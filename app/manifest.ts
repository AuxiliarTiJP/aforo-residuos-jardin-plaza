import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Recorrido de residuos Jardín Plaza",
    short_name: "Residuos JP",
    description: "Registro de visitas mediante escaneo de código QR.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#07552f",
    orientation: "portrait",
    icons: [{ src: "/logo-jardin-plaza-trim.png", sizes: "1024x1024", type: "image/png", purpose: "any" }],
  };
}
