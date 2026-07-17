import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/components/auth-provider";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recorrido de residuos | Jardín Plaza",
  description: "Registro por código QR de las visitas del recorrido de residuos.",
  applicationName: "Residuos Jardín Plaza",
  icons: { icon: "/logo-jardin-plaza-trim.png", apple: "/logo-jardin-plaza-trim.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07552f",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body><ServiceWorkerRegistration /><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
