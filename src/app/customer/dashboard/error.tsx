"use client";

// src/app/customer/dashboard/error.tsx
//
// Customer-facing, so it follows the same rules as /card/[uuid]/error.tsx:
// branded dark-green styling, no internal strings, no link into any staff
// surface, and `error.digest` only.
//
// Distinct from the card boundary in one way — the customer is signed in here,
// so a second escape hatch to the login screen is useful when the failure is a
// session problem rather than a transient one.

import { useEffect } from "react";
import Link from "next/link";

export default function CustomerDashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[customer/dashboard/error]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-green-950 to-emerald-800 p-6 text-white">
      <span className="mb-6 text-7xl">🫓</span>
      <h1 className="mb-2 text-2xl font-bold">Kartınız yüklenemedi</h1>
      <p className="mb-8 max-w-xs text-center text-sm text-green-300">
        Geçici bir sorun oluştu. Damgalarınız ve ödülleriniz güvende — hiçbir
        şey kaybolmadı.
      </p>

      <div className="flex w-full max-w-xs flex-col gap-3">
        <button
          onClick={reset}
          className="rounded-xl bg-green-500 px-6 py-3 font-semibold transition-colors hover:bg-green-400"
        >
          Tekrar Dene
        </button>
        <Link
          href="/customer/login"
          className="rounded-xl border border-green-600/60 px-6 py-3 text-center font-medium text-green-200 transition-colors hover:bg-green-900/40"
        >
          Yeniden Giriş Yap
        </Link>
      </div>

      {error.digest && (
        <p className="mt-8 font-mono text-[11px] text-green-500/50">
          {error.digest}
        </p>
      )}
    </div>
  );
}
