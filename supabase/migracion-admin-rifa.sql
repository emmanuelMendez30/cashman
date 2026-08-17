-- =====================================================
-- Migración: teléfono, rol admin y números de rifa
--
-- Agrega tres cosas:
--   1. Un teléfono opcional en cada cliente.
--   2. Un rol por usuario. El admin ve los clientes de todos.
--   3. Los números de rifa, sorteados una sola vez por semana y
--      guardados, para que dos descargas del Excel nunca difieran.
--
-- Es re-ejecutable y no borra datos.
-- Pegá todo esto en Supabase > SQL Editor y ejecutalo.
-- =====================================================

-- 1) Teléfono del cliente. Opcional: los que ya existen quedan sin número.
alter table public.clientes
  add column if not exists telefono text;

-- =====================================================
-- 2) Roles
-- =====================================================

create table if not exists public.perfiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  rol         text not null default 'usuario' check (rol in ('usuario', 'admin')),
  created_at  timestamptz not null default now()
);

-- Alta automática de perfil cuando se crea un usuario en Supabase.
create or replace function public.crear_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.crear_perfil();

-- Perfiles para los usuarios que ya existían, y marcamos al admin.
insert into public.perfiles (id, email, rol)
select u.id,
       u.email,
       case when u.email = 'admin@srcash.com' then 'admin' else 'usuario' end
from auth.users u
on conflict (id) do update
  set email = excluded.email,
      rol   = case when excluded.email = 'admin@srcash.com' then 'admin'
                   else public.perfiles.rol end;

-- SECURITY DEFINER a propósito: si esta función leyera `perfiles` con los
-- permisos del que llama, las policies que la usan se llamarían a sí mismas
-- en un bucle infinito.
create or replace function public.es_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid() and rol = 'admin'
  );
$$;

alter table public.perfiles enable row level security;

drop policy if exists "ver perfiles" on public.perfiles;
create policy "ver perfiles"
  on public.perfiles for select
  using (id = auth.uid() or public.es_admin());

-- =====================================================
-- 3) El admin ve los clientes y las marcas de todos
-- =====================================================

drop policy if exists "ver propios clientes" on public.clientes;
create policy "ver propios clientes"
  on public.clientes for select
  using (auth.uid() = user_id or public.es_admin());

drop policy if exists "ver propias marcas" on public.marcas;
create policy "ver propias marcas"
  on public.marcas for select
  using (auth.uid() = user_id or public.es_admin());

-- Escribir sigue siendo solo sobre lo propio: el admin mira, no edita
-- los clientes ajenos. Las policies de insert/update/delete no cambian.

-- =====================================================
-- 4) Números de rifa
-- =====================================================

create table if not exists public.rifa_numeros (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  semana      date not null,
  -- Número crudo, único dentro de la semana:
  -- 0..99   -> los cien números únicos, se muestran tal cual.
  -- 150..199 -> la segunda vuelta, se muestra `numero % 100` (50..99), así
  --             que cada uno de esos comparte número con alguien de la
  --             primera vuelta. Cada número se repite una sola vez.
  numero      integer not null check (numero >= 0),
  created_at  timestamptz not null default now(),
  constraint rifa_cliente_semana_key unique (cliente_id, semana),
  constraint rifa_semana_numero_key  unique (semana, numero)
);

alter table public.rifa_numeros enable row level security;

drop policy if exists "ver numeros de rifa" on public.rifa_numeros;
create policy "ver numeros de rifa"
  on public.rifa_numeros for select
  using (public.es_admin());

-- Sortea los números que falten para la semana y devuelve la lista completa.
--
-- Es idempotente: los números ya asignados no se tocan nunca, así que
-- llamarla mil veces devuelve siempre lo mismo. Solo reparte entre los
-- clientes que calificaron y todavía no tienen número.
create or replace function public.asignar_numeros_rifa(p_semana date)
returns table (
  nombre       text,
  telefono     text,
  duenio       text,
  numero       integer,
  numero_rifa  text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_faltan     integer;
  v_asignados  integer;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede generar los números de la rifa';
  end if;

  -- Cuántos calificaron esta semana y todavía no tienen número. Se cuenta
  -- antes del insert, porque después ya lo tendrían.
  select count(*) into v_faltan
  from public.clientes c
  join public.marcas m
    on m.cliente_id = c.id and m.semana = p_semana
  where m.lun and m.mar and m.mie and m.jue and m.vie and m.sab
    and c.desde <= p_semana
    and (c.hasta is null or c.hasta > p_semana)
    and not exists (
      select 1 from public.rifa_numeros r
      where r.cliente_id = c.id and r.semana = p_semana
    );

  with faltantes as (
    select c.id,
           row_number() over (order by random()) as fila
    from public.clientes c
    join public.marcas m
      on m.cliente_id = c.id and m.semana = p_semana
    where m.lun and m.mar and m.mie and m.jue and m.vie and m.sab
      and c.desde <= p_semana
      and (c.hasta is null or c.hasta > p_semana)
      and not exists (
        select 1 from public.rifa_numeros r
        where r.cliente_id = c.id and r.semana = p_semana
      )
  ),
  -- El pozo tiene dos vueltas y las dos se reparten al azar.
  --   Vuelta 1: 0..99, los cien números únicos.
  --   Vuelta 2: 150..199, que se muestran como 50..99. Solo se entra acá
  --             cuando la primera vuelta se agotó, y cada número se repite
  --             una única vez, así que el tope es 150 por semana.
  libres as (
    select t.n,
           row_number() over (order by t.vuelta, random()) as fila
    from (
      select g.n, 1 as vuelta from generate_series(0, 99)    as g(n)
      union all
      select g.n, 2 as vuelta from generate_series(150, 199) as g(n)
    ) t
    where not exists (
      select 1 from public.rifa_numeros r
      where r.semana = p_semana and r.numero = t.n
    )
  )
  insert into public.rifa_numeros (cliente_id, semana, numero)
  select f.id, p_semana, l.n
  from faltantes f
  join libres l on l.fila = f.fila;

  get diagnostics v_asignados = row_count;

  -- Si el pozo no alcanzó, la excepción revierte el insert entero: preferimos
  -- no repartir nada antes que dejar gente afuera sin avisar.
  if v_asignados < v_faltan then
    raise exception
      'Quedaron % clientes sin número. El tope es 150 por semana: 100 únicos más 50 repetidos una sola vez.',
      v_faltan - v_asignados;
  end if;

  -- Devolvemos solo a los que califican hoy. Si alguien se desmarca, su
  -- número queda reservado y lo recupera si vuelve a calificar.
  return query
    select c.nombre,
           c.telefono,
           p.email,
           r.numero,
           lpad((r.numero % 100)::text, 2, '0')
    from public.rifa_numeros r
    join public.clientes c on c.id = r.cliente_id
    join public.perfiles p on p.id = c.user_id
    join public.marcas m
      on m.cliente_id = c.id and m.semana = p_semana
    where r.semana = p_semana
      and m.lun and m.mar and m.mie and m.jue and m.vie and m.sab
    order by r.numero;
end;
$$;

-- Padrón completo de todos los usuarios, para la vista del admin.
create or replace function public.admin_padron()
returns table (
  nombre    text,
  telefono  text,
  duenio    text,
  desde     date,
  hasta     date
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede ver el padrón completo';
  end if;

  return query
    select c.nombre, c.telefono, p.email, c.desde, c.hasta
    from public.clientes c
    join public.perfiles p on p.id = c.user_id
    order by p.email, c.nombre;
end;
$$;
