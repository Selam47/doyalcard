"use client";

// src/app/staff/error.tsx
//
// Till-side boundary. A cashier hitting this has a customer waiting, so the
// copy says what to do next rather than what went wrong, and "Tekrar Dene" is
// the big obvious control.
//
// Scope note: this catches errors from /staff/page.tsx, /staff/register and
// /staff/customer/[uuid]. It does NOT catch errors thrown by
// /staff/layout.tsx — Next.js renders a segment's error boundary INSIDE that
// segment's layout, so a layout failure is caught by the parent boundary
// (src/app/error.tsx) instead. In practice the staff layout cannot throw:
// `getStaffPrincipal()` swallows its own lookup errors and returns null, which
// redirects to /login rather than raising.

import { useEffect } from "react";
import Link from "next/link";

export default function StaffError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[staff/error]", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-10">
      <div className="rounded-2xl border border-red-200 bg-white p-6 text-center shadow-lg">
        <span className="text-5xl">⚠️</span>
        <h1 className="mt-4 text-xl font-bold text-gray-800">
          İşlem tamamlanamadı
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Bağlantı geçici olarak kesilmiş olabilir. Damga eklediyseniz{" "}
          <strong>tekrar eklemeden önce</strong> müşterinin kartını yeniden
          tarayıp kontrol edin.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={reset}
            className="w-full rounded-xl bg-green-600 px-5 py-3 font-semibold text-white transition-colors hover:bg-green-500"
          >
            Tekrar Dene
          </button>
          <Link
            href="/staff"
            className="w-full rounded-xl border border-gray-300 px-5 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Personel Paneline Dön
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
