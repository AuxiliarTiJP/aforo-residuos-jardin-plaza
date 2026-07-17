"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { clearDemoSession, demoLogin, getDemoSession } from "@/lib/demo-store";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AppUser } from "@/lib/types";

type AuthContextValue = {
  user: AppUser | null;
  session: Session | null;
  loading: boolean;
  configured: boolean;
  offlineAccess: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

type CachedProfile = {
  profile: AppUser;
  authorizedAt: string;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const supabase = createSupabaseBrowserClient();
const PROFILE_CACHE_KEY = "jp-aforo-authorized-profile-v1";
const OFFLINE_ACCESS_WINDOW_MS = 72 * 60 * 60 * 1000;

function mapProfile(row: Record<string, unknown>): AppUser {
  return {
    id: String(row.id),
    username: String(row.username),
    fullName: String(row.full_name),
    role: row.role === "admin" ? "admin" : "operator",
    active: Boolean(row.is_active),
    lastAccess: row.last_access ? String(row.last_access) : null,
  };
}

function readCachedProfile(): CachedProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedProfile;
    const age = Date.now() - new Date(cached.authorizedAt).getTime();
    if (!cached.profile.active || cached.profile.role !== "operator" || age > OFFLINE_ACCESS_WINDOW_MS) {
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

function writeCachedProfile(profile: AppUser) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    PROFILE_CACHE_KEY,
    JSON.stringify({ profile, authorizedAt: new Date().toISOString() } satisfies CachedProfile),
  );
}

function clearCachedProfile() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PROFILE_CACHE_KEY);
}

async function loadProfile(userId: string) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, full_name, role, is_active, last_access")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return mapProfile(data);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [offlineAccess, setOfflineAccess] = useState(false);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        if (!isSupabaseConfigured || !supabase) {
          if (active) setUser(getDemoSession());
          return;
        }

        const cached = readCachedProfile();
        const online = navigator.onLine;

        try {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;

          if (data.session) {
            if (!online && cached?.profile.id === data.session.user.id) {
              if (active) {
                setSession(data.session);
                setUser(cached.profile);
                setOfflineAccess(true);
              }
              return;
            }

            const profile = await loadProfile(data.session.user.id);
            if (!profile?.active) {
              await supabase.auth.signOut({ scope: "local" });
              clearCachedProfile();
              return;
            }

            writeCachedProfile(profile);
            if (active) {
              setSession(data.session);
              setUser(profile);
              setOfflineAccess(false);
            }
            return;
          }
        } catch {
          if (!online && cached) {
            if (active) {
              setUser(cached.profile);
              setOfflineAccess(true);
            }
            return;
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void initialize();

    async function revalidateWhenOnline() {
      if (!isSupabaseConfigured || !supabase) return;
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data.session) {
          setUser(null);
          setSession(null);
          setOfflineAccess(false);
          clearCachedProfile();
          return;
        }

        const profile = await loadProfile(data.session.user.id);
        if (!profile?.active) {
          await supabase.auth.signOut({ scope: "local" });
          clearCachedProfile();
          setUser(null);
          setSession(null);
          setOfflineAccess(false);
          return;
        }

        writeCachedProfile(profile);
        setSession(data.session);
        setUser(profile);
        setOfflineAccess(false);
      } catch {
        // La aplicación conserva el acceso local y volverá a intentar en el próximo evento online.
      }
    }

    window.addEventListener("online", revalidateWhenOnline);
    return () => {
      active = false;
      window.removeEventListener("online", revalidateWhenOnline);
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    if (!isSupabaseConfigured || !supabase) {
      setUser(demoLogin(username, password));
      return;
    }

    if (!navigator.onLine) {
      throw new Error("Necesitas conexión para iniciar sesión. Después podrás realizar el recorrido sin señal.");
    }

    const email = `${username.trim().toLowerCase()}@aforo.jardinplaza.local`;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error("Usuario o contraseña incorrectos");

    const profile = await loadProfile(data.user.id);
    if (!profile?.active) {
      await supabase.auth.signOut({ scope: "local" });
      throw new Error("Este usuario está desactivado");
    }

    await supabase.from("profiles").update({ last_access: new Date().toISOString() }).eq("id", profile.id);
    writeCachedProfile(profile);
    setSession(data.session);
    setUser(profile);
    setOfflineAccess(false);
  }, []);

  const logout = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) clearDemoSession();
    else {
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // El cierre local debe continuar aunque no haya conexión.
      }
    }
    clearCachedProfile();
    setSession(null);
    setUser(null);
    setOfflineAccess(false);
  }, []);

  const value = useMemo(
    () => ({ user, session, loading, configured: isSupabaseConfigured, offlineAccess, login, logout }),
    [user, session, loading, offlineAccess, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return context;
}
