-- =====================================================
-- Migración: el admin mete clientes a la rifa a mano
--
-- Pasa que alguien compró los seis días y queda afuera de la lista:
-- el encargado se olvidó de marcar un día, o la persona nunca se dio
-- de alta. Con esto el admin lo mete en el momento, sin tocar los días
-- de nadie y sin tener que pedirle nada al encargado.
--
-- El agregado a mano queda firmado con el correo del admin, y la lista
-- lo muestra marcado, así el sorteo se sigue pudiendo auditar: se ve de
-- un vistazo quién salió del azar y quién entró por decisión de alguien.
--
-- La semana cerrada no se toca, tampoco para el admin. La rifa se juega
-- el sábado 7:30 p.m. y hay margen hasta la medianoche; desde el domingo
-- el resultado es histórico y modificarlo dejaría las exportaciones ya
-- repartidas sin coincidir con la base.
--
-- Es re-ejecutable y no borra datos.
-- Pegá todo esto en Supabase > SQL Editor y ejecutalo.
-- =====================================================

-- Quién lo agregó a mano. Null es lo normal: salió del sorteo automático
-- entre los que completaron los seis días.
alter table public.rifa_numeros
  add column if not exists agregado_por text;

-- =====================================================
-- 1) Un número libre del pozo
-- =====================================================

-- El mismo pozo de dos vueltas que usa el sorteo automático:
--   Vuelta 1: 0..99, los cien números únicos.
--   Vuelta 2: 150..199, que se cantan como 50..99 y comparten número con
--             alguien de la primera. Cada uno se repite una sola vez.
-- Devuelve null cuando ya no queda ninguno, o sea a los 150 de la semana.
-- Volátil a propósito, aunque parezca de solo lectura: devuelve uno al azar
-- entre los libres, así que dos llamadas seguidas no tienen por qué dar lo
-- mismo y el planificador no puede reusar el resultado.
create or replace function public.numero_libre_rifa(p_semana date)
returns integer
language sql
security definer
volatile
set search_path = public
as $$
  select t.n
  from (
    select g.n, 1 as vuelta from generate_series(0, 99)    as g(n)
    union all
    select g.n, 2 as vuelta from generate_series(150, 199) as g(n)
  ) t
  where not exists (
    select 1 from public.rifa_numeros r
    where r.semana = p_semana and r.numero = t.n
  )
  order by t.vuelta, random()
  limit 1;
$$;

-- =====================================================
-- 2) Agregar a la rifa
-- =====================================================

-- Dos formas de llamarla, según el caso:
--   p_cliente_id  -> la persona ya está en el padrón de algún encargado.
--   p_nombre      -> no está en ningún lado; se crea a nombre del admin
--                    y se mete a la rifa en un solo paso.
create or replace function public.admin_agregar_a_rifa(
  p_semana     date,
  p_cliente_id uuid default null,
  p_nombre     text default null,
  p_telefono   text default null
)
returns table (
  cliente_id   uuid,
  nombre       text,
  telefono     text,
  duenio       text,
  numero       integer,
  numero_rifa  text,
  creado       timestamptz,
  agregado_por text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente  public.clientes%rowtype;
  v_email    text;
  v_numero   integer;
  v_nombre   text;
  v_telefono text;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede agregar clientes a la rifa';
  end if;

  if not public.semana_editable(p_semana) then
    raise exception 'Esa semana ya cerró y la rifa quedó como histórico: no se puede agregar a nadie';
  end if;

  select p.email into v_email from public.perfiles p where p.id = auth.uid();

  -- Nadie más puede estar repartiendo números de esta semana mientras
  -- elegimos uno libre. Es el mismo candado que toma el sorteo automático,
  -- que corre solo cada vez que se abre la pestaña de la rifa. La clave es
  -- la cantidad de días desde el 2000: un número distinto por semana, sin
  -- depender de una función de hash.
  perform pg_advisory_xact_lock(p_semana - date '2000-01-01');

  if p_cliente_id is not null then
    select * into v_cliente from public.clientes c where c.id = p_cliente_id;

    if not found then
      raise exception 'Ese cliente no existe';
    end if;

    -- Vigencia: el padrón usa `desde` y `hasta` para decidir en qué semanas
    -- aparece cada persona, y meterlo en una semana donde no figuraba
    -- dejaría la rifa contando a alguien que la lista no muestra.
    if v_cliente.desde > p_semana then
      raise exception 'A % lo dieron de alta después de esa semana', v_cliente.nombre;
    end if;

    if v_cliente.hasta is not null and v_cliente.hasta <= p_semana then
      raise exception '% quedó archivado antes de esa semana', v_cliente.nombre;
    end if;
  else
    v_nombre   := nullif(btrim(p_nombre), '');
    v_telefono := nullif(btrim(p_telefono), '');

    if v_nombre is null then
      raise exception 'Falta el nombre del cliente';
    end if;

    -- La misma regla que el CHECK de la tabla, pero avisada con palabras:
    -- si no, el error que llega a la pantalla es el del constraint.
    if v_telefono is not null and v_telefono !~ '^[0-9]{8}$' then
      raise exception 'El teléfono tiene que ser de 8 dígitos';
    end if;

    -- El cliente nuevo queda a nombre del admin, que es quien lo dio de
    -- alta. Si el encargado ya lo tenía cargado hay que elegirlo del
    -- buscador en vez de crearlo otra vez, o queda repetido en el padrón.
    begin
      insert into public.clientes (user_id, nombre, telefono, desde)
      values (auth.uid(), v_nombre, v_telefono, p_semana)
      returning * into v_cliente;
    exception when unique_violation then
      raise exception 'Ya diste de alta a % vos mismo. Buscalo en la lista en vez de crearlo de nuevo.', v_nombre;
    end;
  end if;

  if exists (
    select 1 from public.rifa_numeros r
    where r.semana = p_semana and r.cliente_id = v_cliente.id
  ) then
    raise exception '% ya tiene número en esta semana', v_cliente.nombre;
  end if;

  v_numero := public.numero_libre_rifa(p_semana);

  if v_numero is null then
    raise exception 'No quedan números libres. El tope es 150 por semana: 100 únicos más 50 repetidos una sola vez.';
  end if;

  insert into public.rifa_numeros (cliente_id, semana, numero, agregado_por)
  values (v_cliente.id, p_semana, v_numero, coalesce(v_email, 'admin'));

  -- La misma forma de fila que devuelve `asignar_numeros_rifa`, para que la
  -- pantalla la sume a la lista sin recargar. `duenio` es el encargado del
  -- cliente, que no tiene por qué ser el admin que lo agregó.
  --
  -- El join al perfil va por izquierda: si por lo que sea el encargado no
  -- tuviera fila en `perfiles`, la función igual devuelve su fila. Volver
  -- vacío sería peor, porque el cliente ya quedó adentro de la rifa y la
  -- pantalla mostraría un error sobre algo que sí se guardó.
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

-- =====================================================
-- 3) Quitar de la rifa
-- =====================================================

