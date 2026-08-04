"use client";

// src/app/error.tsx
//
// Catch-all error boundary for every route segment that does not declare its
// own. It also catches errors thrown by the LAYOUTS of nested segments
// (/staff/layout.tsx, /admin/layout.tsx) — a segment's own error.tsx cannot
// catch its own layout, only the parent boundary can.
//
// Errors in the ROOT layout are not caught here either; those go to
// global-error.tsx.
//
// Never render `error.message`. In a production build React replaces it with a
// generic string anyway, but a message that survives (thrown by our own code)
// can carry an internal identifier, a query fragment or a phone number. Only
// `error.digest` is shown: it is an opaque hash the operator can quote to match
// the entry in the Vercel logs.

import { useEffect } from "react";
import Link from "next/link";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 shadow-lg text-center">
        <span className="text-5xl">⚠️</span>
        <h1 className="mt-4 text-xl font-bold text-gray-800">
          Bir şeyler ters gitti
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          İşlem tamamlanamadı. Tekrar denediğinizde büyük ihtimalle düzelecek.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={reset}
            className="w-full rounded-xl bg-green-600 px-5 py-3 font-semibold text-white transition-colors hover:bg-green-500"
          >
            Tekrar Dene
          </button>
          <Link
            href="/"
            className="w-full rounded-xl border border-gray-300 px-5 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Ana Sayfa
          </Link>
        </div>

        {error.digest && (
          <p className="mt-5 font-mono text-[11px] text-gray-400">
            Hata kodu: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
