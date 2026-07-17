"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;

    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.error("No se pudo registrar el service worker", error);
    });
  }, []);

  return null;
}
