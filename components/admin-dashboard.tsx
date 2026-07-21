"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Building2,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FilterX,
  LoaderCircle,
  RefreshCw,
  Search,
  Store,
  TriangleAlert,
  UsersRound,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "@/components/auth-provider";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type DashboardBrand = {
  id: string;
  name: string;
  local: string;
  zone: string;
  floor: string;
  routeOrder: number | null;
  active: boolean;
};

type DashboardProfile = {
  id: string;
  fullName: string;
  username: string;
};

type DashboardRoute = {
  id: string;
  visitDate: string;
  routeNumber: number;
  status: "active" | "completed";
  startedAt: string;
  completedAt: string | null;
};

type DashboardVisit = {
  id: string;
  routeId: string;
  brandId: string;
  operatorId: string;
  result: "delivered" | "closed";
  confirmedAt: string;
  visitDate: string;
  observations: string | null;
  photoPath: string | null;
};

type DashboardCache = {
  brands: DashboardBrand[];
  profiles: DashboardProfile[];
  routes: DashboardRoute[];
  visits: DashboardVisit[];
  updatedAt: string;
  from: string;
  to: string;
};

type Filters = {
  from: string;
  to: string;
  routeId: string;
  operatorId: string;
  brandId: string;
  result: string;
  zone: string;
  floor: string;
  search: string;
};

const supabase = createSupabaseBrowserClient();
const CACHE_KEY = "jp-aforo-admin-dashboard-v1";
const PAGE_SIZE = 15;

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultFilters(): Filters {
  const today = localDateKey(new Date());
  return {
    from: today,
    to: today,
    routeId: "",
    operatorId: "",
    brandId: "",
    result: "",
    zone: "",
    floor: "",
    search: "",
  };
}

function formatDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(
    new Date(`${value}T12:00:00`),
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function durationMinutes(route: DashboardRoute) {
  const end = route.completedAt ? new Date(route.completedAt).getTime() : Date.now();
  return Math.max(0, Math.round((end - new Date(route.startedAt).getTime()) / 60000));
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return `${hours} h ${rest} min`;
}

function escapeCsv(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function readCache(): DashboardCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as DashboardCache) : null;
  } catch {
    return null;
  }
}

