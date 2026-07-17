import Image from "next/image";

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <Image
      src="/logo-jardin-plaza-trim.png"
      alt="Jardín Plaza - Sencillamente lo mejor"
      width={compact ? 164 : 260}
      height={compact ? 164 : 260}
      className={compact ? "brand-logo compact" : "brand-logo"}
      priority
    />
  );
}
