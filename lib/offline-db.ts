import type { Brand, RouteProgressItem, VisitRecord } from "@/lib/types";

const DB_NAME = "jp-aforo-residuos";
const DB_VERSION = 3;
const BRAND_STORE = "brands";
const VISIT_STORE = "visits";
const META_STORE = "meta";

export type LocalVisitStatus = "pending" | "synced" | "conflict";

export type LocalVisit = VisitRecord & {
  routeBrandKey: string;
  status: LocalVisitStatus;
  attempts: number;
  lastError?: string | null;
  queuedAt: string;
  updatedAt: string;
  syncedAt?: string | null;
  photoBlob?: Blob | null;
};

type MetaRecord = {
  key: string;
  value: string;
};

function storageErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";

  if (name === "ConstraintError") {
    return "Esta marca ya fue registrada en el recorrido actual";
  }

  if (name === "QuotaExceededError") {
    return "El dispositivo no tiene espacio suficiente para guardar el registro sin conexión";
  }

  if (name === "InvalidStateError" || name === "NotAllowedError" || name === "SecurityError") {
    return "El navegador bloqueó el almacenamiento local. Abre la aplicación fuera del modo incógnito y permite el almacenamiento del sitio";
  }

  if (error instanceof Error && error.message) return error.message;
  return "No se pudo guardar el registro en el dispositivo";
}

function ensureStoreIndexes(database: IDBDatabase, transaction: IDBTransaction) {
  let brands: IDBObjectStore;
  if (!database.objectStoreNames.contains(BRAND_STORE)) {
    brands = database.createObjectStore(BRAND_STORE, { keyPath: "qrCode" });
  } else {
    brands = transaction.objectStore(BRAND_STORE);
  }
  if (!brands.indexNames.contains("id")) brands.createIndex("id", "id", { unique: true });

  let visits: IDBObjectStore;
  if (!database.objectStoreNames.contains(VISIT_STORE)) {
    visits = database.createObjectStore(VISIT_STORE, { keyPath: "id" });
  } else {
    visits = transaction.objectStore(VISIT_STORE);
  }

  if (visits.indexNames.contains("dedupeKey")) visits.deleteIndex("dedupeKey");
  if (!visits.indexNames.contains("status")) visits.createIndex("status", "status", { unique: false });
  if (!visits.indexNames.contains("operatorId")) {
    visits.createIndex("operatorId", "operatorId", { unique: false });
  }
  if (!visits.indexNames.contains("routeId")) {
    visits.createIndex("routeId", "routeId", { unique: false });
  }
  if (!visits.indexNames.contains("routeBrandKey")) {
    visits.createIndex("routeBrandKey", "routeBrandKey", { unique: true });
  }

  if (!database.objectStoreNames.contains(META_STORE)) {
    database.createObjectStore(META_STORE, { keyPath: "key" });
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB no está disponible en este dispositivo"));
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const transaction = request.transaction;
      if (!transaction) return;
      ensureStoreIndexes(request.result, transaction);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(storageErrorMessage(request.error)));
    request.onblocked = () => reject(new Error("Cierra otras pestañas de la aplicación e inténtalo nuevamente"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error(storageErrorMessage(transaction.error)));
    transaction.onerror = () => undefined;
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falló la operación local"));
  });
}

export function routeBrandKey(visit: Pick<VisitRecord, "routeId" | "brandId">) {
  return `${visit.routeId}:${visit.brandId}`;
}

export async function cacheBrands(brands: Brand[]): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(BRAND_STORE, "readwrite");
    const store = transaction.objectStore(BRAND_STORE);
    for (const brand of brands) store.put(brand);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function cacheBrand(brand: Brand): Promise<void> {
  await cacheBrands([brand]);
}

export async function getCachedBrand(qrCode: string): Promise<Brand | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(BRAND_STORE, "readonly");
    const value = await requestResult(transaction.objectStore(BRAND_STORE).get(qrCode.trim()));
    return (value as Brand | undefined) ?? null;
  } finally {
    database.close();
  }
}

