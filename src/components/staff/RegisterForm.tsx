"use client";

import { useState, useTransition } from "react";
import { registerCustomer } from "@/actions/customer";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export function RegisterForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [consent, setConsent] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    formData.set("kvkkConsent", consent ? "true" : "false");

    startTransition(async () => {
      const result = await registerCustomer(formData);
      if (!result.success) {
        toast.error(result.error);
      } else {
        toast.success(`✅ ${result.customer.name} başarıyla kaydedildi!`);
        router.push(`/card/${result.customer.qrUuid}`);
      }
    });
  }

  return (
    <div className="bg-white rounded-2xl shadow-md p-6">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Name */}
        <div className="space-y-1.5">
          <label htmlFor="reg-name" className="block text-sm font-medium text-gray-700">
            Ad Soyad <span className="text-red-500">*</span>
          </label>
          <input
            id="reg-name"
            name="name"
            type="text"
            required
            placeholder="Ahmet Yılmaz"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
          />
        </div>

        {/* Phone */}
        <div className="space-y-1.5">
          <label htmlFor="reg-phone" className="block text-sm font-medium text-gray-700">
            Telefon Numarası <span className="text-red-500">*</span>
          </label>
          <input
            id="reg-phone"
            name="phone"
            type="tel"
            required
            placeholder="+905551234567"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
          />
          <p className="text-xs text-gray-400">Örn: +90 555 123 4567</p>
        </div>

        {/* KVKK Consent */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-blue-800">KVKK Aydınlatma Metni</p>
          <p className="text-xs text-blue-700 leading-relaxed">
            6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında, ad-soyad ve telefon
            numaranız sadakat programı amacıyla Ekrem Coşkun Döner tarafından işlenecektir.
            Verileriniz üçüncü taraflarla paylaşılmayacaktır.
          </p>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              id="kvkk-consent-checkbox"
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-green-600"
            />
            <span className="text-xs text-blue-800 font-medium">
              Kişisel verilerimin işlenmesini ve sadakat programına katılmayı onaylıyorum.{" "}
              <span className="text-red-500">*</span>
            </span>
          </label>
        </div>

        <button
          id="register-submit-btn"
          type="submit"
          disabled={isPending || !consent}
          className="w-full py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isPending ? (
            <>
              <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              Kaydediliyor...
            </>
          ) : (
            "➕ Müşteriyi Kaydet"
          )}
        </button>
      </form>
    </div>
  );
}
