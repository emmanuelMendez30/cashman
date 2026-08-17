-- =====================================================
-- Migración: la semana se cierra el domingo
--
-- La rifa se juega el sábado a las 7:30pm hora de Costa Rica. Se da
-- margen hasta la medianoche del sábado para corregir cualquier cosa, y
-- a partir del domingo a las 00:00 esa semana queda cerrada: no se
-- marcan días, ni se agregan clientes, ni se archivan sobre ella. Lo
-- mismo vale para todas las semanas anteriores.
--
-- El admin no queda afectado porque no escribe: sus policies de lectura
-- ya le dejan ver cualquier semana sin importar la fecha.
--
-- Pegá todo esto en Supabase > SQL Editor y ejecutalo.
-- =====================================================

-- Costa Rica es UTC-6 todo el año, pero se usa el nombre de la zona en
-- lugar del desfase fijo para que siga siendo correcto si algún día
-- cambiara. `semana + 6` es el domingo; convertido desde la zona da el
-- instante exacto del cierre.
create or replace function public.semana_editable(p_semana date)
returns boolean
language sql
stable
as $$
  select now() < ((p_semana + 6)::timestamp at time zone 'America/Costa_Rica');
$$;

-- =====================================================
-- Marcas: los días de cada semana
-- =====================================================

drop policy if exists "crear propias marcas" on public.marcas;
create policy "crear propias marcas"
  on public.marcas for insert
  with check (auth.uid() = user_id and public.semana_editable(semana));

drop policy if exists "editar propias marcas" on public.marcas;
create policy "editar propias marcas"
  on public.marcas for update
  using (auth.uid() = user_id and public.semana_editable(semana))
  with check (auth.uid() = user_id and public.semana_editable(semana));

drop policy if exists "borrar propias marcas" on public.marcas;
create policy "borrar propias marcas"
  on public.marcas for delete
  using (auth.uid() = user_id and public.semana_editable(semana));

-- =====================================================
-- Clientes: alta y archivado
-- =====================================================

-- No se puede dar de alta a alguien en una semana ya cerrada.
drop policy if exists "crear propios clientes" on public.clientes;
create policy "crear propios clientes"
  on public.clientes for insert
  with check (auth.uid() = user_id and public.semana_editable(desde));

-- Corregir nombre o teléfono se permite siempre: son datos del cliente, no
-- de una semana, y el sentido de que sean editables es justamente arreglar
-- errores viejos. Lo que sí se controla es el archivado, porque `hasta`
-- decide desde qué semana desaparece.
drop policy if exists "editar propios clientes" on public.clientes;
create policy "editar propios clientes"
  on public.clientes for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (hasta is null or public.semana_editable(hasta))
  );

drop policy if exists "borrar propios clientes" on public.clientes;
create policy "borrar propios clientes"
  on public.clientes for delete
  using (auth.uid() = user_id and public.semana_editable(desde));
