"use client";

import { useEffect } from "react";

export default function CardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[card/error]", error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-green-950 to-emerald-800 p-6 text-white">
      <span className="mb-6 text-7xl">🫓</span>
      <h1 className="mb-2 text-2xl font-bold">Kartınız şu anda yüklenemedi</h1>
      <p className="mb-8 max-w-xs text-center text-sm text-green-300">
        Geçici bir bağlantı sorunu olabilir. Tekrar deneyin — QR kodunuz
        geçerliliğini koruyor.
      </p>

      <button
        onClick={reset}
        className="rounded-xl bg-green-500 px-6 py-3 font-semibold transition-colors hover:bg-green-400"
      >
        Tekrar Dene
      </button>

      <p className="mt-8 max-w-xs text-center text-xs text-green-400/70">
        Sorun devam ederse kasadaki personele bu ekranı gösterin.
      </p>

      {error.digest && (
        <p className="mt-3 font-mono text-[11px] text-green-500/50">
          {error.digest}
        </p>
      )}
    </div>
  );
}
