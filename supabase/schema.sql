-- =====================================================
-- Control Cashmana — esquema de base de datos
-- Pegá todo esto en Supabase > SQL Editor y ejecutalo.
-- =====================================================

create table if not exists public.clientes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  nombre      text not null,
  semana      date not null,
  lun         boolean not null default false,
  mar         boolean not null default false,
  mie         boolean not null default false,
  jue         boolean not null default false,
  vie         boolean not null default false,
  sab         boolean not null default false,
  nota        text not null default '',
  created_at  timestamptz not null default now()
);

-- Búsquedas rápidas por usuario y semana
create index if not exists clientes_user_semana_idx
  on public.clientes (user_id, semana);

-- Un mismo cliente no se puede repetir dentro de la misma semana
create unique index if not exists clientes_user_semana_nombre_key
  on public.clientes (user_id, semana, nombre);

-- =====================================================
-- Row Level Security: cada usuario solo ve lo suyo
-- =====================================================

alter table public.clientes enable row level security;

drop policy if exists "ver propios clientes" on public.clientes;
create policy "ver propios clientes"
  on public.clientes for select
  using (auth.uid() = user_id);

drop policy if exists "crear propios clientes" on public.clientes;
create policy "crear propios clientes"
  on public.clientes for insert
  with check (auth.uid() = user_id);

drop policy if exists "editar propios clientes" on public.clientes;
create policy "editar propios clientes"
  on public.clientes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "borrar propios clientes" on public.clientes;
create policy "borrar propios clientes"
  on public.clientes for delete
  using (auth.uid() = user_id);
