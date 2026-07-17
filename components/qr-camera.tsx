"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RefreshCcw, Zap, ZapOff } from "lucide-react";

type Props = {
  onScan: (value: string) => void;
};

export function QrCamera({ onScan }: Props) {
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const scanningRef = useRef(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(true);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  const stop = useCallback(async () => {
    const scanner = scannerRef.current;
    if (scanner && scanningRef.current) {
      try {
        await scanner.stop();
      } catch {
        // The scanner may already be stopped by the browser.
      }
      scanningRef.current = false;
    }
    try {
      scanner?.clear();
    } catch {
      // Ignore a cleared container.
    }
  }, []);

  const start = useCallback(async () => {
    setError("");
    setStarting(true);
    await stop();
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("qr-reader", { verbose: false });
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: (width, height) => {
            const size = Math.min(width, height) * 0.72;
            return { width: size, height: size };
          },
          aspectRatio: 1,
        },
        async (decodedText) => {
          if (!scanningRef.current) return;
          scanningRef.current = false;
          await stop();
          onScan(decodedText);
        },
        () => undefined,
      );
      scanningRef.current = true;
      window.setTimeout(() => {
        const video = document.querySelector<HTMLVideoElement>("#qr-reader video");
        const track = (video?.srcObject as MediaStream | null)?.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
        setTorchAvailable(Boolean(capabilities?.torch));
      }, 600);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(
        message.toLowerCase().includes("permission") || message.toLowerCase().includes("notallowed")
          ? "Debes permitir el acceso a la cámara para escanear los códigos QR."
          : "No fue posible iniciar la cámara. Revisa los permisos e inténtalo nuevamente.",
      );
    } finally {
      setStarting(false);
    }
  }, [onScan, stop]);

  useEffect(() => {
    const timer = window.setTimeout(() => void start(), 0);
    return () => {
      window.clearTimeout(timer);
      void stop();
    };
  }, [start, stop]);

  async function toggleTorch() {
    const video = document.querySelector<HTMLVideoElement>("#qr-reader video");
    const track = (video?.srcObject as MediaStream | null)?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }

  return (
    <div className="camera-stage">
      <div id="qr-reader" className="qr-reader" aria-label="Cámara para escanear QR" />
      <div className="camera-shade" aria-hidden="true" />
      <div className="scan-frame" aria-hidden="true">
        <i className="corner tl" />
        <i className="corner tr" />
        <i className="corner bl" />
        <i className="corner br" />
        <span className="scan-line" />
      </div>
      {starting ? (
        <div className="camera-status">
          <Camera size={28} />
          <span>Iniciando cámara...</span>
        </div>
      ) : null}
      {error ? (
        <div className="camera-error" role="alert">
          <Camera size={30} />
          <p>{error}</p>
          <button className="secondary-button" onClick={() => void start()}>
            <RefreshCcw size={18} /> Reintentar
          </button>
        </div>
      ) : null}
      <button
        className="torch-button"
        onClick={() => void toggleTorch()}
        disabled={!torchAvailable}
        aria-label={torchOn ? "Apagar linterna" : "Encender linterna"}
      >
        {torchOn ? <ZapOff size={21} /> : <Zap size={21} />}
        <span>Linterna</span>
      </button>
    </div>
  );
}
