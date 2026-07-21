"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RefreshCcw, Zap, ZapOff } from "lucide-react";

type Props = {
  onScan: (value: string) => void;
};

let scannerModulePromise: Promise<typeof import("html5-qrcode")> | null = null;

function loadScannerModule() {
  scannerModulePromise ??= import("html5-qrcode");
  return scannerModulePromise;
}

export function QrCamera({ onScan }: Props) {
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const onScanRef = useRef(onScan);
  const acceptingScanRef = useRef(false);
  const startingRef = useRef(false);
  const generationRef = useRef(0);
  const torchTimerRef = useRef<number | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(true);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const stop = useCallback(async () => {
    acceptingScanRef.current = false;

    if (torchTimerRef.current !== null) {
      window.clearTimeout(torchTimerRef.current);
      torchTimerRef.current = null;
    }

    const scanner = scannerRef.current;
    if (!scanner) return;

    try {
      await scanner.stop();
    } catch {
      // It is safe to continue when the browser already stopped the stream.
    }

    try {
      scanner.clear();
    } catch {
      // The scanner container may already have been removed.
    }

    if (scannerRef.current === scanner) scannerRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (startingRef.current) return;

    startingRef.current = true;
    const generation = ++generationRef.current;
    setError("");
    setStarting(true);
    setTorchOn(false);
    setTorchAvailable(false);

    await stop();

    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await loadScannerModule();

      if (generation !== generationRef.current || !document.getElementById("qr-reader")) return;

      const scanner = new Html5Qrcode("qr-reader", {
        verbose: false,
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      });

      scannerRef.current = scanner;
      acceptingScanRef.current = true;

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 8,
          disableFlip: true,
          qrbox: (width, height) => {
            const size = Math.min(width, height) * 0.76;
            return { width: size, height: size };
          },
        },
        async (decodedText) => {
          if (generation !== generationRef.current || !acceptingScanRef.current) return;

          acceptingScanRef.current = false;
          const scanHandler = onScanRef.current;
          await stop();
          scanHandler(decodedText);
        },
        () => undefined,
      );

      if (generation !== generationRef.current) {
        await stop();
        return;
      }

      torchTimerRef.current = window.setTimeout(() => {
        if (generation !== generationRef.current) return;
        const video = document.querySelector<HTMLVideoElement>("#qr-reader video");
        const track = (video?.srcObject as MediaStream | null)?.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
        setTorchAvailable(Boolean(capabilities?.torch));
      }, 450);
    } catch (cause) {
      if (generation !== generationRef.current) return;

      const message = cause instanceof Error ? cause.message : String(cause);
      setError(
        message.toLowerCase().includes("permission") || message.toLowerCase().includes("notallowed")
          ? "Debes permitir el acceso a la cámara para escanear los códigos QR."
          : "No fue posible iniciar la cámara. Revisa los permisos e inténtalo nuevamente.",
      );
      await stop();
    } finally {
      if (generation === generationRef.current) setStarting(false);
      startingRef.current = false;
    }
  }, [stop]);

  useEffect(() => {
    const timer = window.setTimeout(() => void start(), 0);

    return () => {
      window.clearTimeout(timer);
      generationRef.current += 1;
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
