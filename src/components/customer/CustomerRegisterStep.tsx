"use client";

/**
 * Customer SELF-registration form — the screen reached from
 * CustomerNotRegisteredPanel's "Kayıt Ol" button.
 *
 * Purely presentational: it owns no state and performs no mutation. Submitting
 * it does NOT create a Customer row — the parent's handler only sends the
 * Firebase OTP. The row is created after the code is verified, by
 * /api/customer/auth, so an abandoned or failed verification leaves nothing
 * behind. That ordering is the whole point of this step existing separately
 * from a plain "register" button.
 *
 * Kept deliberately apart from the staff-side RegisterForm / registerCustomer
 * action: that one is `authorizeStaff`-gated, sets `branchId` from the
 * cashier's principal and needs no phone verification because a human is
 * standing at the till. This one has neither a staff principal nor a branch,
 * and proves the number instead.
 */

export interface CountryCodeOption {
  code: string;
  flag: string;
  label: string;
}

interface CustomerRegisterStepProps {
  countryCodes: readonly CountryCodeOption[];
  countryCode: string;
  onCountryCodeChange: (value: string) => void;
  phoneNumber: string;
  onPhoneNumberChange: (value: string) => void;
  name: string;
  onNameChange: (value: string) => void;
  kvkkChecked: boolean;
  onKvkkChange: (value: boolean) => void;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
}

export function CustomerRegisterStep({
  countryCodes,
  countryCode,
  onCountryCodeChange,
  phoneNumber,
  onPhoneNumberChange,
  name,
  onNameChange,
  kvkkChecked,
  onKvkkChange,
  loading,
  onSubmit,
  onBack,
}: CustomerRegisterStepProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-1">
        <h3 className="text-white font-semibold text-base">Hesap Oluştur</h3>
        <p className="text-sm text-green-300/80">
          Bilgilerinizi girin — numaranızı doğrulamak için bir SMS kodu
          göndereceğiz. Hesabınız yalnızca kod doğrulandıktan sonra oluşturulur.
        </p>
      </div>

      {/* Name */}
      <div className="space-y-2">
        <label
          htmlFor="register-name-input"
          className="block text-sm font-medium text-green-100"
        >
          Ad Soyad <span className="text-red-300">*</span>
        </label>
        <input
          id="register-name-input"
          name="name"
          type="text"
          autoComplete="name"
          required
          minLength={2}
          maxLength={100}
          autoFocus
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Ahmet Yılmaz"
          className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/30 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent transition-all"
        />
      </div>

      {/* Phone — pre-filled from the login step, still editable. */}
      <div className="space-y-2">
        <label
          htmlFor="register-phone-input"
          className="block text-sm font-medium text-green-100"
        >
          Telefon Numarası <span className="text-red-300">*</span>
        </label>
        <div className="flex gap-2">
          <select
            value={countryCode}
            onChange={(e) => onCountryCodeChange(e.target.value)}
            className="px-3 py-3 rounded-xl bg-white/10 border border-white/30 text-white focus:outline-none focus:ring-2 focus:ring-green-400 transition-all text-sm min-w-[90px]"
            aria-label="Ülke kodu"
          >
            {countryCodes.map((c) => (
              <option
                key={c.code}
                value={c.code}
                className="bg-green-900 text-white"
              >
                {c.flag} {c.code}
              </option>
            ))}
          </select>
          <input
            id="register-phone-input"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            required
            value={phoneNumber}
            onChange={(e) => onPhoneNumberChange(e.target.value)}
            placeholder="5XX XXX XX XX"
            className="flex-1 px-4 py-3 rounded-xl bg-white/10 border border-white/30 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent transition-all"
          />
        </div>
      </div>

      {/*
        KVKK consent. Same requirement the staff-side registerCustomer applies —
        the shared `KvkkConsentSchema` (z.boolean().refine(val === true)) is
        re-checked server-side by /api/customer/auth, which will not create the
        row without it. The disabled button below is convenience, not the
        control.
      */}
      <div className="rounded-xl bg-white/10 border border-white/20 p-4 space-y-3">
        <p className="text-sm font-semibold text-white">KVKK Aydınlatma Metni</p>
        <div className="text-xs text-green-100/90 leading-relaxed max-h-40 overflow-y-auto space-y-2">
          <p>
            Ekrem Coşkun Döner olarak, sadakat programını yürütebilmek amacıyla{" "}
            <strong>adınızı ve telefon numaranızı</strong> ve programa ilişkin{" "}
            <strong>sipariş ve ödül kayıtlarınızı</strong> işliyoruz.
          </p>
          <p>
            Verileriniz yalnızca damga biriktirme, ödül tanımlama ve ödüllerin
            kasada kullandırılması için kullanılır; pazarlama amacıyla üçüncü
            kişilerle paylaşılmaz.
          </p>
          <p>
            6698 sayılı KVKK kapsamında verilerinize erişme, düzeltilmesini veya
            silinmesini isteme hakkına sahipsiniz. Silme talebiniz halinde
            kaydınız ve tüm sipariş/ödül geçmişiniz kalıcı olarak kaldırılır.
          </p>
        </div>

        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            id="register-kvkk-consent"
            type="checkbox"
            checked={kvkkChecked}
            onChange={(e) => onKvkkChange(e.target.checked)}
            className="mt-0.5 w-5 h-5 shrink-0 rounded border-white/40 accent-green-500"
          />
          <span className="text-sm text-green-100">
            KVKK aydınlatma metnini okudum ve kişisel verilerimin yukarıda
            belirtilen amaçlarla işlenmesini onaylıyorum.{" "}
            <span className="text-red-300">*</span>
          </span>
        </label>
      </div>

      <button
        id="register-send-otp-btn"
        type="submit"
        disabled={loading || !kvkkChecked}
        className="w-full py-3 px-6 rounded-xl bg-green-500 hover:bg-green-400 active:scale-[0.98] text-white font-semibold text-base shadow-lg shadow-green-900/40 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            Gönderiliyor...
          </>
        ) : (
          <>
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
                d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
            Doğrulama Kodu Gönder
          </>
        )}
      </button>

      <button
        type="button"
        onClick={onBack}
        disabled={loading}
        className="w-full text-center text-xs text-green-300/70 hover:text-white transition-colors disabled:opacity-50"
      >
        ← Girişe dön
      </button>
    </form>
  );
}
