-- =====================================================
-- Migración: el admin también marca en la rifa flash
--
-- Hasta ahora cada encargado marcaba solo a sus clientes, y el admin los
-- veía a todos pero sin poder tocar los ajenos. Si un encargado falta, se
-- olvida de marcar o se equivoca, alguien tiene que poder arreglarlo en el
-- momento, y esa persona es el admin.
--
-- Vale solo para la rifa flash. En Cashmana el admin sigue mirando sin
-- editar: ahí la semana es del encargado.
--
-- Lo que no cambia es el cierre: con la rifa cerrada no marca nadie,
-- tampoco el admin. Para eso está reabrirla.
--
-- Reemplaza dos policies y nada más. Es re-ejecutable y no borra datos.
-- Pegá todo esto en Supabase > SQL Editor y ejecutalo.
-- =====================================================

-- Los nombres viejos hablaban de clientes "propios", que ya no es lo que
-- las policies dicen. Se borran los dos nombres, el viejo y el nuevo, para
-- que el archivo se pueda correr las veces que haga falta.
drop policy if exists "marcar propios clientes flash" on public.flash_marcas;
drop policy if exists "desmarcar propios clientes flash" on public.flash_marcas;
drop policy if exists "marcar clientes flash" on public.flash_marcas;
drop policy if exists "desmarcar clientes flash" on public.flash_marcas;

create policy "marcar clientes flash"
  on public.flash_marcas for insert
  with check (
    public.flash_abierta(flash_id)
    and (
      public.es_admin()
      or exists (
        select 1 from public.clientes c
        where c.id = flash_marcas.cliente_id and c.user_id = auth.uid()
      )
    )
  );

create policy "desmarcar clientes flash"
  on public.flash_marcas for delete
  using (
    public.flash_abierta(flash_id)
    and (
      public.es_admin()
      or exists (
        select 1 from public.clientes c
        where c.id = flash_marcas.cliente_id and c.user_id = auth.uid()
      )
    )
  );

-- El nombre, el día y la hora de la rifa los corrige el admin desde el
-- módulo, y para eso no hace falta tocar nada acá: la policy "admin edita
-- rifas flash" ya lo deja actualizar la fila entera. Es la misma que usa
-- para cerrar y reabrir, y a propósito no mira si la rifa está abierta,
-- porque si mirara no habría forma de reabrir una cerrada. Quien no
-- permite editar una rifa cerrada es la pantalla.

notify pgrst, 'reload schema';
