-- =====================================================
-- Migración: Rifa Flash
--
-- Un segundo módulo al lado de Cashmana. Cashmana es la rifa de todas
-- las semanas, con seis días fijos. La rifa flash es la que se arma
-- cuando conviene: un feriado, un aniversario, un día flojo. El admin la
-- crea para una fecha, le pone las opciones que quiera ("Sorteo 1",
-- "Sorteo 2"...) y cada encargado marca a sus clientes. Califica quien
-- tiene marcadas TODAS las opciones de esa rifa: con dos hacen falta las
-- dos, con tres las tres.
--
-- Los clientes son los mismos. La rifa flash lee el padrón de siempre y
-- no tiene uno propio: el que se da de alta en Cashmana aparece acá.
--
-- A diferencia de la semana de Cashmana, la rifa flash no se cierra sola
-- con la hora. Queda abierta hasta que el admin la cierra, y el admin la
-- puede reabrir si la cerró antes de tiempo.
--
-- Los números se reparten igual que en Cashmana: el mismo pozo de dos
-- vueltas, el mismo tope de 150, se sortean una sola vez y quedan
-- guardados, y el admin puede meter a alguien a mano.
--
-- Necesita las migraciones anteriores: usa es_admin() y `perfiles`.
-- No toca nada de Cashmana. Es re-ejecutable y no borra datos.
-- Pegá todo esto en Supabase > SQL Editor y ejecutalo.
-- =====================================================

-- =====================================================
-- 1) Tablas
-- =====================================================

-- Una rifa flash: cómo se llama, qué día se juega y si ya está cerrada.
create table if not exists public.flash_rifas (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null check (btrim(nombre) <> ''),
  fecha        date not null,
  -- Lo que va en la imagen después del día, por ejemplo "7:30 p.m.".
  -- Opcional: sin hora, la imagen dice solo el día.
  hora_sorteo  text,
  -- La cierra el admin a mano, no el reloj. Cerrada, nadie marca ni
  -- cambia opciones, y no se agrega ni se quita gente de la rifa.
  cerrada      boolean not null default false,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- Las opciones que hay que marcar en cada rifa.
create table if not exists public.flash_opciones (
  id          uuid primary key default gen_random_uuid(),
  flash_id    uuid not null references public.flash_rifas(id) on delete cascade,
  nombre      text not null check (btrim(nombre) <> ''),
  orden       integer not null default 0,
  created_at  timestamptz not null default now(),
  -- Existe para la foreign key compuesta de `flash_marcas`, que exige que
  -- la opción marcada sea de la misma rifa que dice la marca.
  constraint flash_opciones_id_flash_key unique (id, flash_id)
);

-- Una fila por opción marcada: si la fila está, el cliente tiene esa
-- opción. Desmarcar es borrar la fila.
--
-- `flash_id` repite lo que ya dice la opción, para filtrar y chequear
-- permisos sin un join. La foreign key compuesta garantiza que las dos
-- cosas no se contradigan: una marca no puede decir una rifa y apuntar a
-- la opción de otra.
create table if not exists public.flash_marcas (
  opcion_id   uuid not null,
  flash_id    uuid not null,
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (opcion_id, cliente_id),
  constraint flash_marcas_opcion_fkey
    foreign key (opcion_id, flash_id)
    references public.flash_opciones (id, flash_id)
    on delete cascade
);

create index if not exists flash_marcas_flash_cliente_idx
  on public.flash_marcas (flash_id, cliente_id);

-- Los números de cada rifa flash. La misma forma que `rifa_numeros` de
-- Cashmana, con la rifa en lugar de la semana.
create table if not exists public.flash_numeros (
  id            uuid primary key default gen_random_uuid(),
  flash_id      uuid not null references public.flash_rifas(id) on delete cascade,
  cliente_id    uuid not null references public.clientes(id) on delete cascade,
  -- 0..99 es la primera vuelta; 150..199 la segunda, que se canta como
  -- `numero % 100`. Igual que en Cashmana.
  numero        integer not null check (numero >= 0),
  -- Correo del admin si entró a mano; null si salió del sorteo.
  agregado_por  text,
  created_at    timestamptz not null default now(),
  constraint flash_numeros_cliente_key unique (flash_id, cliente_id),
  constraint flash_numeros_numero_key  unique (flash_id, numero)
);

-- =====================================================
-- 2) Funciones de apoyo
-- =====================================================

