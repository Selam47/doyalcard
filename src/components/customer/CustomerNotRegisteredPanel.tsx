"use client";

/**
 * The "this number has no account" state of the customer login screen.
 *
 * Reached only when /api/customer/exists answered `{ exists: false }` — i.e.
 * the backend positively confirmed there is no row for this number. A lookup
 * that merely FAILED must never land here; it shows a retryable error on the
 * phone step instead, because telling a registered customer they have no
 * account would push them into creating a duplicate the UNIQUE phone index
 * would then refuse.
 *
 * Nothing is auto-registered from this screen. Registration is an explicit tap,
 * and even then the row is not created until the OTP has been verified.
 */
interface CustomerNotRegisteredPanelProps {
  /** The exact E.164 string that was checked, shown so a typo is obvious. */
  phone: string;
  onRegister: () => void;
  onChangePhone: () => void;
}

export function CustomerNotRegisteredPanel({
  phone,
  onRegister,
  onChangePhone,
}: CustomerNotRegisteredPanelProps) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-amber-400/10 border border-amber-300/30 p-4 space-y-2">
        <div className="flex items-start gap-3">
          <svg
            className="w-5 h-5 shrink-0 text-amber-300 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
          <div className="space-y-1">
            <p className="text-white font-semibold text-sm">
              Bu numara ile kayıtlı bir hesap bulunamadı
            </p>
            <p className="text-amber-100/80 text-xs">{phone}</p>
          </div>
        </div>
      </div>

      <p className="text-sm text-green-300/80">
        Sadakat kartınızı hemen oluşturabilirsiniz. Numarayı yanlış girdiyseniz
        önce numaranızı düzeltmeyi deneyin.
      </p>

      <button
        id="go-to-register-btn"
        type="button"
        onClick={onRegister}
        className="w-full py-3 px-6 rounded-xl bg-green-500 hover:bg-green-400 active:scale-[0.98] text-white font-semibold text-base shadow-lg shadow-green-900/40 transition-all duration-200 flex items-center justify-center gap-2"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
          />
        </svg>
        Kayıt Ol
      </button>

      <button
        type="button"
        onClick={onChangePhone}
        className="w-full py-3 px-6 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-medium text-sm transition-all"
      >
        ← Numarayı Değiştir
      </button>
    </div>
  );
}
