"use client";

import { Suspense } from "react";
import { LoaderCircle } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { LoginScreen } from "@/components/login-screen";
import { OperatorApp } from "@/components/operator-app";
import { AdminUsers } from "@/components/admin-users";

function AppContent() {
  const { user, loading } = useAuth();
  if (loading) {
    return <main className="loading-page"><LoaderCircle className="spinner" size={36} /><span>Cargando aplicación...</span></main>;
  }
  if (!user) return <LoginScreen />;
  if (user.role === "admin") return <AdminUsers />;
  return <OperatorApp />;
}

export default function Home() {
  return <Suspense fallback={<main className="loading-page">Cargando...</main>}><AppContent /></Suspense>;
}
