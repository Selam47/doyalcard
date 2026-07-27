"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Html5Qrcode } from "html5-qrcode";

export function QrScannerSection() {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerId = "qr-scanner-container";

  async function startScanner() {
    setError(null);
    setScanning(true);
    try {
      const scanner = new Html5Qrcode(containerId);
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          // Extract UUID from the URL
          const match = decodedText.match(/\/card\/([a-f0-9-]{36})/i);
          if (match?.[1]) {
            stopScanner();
            router.push(`/card/${match[1]}`);
          }
        },
        () => {} // ignore per-frame errors
      );
    } catch (err) {
      setScanning(false);
      setError("Kamera erişilemedi. Lütfen tarayıcı izinlerini kontrol edin.");
      console.error(err);
    }
  }

  async function stopScanner() {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {
        /* ignore */
      }
      scannerRef.current = null;
    }
    setScanning(false);
  }

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, []);

  return (
    <div className="bg-white rounded-2xl shadow-md overflow-hidden">
      <div className="bg-gradient-to-r from-green-700 to-emerald-600 px-5 py-4">
        <h2 className="text-white font-semibold flex items-center gap-2">
          <span className="text-lg">📷</span> QR Kod Tarayıcı
        </h2>
        <p className="text-green-200 text-xs mt-0.5">
          Müşterinin QR kodunu kamerayla tarayın
        </p>
      </div>

      <div className="p-5 space-y-4">
        {/* Scanner viewport */}
        <div
          id={containerId}
          className={`rounded-xl overflow-hidden bg-gray-900 ${
            scanning ? "block" : "hidden"
          }`}
          style={{ minHeight: "280px" }}
        />

        {!scanning && (
          <div className="flex flex-col items-center justify-center py-8 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
            <span className="text-5xl mb-3">📱</span>
            <p className="text-gray-500 text-sm text-center">
              Müşterinin telefonundaki QR kodu kamerayla okutun
            </p>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            ⚠️ {error}
          </p>
        )}

        <button
          id={scanning ? "stop-scanner-btn" : "start-scanner-btn"}
          onClick={scanning ? stopScanner : startScanner}
          className={`w-full py-3 rounded-xl font-semibold text-sm transition-all ${
            scanning
              ? "bg-red-100 text-red-700 hover:bg-red-200"
              : "bg-green-600 text-white hover:bg-green-500 shadow-md"
          }`}
        >
          {scanning ? "⏹ Taramayı Durdur" : "▶ Taramayı Başlat"}
        </button>
      </div>
    </div>
  );
}
