"use client";

import { useState, useTransition } from "react";
import { searchCustomerByPhone } from "@/actions/customer";
import { useRouter } from "next/navigation";

export function PhoneSearchSection() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<null | "not_found" | { qrUuid: string; name: string }>(null);
  const [isPending, startTransition] = useTransition();

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) return;

    startTransition(async () => {
      const customer = await searchCustomerByPhone(phone.trim());
      if (!customer) {
        setResult("not_found");
      } else {
        setResult({ qrUuid: customer.qrUuid, name: customer.name });
      }
    });
  }

  return (
    <div className="bg-white rounded-2xl shadow-md overflow-hidden">
      <div className="bg-gradient-to-r from-blue-700 to-indigo-600 px-5 py-4">
        <h2 className="text-white font-semibold flex items-center gap-2">
          <span className="text-lg">🔍</span> Telefon ile Ara
        </h2>
        <p className="text-blue-200 text-xs mt-0.5">
          Müşteri telefon numarası ile arama
        </p>
      </div>

      <div className="p-5 space-y-4">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            id="phone-search-input"
            type="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setResult(null);
            }}
            placeholder="+905551234567"
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
          />
          <button
            id="phone-search-btn"
            type="submit"
            disabled={isPending || !phone.trim()}
            className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-500 transition-colors disabled:opacity-50"
          >
            {isPending ? (
              <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            ) : (
              "Ara"
            )}
          </button>
        </form>

        {/* Results */}
        {result === "not_found" && (
          <div className="text-center py-6 bg-gray-50 rounded-xl">
            <span className="text-3xl">🔍</span>
            <p className="text-gray-500 text-sm mt-2">Müşteri bulunamadı</p>
            <a
              href="/staff/register"
              className="mt-3 inline-block text-sm text-blue-600 underline"
            >
              Yeni kayıt oluştur →
            </a>
          </div>
        )}

        {result && result !== "not_found" && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-xl flex items-center justify-between">
            <div>
              <p className="font-semibold text-green-800">{result.name}</p>
              <p className="text-xs text-green-600 mt-0.5">Müşteri bulundu</p>
            </div>
            <button
              id="go-to-card-btn"
              onClick={() => router.push(`/card/${result.qrUuid}`)}
              className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-500 transition-colors"
            >
              Karta Git →
            </button>
          </div>
        )}

        {!result && !isPending && (
          <div className="flex flex-col items-center justify-center py-8 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
            <span className="text-4xl mb-2">📞</span>
            <p className="text-gray-400 text-sm text-center">
              Müşteri telefon numarasını girin
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
