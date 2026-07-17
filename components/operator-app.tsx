"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  CloudOff,
  CloudUpload,
  DoorClosed,
  HelpCircle,
  LogOut,
  RefreshCw,
  ScanLine,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { QrCamera } from "@/components/qr-camera";
import { useAuth } from "@/components/auth-provider";
import { findDemoBrand, saveDemoVisit } from "@/lib/demo-store";
import {
  cacheBrand,
  getCachedBrand,
  getMeta,
  getPendingVisitCount,
  queueVisit,
} from "@/lib/offline-db";
import { refreshBrandCache, syncPendingVisits } from "@/lib/offline-sync";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Brand, VisitResult } from "@/lib/types";

const supabase = createSupabaseBrowserClient();

type Screen = "scan" | "result" | "success" | "error";

function shiftNow(): "morning" | "night" {
  const hour = new Date().getHours();
  return hour >= 5 && hour < 15 ? "morning" : "night";
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function OperatorApp() {
  const { user, logout, configured, offlineAccess } = useAuth();
  const params = useSearchParams();
  const testCode = process.env.NEXT_PUBLIC_ENABLE_QR_TEST === "true" ? params.get("demoQr") : null;
  const [screen, setScreen] = useState<Screen>("scan");
  const [brand, setBrand] = useState<Brand | null>(null);
  const [scannedAt, setScannedAt] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [brandCacheReady, setBrandCacheReady] = useState(false);
  const [savedOffline, setSavedOffline] = useState(false);
  const syncLock = useRef(false);

  const shift = useMemo(() => shiftNow(), []);

  const refreshPendingCount = useCallback(async () => {
    if (!configured || !user) return;
    try {
      setPendingCount(await getPendingVisitCount(user.id));
    } catch {
      setPendingCount(0);
    }
  }, [configured, user]);

  const syncNow = useCallback(async () => {
    if (!configured || !supabase || !user || !navigator.onLine || syncLock.current) return;
    syncLock.current = true;
    setSyncing(true);
    try {
      const summary = await syncPendingVisits(supabase, user.id);
      setPendingCount(summary.pending);
    } catch {
      await refreshPendingCount();
    } finally {
      syncLock.current = false;
      setSyncing(false);
    }
  }, [configured, refreshPendingCount, user]);

  const updateBrandCache = useCallback(async () => {
    if (!configured || !supabase || !navigator.onLine) return;
    try {
      await refreshBrandCache(supabase);
      setBrandCacheReady(true);
    } catch {
      const lastSync = await getMeta("brands_last_synced_at").catch(() => null);
      setBrandCacheReady(Boolean(lastSync));
    }
  }, [configured]);

  const handleLogout = useCallback(async () => {
    if (configured && user) {
      if (navigator.onLine) await syncNow();
      const remaining = await getPendingVisitCount(user.id).catch(() => pendingCount);
      if (remaining > 0) {
        window.alert(
          `Hay ${remaining} ${remaining === 1 ? "registro pendiente" : "registros pendientes"}. ` +
          "La sesión permanecerá abierta para enviarlos cuando regrese la conexión.",
        );
        return;
      }
    }
    await logout();
  }, [configured, logout, pendingCount, syncNow, user]);

  useEffect(() => {
    const currentOnlineState = navigator.onLine;

    const initializeTimer = window.setTimeout(() => {
      void refreshPendingCount();
      void getMeta("brands_last_synced_at")
        .then((lastSync) => setBrandCacheReady(Boolean(lastSync)))
        .catch(() => setBrandCacheReady(false));

      if (currentOnlineState) {
        void updateBrandCache();
        void syncNow();
      }
    }, 0);

    if (navigator.storage?.persist) {
      void navigator.storage.persist().catch(() => false);
    }

    const handleOnline = () => {
      setOnline(true);
      void updateBrandCache();
      void syncNow();
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.clearTimeout(initializeTimer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refreshPendingCount, syncNow, updateBrandCache]);

  useEffect(() => {
    if (!configured || !online || offlineAccess) return;
    const timer = window.setTimeout(() => void syncNow(), 1200);
    return () => window.clearTimeout(timer);
  }, [configured, offlineAccess, online, syncNow]);

  const handleScan = useCallback(
    async (rawCode: string) => {
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
              ? "Este código QR no corresponde a una marca activa."
              : brandCacheReady
                ? "Este código QR no se encuentra en las marcas guardadas en el dispositivo."
                : "Conéctate una vez para descargar las marcas antes de realizar recorridos sin señal.",
          );
          setScreen("error");
          return;
        }

        setBrand(found);
        setScreen("result");
      } catch {
        setMessage(
          navigator.onLine
            ? "No fue posible consultar la marca. Inténtalo nuevamente."
            : "No hay conexión y la marca todavía no está guardada en este dispositivo.",
        );
        setScreen("error");
      }
    },
    [brandCacheReady, configured],
  );

  useEffect(() => {
    if (!testCode || screen !== "scan") return;
    const timer = window.setTimeout(() => void handleScan(testCode), 0);
    return () => window.clearTimeout(timer);
  }, [handleScan, screen, testCode]);

  async function saveResult(result: VisitResult) {
    if (!brand || !user) return;
    setSaving(true);

    try {
      const now = new Date();
      const visit = {
        id: crypto.randomUUID(),
        brandId: brand.id,
        operatorId: user.id,
        result,
        scannedAt,
        confirmedAt: now.toISOString(),
        shift,
        visitDate: localDateKey(now),
      } as const;

      if (!configured || !supabase) {
        saveDemoVisit(visit);
        setSavedOffline(false);
      } else {
        await queueVisit(visit);
        setSavedOffline(!navigator.onLine);
        await refreshPendingCount();
        if (navigator.onLine) void syncNow();
      }

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

  if (screen === "result" && brand) {
    return (
      <main className="operator-page result-page">
        <header className="operator-header compact-header">
          <BrandLogo compact />
          <button className="header-icon" onClick={() => void handleLogout()} aria-label="Cerrar sesión">
            <LogOut size={21} />
          </button>
        </header>
        <section className="result-content">
          <div className="step-heading">
            <span className="step-icon"><ScanLine size={21} /></span>
            <div>
              <p>Resultado de la visita</p>
              <h1>Selecciona una opción</h1>
            </div>
          </div>
          <article className="brand-result-card">
            <span>Marca</span>
            <strong>{brand.name}</strong>
            <div>
              <span>Local</span>
              <b>{brand.local}</b>
            </div>
          </article>
          <p className="result-question">¿Qué ocurrió en esta visita?</p>
          <div className="result-actions">
            <button className="result-button delivered" disabled={saving} onClick={() => void saveResult("delivered")}>
              <CheckCircle2 size={27} />
              <span>Entregó residuos</span>
            </button>
            <button className="result-button closed" disabled={saving} onClick={() => void saveResult("closed")}>
              <DoorClosed size={27} />
              <span>Local cerrado</span>
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "success") {
    return (
      <main className="feedback-page success-feedback">
        <div className="feedback-symbol"><Check size={46} strokeWidth={3} /></div>
        <h1>Registro guardado</h1>
        <p>
          {savedOffline
            ? "Quedó protegido en el dispositivo y se enviará automáticamente cuando regrese la conexión."
            : "El registro quedó protegido localmente y la aplicación está verificando su sincronización."}
        </p>
      </main>
    );
  }

  if (screen === "error") {
    return (
      <main className="feedback-page error-feedback">
        <div className="feedback-symbol"><HelpCircle size={44} /></div>
        <h1>No se pudo registrar</h1>
        <p>{message}</p>
        <button
          className="primary-button"
          onClick={() => {
            setBrand(null);
            setScreen("scan");
          }}
        >
          Volver a escanear
        </button>
      </main>
    );
  }

  const syncLabel = !online
    ? brandCacheReady
      ? `${pendingCount} ${pendingCount === 1 ? "registro pendiente" : "registros pendientes"}`
      : "Conéctate una vez para preparar las marcas"
    : !brandCacheReady
      ? "Descargando marcas para uso sin conexión"
      : syncing
        ? "Sincronizando registros"
        : pendingCount > 0
          ? `${pendingCount} ${pendingCount === 1 ? "registro por enviar" : "registros por enviar"}`
          : "Información sincronizada";

  return (
    <main className="operator-page scan-page">
      <header className="operator-header">
        <BrandLogo compact />
        <div className="operator-meta">
          <span>{shift === "morning" ? "Recorrido mañana" : "Recorrido noche"}</span>
          <strong>{user?.fullName}</strong>
        </div>
        <button className="header-icon" onClick={() => void handleLogout()} aria-label="Cerrar sesión">
          <LogOut size={21} />
        </button>
      </header>
      <section className="scan-copy">
        <h1>Escanear código QR</h1>
        <p>Apunta la cámara al código ubicado en la marca.</p>
      </section>
      {testCode ? (
        <div className="camera-stage"><div className="camera-status"><ScanLine size={30} /><span>Procesando código QR...</span></div></div>
      ) : (
        <QrCamera onScan={handleScan} />
      )}
      {configured ? (
        <section className={`sync-strip ${online ? "online" : "offline"}`} aria-live="polite">
          <span className="sync-icon">{online ? <CloudUpload size={20} /> : <CloudOff size={20} />}</span>
          <div>
            <strong>{online ? "Con conexión" : "Modo sin conexión"}</strong>
            <span>{offlineAccess ? "Sesión local activa · " : ""}{syncLabel}</span>
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
        <span><ScanLine size={20} /> Escaneo obligatorio</span>
        <button type="button" onClick={() => alert("Ubica el QR dentro del marco verde. La lectura se realiza automáticamente.")}>
          <HelpCircle size={20} /> Ayuda
        </button>
      </footer>
    </main>
  );
}
