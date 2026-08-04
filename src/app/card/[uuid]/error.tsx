"use client";

// src/app/card/[uuid]/error.tsx
//
// The customer is standing at the counter with their phone open on a QR scan.
// This is the most public surface in the product, so it gets its own boundary
// rather than falling through to the generic grey one: same dark-green card
// styling as the page and not-found, no mention of anything internal.
//
// Two rules inherited from the route itself (see page.tsx):
//   • NO link to /staff or /login. This page is a read-only dead end for every
//     viewer, and an error state is not an excuse to open a door.
//   • NO `error.message`. A customer must never see an internal string, and the
//     digest is enough for staff to quote when reporting the problem.
//
// "Tekrar Dene" is the right primary action here: the URL is correct (it came
// from their own QR code), so a re-render usually succeeds.

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
