-- MIGRACIÓN V3: recorridos múltiples, avance por recorrido y evidencia de local cerrado.
-- Ejecuta este archivo una sola vez en Supabase SQL Editor antes de publicar el código V3.

create extension if not exists pgcrypto;

do $$ begin
  create type public.route_run_status as enum ('active', 'completed');
exception when duplicate_object then null;
end $$;

create table if not exists public.route_runs (
  id uuid primary key default gen_random_uuid(),
  visit_date date not null default current_date,
  route_number smallint not null check (route_number > 0),
  status public.route_run_status not null default 'active',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  started_by uuid not null references public.profiles(id),
  completed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (visit_date, route_number)
);

create unique index if not exists route_runs_one_active_per_day_idx
on public.route_runs (visit_date)
where status = 'active';

alter table public.visit_records
  add column if not exists route_id uuid references public.route_runs(id),
  add column if not exists capture_method text not null default 'qr',
  add column if not exists observations text,
  add column if not exists photo_path text;

-- Los registros históricos pueden conservar shift. Los nuevos recorridos se agrupan por route_id.
alter table public.visit_records alter column shift drop not null;

alter table public.visit_records
  drop constraint if exists visit_records_brand_id_visit_date_shift_key;

drop index if exists public.visit_records_brand_id_visit_date_shift_key;

create unique index if not exists visit_records_route_brand_unique_idx
on public.visit_records (route_id, brand_id)
where route_id is not null;

create index if not exists visit_records_route_idx
on public.visit_records (route_id, created_at);

create index if not exists route_runs_date_status_idx
on public.route_runs (visit_date desc, status);

alter table public.visit_records
  drop constraint if exists visit_records_capture_method_check;

alter table public.visit_records
  add constraint visit_records_capture_method_check
  check (capture_method in ('qr', 'manual')) not valid;

alter table public.visit_records
  drop constraint if exists visit_records_evidence_check;

-- NOT VALID evita bloquear datos históricos, pero la regla sí se aplica a inserciones nuevas.
alter table public.visit_records
  add constraint visit_records_evidence_check
  check (
    (
      result = 'delivered'
      and capture_method = 'qr'
      and observations is null
      and photo_path is null
    )
    or
    (
      result = 'closed'
      and capture_method = 'manual'
      and length(trim(coalesce(observations, ''))) >= 5
      and photo_path is not null
    )
  ) not valid;

alter table public.route_runs enable row level security;

-- Permisos de recorridos.
drop policy if exists "Usuarios activos leen recorridos" on public.route_runs;
create policy "Usuarios activos leen recorridos"
on public.route_runs for select
to authenticated
using (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true
  )
);

drop policy if exists "Usuarios activos inician recorridos" on public.route_runs;
create policy "Usuarios activos inician recorridos"
on public.route_runs for insert
to authenticated
with check (
  started_by = auth.uid()
  and exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true
  )
);

drop policy if exists "Usuarios activos finalizan recorridos" on public.route_runs;
create policy "Usuarios activos finalizan recorridos"
on public.route_runs for update
to authenticated
using (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true
  )
)
with check (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true
  )
);

-- Reemplaza las políticas anteriores de registros.
drop policy if exists "Operarios crean sus registros" on public.visit_records;
create policy "Operarios crean registros del recorrido activo"
on public.visit_records for insert
to authenticated
with check (
  operator_id = auth.uid()
  and route_id is not null
  and exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true
  )
  and exists (
    select 1 from public.route_runs
    where id = route_id and status = 'active'
  )
);

drop policy if exists "Administradores leen registros" on public.visit_records;
drop policy if exists "Usuarios activos leen avance" on public.visit_records;
create policy "Usuarios activos leen avance"
on public.visit_records for select
to authenticated
using (
  exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true
  )
);

-- Bucket privado para fotografías de locales cerrados.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'closed-evidence',
  'closed-evidence',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Ruta esperada: routeId/operatorId/visitId.jpg
drop policy if exists "Operarios suben evidencia" on storage.objects;
create policy "Operarios suben evidencia"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'closed-evidence'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "Operarios actualizan su evidencia" on storage.objects;
create policy "Operarios actualizan su evidencia"
on storage.objects for update
to authenticated
using (
  bucket_id = 'closed-evidence'
  and (storage.foldername(name))[2] = auth.uid()::text
)
with check (
  bucket_id = 'closed-evidence'
  and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "Operarios leen su evidencia" on storage.objects;
create policy "Operarios leen su evidencia"
on storage.objects for select
to authenticated
using (
  bucket_id = 'closed-evidence'
  and (
    (storage.foldername(name))[2] = auth.uid()::text
    or public.current_user_is_admin()
  )
);
