"use client";

import { useState, type FormEvent } from "react";
import { Eye, EyeOff, LockKeyhole, UserRound } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { useAuth } from "@/components/auth-provider";

export function LoginScreen() {
  const { login, configured } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(username, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible iniciar sesión");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-brand-area">
        <BrandLogo />
        <div className="login-copy">
          <h1>Recorrido de residuos</h1>
          <p>Escanea el código QR de cada marca y registra el resultado de la visita.</p>
        </div>
      </div>

      <section className="login-card" aria-labelledby="login-title">
        <h2 id="login-title">Iniciar sesión</h2>
        <p>Ingresa con el usuario asignado por el administrador.</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="username">Usuario</label>
          <div className="input-shell">
            <UserRound size={19} aria-hidden="true" />
            <input
              id="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Ingresa tu usuario"
              required
            />
          </div>
          <label htmlFor="password">Contraseña</label>
          <div className="input-shell">
            <LockKeyhole size={19} aria-hidden="true" />
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Ingresa tu contraseña"
              required
            />
            <button
              type="button"
              className="icon-button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            >
              {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="primary-button login-button" disabled={submitting}>
            {submitting ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
        {!configured ? (
          <div className="demo-note">
            <strong>Modo demostración</strong>
            <span>admin / admin123 · operario / operario123</span>
          </div>
        ) : null}
      </section>
    </main>
  );
}
