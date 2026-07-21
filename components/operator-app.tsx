"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  ClipboardList,
  CloudOff,
  CloudUpload,
  DoorClosed,
  Flag,
  HelpCircle,
  ListChecks,
  LoaderCircle,
  LogOut,
  Play,
  RefreshCw,
  ScanLine,
  Search,
  Store,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { QrCamera } from "@/components/qr-camera";
import { useAuth } from "@/components/auth-provider";
import { demoBrands, findDemoBrand, saveDemoVisit } from "@/lib/demo-store";
import { compressEvidencePhoto } from "@/lib/image-utils";
import {
  cacheBrand,
  getCachedBrand,
  getCachedBrands,
  getLocalRouteProgress,
  getMeta,
  getPendingVisitCount,
  queueVisit,
} from "@/lib/offline-db";
import {
  fetchRouteProgress,
  readCachedRouteProgress,
  refreshBrandCache,
  syncPendingVisits,
} from "@/lib/offline-sync";
import {
  completeRoute,
  getActiveRoute,
  readCachedActiveRoute,
  startNextRoute,
} from "@/lib/route-service";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Brand, RouteProgressItem, RouteRun, VisitRecord } from "@/lib/types";

const supabase = createSupabaseBrowserClient();

type Screen = "route" | "scan" | "result" | "closed" | "progress" | "success" | "error";
type ProgressFilter = "pending" | "completed";

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function demoRoute(date: string): RouteRun {
  return {
    id: `demo-route-${date}-1`,
    visitDate: date,
    routeNumber: 1,
    status: "active",
    startedAt: new Date().toISOString(),
    startedBy: "demo-operator",
    completedAt: null,
    completedBy: null,
  };
}

function mergeProgress(...groups: RouteProgressItem[][]) {
  const merged = new Map<string, RouteProgressItem>();
  for (const group of groups) {
    for (const item of group) merged.set(item.brandId, item);
  }
  return [...merged.values()];
}

