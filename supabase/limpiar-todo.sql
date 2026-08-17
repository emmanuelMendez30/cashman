-- =====================================================
-- Dejar la base en cero, lista para empezar a usarla de verdad
--
-- Borra TODOS los clientes, sus marcas y los números de rifa ya
-- sorteados. No toca los usuarios ni sus roles: Key, Jacky y el admin
-- siguen entrando igual.
--
-- Se corre desde el SQL Editor y no desde la app a propósito: las
-- policies impiden borrar clientes dados de alta en semanas ya
-- cerradas, y acá justamente queremos barrer con todo.
--
-- OJO: esto no se puede deshacer.
-- =====================================================

-- El orden no importa por el ON DELETE CASCADE, pero se hace explícito
-- para que quede claro qué se está borrando.
delete from public.rifa_numeros;
delete from public.marcas;
delete from public.clientes;

-- La tabla que quedó guardada cuando separamos el padrón de las marcas.
-- Si ya no querés el respaldo de la estructura vieja, descomentá:
-- drop table if exists public.clientes_semanal_legacy;

-- Comprobación: las tres tienen que dar 0.
select
  (select count(*) from public.clientes)     as clientes,
  (select count(*) from public.marcas)       as marcas,
  (select count(*) from public.rifa_numeros) as numeros_rifa;
