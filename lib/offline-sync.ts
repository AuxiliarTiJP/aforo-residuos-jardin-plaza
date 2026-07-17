import type { SupabaseClient } from "@supabase/supabase-js";
import { cacheBrands, getPendingVisits, setMeta, updateLocalVisit } from "@/lib/offline-db";
import type { Brand } from "@/lib/types";

export type SyncSummary = {
  synced: number;
  conflicts: number;
  pending: number;
};

export async function refreshBrandCache(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from("brands")
    .select("id, qr_code, name, local, is_active")
    .eq("is_active", true)
    .order("name");

  if (error) throw error;

  const brands: Brand[] = (data ?? []).map((row) => ({
    id: row.id,
    qrCode: row.qr_code,
    name: row.name,
    local: row.local,
    active: row.is_active,
  }));

  await cacheBrands(brands);
  await setMeta("brands_last_synced_at", new Date().toISOString());
  return brands.length;
}

export async function syncPendingVisits(
  supabase: SupabaseClient,
  operatorId: string,
): Promise<SyncSummary> {
  const pendingVisits = await getPendingVisits(operatorId);
  let synced = 0;
  let conflicts = 0;

  for (const visit of pendingVisits) {
    const { error } = await supabase.from("visit_records").insert({
      id: visit.id,
      brand_id: visit.brandId,
      operator_id: visit.operatorId,
      result: visit.result,
      scanned_at: visit.scannedAt,
      confirmed_at: visit.confirmedAt,
      shift: visit.shift,
      visit_date: visit.visitDate,
    });

    if (!error) {
      synced += 1;
      await updateLocalVisit(visit.id, {
        status: "synced",
        attempts: visit.attempts + 1,
        lastError: null,
        syncedAt: new Date().toISOString(),
      });
      continue;
    }

    if (error.code === "23505") {
      conflicts += 1;
      await updateLocalVisit(visit.id, {
        status: "conflict",
        attempts: visit.attempts + 1,
        lastError: "La marca ya estaba registrada para esta fecha y jornada",
      });
      continue;
    }

    await updateLocalVisit(visit.id, {
      status: "pending",
      attempts: visit.attempts + 1,
      lastError: error.message,
    });

    if (!navigator.onLine) break;
  }

  const remaining = await getPendingVisits(operatorId);
  return { synced, conflicts, pending: remaining.length };
}