export async function getCachedBrands(): Promise<Brand[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(BRAND_STORE, "readonly");
    const values = (await requestResult(transaction.objectStore(BRAND_STORE).getAll())) as Brand[];
    return values.filter((brand) => brand.active).sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    database.close();
  }
}

export async function setMeta(key: string, value: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(META_STORE, "readwrite");
    const request = transaction.objectStore(META_STORE).put({ key, value } satisfies MetaRecord);
    await requestResult(request);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function getMeta(key: string): Promise<string | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(META_STORE, "readonly");
    const value = (await requestResult(transaction.objectStore(META_STORE).get(key))) as MetaRecord | undefined;
    return value?.value || null;
  } finally {
    database.close();
  }
}

async function getLocalVisitByRouteBrandKey(key: string): Promise<LocalVisit | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(VISIT_STORE, "readonly");
    const store = transaction.objectStore(VISIT_STORE);
    const value = (await requestResult(store.index("routeBrandKey").get(key))) as LocalVisit | undefined;
    return value ?? null;
  } finally {
    database.close();
  }
}

export async function queueVisit(visit: VisitRecord, photoBlob?: Blob | null): Promise<LocalVisit> {
  const key = routeBrandKey(visit);
  const existing = await getLocalVisitByRouteBrandKey(key);

  if (existing) {
    throw new Error("Esta marca ya fue registrada en el recorrido actual");
  }

  if (visit.result === "closed" && !photoBlob) {
    throw new Error("La fotografía es obligatoria para reportar un local cerrado");
  }

  const now = new Date().toISOString();
  const localVisit: LocalVisit = {
    ...visit,
    routeBrandKey: key,
    status: "pending",
    attempts: 0,
    lastError: null,
    queuedAt: now,
    updatedAt: now,
    syncedAt: null,
    photoBlob: photoBlob ?? null,
  };

  const database = await openDatabase();
  try {
    const transaction = database.transaction(VISIT_STORE, "readwrite");
    const request = transaction.objectStore(VISIT_STORE).add(localVisit);
    await requestResult(request);
    await transactionDone(transaction);
    return localVisit;
  } catch (error) {
    throw new Error(storageErrorMessage(error));
  } finally {
    database.close();
  }
}

export async function getPendingVisits(operatorId?: string): Promise<LocalVisit[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(VISIT_STORE, "readonly");
    const records = (await requestResult(
      transaction.objectStore(VISIT_STORE).index("status").getAll("pending"),
    )) as LocalVisit[];
    return records
      .filter((record) => !operatorId || record.operatorId === operatorId)
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  } finally {
    database.close();
  }
}

export async function getVisitsForRoute(routeId: string): Promise<LocalVisit[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(VISIT_STORE, "readonly");
    const records = (await requestResult(
      transaction.objectStore(VISIT_STORE).index("routeId").getAll(routeId),
    )) as LocalVisit[];
    return records;
  } finally {
    database.close();
  }
}

export async function getLocalRouteProgress(routeId: string): Promise<RouteProgressItem[]> {
  const visits = await getVisitsForRoute(routeId);
  return visits
    .filter((visit) => visit.status !== "conflict")
    .map((visit) => ({ brandId: visit.brandId, result: visit.result }));
}

export async function getPendingVisitCount(operatorId?: string): Promise<number> {
  const records = await getPendingVisits(operatorId);
  return records.length;
}

export async function updateLocalVisit(
  id: string,
  patch: Partial<
    Pick<LocalVisit, "status" | "attempts" | "lastError" | "updatedAt" | "syncedAt" | "photoPath" | "photoBlob">
  >,
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(VISIT_STORE, "readwrite");
    const store = transaction.objectStore(VISIT_STORE);
    const current = (await requestResult(store.get(id))) as LocalVisit | undefined;
    if (!current) return;
    const request = store.put({ ...current, ...patch, updatedAt: new Date().toISOString() });
    await requestResult(request);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
