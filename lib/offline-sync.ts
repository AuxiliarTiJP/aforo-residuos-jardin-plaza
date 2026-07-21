import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cacheBrands,
  getMeta,
  getPendingVisits,
  setMeta,
  updateLocalVisit,
} from "@/lib/offline-db";
import type { Brand, RouteProgressItem } from "@/lib/types";

export type SyncSummary = {
  synced: number;
  conflicts: number;
  pending: number;
};

export async function refreshBrandCache(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from("brands")
    .select("id, qr_code, name, local, zone, floor, route_order, is_active")
    .eq("is_active", true)
    .order("name");

  if (error) throw error;

  const brands: Brand[] = (data ?? []).map((row) => ({
    id: row.id,
    qrCode: row.qr_code,
    name: row.name,
    local: row.local,
    zone: row.zone ? String(row.zone) : null,
    floor: row.floor ? String(row.floor) : null,
    routeOrder: row.route_order === null ? null : Number(row.route_order),
    active: row.is_active,
  }));

  await cacheBrands(brands);
  await setMeta("brands_last_synced_at", new Date().toISOString());
  return brands.length;
}

function photoExtension(blob: Blob) {
  if (blob.type === "image/png") return "png";
  if (blob.type === "image/webp") return "webp";
  return "jpg";
}

export async function fetchRouteProgress(
  supabase: SupabaseClient,
  routeId: string,
): Promise<RouteProgressItem[]> {
  const { data, error } = await supabase
    .from("visit_records")
    .select("brand_id, result")
    .eq("route_id", routeId);

  if (error) throw error;
  const progress = (data ?? []).map((row) => ({
    brandId: String(row.brand_id),
    result: row.result === "closed" ? "closed" as const : "delivered" as const,
  }));
  await setMeta(`route_progress_${routeId}`, JSON.stringify(progress));
  return progress;
}

export async function readCachedRouteProgress(routeId: string): Promise<RouteProgressItem[]> {
  const raw = await getMeta(`route_progress_${routeId}`);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as RouteProgressItem[];
  } catch {
    return [];
  }
}

export async function syncPendingVisits(
  supabase: SupabaseClient,
  operatorId: string,
): Promise<SyncSummary> {
  const pendingVisits = await getPendingVisits(operatorId);
  let synced = 0;
  let conflicts = 0;

  for (const visit of pendingVisits) {
    let photoPath = visit.photoPath ?? null;

    if (visit.result === "closed" && visit.photoBlob) {
      photoPath = `${visit.routeId}/${visit.operatorId}/${visit.id}.${photoExtension(visit.photoBlob)}`;
      const { error: uploadError } = await supabase.storage
        .from("closed-evidence")
        .upload(photoPath, visit.photoBlob, {
          contentType: visit.photoBlob.type || "image/jpeg",
          upsert: true,
        });

      if (uploadError) {
        await updateLocalVisit(visit.id, {
          status: "pending",
          attempts: visit.attempts + 1,
          lastError: uploadError.message,
        });
        if (!navigator.onLine) break;
        continue;
      }
    }

    const { error } = await supabase.from("visit_records").insert({
      id: visit.id,
      route_id: visit.routeId,
      brand_id: visit.brandId,
      operator_id: visit.operatorId,
      result: visit.result,
      capture_method: visit.captureMethod,
      scanned_at: visit.scannedAt,
      confirmed_at: visit.confirmedAt,
      visit_date: visit.visitDate,
      observations: visit.observations ?? null,
      photo_path: photoPath,
    });

    if (!error) {
      synced += 1;
      await updateLocalVisit(visit.id, {
        status: "synced",
        attempts: visit.attempts + 1,
        lastError: null,
        syncedAt: new Date().toISOString(),
        photoPath,
        photoBlob: null,
      });
      continue;
    }

    if (error.code === "23505") {
      conflicts += 1;
      await updateLocalVisit(visit.id, {
        status: "conflict",
        attempts: visit.attempts + 1,
        lastError: "La marca ya estaba registrada en el recorrido actual",
        photoPath,
        photoBlob: null,
      });
      continue;
    }

    await updateLocalVisit(visit.id, {
      status: "pending",
      attempts: visit.attempts + 1,
      lastError: error.message,
      photoPath,
    });

    if (!navigator.onLine) break;
  }

  const remaining = await getPendingVisits(operatorId);
  return { synced, conflicts, pending: remaining.length };
}