-- El lunes de la semana de una fecha, que es como el padrón guarda `desde`
-- y `hasta`. El domingo cuenta como parte de la semana que termina, igual
-- que `lunesDe` en lib/semanas.js. Es pura aritmética de fechas, así que
-- la zona horaria de la sesión no puede correrla un día.
create or replace function public.lunes_de(p_fecha date)
returns date
language sql
immutable
as $$
  select p_fecha - (extract(isodow from p_fecha)::int - 1);
$$;

-- SECURITY DEFINER por lo mismo que es_admin(): la usan las policies, y
-- la respuesta no tiene que depender de lo que el que llama puede leer.
create or replace function public.flash_abierta(p_flash_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.flash_rifas f
    where f.id = p_flash_id and not f.cerrada
  );
$$;

-- Los clientes que califican en una rifa flash: vigentes en el padrón la
-- semana de la rifa, y con tantas opciones marcadas como opciones tiene la
-- rifa. La clave primaria de `flash_marcas` impide marcar dos veces la
-- misma, así que contar alcanza para saber que están todas.
--
-- Una rifa sin opciones no deja calificar a nadie: ningún grupo cuenta 0.
--
-- Sin SECURITY DEFINER a propósito: llamada por un encargado solo ve sus
-- propias marcas, y adentro de las funciones del admin corre con los
-- permisos de esas funciones.
create or replace function public.flash_calificados(p_flash_id uuid)
returns table (cliente_id uuid)
language sql
stable
set search_path = public
as $$
  select m.cliente_id
  from public.flash_marcas m
  join public.flash_rifas f on f.id = m.flash_id
  join public.clientes c on c.id = m.cliente_id
  where m.flash_id = p_flash_id
    and c.desde <= public.lunes_de(f.fecha)
    and (c.hasta is null or c.hasta > public.lunes_de(f.fecha))
  group by m.cliente_id
  having count(*) = (
    select count(*) from public.flash_opciones o
    where o.flash_id = p_flash_id
  );
$$;

-- =====================================================
-- 3) Permisos
-- =====================================================

alter table public.flash_rifas    enable row level security;
alter table public.flash_opciones enable row level security;
alter table public.flash_marcas   enable row level security;
alter table public.flash_numeros  enable row level security;

-- Las rifas y sus opciones las ve todo el que entra: el encargado necesita
-- saber qué rifas hay y qué tiene que marcar. No hay policy de insert: se
-- crean con `admin_crear_flash`, que da de alta la rifa y sus opciones en
-- un solo paso.
drop policy if exists "ver rifas flash" on public.flash_rifas;
create policy "ver rifas flash"
  on public.flash_rifas for select
  to authenticated
  using (true);

-- Editar es lo que cierra y reabre, y eso tiene que andar siempre: por eso
-- esta no mira si la rifa está abierta.
drop policy if exists "admin edita rifas flash" on public.flash_rifas;
create policy "admin edita rifas flash"
  on public.flash_rifas for update
  using (public.es_admin())
  with check (public.es_admin());

-- Borrar, solo mientras está abierta: una rifa cerrada ya se jugó.
drop policy if exists "admin borra rifas flash" on public.flash_rifas;
create policy "admin borra rifas flash"
  on public.flash_rifas for delete
  using (public.es_admin() and not cerrada);

drop policy if exists "ver opciones flash" on public.flash_opciones;
create policy "ver opciones flash"
  on public.flash_opciones for select
  to authenticated
  using (true);

drop policy if exists "admin crea opciones flash" on public.flash_opciones;
create policy "admin crea opciones flash"
  on public.flash_opciones for insert
  with check (public.es_admin() and public.flash_abierta(flash_id));

drop policy if exists "admin edita opciones flash" on public.flash_opciones;
create policy "admin edita opciones flash"
  on public.flash_opciones for update
  using (public.es_admin() and public.flash_abierta(flash_id))
  with check (public.es_admin() and public.flash_abierta(flash_id));

