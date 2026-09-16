-- =====================================================
-- Migración: dos números por persona en la rifa flash
--
-- La jefa quiere darle dos números a cada uno cuando la rifa es chica.
-- Vale solo para la rifa flash: Cashmana sigue dando uno por semana.
--
-- LA REGLA
--
-- Al cerrar la rifa las marcas ya no se mueven, así que ahí el conteo de
-- participantes es el definitivo, y recién ahí se decide:
--   50 o menos  -> dos números para cada uno
--   más de 50   -> uno solo
--
-- El 50 no es un número al azar: 50 x 2 = 100, que son exactamente los
-- números únicos de la primera vuelta. Hasta ahí nadie comparte número con
-- nadie. Pasando de 50, dar dos obligaría a repetir, y es preferible uno
-- solo antes que repetidos.
--
-- La decisión se toma una vez y no se da marcha atrás: de uno puede subir
-- a dos, nunca al revés, porque un número que ya se cantó no se saca. Si
-- la rifa se reabre y entra más gente, sigue siendo de dos y a los nuevos
-- también les tocan dos.
--
-- Al repartir, los números que alguien ya tiene no se tocan nunca: solo se
-- le dan los que le faltan para llegar a dos.
--
-- Necesita `migracion-rifa-flash.sql`. Es re-ejecutable y no borra datos.
-- Pegá todo esto en Supabase > SQL Editor y ejecutalo.
-- =====================================================

-- Hasta ahora cada cliente tenía un solo número por rifa y este unique lo
-- garantizaba. Ahora puede tener más de uno.
alter table public.flash_numeros
  drop constraint if exists flash_numeros_cliente_key;

-- El unique servía además de índice para buscar los números de un cliente.
-- Al sacarlo hay que dejar uno en su lugar.
create index if not exists flash_numeros_cliente_idx
  on public.flash_numeros (flash_id, cliente_id);

-- El que sigue en pie es el que importa: dentro de una rifa, un número no
-- puede estar dos veces. Eso es lo que hace que el pozo no se pise.

-- Cuántos números le tocan a cada uno en esta rifa. Arranca en uno y lo
-- sube el sorteo, cuando la rifa ya está cerrada y el conteo es final.
alter table public.flash_rifas
  add column if not exists numeros_por_persona integer not null default 1;

alter table public.flash_rifas
  drop constraint if exists flash_rifas_numeros_por_persona_check;

alter table public.flash_rifas
  add constraint flash_rifas_numeros_por_persona_check
  check (numeros_por_persona between 1 and 2);

