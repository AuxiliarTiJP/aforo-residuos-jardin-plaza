"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { KeyRound, LogOut, Pencil, Plus, Power, Search, ShieldCheck, Trash2, UserRound, UsersRound, X } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { useAuth } from "@/components/auth-provider";
import { createDemoUser, deleteDemoUser, getDemoUsers, updateDemoUser } from "@/lib/demo-store";
import type { AppUser, UserRole } from "@/lib/types";

type FormMode = "create" | "edit" | "password" | null;

type UserForm = {
  fullName: string;
  username: string;
  password: string;
  role: UserRole;
};

const emptyForm: UserForm = { fullName: "", username: "", password: "", role: "operator" };

function safeDemoUsers() {
  return getDemoUsers().map(({ password: _password, ...user }) => {
    void _password;
    return user;
  });
}

export function AdminUsers() {
  const { user: currentUser, logout, configured, session } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [selected, setSelected] = useState<AppUser | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const accessToken = session?.access_token ?? "";

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      if (!configured) {
        setUsers(safeDemoUsers());
      } else {
        const response = await fetch("/api/admin/users", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "No fue posible cargar los trabajadores");
        setUsers(payload.users);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar los trabajadores");
    } finally {
      setLoading(false);
    }
  }, [configured, accessToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUsers(), 0);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return users;
    return users.filter((item) => `${item.fullName} ${item.username}`.toLowerCase().includes(term));
  }, [query, users]);

  function openCreate() {
    setSelected(null);
    setForm(emptyForm);
    setError("");
    setFormMode("create");
  }

  function openEdit(item: AppUser) {
    setSelected(item);
    setForm({ fullName: item.fullName, username: item.username, password: "", role: item.role });
    setError("");
    setFormMode("edit");
  }

  function openPassword(item: AppUser) {
    setSelected(item);
    setForm({ ...emptyForm, password: "" });
    setError("");
    setFormMode("password");
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      if (!configured) {
        if (formMode === "create") {
          createDemoUser(form);
        } else if (formMode === "edit" && selected) {
          updateDemoUser(selected.id, { fullName: form.fullName, role: form.role });
        } else if (formMode === "password" && selected) {
          updateDemoUser(selected.id, { password: form.password });
        }
      } else {
        const url = formMode === "create" ? "/api/admin/users" : `/api/admin/users/${selected?.id}`;
        const method = formMode === "create" ? "POST" : "PATCH";
        const body =
          formMode === "password"
            ? { password: form.password }
            : formMode === "edit"
              ? { fullName: form.fullName, role: form.role }
              : form;
        const response = await fetch(url, {
          method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(body),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "No fue posible guardar el trabajador");
      }
      setFormMode(null);
      await loadUsers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible guardar el trabajador");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(item: AppUser) {
    if (item.id === currentUser?.id) return;
    try {
      if (!configured) updateDemoUser(item.id, { active: !item.active });
      else {
        const response = await fetch(`/api/admin/users/${item.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ active: !item.active }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "No fue posible cambiar el estado");
      }
      await loadUsers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cambiar el estado");
    }
  }

  async function removeUser(item: AppUser) {
    if (item.id === currentUser?.id) return;
    const confirmed = window.confirm(`¿Eliminar definitivamente a ${item.fullName}?`);
    if (!confirmed) return;
    try {
      if (!configured) deleteDemoUser(item.id);
      else {
        const response = await fetch(`/api/admin/users/${item.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "No fue posible eliminar el trabajador");
      }
      await loadUsers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible eliminar el trabajador");
    }
  }

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <BrandLogo compact />
        <nav>
          <div className="nav-item active"><UsersRound size={21} /> Trabajadores</div>
        </nav>
        <div className="admin-person">
          <ShieldCheck size={20} />
          <div><strong>{currentUser?.fullName}</strong><span>Administrador</span></div>
        </div>
        <button className="logout-button" onClick={() => void logout()}><LogOut size={20} /> Cerrar sesión</button>
      </aside>

      <section className="admin-content">
        <header className="admin-topbar">
          <div>
            <p>Administración</p>
            <h1>Trabajadores</h1>
            <span>Agrega, edita, activa o desactiva el personal autorizado.</span>
          </div>
          <button className="primary-button add-user-button" onClick={openCreate}><Plus size={20} /> Nuevo trabajador</button>
        </header>

        <div className="admin-toolbar">
          <div className="search-shell"><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o usuario" /></div>
          <span>{filtered.length} trabajadores</span>
        </div>

        {error && !formMode ? <p className="admin-error" role="alert">{error}</p> : null}

        <div className="users-table-wrap">
          <table className="users-table">
            <thead><tr><th>Trabajador</th><th>Usuario</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th>Acciones</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="table-empty">Cargando trabajadores...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="table-empty">No se encontraron trabajadores.</td></tr>
              ) : filtered.map((item) => (
                <tr key={item.id}>
                  <td><div className="person-cell"><span className="avatar"><UserRound size={18} /></span><strong>{item.fullName}</strong></div></td>
                  <td>{item.username}</td>
                  <td><span className={`role-tag ${item.role}`}>{item.role === "admin" ? "Administrador" : "Operario"}</span></td>
                  <td><span className={`status-tag ${item.active ? "active" : "inactive"}`}>{item.active ? "Activo" : "Inactivo"}</span></td>
                  <td>{item.lastAccess ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.lastAccess)) : "Sin ingreso"}</td>
                  <td><div className="row-actions">
                    <button title="Editar" onClick={() => openEdit(item)}><Pencil size={18} /></button>
                    <button title="Cambiar contraseña" onClick={() => openPassword(item)}><KeyRound size={18} /></button>
                    <button title={item.active ? "Desactivar" : "Activar"} disabled={item.id === currentUser?.id} onClick={() => void toggleActive(item)}><Power size={18} /></button>
                    <button className="danger" title="Eliminar" disabled={item.id === currentUser?.id} onClick={() => void removeUser(item)}><Trash2 size={18} /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {formMode ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setFormMode(null); }}>
          <section className="user-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <button className="modal-close" onClick={() => setFormMode(null)} aria-label="Cerrar"><X size={21} /></button>
            <span className="modal-icon">{formMode === "password" ? <KeyRound size={24} /> : <UserRound size={24} />}</span>
            <h2 id="modal-title">{formMode === "create" ? "Nuevo trabajador" : formMode === "edit" ? "Editar trabajador" : "Cambiar contraseña"}</h2>
            <p>{formMode === "password" ? `Define una nueva contraseña para ${selected?.fullName}.` : "Completa los datos del trabajador autorizado."}</p>
            <form onSubmit={submitForm}>
              {formMode !== "password" ? <>
                <label htmlFor="fullName">Nombre completo</label>
                <input id="fullName" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required />
                <label htmlFor="newUsername">Usuario</label>
                <input id="newUsername" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} disabled={formMode === "edit"} required />
                <label htmlFor="role">Rol</label>
                <select id="role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })}>
                  <option value="operator">Operario</option>
                  <option value="admin">Administrador</option>
                </select>
              </> : null}
              {formMode !== "edit" ? <>
                <label htmlFor="newPassword">{formMode === "password" ? "Nueva contraseña" : "Contraseña temporal"}</label>
                <input id="newPassword" type="password" minLength={8} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
              </> : null}
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setFormMode(null)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</button></div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
