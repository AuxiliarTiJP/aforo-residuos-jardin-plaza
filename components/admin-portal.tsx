"use client";

import { useState } from "react";
import { BarChart3, LogOut, ShieldCheck, UsersRound } from "lucide-react";
import { AdminDashboard } from "@/components/admin-dashboard";
import { AdminUsersPanel } from "@/components/admin-users";
import { BrandLogo } from "@/components/brand-logo";
import { useAuth } from "@/components/auth-provider";

type AdminView = "dashboard" | "users";

export function AdminPortal() {
  const { user, logout } = useAuth();
  const [view, setView] = useState<AdminView>("dashboard");

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <BrandLogo compact />
        <nav aria-label="Administración">
          <button
            type="button"
            className={`nav-item ${view === "dashboard" ? "active" : ""}`}
            onClick={() => setView("dashboard")}
          >
            <BarChart3 size={21} />
            <span>Dashboard</span>
          </button>
          <button
            type="button"
            className={`nav-item ${view === "users" ? "active" : ""}`}
            onClick={() => setView("users")}
          >
            <UsersRound size={21} />
            <span>Trabajadores</span>
          </button>
        </nav>
        <div className="admin-person">
          <ShieldCheck size={20} />
          <div>
            <strong>{user?.fullName}</strong>
            <span>Administrador</span>
          </div>
        </div>
        <button className="logout-button" onClick={() => void logout()}>
          <LogOut size={20} />
          <span>Cerrar sesión</span>
        </button>
      </aside>

      {view === "dashboard" ? <AdminDashboard /> : <AdminUsersPanel />}
    </main>
  );
}
