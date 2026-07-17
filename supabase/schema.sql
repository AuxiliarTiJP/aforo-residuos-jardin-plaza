-- Ejecuta este archivo en Supabase SQL Editor.

create extension if not exists pgcrypto;

do $$ begin
  create type public.user_role as enum ('admin', 'operator');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.visit_result as enum ('delivered', 'closed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.route_shift as enum ('morning', 'night');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9._-]{3,40}$'),
  full_name text not null,
  role public.user_role not null default 'operator',
  is_active boolean not null default true,
  last_access timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  qr_code text not null unique,
  name text not null,
  local text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.visit_records (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id),
  operator_id uuid not null references public.profiles(id),
  result public.visit_result not null,
  scanned_at timestamptz not null,
  confirmed_at timestamptz not null default now(),
  shift public.route_shift not null,
  visit_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique (brand_id, visit_date, shift)
);

create index if not exists visit_records_operator_date_idx on public.visit_records(operator_id, visit_date desc);
create index if not exists visit_records_date_shift_idx on public.visit_records(visit_date desc, shift);
create index if not exists brands_qr_code_idx on public.brands(qr_code);

alter table public.profiles enable row level security;
alter table public.brands enable row level security;
alter table public.visit_records enable row level security;

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  );
$$;

create policy "Usuarios leen su perfil"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.current_user_is_admin());

create policy "Marcas activas visibles para usuarios"
on public.brands for select
to authenticated
using (is_active = true);

create policy "Operarios crean sus registros"
on public.visit_records for insert
to authenticated
with check (
  operator_id = auth.uid()
  and exists (select 1 from public.profiles where id = auth.uid() and is_active = true)
);

create policy "Administradores leen registros"
on public.visit_records for select
to authenticated
using (public.current_user_is_admin());

-- Marcas de prueba. Reemplázalas por las 300 marcas reales.
insert into public.brands (qr_code, name, local)
values
  ('JP-001', 'Adidas', '214'),
  ('JP-002', 'Arturo Calle', '118'),
  ('JP-003', 'Studio F', '305')
on conflict (qr_code) do nothing;

-- El primer administrador se crea desde Authentication > Users.
-- Usa el correo interno: admin@aforo.jardinplaza.local
-- Después copia su UUID y ejecuta:
-- insert into public.profiles (id, username, full_name, role)
-- values ('UUID_DEL_USUARIO', 'admin', 'Administrador principal', 'admin');
