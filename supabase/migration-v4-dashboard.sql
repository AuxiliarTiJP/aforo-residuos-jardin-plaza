-- MIGRACIÓN V4: seguridad del dashboard administrativo e índices de consulta.
-- Ejecuta una sola vez después de migration-v3.sql.

-- Los administradores pueden consultar marcas activas e inactivas para análisis histórico.
drop policy if exists "Administradores leen todas las marcas" on public.brands;
create policy "Administradores leen todas las marcas"
on public.brands for select
to authenticated
using (public.current_user_is_admin());

-- Los operarios solo necesitan consultar el recorrido activo para ver su avance.
-- Los administradores conservan acceso histórico completo para el dashboard.
drop policy if exists "Usuarios activos leen recorridos" on public.route_runs;
drop policy if exists "Administradores leen todos los recorridos" on public.route_runs;
drop policy if exists "Operarios leen recorrido activo" on public.route_runs;

create policy "Administradores leen todos los recorridos"
on public.route_runs for select
to authenticated
using (public.current_user_is_admin());

create policy "Operarios leen recorrido activo"
on public.route_runs for select
to authenticated
using (
  status = 'active'
  and exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'operator'
      and is_active = true
  )
);

-- Separa el acceso histórico administrativo del avance operativo actual.
drop policy if exists "Usuarios activos leen avance" on public.visit_records;
drop policy if exists "Administradores leen todos los registros" on public.visit_records;
drop policy if exists "Operarios leen avance del recorrido activo" on public.visit_records;

create policy "Administradores leen todos los registros"
on public.visit_records for select
to authenticated
using (public.current_user_is_admin());

create policy "Operarios leen avance del recorrido activo"
on public.visit_records for select
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'operator'
      and is_active = true
  )
  and exists (
    select 1
    from public.route_runs
    where route_runs.id = visit_records.route_id
      and route_runs.status = 'active'
  )
);

-- Índices para filtros por fecha, resultado, recorrido, marca y operario.
create index if not exists visit_records_dashboard_date_result_idx
on public.visit_records (visit_date desc, result);

create index if not exists visit_records_dashboard_route_operator_idx
on public.visit_records (route_id, operator_id, confirmed_at desc);

create index if not exists visit_records_dashboard_brand_idx
on public.visit_records (brand_id, visit_date desc);

create index if not exists brands_dashboard_location_idx
on public.brands (zone, floor, route_order)
where is_active = true;