export function OperatorApp() {
  const { user, logout, configured, offlineAccess } = useAuth();
  const params = useSearchParams();
  const testCode = process.env.NEXT_PUBLIC_ENABLE_QR_TEST === "true" ? params.get("demoQr") : null;
  const visitDate = useMemo(() => localDateKey(new Date()), []);
  const [screen, setScreen] = useState<Screen>("route");
  const [route, setRoute] = useState<RouteRun | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [progress, setProgress] = useState<RouteProgressItem[]>([]);
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>("pending");
  const [brand, setBrand] = useState<Brand | null>(null);
  const [scannedAt, setScannedAt] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [brandCacheReady, setBrandCacheReady] = useState(false);
  const [savedOffline, setSavedOffline] = useState(false);
  const [successText, setSuccessText] = useState("Registro guardado");
  const [closedSearch, setClosedSearch] = useState("");
  const [closedBrandId, setClosedBrandId] = useState("");
  const [closedPhoto, setClosedPhoto] = useState<File | null>(null);
  const [closedObservations, setClosedObservations] = useState("");
  const syncLock = useRef(false);
  const syncNowRef = useRef<() => Promise<void>>(async () => undefined);

  const completedMap = useMemo(
    () => new Map(progress.map((item) => [item.brandId, item.result])),
    [progress],
  );
  const completedBrands = useMemo(
    () => brands.filter((item) => completedMap.has(item.id)),
    [brands, completedMap],
  );
  const pendingBrands = useMemo(
    () => brands.filter((item) => !completedMap.has(item.id)),
    [brands, completedMap],
  );
  const progressPercent = brands.length === 0 ? 0 : Math.round((completedBrands.length / brands.length) * 100);

  const closedPhotoPreview = useMemo(
    () => (closedPhoto ? URL.createObjectURL(closedPhoto) : ""),
    [closedPhoto],
  );

  const filteredClosedBrands = useMemo(() => {
    const query = closedSearch.trim().toLowerCase();
    if (!query) return pendingBrands.slice(0, 30);
    return pendingBrands
      .filter((item) => item.name.toLowerCase().includes(query) || item.local.toLowerCase().includes(query))
      .slice(0, 30);
  }, [closedSearch, pendingBrands]);

  const refreshPendingCount = useCallback(async () => {
    if (!configured || !user) return;
    try {
      setPendingCount(await getPendingVisitCount(user.id));
    } catch {
      setPendingCount(0);
    }
  }, [configured, user]);

  const loadBrands = useCallback(async () => {
    if (!configured) {
      setBrands(demoBrands);
      setBrandCacheReady(true);
      return;
    }
    try {
      const cached = await getCachedBrands();
      setBrands(cached);
      setBrandCacheReady(cached.length > 0);
    } catch {
      setBrands([]);
    }
  }, [configured]);

  const refreshProgress = useCallback(async () => {
    if (!route) {
      setProgress([]);
      return;
    }

    try {
      const local = await getLocalRouteProgress(route.id);
      let remote: RouteProgressItem[] = [];
      if (configured && supabase) {
        remote = navigator.onLine
          ? await fetchRouteProgress(supabase, route.id)
          : await readCachedRouteProgress(route.id);
      }
      setProgress(mergeProgress(remote, local));
    } catch {
      const local = await getLocalRouteProgress(route.id).catch(() => []);
      setProgress(local);
    }
  }, [configured, route]);

  const syncNow = useCallback(async () => {
    if (!configured || !supabase || !user || !navigator.onLine || syncLock.current) return;
    syncLock.current = true;
    setSyncing(true);
    try {
      const summary = await syncPendingVisits(supabase, user.id);
      setPendingCount(summary.pending);
      await refreshProgress();
    } catch {
      await refreshPendingCount();
    } finally {
      syncLock.current = false;
      setSyncing(false);
    }
  }, [configured, refreshPendingCount, refreshProgress, user]);

  const updateBrandCache = useCallback(async () => {
    if (!configured || !supabase || !navigator.onLine) return;
    try {
      await refreshBrandCache(supabase);
      await loadBrands();
      setBrandCacheReady(true);
    } catch {
      const lastSync = await getMeta("brands_last_synced_at").catch(() => null);
      setBrandCacheReady(Boolean(lastSync));
    }
  }, [configured, loadBrands]);

  const applyLoadedRoute = useCallback((valid: RouteRun | null) => {
    setRoute((current) => {
      if (current?.id === valid?.id && current?.status === valid?.status) return current;
      return valid;
    });
    setScreen((current) => {
      if (current !== "route" && current !== "scan") return current;
      return valid ? "scan" : "route";
    });
  }, []);

  const loadRoute = useCallback(async () => {
    if (!configured || !supabase) {
      applyLoadedRoute(demoRoute(visitDate));
      return;
    }

    try {
      const active = navigator.onLine
        ? await getActiveRoute(supabase, visitDate)
        : await readCachedActiveRoute();
      const valid = active?.visitDate === visitDate ? active : null;
      applyLoadedRoute(valid);
    } catch {
      const cached = await readCachedActiveRoute().catch(() => null);
      const valid = cached?.visitDate === visitDate ? cached : null;
      applyLoadedRoute(valid);
    }
  }, [applyLoadedRoute, configured, visitDate]);

  const handleLogout = useCallback(async () => {
    if (configured && user) {
      if (navigator.onLine) await syncNow();
      const remaining = await getPendingVisitCount(user.id).catch(() => pendingCount);
      if (remaining > 0) {
        window.alert(
          `Hay ${remaining} ${remaining === 1 ? "registro pendiente" : "registros pendientes"}. ` +
          "La sesiÃ³n permanecerÃ¡ abierta para enviarlos cuando regrese la conexiÃ³n.",
        );
        return;
      }
    }
    await logout();
  }, [configured, logout, pendingCount, syncNow, user]);

  useEffect(() => {
    syncNowRef.current = syncNow;
  }, [syncNow]);

  useEffect(() => {
    const initializeTimer = window.setTimeout(() => {
      void loadBrands();
      void loadRoute();
      void refreshPendingCount();
      if (navigator.onLine) {
        void updateBrandCache();
        void syncNowRef.current();
      }
    }, 0);

    if (navigator.storage?.persist) void navigator.storage.persist().catch(() => false);

    const handleOnline = () => {
      setOnline(true);
      void updateBrandCache();
      void loadRoute();
      void syncNowRef.current();
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.clearTimeout(initializeTimer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [loadBrands, loadRoute, refreshPendingCount, updateBrandCache]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshProgress(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshProgress]);

  useEffect(() => {
    if (screen !== "closed" && screen !== "progress") return;
    const timer = window.setTimeout(() => void refreshProgress(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshProgress, screen]);

  useEffect(() => {
    if (!route || !online) return;
    const interval = window.setInterval(() => void refreshProgress(), 20000);
    return () => window.clearInterval(interval);
  }, [online, refreshProgress, route]);

  useEffect(() => {
    if (!closedPhotoPreview) return;
    return () => URL.revokeObjectURL(closedPhotoPreview);
  }, [closedPhotoPreview]);

  const handleScan = useCallback(
    async (rawCode: string) => {
      if (!route) {
        setMessage("Debes iniciar un recorrido antes de escanear marcas.");
        setScreen("error");
        return;
      }

      setMessage("");
      setScannedAt(new Date().toISOString());
      const normalizedCode = rawCode.trim();

      try {
        let found: Brand | null = null;

        if (!configured || !supabase) {
          found = findDemoBrand(normalizedCode) ?? null;
        } else {
          found = await getCachedBrand(normalizedCode);

          if (!found && navigator.onLine) {
            const { data, error } = await supabase
              .from("brands")
              .select("id, qr_code, name, local, is_active")
              .eq("qr_code", normalizedCode)
              .eq("is_active", true)
              .maybeSingle();

            if (error) throw error;
            if (data) {
              found = {
                id: data.id,
                qrCode: data.qr_code,
                name: data.name,
                local: data.local,
                active: data.is_active,
              };
              await cacheBrand(found);
            }
          }
        }

        if (!found) {
          setMessage(
            navigator.onLine
              ? "Este cÃ³digo QR no corresponde a una marca activa."
              : brandCacheReady
                ? "Este cÃ³digo QR no se encuentra en las marcas guardadas en el dispositivo."
                : "ConÃ©ctate una vez para descargar las marcas antes de realizar recorridos sin seÃ±al.",
          );
          setScreen("error");
          return;
        }

        if (completedMap.has(found.id)) {
          setMessage("Esta marca ya fue gestionada en el recorrido actual. PodrÃ¡ registrarse nuevamente cuando se inicie el siguiente recorrido.");
          setScreen("error");
          return;
        }

        setBrand(found);
        setScreen("result");
      } catch {
        setMessage(
          navigator.onLine
            ? "No fue posible consultar la marca. IntÃ©ntalo nuevamente."
            : "No hay conexiÃ³n y la marca todavÃ­a no estÃ¡ guardada en este dispositivo.",
        );
        setScreen("error");
      }
    },
    [brandCacheReady, completedMap, configured, route],
  );

  useEffect(() => {
    if (!testCode || screen !== "scan") return;
    const timer = window.setTimeout(() => void handleScan(testCode), 0);
    return () => window.clearTimeout(timer);
  }, [handleScan, screen, testCode]);

  async function startRoute() {
    if (!user) return;
    if (configured && !navigator.onLine) {
      setMessage("Necesitas conexiÃ³n para iniciar un nuevo recorrido. Una vez iniciado podrÃ¡s continuar sin seÃ±al.");
      setScreen("error");
      return;
    }

    setSaving(true);
    try {
      const next = !configured || !supabase
        ? demoRoute(visitDate)
        : await startNextRoute(supabase, visitDate, user.id);
      setRoute(next);
      setProgress([]);
      setScreen("scan");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "No fue posible iniciar el recorrido");
      setScreen("error");
    } finally {
      setSaving(false);
    }
  }

  async function saveDelivered() {
    if (!brand || !user || !route) return;
    setSaving(true);

    try {
      const now = new Date();
      const visit: VisitRecord = {
        id: crypto.randomUUID(),
        routeId: route.id,
        brandId: brand.id,
        operatorId: user.id,
        result: "delivered",
        captureMethod: "qr",
        scannedAt,
        confirmedAt: now.toISOString(),
        visitDate: localDateKey(now),
        observations: null,
        photoPath: null,
      };

      if (!configured || !supabase) {
        saveDemoVisit(visit);
        setSavedOffline(false);
      } else {
        await queueVisit(visit);
        setSavedOffline(!navigator.onLine);
        await refreshPendingCount();
        await refreshProgress();
        if (navigator.onLine) void syncNow();
      }

      setSuccessText("RecolecciÃ³n registrada");
      setScreen("success");
      window.setTimeout(() => {
        setBrand(null);
        setScreen("scan");
      }, 1300);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "No fue posible guardar el registro");
      setScreen("error");
    } finally {
      setSaving(false);
    }
  }

  async function saveClosedReport() {
    if (!user || !route) return;
    const selectedBrand = brands.find((item) => item.id === closedBrandId);
    const observations = closedObservations.trim();

    if (!selectedBrand) {
      setMessage("Selecciona la tienda que deseas reportar.");
      setScreen("error");
      return;
    }
    if (!closedPhoto) {
      setMessage("Debes tomar una fotografÃ­a del local cerrado.");
      setScreen("error");
      return;
    }

    setSaving(true);
    try {
      const photoBlob = await compressEvidencePhoto(closedPhoto);
      const now = new Date();
      const visit: VisitRecord = {
        id: crypto.randomUUID(),
        routeId: route.id,
        brandId: selectedBrand.id,
        operatorId: user.id,
        result: "closed",
        captureMethod: "manual",
        scannedAt: now.toISOString(),
        confirmedAt: now.toISOString(),
        visitDate: localDateKey(now),
        observations: observations || null,
        photoPath: null,
      };

      if (!configured || !supabase) {
        saveDemoVisit(visit);
        setSavedOffline(false);
      } else {
        await queueVisit(visit, photoBlob);
        setSavedOffline(!navigator.onLine);
        await refreshPendingCount();
        await refreshProgress();
        if (navigator.onLine) void syncNow();
      }

      setClosedBrandId("");
      setClosedSearch("");
      setClosedPhoto(null);
      setClosedObservations("");
      setSuccessText("Local cerrado reportado");
      setScreen("success");
      window.setTimeout(() => setScreen("scan"), 1500);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "No fue posible guardar la novedad");
      setScreen("error");
    } finally {
      setSaving(false);
    }
  }

  async function finishCurrentRoute() {
    if (!route || !user) return;
    if (pendingBrands.length > 0) {
      window.alert(`AÃºn faltan ${pendingBrands.length} marcas por gestionar.`);
      return;
    }
    if (configured && !navigator.onLine) {
      window.alert("ConÃ©ctate para finalizar el recorrido y abrir el siguiente.");
      return;
    }

    setSaving(true);
    try {
      if (configured && supabase) {
        await syncNow();
        await completeRoute(supabase, route.id, user.id);
      }
      setRoute(null);
      setProgress([]);
      setScreen("route");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "No fue posible finalizar el recorrido");
      setScreen("error");
    } finally {
      setSaving(false);
    }
  }

  if (screen === "route" || !route) {
    return (
      <main className="operator-page route-start-page">
        <header className="operator-header compact-header">
          <BrandLogo compact />
          <button className="header-icon" onClick={() => void handleLogout()} aria-label="Cerrar sesiÃ³n">
            <LogOut size={21} />
          </button>
        </header>
        <section className="route-start-content">
          <div className="route-start-icon"><Play size={34} /></div>
          <h1>Iniciar recorrido</h1>
          <p>Se abrirÃ¡ el siguiente recorrido del dÃ­a. Todos los registros quedarÃ¡n asociados a este recorrido.</p>
          <button className="primary-button" disabled={saving} onClick={() => void startRoute()}>
            {saving ? <LoaderCircle className="spinner" size={20} /> : <Play size={20} />}
            Iniciar recorrido
          </button>
          {!online ? <span className="route-warning">Necesitas conexiÃ³n Ãºnicamente para iniciar un recorrido nuevo.</span> : null}
        </section>
      </main>
    );
  }

  if (screen === "result" && brand) {
    return (
      <main className="operator-page result-page">
        <header className="operator-header compact-header">
          <button className="header-icon" onClick={() => setScreen("scan")} aria-label="Volver">
            <ArrowLeft size={21} />
          </button>
          <BrandLogo compact />
          <button className="header-icon" onClick={() => void handleLogout()} aria-label="Cerrar sesiÃ³n">
            <LogOut size={21} />
          </button>
        </header>
        <section className="result-content">
          <div className="step-heading">
            <span className="step-icon"><ScanLine size={21} /></span>
            <div>
              <p>QR validado</p>
              <h1>Confirmar recolecciÃ³n</h1>
            </div>
          </div>
          <article className="brand-result-card">
            <span>Marca</span>
            <strong>{brand.name}</strong>
            <div><span>Local</span><b>{brand.local}</b></div>
          </article>
          <button className="result-button delivered single-action" disabled={saving} onClick={() => void saveDelivered()}>
            <CheckCircle2 size={27} />
            <span>Confirmar entrega de residuos</span>
          </button>
        </section>
      </main>
    );
  }

  if (screen === "closed") {
    const selected = brands.find((item) => item.id === closedBrandId);
    return (
      <main className="operator-page closed-report-page">
        <header className="operator-header compact-header">
          <button className="header-icon" onClick={() => setScreen("scan")} aria-label="Volver">
            <ArrowLeft size={21} />
          </button>
          <BrandLogo compact />
          <span className="route-chip">Recorrido {route.routeNumber}</span>
        </header>
        <section className="closed-report-content">
          <div className="step-heading">
            <span className="step-icon orange"><DoorClosed size={21} /></span>
            <div><p>Novedad</p><h1>Reportar local cerrado</h1></div>
          </div>

          <label className="field-label" htmlFor="closed-search">Buscar tienda</label>
          <div className="search-field">
            <Search size={19} />
            <input
              id="closed-search"
              value={closedSearch}
              onChange={(event) => setClosedSearch(event.target.value)}
              placeholder="Nombre de la marca o local"
              autoComplete="off"
            />
          </div>

          {selected ? (
            <button className="selected-store" type="button" onClick={() => setClosedBrandId("")}>
              <Store size={20} />
              <span><strong>{selected.name}</strong><small>Local {selected.local}</small></span>
              <small>Cambiar</small>
            </button>
          ) : (
            <div className="store-results">
              {filteredClosedBrands.map((item) => (
                <button key={item.id} type="button" onClick={() => setClosedBrandId(item.id)}>
                  <span><strong>{item.name}</strong><small>Local {item.local}</small></span>
                  <Check size={18} />
                </button>
              ))}
              {filteredClosedBrands.length === 0 ? <p>No hay tiendas pendientes que coincidan.</p> : null}
            </div>
          )}

          <label className="field-label">FotografÃ­a obligatoria</label>
          <label className={`photo-capture ${closedPhotoPreview ? "has-photo" : ""}`}>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => setClosedPhoto(event.target.files?.[0] ?? null)}
            />
            {closedPhotoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={closedPhotoPreview} alt="Evidencia del local cerrado" />
            ) : (
              <><Camera size={31} /><strong>Tomar fotografÃ­a</strong><span>La imagen se guardarÃ¡ tambiÃ©n sin conexiÃ³n.</span></>
            )}
          </label>

          <label className="field-label" htmlFor="closed-observations">Observaciones opcionales</label>
          <textarea
            id="closed-observations"
            className="observations-field"
            value={closedObservations}
            onChange={(event) => setClosedObservations(event.target.value)}
            placeholder="Agrega una observación solamente si es necesario."
            rows={4}
          />

          <button className="primary-button" disabled={saving} onClick={() => void saveClosedReport()}>
            {saving ? <LoaderCircle className="spinner" size={20} /> : <DoorClosed size={20} />}
            Guardar novedad
          </button>
        </section>
      </main>
    );
  }

  if (screen === "progress") {
    const rows = progressFilter === "pending" ? pendingBrands : completedBrands;
    return (
      <main className="operator-page progress-page">
        <header className="operator-header compact-header">
          <button className="header-icon" onClick={() => setScreen("scan")} aria-label="Volver">
            <ArrowLeft size={21} />
          </button>
          <BrandLogo compact />
          <span className="route-chip">Recorrido {route.routeNumber}</span>
        </header>
        <section className="progress-content">
          <div className="progress-summary">
            <div><span>Avance</span><strong>{completedBrands.length} de {brands.length}</strong></div>
            <b>{progressPercent}%</b>
          </div>
          <div className="progress-track"><span style={{ width: `${progressPercent}%` }} /></div>
          <div className="progress-tabs">
            <button className={progressFilter === "pending" ? "active" : ""} onClick={() => setProgressFilter("pending")}>
              Pendientes <span>{pendingBrands.length}</span>
            </button>
            <button className={progressFilter === "completed" ? "active" : ""} onClick={() => setProgressFilter("completed")}>
              Gestionadas <span>{completedBrands.length}</span>
            </button>
          </div>
          <div className="progress-list">
            {rows.map((item) => {
              const result = completedMap.get(item.id);
              return (
                <article key={item.id}>
                  <span className={`progress-state ${result ? "done" : "pending"}`}>
                    {result === "closed" ? <DoorClosed size={18} /> : result ? <Check size={18} /> : <span />}
                  </span>
                  <div><strong>{item.name}</strong><small>Local {item.local}</small></div>
                  {result ? <em>{result === "closed" ? "Cerrado" : "Recolectado"}</em> : <em>Pendiente</em>}
                </article>
              );
            })}
          </div>
          <button className="finish-route-button" disabled={saving || pendingBrands.length > 0} onClick={() => void finishCurrentRoute()}>
            <Flag size={19} /> Finalizar recorrido
          </button>
          {pendingBrands.length > 0 ? <p className="finish-route-note">Debes gestionar todas las marcas antes de finalizar.</p> : null}
        </section>
      </main>
    );
  }

  if (screen === "success") {
    return (
      <main className="feedback-page success-feedback">
        <div className="feedback-symbol"><Check size={46} strokeWidth={3} /></div>
        <h1>{successText}</h1>
        <p>
          {savedOffline
            ? "QuedÃ³ protegido en el dispositivo y se enviarÃ¡ automÃ¡ticamente cuando regrese la conexiÃ³n."
            : "El registro quedÃ³ protegido localmente y la aplicaciÃ³n estÃ¡ verificando su sincronizaciÃ³n."}
        </p>
      </main>
    );
  }

  if (screen === "error") {
    return (
      <main className="feedback-page error-feedback">
        <div className="feedback-symbol"><HelpCircle size={44} /></div>
        <h1>No se pudo completar</h1>
        <p>{message}</p>
        <button className="primary-button" onClick={() => setScreen(route ? "scan" : "route")}>Volver</button>
      </main>
    );
  }

  const syncLabel = !online
    ? brandCacheReady
      ? `${pendingCount} ${pendingCount === 1 ? "registro pendiente" : "registros pendientes"}`
      : "ConÃ©ctate una vez para preparar las marcas"
    : !brandCacheReady
      ? "Descargando marcas para uso sin conexiÃ³n"
      : syncing
        ? "Sincronizando registros"
        : pendingCount > 0
          ? `${pendingCount} ${pendingCount === 1 ? "registro por enviar" : "registros por enviar"}`
          : "InformaciÃ³n sincronizada";

  return (
    <main className="operator-page scan-page">
      <header className="operator-header">
        <BrandLogo compact />
        <div className="operator-meta">
          <span>Recorrido {route.routeNumber}</span>
          <strong>{user?.fullName}</strong>
        </div>
        <button className="header-icon" onClick={() => void handleLogout()} aria-label="Cerrar sesiÃ³n">
          <LogOut size={21} />
        </button>
      </header>

      <section className="route-progress-card">
        <div><span>Avance del recorrido</span><strong>{completedBrands.length} / {brands.length}</strong></div>
        <div className="progress-track"><span style={{ width: `${progressPercent}%` }} /></div>
        <button
          type="button"
          onClick={() => setScreen("progress")}
        >
          <ListChecks size={18} /> Ver marcas
        </button>
      </section>

      <section className="scan-copy">
        <h1>Escanear cÃ³digo QR</h1>
        <p>Apunta la cÃ¡mara al cÃ³digo ubicado en la marca.</p>
      </section>
      {testCode ? (
        <div className="camera-stage"><div className="camera-status"><ScanLine size={30} /><span>Procesando cÃ³digo QR...</span></div></div>
      ) : (
        <QrCamera onScan={handleScan} />
      )}

      <button
        className="closed-report-entry"
        type="button"
        onClick={() => setScreen("closed")}
      >
        <DoorClosed size={21} />
        <span><strong>Reportar local cerrado</strong><small>Selecciona la tienda, toma una foto y agrega observaciones si aplica.</small></span>
      </button>

      {configured ? (
        <section className={`sync-strip ${online ? "online" : "offline"}`} aria-live="polite">
          <span className="sync-icon">{online ? <CloudUpload size={20} /> : <CloudOff size={20} />}</span>
          <div>
            <strong>{online ? "Con conexiÃ³n" : "Modo sin conexiÃ³n"}</strong>
            <span>{offlineAccess ? "SesiÃ³n local activa Â· " : ""}{syncLabel}</span>
          </div>
          {online && pendingCount > 0 ? (
            <button type="button" onClick={() => void syncNow()} disabled={syncing}>
              <RefreshCw className={syncing ? "spinner" : ""} size={18} />
              <span>Sincronizar</span>
            </button>
          ) : null}
        </section>
      ) : null}
      <footer className="scan-footer">
        <span><ClipboardList size={20} /> Recorrido {route.routeNumber}</span>
        <button type="button" onClick={() => alert("Escanea el QR para registrar una recolecciÃ³n. Usa Reportar local cerrado cuando no sea posible acceder al QR.")}>
          <HelpCircle size={20} /> Ayuda
        </button>
      </footer>
    </main>
  );
}