drop policy if exists "admin borra opciones flash" on public.flash_opciones;
create policy "admin borra opciones flash"
  on public.flash_opciones for delete
  using (public.es_admin() and public.flash_abierta(flash_id));

-- Marcas: como en Cashmana, cada encargado marca solo a sus clientes y el
-- admin ve las de todos. Con la rifa cerrada no se marca ni se desmarca.
drop policy if exists "ver marcas flash" on public.flash_marcas;
create policy "ver marcas flash"
  on public.flash_marcas for select
  using (
    public.es_admin()
    or exists (
      select 1 from public.clientes c
      where c.id = flash_marcas.cliente_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "marcar propios clientes flash" on public.flash_marcas;
create policy "marcar propios clientes flash"
  on public.flash_marcas for insert
  with check (
    public.flash_abierta(flash_id)
    and exists (
      select 1 from public.clientes c
      where c.id = flash_marcas.cliente_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "desmarcar propios clientes flash" on public.flash_marcas;
create policy "desmarcar propios clientes flash"
  on public.flash_marcas for delete
  using (
    public.flash_abierta(flash_id)
    and exists (
      select 1 from public.clientes c
      where c.id = flash_marcas.cliente_id and c.user_id = auth.uid()
    )
  );

-- Los números solo los ve el admin, igual que en Cashmana, y se escriben
-- únicamente desde las funciones de abajo.
drop policy if exists "ver numeros flash" on public.flash_numeros;
create policy "ver numeros flash"
  on public.flash_numeros for select
  using (public.es_admin());

-- =====================================================
-- 4) Crear una rifa flash
-- =====================================================

-- La rifa y sus opciones van juntas: una rifa sin opciones no sirve para
-- nada, y si el alta se cortara a la mitad quedaría una así.
create or replace function public.admin_crear_flash(
  p_nombre       text,
  p_fecha        date,
  p_hora_sorteo  text,
  p_opciones     text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id        uuid;
  v_nombre    text := nullif(btrim(p_nombre), '');
  v_opciones  text[];
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede crear rifas flash';
  end if;

  if v_nombre is null then
    raise exception 'Falta el nombre de la rifa';
  end if;

  if p_fecha is null then
    raise exception 'Falta el día de la rifa';
  end if;

  -- Opciones sin espacios de más y sin vacías, en el orden en que vinieron.
  select coalesce(array_agg(btrim(t.o) order by t.i), '{}')
    into v_opciones
  from unnest(p_opciones) with ordinality as t(o, i)
  where btrim(t.o) <> '';

  if cardinality(v_opciones) = 0 then
    raise exception 'La rifa necesita al menos una opción para marcar';
  end if;

  insert into public.flash_rifas (nombre, fecha, hora_sorteo, created_by)
  values (v_nombre, p_fecha, nullif(btrim(p_hora_sorteo), ''), auth.uid())
  returning id into v_id;

  insert into public.flash_opciones (flash_id, nombre, orden)
  select v_id, t.o, t.i::int
  from unnest(v_opciones) with ordinality as t(o, i);

  return v_id;
end;
$$;

-- =====================================================
-- 5) Sortear los números
-- =====================================================

-- Exactamente la lógica de `asignar_numeros_rifa` de Cashmana, con la rifa
-- flash en lugar de la semana: sortea los números que falten, nunca toca
-- uno ya dado, y devuelve la lista completa. Llamarla mil veces devuelve
-- siempre lo mismo.
create or replace function public.asignar_numeros_flash(p_flash_id uuid)
returns table (
  cliente_id    uuid,
  nombre        text,
  telefono      text,
  duenio        text,
  numero        integer,
  numero_rifa   text,
  creado        timestamptz,
  agregado_por  text
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

  -- Candado sobre la fila de la rifa: mientras se reparte, nadie más puede
  -- repartir ni agregar a mano en esta rifa, así que dos llamadas a la vez
  -- no pueden ver el mismo número libre. Lo toman las tres funciones que
  -- escriben números.
  perform 1 from public.flash_rifas f where f.id = p_flash_id for update;

  if not found then
    raise exception 'Esa rifa flash no existe';
  end if;

  -- Cuántos califican y todavía no tienen número. Se cuenta antes del
  -- insert, porque después ya lo tendrían.
  select count(*) into v_faltan
  from public.flash_calificados(p_flash_id) q
  where not exists (
    select 1 from public.flash_numeros ya
    where ya.flash_id = p_flash_id and ya.cliente_id = q.cliente_id
  );

  with faltantes as (
    select q.cliente_id as id,
           row_number() over (order by random()) as fila
    from public.flash_calificados(p_flash_id) q
    where not exists (
      select 1 from public.flash_numeros ya
      where ya.flash_id = p_flash_id and ya.cliente_id = q.cliente_id
    )
  ),
  -- El mismo pozo de dos vueltas de Cashmana, las dos al azar.
  --   Vuelta 1: 0..99, los cien números únicos.
  --   Vuelta 2: 150..199, que se cantan como 50..99. Solo se entra acá
  --             cuando la primera se agotó, y cada número se repite una
  --             única vez, así que el tope es 150 por rifa.
  libres as (
    select t.n,
           row_number() over (order by t.vuelta, random()) as fila
    from (
      select g.n, 1 as vuelta from generate_series(0, 99)    as g(n)
      union all
      select g.n, 2 as vuelta from generate_series(150, 199) as g(n)
    ) t
    where not exists (
      select 1 from public.flash_numeros ya
      where ya.flash_id = p_flash_id and ya.numero = t.n
    )
  )
  insert into public.flash_numeros (flash_id, cliente_id, numero)
  select p_flash_id, f.id, l.n
  from faltantes f
  join libres l on l.fila = f.fila;

  get diagnostics v_asignados = row_count;

  -- Si el pozo no alcanzó, la excepción revierte el insert entero:
  -- preferimos no repartir nada antes que dejar gente afuera sin avisar.
  if v_asignados < v_faltan then
    raise exception
      'Quedaron % clientes sin número. El tope es 150 por rifa: 100 únicos más 50 repetidos una sola vez.',
      v_faltan - v_asignados;
  end if;

  -- Los que califican hoy más los agregados a mano. Si a alguien le
  -- desmarcan una opción, o el admin agrega una opción nueva, su número
  -- queda reservado y lo recupera cuando vuelva a tenerlas todas.
  return query
    select n.cliente_id,
           c.nombre,
           c.telefono,
           p.email,
           n.numero,
           lpad((n.numero % 100)::text, 2, '0'),
           c.created_at,
           n.agregado_por
    from public.flash_numeros n
    join public.clientes c on c.id = n.cliente_id
    left join public.perfiles p on p.id = c.user_id
    where n.flash_id = p_flash_id
      and (
        n.agregado_por is not null
        or n.cliente_id in (
          select q.cliente_id from public.flash_calificados(p_flash_id) q
        )
      )
    order by n.numero;
end;
$$;

-- =====================================================
-- 6) Meter a alguien a mano, y deshacerlo
-- =====================================================

-- Igual que `admin_agregar_a_rifa` de Cashmana. Dos formas de llamarla:
--   p_cliente_id  -> la persona ya está en el padrón de algún encargado.
--   p_nombre      -> no está en ningún lado; se crea a nombre del admin,
--                    desde la semana de la rifa, y entra en el mismo paso.
create or replace function public.admin_agregar_a_flash(
  p_flash_id    uuid,
  p_cliente_id  uuid default null,
  p_nombre      text default null,
  p_telefono    text default null
)
returns table (
  cliente_id    uuid,
  nombre        text,
  telefono      text,
  duenio        text,
  numero        integer,
  numero_rifa   text,
  creado        timestamptz,
  agregado_por  text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rifa      public.flash_rifas%rowtype;
  v_lunes     date;
  v_cliente   public.clientes%rowtype;
  v_email     text;
  v_numero    integer;
  v_nombre    text;
  v_telefono  text;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede agregar clientes a la rifa';
  end if;

  -- El mismo candado que toma el sorteo: ver `asignar_numeros_flash`.
  select * into v_rifa from public.flash_rifas f where f.id = p_flash_id for update;

  if not found then
    raise exception 'Esa rifa flash no existe';
  end if;

  if v_rifa.cerrada then
    raise exception 'Esa rifa flash está cerrada: no se puede agregar a nadie. Si hace falta, reabrila desde el módulo Rifa Flash.';
  end if;

  v_lunes := public.lunes_de(v_rifa.fecha);

  select p.email into v_email from public.perfiles p where p.id = auth.uid();

  if p_cliente_id is not null then
    select * into v_cliente from public.clientes c where c.id = p_cliente_id;

    if not found then
      raise exception 'Ese cliente no existe';
    end if;

    if v_cliente.desde > v_lunes then
      raise exception 'A % lo dieron de alta después de la semana de esta rifa', v_cliente.nombre;
    end if;

    if v_cliente.hasta is not null and v_cliente.hasta <= v_lunes then
      raise exception '% quedó archivado antes de la semana de esta rifa', v_cliente.nombre;
    end if;
  else
    v_nombre   := nullif(btrim(p_nombre), '');
    v_telefono := nullif(btrim(p_telefono), '');

    if v_nombre is null then
      raise exception 'Falta el nombre del cliente';
    end if;

    if v_telefono is not null and v_telefono !~ '^[0-9]{8}$' then
      raise exception 'El teléfono tiene que ser de 8 dígitos';
    end if;

    begin
      insert into public.clientes (user_id, nombre, telefono, desde)
      values (auth.uid(), v_nombre, v_telefono, v_lunes)
      returning * into v_cliente;
    exception when unique_violation then
      raise exception 'Ya diste de alta a % vos mismo. Buscalo en la lista en vez de crearlo de nuevo.', v_nombre;
    end;
  end if;

  if exists (
    select 1 from public.flash_numeros ya
    where ya.flash_id = p_flash_id and ya.cliente_id = v_cliente.id
  ) then
    raise exception '% ya tiene número en esta rifa', v_cliente.nombre;
  end if;

  -- Un número libre del mismo pozo: primero la primera vuelta, al azar.
  select t.n into v_numero
  from (
    select g.n, 1 as vuelta from generate_series(0, 99)    as g(n)
    union all
    select g.n, 2 as vuelta from generate_series(150, 199) as g(n)
  ) t
  where not exists (
    select 1 from public.flash_numeros ya
    where ya.flash_id = p_flash_id and ya.numero = t.n
  )
  order by t.vuelta, random()
  limit 1;

  if v_numero is null then
    raise exception 'No quedan números libres. El tope es 150 por rifa: 100 únicos más 50 repetidos una sola vez.';
  end if;

  insert into public.flash_numeros (flash_id, cliente_id, numero, agregado_por)
  values (p_flash_id, v_cliente.id, v_numero, coalesce(v_email, 'admin'));

  -- La misma forma de fila que devuelve `asignar_numeros_flash`. El join al
  -- perfil va por izquierda para que siempre vuelva una fila: el cliente ya
  -- quedó adentro y la pantalla no tiene que mostrar un error por eso.
  return query
    select v_cliente.id,
           v_cliente.nombre,
           v_cliente.telefono,
           coalesce(p.email, ''),
           v_numero,
           lpad((v_numero % 100)::text, 2, '0'),
           v_cliente.created_at,
           coalesce(v_email, 'admin')
    from (select 1) as fila
    left join public.perfiles p on p.id = v_cliente.user_id;
end;
$$;

-- Solo alcanza a los agregados a mano: un número que salió del sorteo no
-- se quita, porque sacarlo sería elegir a dedo quién no participa.
create or replace function public.admin_quitar_de_flash(
  p_flash_id    uuid,
  p_cliente_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede quitar clientes de la rifa';
  end if;

  perform 1 from public.flash_rifas f
  where f.id = p_flash_id and not f.cerrada
  for update;

  if not found then
    raise exception 'Esa rifa flash está cerrada: no se puede quitar a nadie';
  end if;

  delete from public.flash_numeros ya
  where ya.flash_id = p_flash_id
    and ya.cliente_id = p_cliente_id
    and ya.agregado_por is not null;

  if not found then
    raise exception 'Ese número salió del sorteo, no se agregó a mano: no se puede quitar';
  end if;
end;
$$;

-- La API de Supabase guarda en caché qué tablas y relaciones hay. Esto le
-- avisa que cambiaron, para que la app vea las tablas nuevas sin esperar.
notify pgrst, 'reload schema';
