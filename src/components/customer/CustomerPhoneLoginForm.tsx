"use client";

declare global {
  interface Window {
    recaptchaVerifier?: import("firebase/auth").RecaptchaVerifier;
  }

  /**
   * WebOTP API — not yet in TypeScript's DOM lib.
   * `navigator.credentials.get({ otp: { transport: ["sms"] } })` resolves with
   * an OTPCredential on Chrome/Android when an SMS bound to this origin arrives.
   */
  interface OTPCredential extends Credential {
    readonly code: string;
  }

  interface CredentialRequestOptions {
    otp?: { transport: string[] };
  }
}

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { toE164, E164_REGEX } from "@/lib/phone";
import { toast } from "sonner";

const COUNTRY_CODES = [
  { code: "+90", flag: "🇹🇷", label: "TR" },
  { code: "+1",  flag: "🇺🇸", label: "US" },
  { code: "+44", flag: "🇬🇧", label: "GB" },
  { code: "+49", flag: "🇩🇪", label: "DE" },
  { code: "+33", flag: "🇫🇷", label: "FR" },
  { code: "+31", flag: "🇳🇱", label: "NL" },
  { code: "+971", flag: "🇦🇪", label: "AE" },
];

const OTP_LENGTH = 6;

type Step = "phone" | "otp";

interface CustomerPhoneLoginFormProps {
  /** True when a valid customer session cookie already exists server-side. */
  alreadyLoggedIn?: boolean;
}