-- Para deshacer un agregado equivocado: nombre mal escrito, persona
-- confundida. Solo alcanza a los que entraron a mano — un número que
-- salió del sorteo no se quita, porque el azar ya se jugó y sacarlo
-- sería elegir a dedo quién no participa. El número vuelve al pozo.
create or replace function public.admin_quitar_de_rifa(
  p_semana     date,
  p_cliente_id uuid
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

  if not public.semana_editable(p_semana) then
    raise exception 'Esa semana ya cerró y la rifa quedó como histórico: no se puede quitar a nadie';
  end if;

  delete from public.rifa_numeros r
  where r.semana = p_semana
    and r.cliente_id = p_cliente_id
    and r.agregado_por is not null;

  if not found then
    raise exception 'Ese número salió del sorteo, no se agregó a mano: no se puede quitar';
  end if;
end;
$$;

-- =====================================================
-- 4) El sorteo devuelve también a los agregados a mano
-- =====================================================

-- Cambia solo la consulta final: los agregados a mano no tienen los seis
-- días marcados, así que el filtro de siempre los dejaba afuera de la
-- lista aunque ya tuvieran número guardado. Ahora entran por su cuenta,
-- y se devuelven dos columnas nuevas (`cliente_id` para poder quitarlos,
-- `agregado_por` para marcarlos en pantalla).
--
-- El reparto automático no cambia: sigue siendo solo para los que
-- completaron los seis días y sigue sin tocar un número ya asignado.
--
-- Postgres no deja cambiar las columnas que devuelve una función con
-- `create or replace`, así que primero se borra.
drop function if exists public.asignar_numeros_rifa(date);

create or replace function public.asignar_numeros_rifa(p_semana date)
returns table (
  cliente_id   uuid,
  nombre       text,
  telefono     text,
  duenio       text,
  numero       integer,
  numero_rifa  text,
  -- Cuándo se dio de alta el cliente. Sirve para comprobar a simple vista
  -- que el sorteo fue al azar: ordenando por esta columna, los números
  -- tienen que salir salteados.
  creado       timestamptz,
  -- Correo del admin que lo metió a mano, o null si salió del sorteo.
  agregado_por text
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

  -- Mismo candado que toma `admin_agregar_a_rifa`: si el admin agrega a
  -- alguien en una pestaña mientras otra está repartiendo, los dos podrían
  -- ver el mismo número libre y uno de los dos inserts fallaría.
  perform pg_advisory_xact_lock(p_semana - date '2000-01-01');

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

  -- Devolvemos a los que califican hoy más a los agregados a mano. Si
  -- alguien se desmarca, su número queda reservado y lo recupera si vuelve
  -- a calificar; el agregado a mano no depende de las marcas, por eso el
  -- join a `marcas` pasa a ser left.
  return query
    select r.cliente_id,
           c.nombre,
           c.telefono,
           p.email,
           r.numero,
           lpad((r.numero % 100)::text, 2, '0'),
           c.created_at,
           r.agregado_por
    from public.rifa_numeros r
    join public.clientes c on c.id = r.cliente_id
    join public.perfiles p on p.id = c.user_id
    left join public.marcas m
      on m.cliente_id = c.id and m.semana = p_semana
    where r.semana = p_semana
      and (
        r.agregado_por is not null
        or (m.lun and m.mar and m.mie and m.jue and m.vie and m.sab)
      )
    order by r.numero;
end;
$$;
