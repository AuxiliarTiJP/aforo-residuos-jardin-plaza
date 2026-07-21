import type { SupabaseClient } from "@supabase/supabase-js";
import { getMeta, setMeta } from "@/lib/offline-db";
import type { RouteRun } from "@/lib/types";

const ACTIVE_ROUTE_META = "active_route_v1";

function mapRoute(row: Record<string, unknown>): RouteRun {
  return {
    id: String(row.id),
    visitDate: String(row.visit_date),
    routeNumber: Number(row.route_number),
    status: row.status === "completed" ? "completed" : "active",
    startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    startedBy: String(row.started_by),
    completedBy: row.completed_by ? String(row.completed_by) : null,
  };
}

export async function readCachedActiveRoute(): Promise<RouteRun | null> {
  const raw = await getMeta(ACTIVE_ROUTE_META);
  if (!raw) return null;
  try {
    const route = JSON.parse(raw) as RouteRun;
    return route.status === "active" ? route : null;
  } catch {
    return null;
  }
}

export async function cacheActiveRoute(route: RouteRun | null): Promise<void> {
  await setMeta(ACTIVE_ROUTE_META, route ? JSON.stringify(route) : "");
}

export async function getActiveRoute(
  supabase: SupabaseClient,
  visitDate: string,
): Promise<RouteRun | null> {
  const { data, error } = await supabase
    .from("route_runs")
    .select("id, visit_date, route_number, status, started_at, completed_at, started_by, completed_by")
    .eq("visit_date", visitDate)
    .eq("status", "active")
    .order("route_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  const route = data ? mapRoute(data) : null;
  await cacheActiveRoute(route);
  return route;
}

export async function startNextRoute(
  supabase: SupabaseClient,
  visitDate: string,
  userId: string,
): Promise<RouteRun> {
  const active = await getActiveRoute(supabase, visitDate);
  if (active) return active;

  const { data: previous, error: previousError } = await supabase
    .from("route_runs")
    .select("route_number")
    .eq("visit_date", visitDate)
    .order("route_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (previousError) throw previousError;
  const routeNumber = Number(previous?.route_number ?? 0) + 1;

  const { data, error } = await supabase
    .from("route_runs")
    .insert({
      visit_date: visitDate,
      route_number: routeNumber,
      status: "active",
      started_by: userId,
    })
    .select("id, visit_date, route_number, status, started_at, completed_at, started_by, completed_by")
    .single();

  if (error?.code === "23505") {
    const concurrent = await getActiveRoute(supabase, visitDate);
    if (concurrent) return concurrent;
  }
  if (error) throw error;

  const route = mapRoute(data);
  await cacheActiveRoute(route);
  return route;
}

export async function completeRoute(
  supabase: SupabaseClient,
  routeId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from("route_runs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      completed_by: userId,
    })
    .eq("id", routeId)
    .eq("status", "active");

  if (error) throw error;
  await cacheActiveRoute(null);
}