function writeCache(cache: DashboardCache) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export function AdminDashboard() {
  const { configured, user } = useAuth();
  const [filters, setFilters] = useState<Filters>(() => defaultFilters());
  const [brands, setBrands] = useState<DashboardBrand[]>([]);
  const [profiles, setProfiles] = useState<DashboardProfile[]>([]);
  const [routes, setRoutes] = useState<DashboardRoute[]>([]);
  const [visits, setVisits] = useState<DashboardVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [page, setPage] = useState(1);
  const [evidenceUrl, setEvidenceUrl] = useState<string | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  const loadDashboard = useCallback(async (silent = false) => {
    if (!user || user.role !== "admin") return;
    if (!silent) setLoading(true);
    setError("");

    const cached = readCache();
    if (!navigator.onLine || !configured || !supabase) {
      if (cached) {
        setBrands(cached.brands);
        setProfiles(cached.profiles);
        setRoutes(cached.routes);
        setVisits(cached.visits);
        setUpdatedAt(cached.updatedAt);
      } else if (!configured) {
        setBrands([
          { id: "brand-1", name: "Adidas", local: "214", zone: "Zona 1", floor: "Piso 2", routeOrder: 1, active: true },
          { id: "brand-2", name: "Arturo Calle", local: "118", zone: "Zona 1", floor: "Piso 1", routeOrder: 2, active: true },
          { id: "brand-3", name: "Studio F", local: "305", zone: "Zona 2", floor: "Piso 3", routeOrder: 3, active: true },
        ]);
        setProfiles([{ id: "demo-operator", fullName: "Operario de prueba", username: "operario" }]);
        setRoutes([]);
        setVisits([]);
      } else {
        setError("No hay datos guardados para consultar sin conexión.");
      }
      setLoading(false);
      return;
    }

    try {
      const [brandResponse, profileResponse, routeResponse, visitResponse] = await Promise.all([
        supabase
          .from("brands")
          .select("id, name, local, zone, floor, route_order, is_active")
          .order("route_order", { ascending: true, nullsFirst: false })
          .order("name"),
        supabase
          .from("profiles")
          .select("id, full_name, username")
          .eq("is_active", true)
          .order("full_name"),
        supabase
          .from("route_runs")
          .select("id, visit_date, route_number, status, started_at, completed_at")
          .gte("visit_date", filters.from)
          .lte("visit_date", filters.to)
          .order("visit_date", { ascending: false })
          .order("route_number", { ascending: false }),
        supabase
          .from("visit_records")
          .select("id, route_id, brand_id, operator_id, result, confirmed_at, visit_date, observations, photo_path")
          .gte("visit_date", filters.from)
          .lte("visit_date", filters.to)
          .order("confirmed_at", { ascending: false })
          .limit(10000),
      ]);

      if (brandResponse.error) throw brandResponse.error;
      if (profileResponse.error) throw profileResponse.error;
      if (routeResponse.error) throw routeResponse.error;
      if (visitResponse.error) throw visitResponse.error;

      const nextBrands: DashboardBrand[] = (brandResponse.data ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        local: String(row.local),
        zone: row.zone ? String(row.zone) : "Sin zona",
        floor: row.floor ? String(row.floor) : "Sin piso",
        routeOrder: row.route_order === null ? null : Number(row.route_order),
        active: Boolean(row.is_active),
      }));
      const nextProfiles: DashboardProfile[] = (profileResponse.data ?? []).map((row) => ({
        id: String(row.id),
        fullName: String(row.full_name),
        username: String(row.username),
      }));
      const nextRoutes: DashboardRoute[] = (routeResponse.data ?? []).map((row) => ({
        id: String(row.id),
        visitDate: String(row.visit_date),
        routeNumber: Number(row.route_number),
        status: row.status === "completed" ? "completed" : "active",
        startedAt: String(row.started_at),
        completedAt: row.completed_at ? String(row.completed_at) : null,
      }));
      const nextVisits: DashboardVisit[] = (visitResponse.data ?? []).map((row) => ({
        id: String(row.id),
        routeId: String(row.route_id),
        brandId: String(row.brand_id),
        operatorId: String(row.operator_id),
        result: row.result === "closed" ? "closed" : "delivered",
        confirmedAt: String(row.confirmed_at),
        visitDate: String(row.visit_date),
        observations: row.observations ? String(row.observations) : null,
        photoPath: row.photo_path ? String(row.photo_path) : null,
      }));
      const now = new Date().toISOString();

      setBrands(nextBrands);
      setProfiles(nextProfiles);
      setRoutes(nextRoutes);
      setVisits(nextVisits);
      setUpdatedAt(now);
      writeCache({
        brands: nextBrands,
        profiles: nextProfiles,
        routes: nextRoutes,
        visits: nextVisits,
        updatedAt: now,
        from: filters.from,
        to: filters.to,
      });
    } catch (cause) {
      const cachedFallback = readCache();
      if (cachedFallback) {
        setBrands(cachedFallback.brands);
        setProfiles(cachedFallback.profiles);
        setRoutes(cachedFallback.routes);
        setVisits(cachedFallback.visits);
        setUpdatedAt(cachedFallback.updatedAt);
        setError("No fue posible actualizar. Se muestran los últimos datos guardados.");
      } else {
        setError(cause instanceof Error ? cause.message : "No fue posible cargar el dashboard");
      }
    } finally {
      setLoading(false);
    }
  }, [configured, filters.from, filters.to, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const cached = readCache();
      if (cached) {
        setBrands(cached.brands);
        setProfiles(cached.profiles);
        setRoutes(cached.routes);
        setVisits(cached.visits);
        setUpdatedAt(cached.updatedAt);
      }
      void loadDashboard();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      void loadDashboard(true);
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    const interval = window.setInterval(() => {
      if (navigator.onLine) void loadDashboard(true);
    }, 60000);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.clearInterval(interval);
    };
  }, [loadDashboard]);


  const brandMap = useMemo(() => new Map(brands.map((item) => [item.id, item])), [brands]);
  const profileMap = useMemo(() => new Map(profiles.map((item) => [item.id, item])), [profiles]);
  const routeMap = useMemo(() => new Map(routes.map((item) => [item.id, item])), [routes]);
  const activeBrands = useMemo(() => brands.filter((item) => item.active), [brands]);

  const routeOptions = useMemo(
    () => [...routes].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [routes],
  );
  const zones = useMemo(() => [...new Set(activeBrands.map((item) => item.zone))].sort(), [activeBrands]);
  const floors = useMemo(() => [...new Set(activeBrands.map((item) => item.floor))].sort(), [activeBrands]);

  const filteredVisits = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return visits.filter((visit) => {
      const brand = brandMap.get(visit.brandId);
      const operator = profileMap.get(visit.operatorId);
      if (filters.routeId && visit.routeId !== filters.routeId) return false;
      if (filters.operatorId && visit.operatorId !== filters.operatorId) return false;
      if (filters.brandId && visit.brandId !== filters.brandId) return false;
      if (filters.result && visit.result !== filters.result) return false;
      if (filters.zone && brand?.zone !== filters.zone) return false;
      if (filters.floor && brand?.floor !== filters.floor) return false;
      if (search) {
        const haystack = `${brand?.name ?? ""} ${brand?.local ?? ""} ${operator?.fullName ?? ""} ${visit.observations ?? ""}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [brandMap, filters, profileMap, visits]);

  const selectedRoutes = useMemo(() => {
    if (filters.routeId) return routes.filter((route) => route.id === filters.routeId);
    return routes;
  }, [filters.routeId, routes]);

  const metrics = useMemo(() => {
    const delivered = filteredVisits.filter((item) => item.result === "delivered").length;
    const closed = filteredVisits.filter((item) => item.result === "closed").length;
    const routeIds = new Set(selectedRoutes.map((item) => item.id));
    const managedByRoute = new Map<string, Set<string>>();
    for (const visit of visits) {
      if (!routeIds.has(visit.routeId)) continue;
      const brand = brandMap.get(visit.brandId);
      if (filters.zone && brand?.zone !== filters.zone) continue;
      if (filters.floor && brand?.floor !== filters.floor) continue;
      if (filters.brandId && visit.brandId !== filters.brandId) continue;
      const current = managedByRoute.get(visit.routeId) ?? new Set<string>();
      current.add(visit.brandId);
      managedByRoute.set(visit.routeId, current);
    }
    const baseBrands = activeBrands.filter((brand) =>
      (!filters.zone || brand.zone === filters.zone) &&
      (!filters.floor || brand.floor === filters.floor) &&
      (!filters.brandId || brand.id === filters.brandId),
    );
    const expected = baseBrands.length * selectedRoutes.length;
    const managed = [...managedByRoute.values()].reduce((sum, set) => sum + set.size, 0);
    const pending = Math.max(0, expected - managed);
    const completion = expected === 0 ? 0 : Math.round((managed / expected) * 100);
    const durations = selectedRoutes.map(durationMinutes);
    const averageDuration = durations.length === 0 ? 0 : Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
    return { delivered, closed, managed, pending, completion, averageDuration };
  }, [activeBrands, brandMap, filteredVisits, filters.brandId, filters.floor, filters.zone, selectedRoutes, visits]);

  const routeChartData = useMemo(() => {
    const baseBrands = activeBrands.filter((brand) =>
      (!filters.zone || brand.zone === filters.zone) &&
      (!filters.floor || brand.floor === filters.floor) &&
      (!filters.brandId || brand.id === filters.brandId),
    );
    return selectedRoutes
      .slice()
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((route) => {
        const routeVisits = filteredVisits.filter((visit) => visit.routeId === route.id);
        const visitedBrands = new Set(routeVisits.map((item) => item.brandId));
        return {
          name: `${route.visitDate.slice(5)} · R${route.routeNumber}`,
          Entregas: routeVisits.filter((item) => item.result === "delivered").length,
          Cerrados: routeVisits.filter((item) => item.result === "closed").length,
          Pendientes: Math.max(0, baseBrands.length - visitedBrands.size),
        };
      });
  }, [activeBrands, filteredVisits, filters.brandId, filters.floor, filters.zone, selectedRoutes]);

  const operatorChartData = useMemo(() => {
    const accumulator = new Map<string, { name: string; Entregas: number; Cerrados: number }>();
    for (const visit of filteredVisits) {
      const operator = profileMap.get(visit.operatorId);
      const current = accumulator.get(visit.operatorId) ?? {
        name: operator?.fullName ?? "Sin asignar",
        Entregas: 0,
        Cerrados: 0,
      };
      if (visit.result === "closed") current.Cerrados += 1;
      else current.Entregas += 1;
      accumulator.set(visit.operatorId, current);
    }
    return [...accumulator.values()].sort(
      (a, b) => b.Entregas + b.Cerrados - (a.Entregas + a.Cerrados),
    );
  }, [filteredVisits, profileMap]);

  const dailyTrendData = useMemo(() => {
    const accumulator = new Map<string, { date: string; Entregas: number; Cerrados: number; Cumplimiento: number }>();
    for (const route of selectedRoutes) {
      if (!accumulator.has(route.visitDate)) {
        accumulator.set(route.visitDate, { date: route.visitDate, Entregas: 0, Cerrados: 0, Cumplimiento: 0 });
      }
    }
    for (const visit of filteredVisits) {
      const current = accumulator.get(visit.visitDate) ?? { date: visit.visitDate, Entregas: 0, Cerrados: 0, Cumplimiento: 0 };
      if (visit.result === "closed") current.Cerrados += 1;
      else current.Entregas += 1;
      accumulator.set(visit.visitDate, current);
    }
    for (const [date, current] of accumulator) {
      const dayRoutes = selectedRoutes.filter((route) => route.visitDate === date).length;
      const baseBrands = activeBrands.filter((brand) =>
        (!filters.zone || brand.zone === filters.zone) &&
        (!filters.floor || brand.floor === filters.floor) &&
        (!filters.brandId || brand.id === filters.brandId),
      ).length;
      const expected = dayRoutes * baseBrands;
      current.Cumplimiento = expected === 0 ? 0 : Math.min(100, Math.round(((current.Entregas + current.Cerrados) / expected) * 100));
    }
    return [...accumulator.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((item) => ({ ...item, name: item.date.slice(5) }));
  }, [activeBrands, filteredVisits, filters.brandId, filters.floor, filters.zone, selectedRoutes]);

  const recurrentClosed = useMemo(() => {
    const counts = new Map<string, number>();
    for (const visit of filteredVisits) {
      if (visit.result !== "closed") continue;
      counts.set(visit.brandId, (counts.get(visit.brandId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([brandId, count]) => ({ brand: brandMap.get(brandId), count }))
      .filter((item) => item.brand)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [brandMap, filteredVisits]);

  const latestRoute = useMemo(
    () => [...selectedRoutes].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null,
    [selectedRoutes],
  );
  const latestRouteVisited = useMemo(
    () => new Set(visits.filter((visit) => visit.routeId === latestRoute?.id).map((visit) => visit.brandId)),
    [latestRoute, visits],
  );
  const latestPending = useMemo(
    () => activeBrands
      .filter((brand) => !latestRouteVisited.has(brand.id))
      .sort((a, b) => (a.routeOrder ?? Number.MAX_SAFE_INTEGER) - (b.routeOrder ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 12),
    [activeBrands, latestRouteVisited],
  );

  const totalPages = Math.max(1, Math.ceil(filteredVisits.length / PAGE_SIZE));
  const pageRows = filteredVisits.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function resetFilters() {
    setFilters(defaultFilters());
    setPage(1);
  }

  function exportCsv() {
    const headers = ["Fecha", "Recorrido", "Marca", "Local", "Zona", "Piso", "Operario", "Resultado", "Hora", "Observaciones", "Evidencia"];
    const rows = filteredVisits.map((visit) => {
      const brand = brandMap.get(visit.brandId);
      const operator = profileMap.get(visit.operatorId);
      const route = routeMap.get(visit.routeId);
      return [
        visit.visitDate,
        route?.routeNumber ?? "",
        brand?.name ?? "",
        brand?.local ?? "",
        brand?.zone ?? "",
        brand?.floor ?? "",
        operator?.fullName ?? "",
        visit.result === "closed" ? "Local cerrado" : "Entregó residuos",
        formatDateTime(visit.confirmedAt),
        visit.observations ?? "",
        visit.photoPath ?? "",
      ];
    });
    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(";")).join("\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aforo-residuos-${filters.from}-${filters.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function openEvidence(path: string) {
    if (!supabase) return;
    setEvidenceLoading(true);
    try {
      const { data, error: signedError } = await supabase.storage
        .from("closed-evidence")
        .createSignedUrl(path, 300);
      if (signedError) throw signedError;
      setEvidenceUrl(data.signedUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible abrir la evidencia");
    } finally {
      setEvidenceLoading(false);
    }
  }

  return (
    <section className="admin-content dashboard-content">
      <header className="admin-topbar dashboard-topbar">
        <div>
          <p>Operación de residuos</p>
          <h1>Dashboard</h1>
          <span>
            Seguimiento de recorridos, cumplimiento y novedades de las marcas.
          </span>
        </div>
        <div className="dashboard-actions">
          <button className="secondary-button" onClick={() => void loadDashboard()} disabled={loading || !online}>
            <RefreshCw size={18} className={loading ? "spinner" : ""} /> Actualizar
          </button>
          <button className="primary-button" onClick={exportCsv} disabled={filteredVisits.length === 0}>
            <Download size={18} /> Exportar CSV
          </button>
        </div>
      </header>

      <div className={`dashboard-live-state ${online ? "online" : "offline"}`}>
        {online ? <CheckCircle2 size={17} /> : <TriangleAlert size={17} />}
        <span>{online ? "Datos en línea" : "Sin conexión: mostrando los últimos datos guardados"}</span>
        <time>{updatedAt ? `Actualizado ${formatDateTime(updatedAt)}` : "Sin actualización previa"}</time>
      </div>

      <section className="dashboard-filters" aria-label="Filtros del dashboard">
        <div className="filter-field">
          <label htmlFor="filter-from">Desde</label>
          <div><CalendarDays size={17} /><input id="filter-from" type="date" value={filters.from} onChange={(event) => updateFilter("from", event.target.value)} /></div>
        </div>
        <div className="filter-field">
          <label htmlFor="filter-to">Hasta</label>
          <div><CalendarDays size={17} /><input id="filter-to" type="date" value={filters.to} min={filters.from} onChange={(event) => updateFilter("to", event.target.value)} /></div>
        </div>
        <div className="filter-field">
          <label htmlFor="filter-route">Recorrido</label>
          <select id="filter-route" value={filters.routeId} onChange={(event) => updateFilter("routeId", event.target.value)}>
            <option value="">Todos</option>
            {routeOptions.map((route) => <option key={route.id} value={route.id}>{formatDate(route.visitDate)} · Recorrido {route.routeNumber}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="filter-operator">Operario</label>
          <select id="filter-operator" value={filters.operatorId} onChange={(event) => updateFilter("operatorId", event.target.value)}>
            <option value="">Todos</option>
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.fullName}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="filter-brand">Marca</label>
          <select id="filter-brand" value={filters.brandId} onChange={(event) => updateFilter("brandId", event.target.value)}>
            <option value="">Todas</option>
            {activeBrands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name} · {brand.local}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="filter-result">Resultado</label>
          <select id="filter-result" value={filters.result} onChange={(event) => updateFilter("result", event.target.value)}>
            <option value="">Todos</option>
            <option value="delivered">Entregó residuos</option>
            <option value="closed">Local cerrado</option>
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="filter-zone">Zona</label>
          <select id="filter-zone" value={filters.zone} onChange={(event) => updateFilter("zone", event.target.value)}>
            <option value="">Todas</option>
            {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="filter-floor">Piso</label>
          <select id="filter-floor" value={filters.floor} onChange={(event) => updateFilter("floor", event.target.value)}>
            <option value="">Todos</option>
            {floors.map((floor) => <option key={floor} value={floor}>{floor}</option>)}
          </select>
        </div>
        <button className="filter-reset" type="button" onClick={resetFilters}><FilterX size={18} /> Limpiar</button>
      </section>

      {error ? <p className="admin-error dashboard-error" role="alert">{error}</p> : null}

      {loading && routes.length === 0 ? (
        <div className="dashboard-loading"><LoaderCircle className="spinner" size={30} /><span>Cargando indicadores...</span></div>
      ) : (
        <>
          <section className="metric-grid" aria-label="Indicadores principales">
            <article className="metric-card primary"><span><BarChart3 size={20} /> Cumplimiento</span><strong>{metrics.completion}%</strong><small>{metrics.managed} gestiones sobre {metrics.managed + metrics.pending}</small></article>
            <article className="metric-card"><span><CheckCircle2 size={20} /> Entregas</span><strong>{metrics.delivered}</strong><small>registros filtrados</small></article>
            <article className="metric-card warning"><span><Building2 size={20} /> Locales cerrados</span><strong>{metrics.closed}</strong><small>con foto y observación</small></article>
            <article className="metric-card"><span><Store size={20} /> Pendientes</span><strong>{metrics.pending}</strong><small>en los recorridos seleccionados</small></article>
            <article className="metric-card"><span><Clock3 size={20} /> Duración promedio</span><strong>{formatDuration(metrics.averageDuration)}</strong><small>{selectedRoutes.length} recorridos analizados</small></article>
          </section>

          <section className="dashboard-grid dashboard-grid-primary">
            <article className="chart-panel chart-panel-wide">
              <header><div><span>Comparativo operativo</span><h2>Resultados por recorrido</h2></div><BarChart3 size={22} /></header>
              {routeChartData.length === 0 ? <div className="chart-empty">No hay recorridos para el rango seleccionado.</div> : (
                <div className="chart-canvas">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={routeChartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="Entregas" fill="#0a6b3a" radius={[5, 5, 0, 0]} />
                      <Bar dataKey="Cerrados" fill="#f26522" radius={[5, 5, 0, 0]} />
                      <Bar dataKey="Pendientes" fill="#b5beb8" radius={[5, 5, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </article>

            <article className="pending-panel">
              <header><div><span>Estado más reciente</span><h2>{latestRoute ? `Pendientes · Recorrido ${latestRoute.routeNumber}` : "Marcas pendientes"}</h2></div><Store size={22} /></header>
              {latestRoute ? <p>{formatDate(latestRoute.visitDate)} · {latestPending.length} visibles de {Math.max(0, activeBrands.length - latestRouteVisited.size)} pendientes</p> : <p>No existe un recorrido en el rango seleccionado.</p>}
              <div className="pending-brand-list">
                {latestPending.length === 0 ? <div className="chart-empty compact">Sin marcas pendientes.</div> : latestPending.map((brand) => (
                  <div key={brand.id}><span>{brand.routeOrder ?? "—"}</span><div><strong>{brand.name}</strong><small>Local {brand.local} · {brand.zone}</small></div></div>
                ))}
              </div>
            </article>
          </section>

          <section className="dashboard-grid">
            <article className="chart-panel">
              <header><div><span>Distribución del equipo</span><h2>Registros por operario</h2></div><UsersRound size={22} /></header>
              {operatorChartData.length === 0 ? <div className="chart-empty">No hay datos para mostrar.</div> : (
                <div className="chart-canvas">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={operatorChartData} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis type="category" dataKey="name" width={105} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="Entregas" stackId="a" fill="#0a6b3a" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="Cerrados" stackId="a" fill="#f26522" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </article>

            <article className="chart-panel">
              <header><div><span>Evolución</span><h2>Tendencia diaria</h2></div><CalendarDays size={22} /></header>
              {dailyTrendData.length === 0 ? <div className="chart-empty">No hay datos para mostrar.</div> : (
                <div className="chart-canvas">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dailyTrendData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
                      <Tooltip formatter={(value, name) => name === "Cumplimiento" ? `${value}%` : value} />
                      <Line type="monotone" dataKey="Cumplimiento" stroke="#0a6b3a" strokeWidth={3} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </article>

            <article className="closed-ranking-panel">
              <header><div><span>Seguimiento</span><h2>Cierres recurrentes</h2></div><TriangleAlert size={22} /></header>
              <div className="closed-ranking-list">
                {recurrentClosed.length === 0 ? <div className="chart-empty compact">No hay locales cerrados.</div> : recurrentClosed.map((item, index) => (
                  <div key={item.brand?.id}><b>{index + 1}</b><div><strong>{item.brand?.name}</strong><small>Local {item.brand?.local}</small></div><span>{item.count}</span></div>
                ))}
              </div>
            </article>
          </section>

          <section className="records-panel">
            <header className="records-header">
              <div><span>Detalle operativo</span><h2>Registros</h2></div>
              <div className="records-search"><Search size={18} /><input value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Buscar marca, local, operario u observación" /></div>
            </header>
            <div className="records-table-wrap">
              <table className="records-table">
                <thead><tr><th>Fecha</th><th>Recorrido</th><th>Marca</th><th>Ubicación</th><th>Operario</th><th>Resultado</th><th>Hora</th><th>Observación</th><th>Evidencia</th></tr></thead>
                <tbody>
                  {pageRows.length === 0 ? <tr><td colSpan={9} className="table-empty">No hay registros con los filtros seleccionados.</td></tr> : pageRows.map((visit) => {
                    const brand = brandMap.get(visit.brandId);
                    const operator = profileMap.get(visit.operatorId);
                    const route = routeMap.get(visit.routeId);
                    return (
                      <tr key={visit.id}>
                        <td>{formatDate(visit.visitDate)}</td>
                        <td>#{route?.routeNumber ?? "—"}</td>
                        <td><strong>{brand?.name ?? "Marca eliminada"}</strong><small>Local {brand?.local ?? "—"}</small></td>
                        <td>{brand?.zone ?? "—"}<small>{brand?.floor ?? "—"}</small></td>
                        <td>{operator?.fullName ?? "Sin información"}</td>
                        <td><span className={`result-tag ${visit.result}`}>{visit.result === "closed" ? "Local cerrado" : "Entregó residuos"}</span></td>
                        <td>{new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit" }).format(new Date(visit.confirmedAt))}</td>
                        <td className="observation-cell">{visit.observations ?? "—"}</td>
                        <td>{visit.photoPath ? <button className="evidence-button" onClick={() => void openEvidence(visit.photoPath!)} disabled={evidenceLoading}><Camera size={17} /> Ver foto</button> : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <footer className="records-footer"><span>{filteredVisits.length} registros</span><div><button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}><ChevronLeft size={18} /></button><b>Página {page} de {totalPages}</b><button onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages}><ChevronRight size={18} /></button></div></footer>
          </section>
        </>
      )}

      {evidenceUrl ? (
        <div className="modal-backdrop evidence-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setEvidenceUrl(null); }}>
          <section className="evidence-modal" role="dialog" aria-modal="true" aria-label="Evidencia del local cerrado">
            <button className="modal-close" onClick={() => setEvidenceUrl(null)} aria-label="Cerrar"><X size={21} /></button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={evidenceUrl} alt="Evidencia fotográfica del local cerrado" />
          </section>
        </div>
      ) : null}
    </section>
  );
}