-- =====================================================
-- Sortear: completar a cada uno los números que le faltan
-- =====================================================

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
  -- 50 x 2 = 100, la primera vuelta entera. Ver la nota de arriba.
  c_tope_dos    constant integer := 50;
  v_rifa        public.flash_rifas%rowtype;
  v_participan  integer;
  v_objetivo    integer;
  v_faltan      integer;
  v_asignados   integer;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede generar los números de la rifa';
  end if;

  -- Candado sobre la fila de la rifa: mientras se reparte, nadie más puede
  -- repartir ni agregar a mano acá, así que dos llamadas a la vez no pueden
  -- ver el mismo número libre.
  select * into v_rifa from public.flash_rifas f where f.id = p_flash_id for update;

  if not found then
    raise exception 'Esa rifa flash no existe';
  end if;

  -- La decisión de los dos números. Solo con la rifa cerrada, porque recién
  -- ahí el conteo es final, y solo si todavía está en uno: de dos no se
  -- vuelve. El `> 0` es para no comprometer a dos una rifa cerrada sin
  -- nadie adentro, que después se reabre y se llena.
  if v_rifa.cerrada and v_rifa.numeros_por_persona = 1 then
    select count(*) into v_participan
    from public.flash_calificados(p_flash_id) q;

    if v_participan > 0 and v_participan <= c_tope_dos then
      update public.flash_rifas
      set numeros_por_persona = 2
      where id = p_flash_id;

      v_rifa.numeros_por_persona := 2;
    end if;
  end if;

  v_objetivo := v_rifa.numeros_por_persona;

  -- Cuántos números faltan repartir: lo que le falta a cada uno que
  -- califica para llegar al objetivo. Se cuenta antes del insert, porque
  -- después ya los tendrían.
  select coalesce(sum(greatest(v_objetivo - coalesce(t.cuantos, 0), 0)), 0)
    into v_faltan
  from public.flash_calificados(p_flash_id) q
  left join (
    select n.cliente_id, count(*) as cuantos
    from public.flash_numeros n
    where n.flash_id = p_flash_id
    group by n.cliente_id
  ) t on t.cliente_id = q.cliente_id;

  with tienen as (
    select n.cliente_id, count(*) as cuantos
    from public.flash_numeros n
    where n.flash_id = p_flash_id
    group by n.cliente_id
  ),
  -- Una fila por número que falta, no por persona: al que le faltan dos
  -- entra dos veces y se lleva dos números distintos. Al que ya los tiene,
  -- `generate_series(1, 0)` no le devuelve ninguna fila y queda como está.
  faltantes as (
    select q.cliente_id as id,
           row_number() over (order by random()) as fila
    from public.flash_calificados(p_flash_id) q
    left join tienen t on t.cliente_id = q.cliente_id
    cross join lateral generate_series(
      1, greatest(v_objetivo - coalesce(t.cuantos, 0), 0)
    ) as g(i)
  ),
  -- El mismo pozo de dos vueltas de siempre, las dos al azar.
  --   Vuelta 1: 0..99, los cien números únicos.
  --   Vuelta 2: 150..199, que se cantan como 50..99. Solo se entra acá
  --             cuando la primera se agotó, y cada número se repite una
  --             única vez, así que el tope es 150 números por rifa.
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
  -- preferimos no repartir nada antes que dejar gente a medias.
  if v_asignados < v_faltan then
    raise exception
      'No alcanzaron los números: faltaron %. El tope son 150 números por rifa (100 únicos más 50 repetidos una sola vez), o sea 75 personas si se reparten de a dos.',
      v_faltan - v_asignados;
  end if;

  -- Una fila por número. Los que califican hoy más los agregados a mano.
  -- Si a alguien le desmarcan una opción, sus números quedan reservados y
  -- los recupera cuando vuelva a tenerlas todas.
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
-- Agregar a mano: le tocan los mismos que a todos
-- =====================================================

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
  v_i         integer;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede agregar clientes a la rifa';
  end if;

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

  -- Le tocan tantos como diga la rifa: si es de dos, entra con dos, para
  -- que no quede en desventaja contra los que salieron sorteados.
  for v_i in 1..v_rifa.numeros_por_persona loop
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
      raise exception 'No quedan números libres. El tope son 150 números por rifa: 100 únicos más 50 repetidos una sola vez.';
    end if;

    insert into public.flash_numeros (flash_id, cliente_id, numero, agregado_por)
    values (p_flash_id, v_cliente.id, v_numero, coalesce(v_email, 'admin'));
  end loop;

  -- La misma forma que devuelve `asignar_numeros_flash`: una fila por
  -- número, para que la pantalla los sume a la lista sin recargar.
  return query
    select n.cliente_id,
           c.nombre,
           c.telefono,
           coalesce(p.email, ''),
           n.numero,
           lpad((n.numero % 100)::text, 2, '0'),
           c.created_at,
           n.agregado_por
    from public.flash_numeros n
    join public.clientes c on c.id = n.cliente_id
    left join public.perfiles p on p.id = c.user_id
    where n.flash_id = p_flash_id and n.cliente_id = v_cliente.id
    order by n.numero;
end;
$$;

notify pgrst, 'reload schema';
