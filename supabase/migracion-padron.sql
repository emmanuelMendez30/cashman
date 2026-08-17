-- =====================================================
-- Migración: separar el padrón de clientes de las marcas semanales
--
-- Antes: una fila por cliente Y por semana. Al cambiar de semana
--        la lista arrancaba vacía y había que reescribir los nombres.
--
-- Ahora: `clientes` es el padrón permanente (un cliente, una fila) y
--        `marcas` guarda los seis días de cada semana. Das de alta al
--        cliente una vez y todas las semanas siguientes solo marcás.
--
-- Es re-ejecutable y NO borra nada: la tabla vieja queda guardada como
-- clientes_semanal_legacy por si hay que mirar hacia atrás.
--
-- Pegá todo esto en Supabase > SQL Editor y ejecutalo.
-- =====================================================

-- 1) Apartar la tabla vieja (conserva sus datos y sus policies)
alter table if exists public.clientes
  rename to clientes_semanal_legacy;

-- 2) El padrón: quién es tu cliente. Una fila por persona.
create table if not exists public.clientes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  nombre      text not null,
  -- Semana (lunes) desde la que el cliente aparece en la lista.
  desde       date not null,
  -- Al archivar se completa con la semana desde la que deja de aparecer.
  -- Las semanas anteriores lo siguen mostrando con lo que compró.
  hasta       date,
  created_at  timestamptz not null default now()
);

-- Un mismo nombre no se puede repetir entre los clientes activos.
-- Si archivás a "Juan" podés volver a darlo de alta más adelante.
create unique index if not exists clientes_user_nombre_activo_key
  on public.clientes (user_id, nombre)
  where hasta is null;

-- 3) Las marcas: qué compró cada cliente en cada semana.
create table if not exists public.marcas (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  semana      date not null,
  lun         boolean not null default false,
  mar         boolean not null default false,
  mie         boolean not null default false,
  jue         boolean not null default false,
  vie         boolean not null default false,
  sab         boolean not null default false,
  nota        text not null default '',
  created_at  timestamptz not null default now(),
  -- Un cliente tiene como máximo una fila de marcas por semana.
  constraint marcas_cliente_semana_key unique (cliente_id, semana)
);

create index if not exists marcas_user_semana_idx
  on public.marcas (user_id, semana);

-- 4) Pasar los datos que ya existían
--    Cada nombre distinto se convierte en un cliente del padrón, y su
--    fecha de alta es la primera semana en la que aparecía.
insert into public.clientes (user_id, nombre, desde)
select l.user_id, l.nombre, min(l.semana)
from public.clientes_semanal_legacy l
group by l.user_id, l.nombre
on conflict do nothing;

--    Y cada fila vieja se convierte en las marcas de esa semana.
insert into public.marcas
  (cliente_id, user_id, semana, lun, mar, mie, jue, vie, sab, nota)
select c.id, l.user_id, l.semana, l.lun, l.mar, l.mie, l.jue, l.vie, l.sab, l.nota
from public.clientes_semanal_legacy l
join public.clientes c
  on c.user_id = l.user_id and c.nombre = l.nombre
on conflict on constraint marcas_cliente_semana_key do nothing;

-- =====================================================
-- Row Level Security: cada usuario solo ve lo suyo
-- =====================================================

alter table public.clientes enable row level security;
alter table public.marcas   enable row level security;

drop policy if exists "ver propios clientes" on public.clientes;
create policy "ver propios clientes"
  on public.clientes for select using (auth.uid() = user_id);

drop policy if exists "crear propios clientes" on public.clientes;
create policy "crear propios clientes"
  on public.clientes for insert with check (auth.uid() = user_id);

drop policy if exists "editar propios clientes" on public.clientes;
create policy "editar propios clientes"
  on public.clientes for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "borrar propios clientes" on public.clientes;
create policy "borrar propios clientes"
  on public.clientes for delete using (auth.uid() = user_id);

drop policy if exists "ver propias marcas" on public.marcas;
create policy "ver propias marcas"
  on public.marcas for select using (auth.uid() = user_id);

drop policy if exists "crear propias marcas" on public.marcas;
create policy "crear propias marcas"
  on public.marcas for insert with check (auth.uid() = user_id);

drop policy if exists "editar propias marcas" on public.marcas;
create policy "editar propias marcas"
  on public.marcas for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "borrar propias marcas" on public.marcas;
create policy "borrar propias marcas"
  on public.marcas for delete using (auth.uid() = user_id);
