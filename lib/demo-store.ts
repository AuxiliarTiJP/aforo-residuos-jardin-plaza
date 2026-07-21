import type { AppUser, Brand, VisitRecord } from "@/lib/types";

const USERS_KEY = "jp_residuos_demo_users_v2";
const SESSION_KEY = "jp_residuos_demo_session_v2";
const VISITS_KEY = "jp_residuos_demo_visits_v2";

type DemoUser = AppUser & { password: string };

const seedUsers: DemoUser[] = [
  {
    id: "demo-admin",
    username: "admin",
    fullName: "Administrador principal",
    password: "admin123",
    role: "admin",
    active: true,
    lastAccess: null,
  },
  {
    id: "demo-operator",
    username: "operario",
    fullName: "Operario de prueba",
    password: "operario123",
    role: "operator",
    active: true,
    lastAccess: null,
  },
];

export const demoBrands: Brand[] = [
  { id: "brand-1", qrCode: "JP-001", name: "Adidas", local: "214", active: true, zone: "Zona 1", floor: "Piso 2", routeOrder: 1 },
  { id: "brand-2", qrCode: "JP-002", name: "Arturo Calle", local: "118", active: true, zone: "Zona 1", floor: "Piso 1", routeOrder: 2 },
  { id: "brand-3", qrCode: "JP-003", name: "Studio F", local: "305", active: true, zone: "Zona 2", floor: "Piso 3", routeOrder: 3 },
];

function browserOnly() {
  if (typeof window === "undefined") throw new Error("Disponible solo en el navegador");
}

export function getDemoUsers(): DemoUser[] {
  browserOnly();
  const stored = window.localStorage.getItem(USERS_KEY);
  if (!stored) {
    window.localStorage.setItem(USERS_KEY, JSON.stringify(seedUsers));
    return seedUsers;
  }
  try {
    return JSON.parse(stored) as DemoUser[];
  } catch {
    window.localStorage.setItem(USERS_KEY, JSON.stringify(seedUsers));
    return seedUsers;
  }
}

export function saveDemoUsers(users: DemoUser[]) {
  browserOnly();
  window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export function demoLogin(username: string, password: string): AppUser {
  const normalized = username.trim().toLowerCase();
  const users = getDemoUsers();
  const index = users.findIndex((item) => item.username.toLowerCase() === normalized);
  if (index === -1 || users[index].password !== password) {
    throw new Error("Usuario o contraseña incorrectos");
  }
  if (!users[index].active) throw new Error("Este usuario está desactivado");
  users[index] = { ...users[index], lastAccess: new Date().toISOString() };
  saveDemoUsers(users);
  const { password: _password, ...safeUser } = users[index];
  void _password;
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(safeUser));
  return safeUser;
}

export function getDemoSession(): AppUser | null {
  browserOnly();
  const stored = window.localStorage.getItem(SESSION_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as AppUser;
  } catch {
    return null;
  }
}

export function clearDemoSession() {
  browserOnly();
  window.localStorage.removeItem(SESSION_KEY);
}

export function createDemoUser(input: {
  username: string;
  fullName: string;
  password: string;
  role: AppUser["role"];
}) {
  const users = getDemoUsers();
  const normalized = input.username.trim().toLowerCase();
  if (users.some((item) => item.username.toLowerCase() === normalized)) {
    throw new Error("Ese usuario ya existe");
  }
  const user: DemoUser = {
    id: crypto.randomUUID(),
    username: normalized,
    fullName: input.fullName.trim(),
    password: input.password,
    role: input.role,
    active: true,
    lastAccess: null,
  };
  saveDemoUsers([user, ...users]);
  return user;
}

export function updateDemoUser(
  id: string,
  patch: Partial<Pick<DemoUser, "fullName" | "active" | "password" | "role">>,
) {
  const users = getDemoUsers();
  const next = users.map((item) => (item.id === id ? { ...item, ...patch } : item));
  saveDemoUsers(next);
}

export function deleteDemoUser(id: string) {
  const users = getDemoUsers();
  saveDemoUsers(users.filter((item) => item.id !== id));
}

export function findDemoBrand(qrCode: string) {
  return demoBrands.find(
    (brand) => brand.active && brand.qrCode.toLowerCase() === qrCode.trim().toLowerCase(),
  );
}

export function saveDemoVisit(visit: VisitRecord) {
  browserOnly();
  const stored = window.localStorage.getItem(VISITS_KEY);
  const visits = stored ? (JSON.parse(stored) as VisitRecord[]) : [];
  const duplicate = visits.some(
    (item) =>
      item.brandId === visit.brandId &&
      item.routeId === visit.routeId,
  );
  if (duplicate) throw new Error("Esta marca ya fue registrada en el recorrido actual");
  window.localStorage.setItem(VISITS_KEY, JSON.stringify([visit, ...visits]));
}
