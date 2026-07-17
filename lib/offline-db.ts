import type { Brand, VisitRecord } from "@/lib/types";

const DB_NAME = "jp-aforo-residuos";
const DB_VERSION = 1;
const BRAND_STORE = "brands";
const VISIT_STORE = "visits";
const META_STORE = "meta";

export type LocalVisitStatus = "pending" | "synced" | "conflict";

export type LocalVisit = VisitRecord & {
  dedupeKey: string;
  status: LocalVisitStatus;
  attempts: number;
  lastError?: string | null;
  queuedAt: string;
  updatedAt: string;
  syncedAt?: string | null;
};

type MetaRecord = {
  key: string;
  value: string;
};

function openDatabase(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB no está disponible en este dispositivo"));
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(BRAND_STORE)) {
        const brands = database.createObjectStore(BRAND_STORE, { keyPath: "qrCode" });
        brands.createIndex("id", "id", { unique: true });
      }

      if (!database.objectStoreNames.contains(VISIT_STORE)) {
        const visits = database.createObjectStore(VISIT_STORE, { keyPath: "id" });
        visits.createIndex("status", "status", { unique: false });
        visits.createIndex("operatorId", "operatorId", { unique: false });
        visits.createIndex("dedupeKey", "dedupeKey", { unique: true });
      }

      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir el almacenamiento local"));
    request.onblocked = () => reject(new Error("Cierra otras pestañas de la aplicación e inténtalo nuevamente"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Falló la operación local"));
    transaction.onabort = () => reject(transaction.error ?? new Error("La operación local fue cancelada"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falló la lectura local"));
  });
}

export function visitDedupeKey(visit: Pick<VisitRecord, "brandId" | "visitDate" | "shift">) {
  return `${visit.brandId}:${visit.visitDate}:${visit.shift}`;
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

export async function setMeta(key: string, value: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(META_STORE, "readwrite");
    transaction.objectStore(META_STORE).put({ key, value } satisfies MetaRecord);
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
    return value?.value ?? null;
  } finally {
    database.close();
  }
}

export async function queueVisit(visit: VisitRecord): Promise<LocalVisit> {
  const now = new Date().toISOString();
  const localVisit: LocalVisit = {
    ...visit,
    dedupeKey: visitDedupeKey(visit),
    status: "pending",
    attempts: 0,
    lastError: null,
    queuedAt: now,
    updatedAt: now,
    syncedAt: null,
  };

  const database = await openDatabase();
  try {
    const transaction = database.transaction(VISIT_STORE, "readwrite");
    transaction.objectStore(VISIT_STORE).add(localVisit);
    await transactionDone(transaction);
    return localVisit;
  } catch (error) {
    if (error instanceof DOMException && error.name === "ConstraintError") {
      throw new Error("Esta marca ya fue registrada en esta jornada");
    }
    throw error;
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

export async function getPendingVisitCount(operatorId?: string): Promise<number> {
  const records = await getPendingVisits(operatorId);
  return records.length;
}

export async function updateLocalVisit(
  id: string,
  patch: Partial<Pick<LocalVisit, "status" | "attempts" | "lastError" | "updatedAt" | "syncedAt">>,
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(VISIT_STORE, "readwrite");
    const store = transaction.objectStore(VISIT_STORE);
    const current = (await requestResult(store.get(id))) as LocalVisit | undefined;
    if (!current) return;
    store.put({ ...current, ...patch, updatedAt: new Date().toISOString() });
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