export function CustomerPhoneLoginForm({ alreadyLoggedIn = false }: CustomerPhoneLoginFormProps) {
  const router = useRouter();

  useEffect(() => {
    if (!alreadyLoggedIn) return;
    const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (entry?.type === "back_forward") return;
    router.replace("/customer/dashboard");
  }, [alreadyLoggedIn, router]);

  const [step, setStep] = useState<Step>("phone");
  const [countryCode, setCountryCode] = useState("+90");
  const [phoneNumber, setPhoneNumber] = useState("");
  /** The OTP is a single string — one real <input> drives six styled cells. */
  const [otp, setOtp] = useState("");
  const [otpFocused, setOtpFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);
  const recaptchaContainerRef = useRef<HTMLDivElement | null>(null);
  const otpInputRef = useRef<HTMLInputElement | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * Guards the auto-submit effect. Auto-fill (iOS keyboard suggestion or WebOTP)
   * and a fast typist can both push the length to 6 while a confirm() is already
   * in flight; without this ref Firebase would receive two confirms for one code.
   */
  const verifyingRef = useRef(false);
  /** The last code we already sent to confirm() — never re-submit it unchanged. */
  const attemptedCodeRef = useRef<string | null>(null);

  const destroyRecaptcha = useCallback(() => {
    if (recaptchaVerifierRef.current) {
      try {
        recaptchaVerifierRef.current.clear();
      } catch {
        // Widget may already be gone — safe to ignore
      }
      recaptchaVerifierRef.current = null;
    }
    delete window.recaptchaVerifier;
    if (recaptchaContainerRef.current) {
      recaptchaContainerRef.current.innerHTML = "";
    }
  }, []);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      destroyRecaptcha();
    };
  }, [destroyRecaptcha]);

  const createRecaptcha = useCallback(async (): Promise<RecaptchaVerifier> => {
    destroyRecaptcha();

    const verifier = new RecaptchaVerifier(
      auth,
      "recaptcha-container",
      {
        size: "invisible",
        callback: () => {
          // reCAPTCHA solved — allow SMS send
        },
        "expired-callback": () => {
          if (window.recaptchaVerifier) {
            try { window.recaptchaVerifier.clear(); } catch { /* already gone */ }
          }
        },
        "error-callback": () => {
          destroyRecaptcha();
        },
      }
    );

    window.recaptchaVerifier = verifier;

    await verifier.render();

    recaptchaVerifierRef.current = verifier;
    return verifier;
  }, [destroyRecaptcha]);

  const startCountdown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setResendCountdown(30);
    countdownRef.current = setInterval(() => {
      setResendCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          countdownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const handleGoBackToPhone = useCallback(() => {
    destroyRecaptcha();
    confirmationRef.current = null;
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
    verifyingRef.current = false;
    attemptedCodeRef.current = null;
    setResendCountdown(0);
    setStep("phone");
    setOtp("");
  }, [destroyRecaptcha]);

  /**
   * Single entry point for verification. Called by the submit button, by the
   * auto-submit effect (typed 6th digit / iOS auto-fill) and indirectly by the
   * WebOTP listener, which only writes into `otp` state.
   */
  const verifyCode = useCallback(
    async (code: string) => {
      if (verifyingRef.current) return;
      if (code.length !== OTP_LENGTH) {
        toast.error("Lütfen 6 haneli kodu girin.");
        return;
      }
      if (!confirmationRef.current) {
        toast.error("Oturum süresi doldu. Lütfen yeni kod isteyin.");
        handleGoBackToPhone();
        return;
      }

      verifyingRef.current = true;
      attemptedCodeRef.current = code;
      setLoading(true);
      // Dismiss the mobile keyboard while the request is in flight.
      otpInputRef.current?.blur();

      try {
        const credential = await confirmationRef.current.confirm(code);
        const idToken = await credential.user.getIdToken();

        const res = await fetch("/api/customer/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        });

        if (!res.ok) throw new Error("Backend auth failed");

        const data = await res.json();
        toast.success(
          data.isNew
            ? "Hoş geldiniz! Hesabınız oluşturuldu."
            : "Tekrar hoş geldiniz!"
        );
        router.push("/customer/dashboard");
        router.refresh();
      } catch (err: unknown) {
        console.error("[OTP verify error]", err);
        const errCode = (err as { code?: string }).code;
        if (errCode === "auth/invalid-verification-code") {
          toast.error("Hatalı doğrulama kodu. Lütfen tekrar deneyin.");
          setOtp("");
          attemptedCodeRef.current = null;
          setTimeout(() => otpInputRef.current?.focus(), 50);
        } else if (errCode === "auth/code-expired" || errCode === "auth/session-expired") {
          toast.error("Kodun süresi doldu. Lütfen yeni kod isteyin.");
          handleGoBackToPhone();
        } else {
          toast.error("Doğrulama başarısız. Lütfen tekrar deneyin.");
        }
      } finally {
        verifyingRef.current = false;
        setLoading(false);
      }
    },
    [handleGoBackToPhone, router]
  );

  /**
   * WebOTP API fallback (Chrome/Android). iOS Safari has no WebOTP — it relies
   * on autocomplete="one-time-code" instead, which is why both are wired up.
   *
   * NOTE: WebOTP only fires when the SMS body ends with the origin-binding line
   *   `@your-domain.com #123456`
   * If the Firebase SMS template does not carry that suffix the promise simply
   * never resolves, and the flow degrades silently to native auto-fill / typing.
   */
  useEffect(() => {
    if (step !== "otp") return;
    if (typeof window === "undefined") return;
    if (!("OTPCredential" in window) || !navigator.credentials?.get) return;

    const controller = new AbortController();

    navigator.credentials
      .get({ otp: { transport: ["sms"] }, signal: controller.signal })
      .then((credential) => {
        const received = (credential as OTPCredential | null)?.code;
        const digits = received?.replace(/\D/g, "").slice(0, OTP_LENGTH) ?? "";
        if (digits.length === OTP_LENGTH) setOtp(digits);
      })
      .catch(() => {
        // AbortError on unmount/step change, or the user dismissed the prompt.
      });

    // Aborting is required — a pending WebOTP request otherwise outlives the step.
    return () => controller.abort();
  }, [step]);

  /** Auto-confirm as soon as six digits land, whatever filled them. */
  useEffect(() => {
    if (step !== "otp") return;
    if (otp.length !== OTP_LENGTH) return;
    if (verifyingRef.current) return;
    if (attemptedCodeRef.current === otp) return;
    void verifyCode(otp);
  }, [otp, step, verifyCode]);

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();

    const fullPhone = toE164(countryCode, phoneNumber);

    if (!E164_REGEX.test(fullPhone)) {
      toast.error("Geçerli bir telefon numarası girin.");
      return;
    }

    setLoading(true);
    try {
      const verifier = await createRecaptcha();

      const result = await signInWithPhoneNumber(auth, fullPhone, verifier);
      confirmationRef.current = result;

      attemptedCodeRef.current = null;
      verifyingRef.current = false;
      setOtp("");
      setStep("otp");
      startCountdown();
      toast.success("Doğrulama kodu gönderildi!");
      setTimeout(() => otpInputRef.current?.focus(), 100);
    } catch (err: unknown) {
      console.error("[reCAPTCHA / OTP send error]", err);
      destroyRecaptcha();

      const code = (err as { code?: string }).code;
      if (code === "auth/invalid-phone-number") {
        toast.error("Geçersiz telefon numarası formatı.");
      } else if (code === "auth/too-many-requests") {
        toast.error("Çok fazla deneme. Lütfen birkaç dakika sonra tekrar deneyin.");
      } else if (code === "auth/captcha-check-failed") {
        toast.error("reCAPTCHA doğrulaması başarısız. Lütfen tekrar deneyin.");
      } else if (code === "auth/quota-exceeded") {
        toast.error("SMS kotası aşıldı. Lütfen daha sonra tekrar deneyin.");
      } else if (code === "auth/unauthorized-domain") {
        toast.error("Bu alan adı Firebase'de yetkili değil. Lütfen yönetici ile iletişime geçin.");
      } else if (code === "auth/network-request-failed") {
        toast.error("Ağ hatası. İnternet bağlantınızı kontrol edin.");
      } else {
        toast.error("SMS gönderilemedi. Lütfen tekrar deneyin.");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleVerifySubmit(e: React.FormEvent) {
    e.preventDefault();
    void verifyCode(otp);
  }

  /**
   * One handler for typing, pasting and auto-fill: iOS delivers the whole
   * 6-digit code in a single change event, so anything that is not a digit is
   * stripped and the result is clamped to six characters.
   */
  function handleOtpChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH);
    setOtp(digits);
    // Editing after a failed attempt re-arms the auto-submit effect.
    if (digits !== attemptedCodeRef.current) attemptedCodeRef.current = null;
  }

  function handleResend() {
    if (resendCountdown > 0) return;
    handleGoBackToPhone();
  }

  const activeCell = Math.min(otp.length, OTP_LENGTH - 1);

  return (
    <div className="space-y-6">
      {/*
        IMPORTANT: This div is ALWAYS in the DOM — never conditionally rendered.
        It is referenced via recaptchaContainerRef (not a string id) so React
        never unmounts it between step 1 and step 2, preventing duplicate-widget
        errors caused by Firebase re-scanning the DOM.
        It is moved off-screen (not width:0/height:0) — a zero-dimension
        container can prevent Google's reCAPTCHA fingerprinting/scoring iframe
        from laying itself out correctly and, if risk scoring ever escalates
        an "invisible" challenge to a visible one, a 0x0 box means the user
        has no way to see or solve it.
      */}
      <div
        id="recaptcha-container"
        ref={recaptchaContainerRef}
        aria-hidden="true"
        style={{ position: "fixed", top: "-9999px", left: "-9999px" }}
      />

      {step === "phone" ? (
        <form onSubmit={handleSendOtp} className="space-y-5">
          <div className="space-y-2">
            <label
              htmlFor="phone-input"
              className="block text-sm font-medium text-green-100"
            >
              Telefon Numarası
            </label>
            <div className="flex gap-2">
              {/* Country code selector */}
              <select
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                className="px-3 py-3 rounded-xl bg-white/10 border border-white/30 text-white focus:outline-none focus:ring-2 focus:ring-green-400 transition-all text-sm min-w-[90px]"
                aria-label="Ülke kodu"
              >
                {COUNTRY_CODES.map((c) => (
                  <option
                    key={c.code}
                    value={c.code}
                    className="bg-green-900 text-white"
                  >
                    {c.flag} {c.code}
                  </option>
                ))}
              </select>
              {/* Phone number */}
              <input
                id="phone-input"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                required
                autoFocus
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="5XX XXX XX XX"
                className="flex-1 px-4 py-3 rounded-xl bg-white/10 border border-white/30 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent transition-all"
              />
            </div>
            <p className="text-xs text-green-300/70 pt-1">
              Numaranıza ücretsiz doğrulama kodu SMS ile gönderilecek.
            </p>
          </div>

          <button
            id="send-otp-btn"
            type="submit"
            disabled={loading}
            className="w-full py-3 px-6 rounded-xl bg-green-500 hover:bg-green-400 active:scale-[0.98] text-white font-semibold text-base shadow-lg shadow-green-900/40 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                Gönderiliyor...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                Kod Gönder
              </>
            )}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifySubmit} className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label htmlFor="otp-input" className="block text-sm font-medium text-green-100">
                Doğrulama Kodu
              </label>
              <button
                type="button"
                onClick={handleGoBackToPhone}
                className="text-xs text-green-300 hover:text-white transition-colors"
              >
                ← Numarayı Değiştir
              </button>
            </div>

            <p className="text-sm text-green-300/80">
              <span className="font-semibold text-white">
                {`${countryCode} ${phoneNumber}`}
              </span>{" "}
              numarasına gönderilen 6 haneli kodu girin.
            </p>

            {/*
              ONE real input drives SIX painted cells.
              iOS Safari and Chrome only offer the "From Messages" / SMS
              suggestion for a single field carrying autocomplete="one-time-code"
              and they paste all six digits in one change event — six separate
              maxLength=1 cells break that entirely. The input is transparent and
              stretched over the cells so it stays focusable, keyboard-navigable
              and reachable by the autofill UI, while the cells below are purely
              presentational (pointer-events-none).
            */}
            <div className="relative">
              <input
                id="otp-input"
                ref={otpInputRef}
                name="otp"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={OTP_LENGTH}
                value={otp}
                onChange={handleOtpChange}
                onFocus={() => setOtpFocused(true)}
                onBlur={() => setOtpFocused(false)}
                disabled={loading}
                aria-label="6 haneli doğrulama kodu"
                className="absolute inset-0 z-10 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
              />

              <div className="flex gap-2 justify-center pointer-events-none" aria-hidden="true">
                {Array.from({ length: OTP_LENGTH }).map((_, i) => {
                  const isActive = otpFocused && i === activeCell && !loading;
                  return (
                    <div
                      key={i}
                      className={`w-11 h-14 flex items-center justify-center text-2xl font-bold rounded-xl bg-white/10 border text-white transition-all ${
                        isActive
                          ? "border-transparent ring-2 ring-green-400"
                          : "border-white/30"
                      }`}
                    >
                      {otp[i] ?? ""}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <button
            id="verify-otp-btn"
            type="submit"
            disabled={loading || otp.length !== OTP_LENGTH}
            className="w-full py-3 px-6 rounded-xl bg-green-500 hover:bg-green-400 active:scale-[0.98] text-white font-semibold text-base shadow-lg shadow-green-900/40 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                Doğrulanıyor...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Doğrula ve Giriş Yap
              </>
            )}
          </button>

          {/* Resend countdown */}
          <p className="text-center text-sm text-green-300/70">
            Kodu almadınız?{" "}
            {resendCountdown > 0 ? (
              <span className="text-white/50">{resendCountdown}s sonra tekrar gönder</span>
            ) : (
              <button
                type="button"
                onClick={handleResend}
                className="text-green-300 hover:text-white underline transition-colors"
              >
                Tekrar Gönder
              </button>
            )}
          </p>
        </form>
      )}
    </div>
  );
}
