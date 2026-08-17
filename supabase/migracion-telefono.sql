-- =====================================================
-- Migración: el teléfono tiene que ser 8 dígitos
--
-- La validación del formulario evita el 99% de los errores, pero la
-- que de verdad manda es esta: cualquier cosa que escriba en la base,
-- venga de donde venga, tiene que cumplirla.
--
-- Sigue siendo opcional: null pasa, lo que no pasa es un número mal
-- formado. Pegá esto en Supabase > SQL Editor y ejecutalo.
-- =====================================================

-- Por si quedó algún teléfono cargado antes de esta regla: se limpia lo
-- que no sean exactamente 8 dígitos, en vez de fallar al crear el check.
update public.clientes
set telefono = null
where telefono is not null
  and telefono !~ '^[0-9]{8}$';

alter table public.clientes
  drop constraint if exists clientes_telefono_formato;

alter table public.clientes
  add constraint clientes_telefono_formato
  check (telefono is null or telefono ~ '^[0-9]{8}$');
