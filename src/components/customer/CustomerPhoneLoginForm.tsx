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
const FIREBASE_OPERATION_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(Object.assign(new Error("Firebase operation timed out"), { code: "auth/timeout" }));
    }, FIREBASE_OPERATION_TIMEOUT_MS);

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

/**
 * "phone" → "otp" → (only when the backend asks for it) "consent".
 *
 * The consent step exists because /api/customer/auth refuses to CREATE a
 * Customer row until KVKK consent has been given explicitly, mirroring the
 * z.refine on the staff-side registerCustomer action. It is reached only on a
 * 428 response, so a returning, already-consented customer never sees it.
 */
type Step = "phone" | "otp" | "consent";

interface CustomerPhoneLoginFormProps {
  /** True when a valid customer session cookie already exists server-side. */
  alreadyLoggedIn?: boolean;
  /** Validated server-side destination, usually the card URL that was scanned. */
  redirectTo?: string;
}

export function CustomerPhoneLoginForm({
  alreadyLoggedIn = false,
  redirectTo = "/customer/dashboard",
}: CustomerPhoneLoginFormProps) {
  const router = useRouter();

  useEffect(() => {
    if (!alreadyLoggedIn) return;
    const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (entry?.type === "back_forward") return;
    router.replace(redirectTo);
  }, [alreadyLoggedIn, redirectTo, router]);

  const [step, setStep] = useState<Step>("phone");
  const [countryCode, setCountryCode] = useState("+90");
  const [phoneNumber, setPhoneNumber] = useState("");
  /** The OTP is a single string — one real <input> drives six styled cells. */
  const [otp, setOtp] = useState("");
  const [otpFocused, setOtpFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [kvkkChecked, setKvkkChecked] = useState(false);

  const confirmationRef = useRef<ConfirmationResult | null>(null);
  /**
   * The already-verified Firebase ID token, kept so the consent step can retry
   * /api/customer/auth without re-sending an SMS. Held in a ref, never in
   * state: it must not end up in a render-triggered log or a React DevTools
   * tree any longer than necessary, and it is cleared as soon as it is spent.
   */
  const idTokenRef = useRef<string | null>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);
  const recaptchaGenerationRef = useRef(0);
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
  /**
   * Mirror of `otp` readable from timers/native listeners without re-subscribing
   * them on every keystroke. Written by applyOtpValue, never read during render.
   */
  const otpRef = useRef("");

  /**
   * THE single place where the OTP value is written, no matter which path
   * delivered it: React onChange, a native `change`/`input` event, the WebOTP
   * credential, or the DOM-value poll below.
   *
   * Why this is not just `setOtp(e.target.value)`:
   * React's `onChange` is really the `input` event. Several mobile auto-fill
   * paths (the iOS "From Messages" keyboard suggestion, some Android IMEs and
   * password managers) write `input.value` and either dispatch only a native
   * `change` event or dispatch nothing at all. React state then stays "" while
   * the field visibly shows six digits, the submit button stays disabled and the
   * form looks stuck — which is exactly the reported bug. Every ingress point is
   * therefore funnelled through here, and the DOM is pushed back into sync so a
   * value that arrived outside React cannot drift away from state.
   */
  const applyOtpValue = useCallback((raw: string): string => {
    const digits = raw.replace(/\D/g, "").slice(0, OTP_LENGTH);

    // Re-arm the auto-submit guard whenever the code actually changes, so a
    // corrected code after a failed attempt submits without an extra tap.
    if (digits !== attemptedCodeRef.current) attemptedCodeRef.current = null;

    otpRef.current = digits;
    setOtp((prev) => (prev === digits ? prev : digits));

    const el = otpInputRef.current;
    if (el && el.value !== digits) el.value = digits;

    return digits;
  }, []);

  const destroyRecaptcha = useCallback(() => {
    recaptchaGenerationRef.current += 1;

    const verifiers = new Set<RecaptchaVerifier>();
    if (recaptchaVerifierRef.current) verifiers.add(recaptchaVerifierRef.current);
    if (window.recaptchaVerifier) verifiers.add(window.recaptchaVerifier);

    for (const verifier of verifiers) {
      try {
        verifier.clear();
      } catch {
        // Widget may already be gone — safe to ignore.
      }
    }

    recaptchaVerifierRef.current = null;
    delete window.recaptchaVerifier;
  }, []);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      destroyRecaptcha();
    };
  }, [destroyRecaptcha]);

  const createRecaptcha = useCallback(async (): Promise<RecaptchaVerifier> => {
    destroyRecaptcha();
    const generation = recaptchaGenerationRef.current;

    const verifier = new RecaptchaVerifier(
      auth,
      recaptchaContainerRef.current ?? "recaptcha-container",
      {
        size: "invisible",
        callback: () => {
          // reCAPTCHA solved — allow SMS send.
        },
        "expired-callback": destroyRecaptcha,
        "error-callback": destroyRecaptcha,
      }
    );

    // Store both references before render(): a submit or Strict Mode cleanup can
    // now reliably clear an initialization that is still in flight.
    recaptchaVerifierRef.current = verifier;
    window.recaptchaVerifier = verifier;

    try {
      await verifier.render();
      if (
        generation !== recaptchaGenerationRef.current ||
        recaptchaVerifierRef.current !== verifier
      ) {
        throw Object.assign(new Error("Stale reCAPTCHA initialization"), {
          name: "AbortError",
        });
      }
      return verifier;
    } catch (error) {
      if (recaptchaVerifierRef.current === verifier) destroyRecaptcha();
      throw error;
    }
  }, [destroyRecaptcha]);

  useEffect(() => {
    let cancelled = false;

    void createRecaptcha().catch((error: unknown) => {
      if (!cancelled && (error as { name?: string }).name !== "AbortError") {
        console.error("[reCAPTCHA initialization error]", error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [createRecaptcha]);

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
    idTokenRef.current = null;
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
    verifyingRef.current = false;
    attemptedCodeRef.current = null;
    setResendCountdown(0);
    setKvkkChecked(false);
    setStep("phone");
    applyOtpValue("");
  }, [destroyRecaptcha, applyOtpValue]);

  /**
   * Exchange the verified Firebase ID token for the server session cookie.
   *
   * Returns `"consent-required"` when the backend answers 428, meaning it has
   * verified the phone number but will not create (or unlock) the Customer row
   * until KVKK consent is sent. Nothing is written server-side in that case —
   * no row, no cookie — so abandoning the flow here leaves no trace.
   */
  const submitSession = useCallback(
    async (
      idToken: string,
      consent: boolean
    ): Promise<"ok" | "consent-required"> => {
      const res = await withTimeout(
        fetch("/api/customer/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            consent ? { idToken, kvkkConsent: true } : { idToken }
          ),
        })
      );

      const data = (await res.json().catch(() => ({}))) as {
        isNew?: boolean;
        requiresConsent?: boolean;
        error?: string;
      };

      if (res.status === 428 && data.requiresConsent) {
        return "consent-required";
      }

      if (!res.ok) throw new Error(data.error ?? "Backend auth failed");

      toast.success(
        data.isNew
          ? "Hoş geldiniz! Hesabınız oluşturuldu."
          : "Tekrar hoş geldiniz!"
      );
      idTokenRef.current = null;
      router.push(redirectTo);
      router.refresh();
      return "ok";
    },
    [redirectTo, router]
  );

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
        const credential = await withTimeout(
          confirmationRef.current.confirm(code)
        );
        const idToken = await withTimeout(credential.user.getIdToken());
        idTokenRef.current = idToken;

        const outcome = await submitSession(idToken, false);

        if (outcome === "consent-required") {
          // Phone verified, but no Customer row exists (or the existing one
          // predates the consent requirement). Ask before anything is stored.
          setKvkkChecked(false);
          setStep("consent");
        }
      } catch (err: unknown) {
        console.error("[OTP verify error]", err);
        const errCode = (err as { code?: string }).code;
        if (errCode === "auth/invalid-verification-code") {
          toast.error("Hatalı doğrulama kodu. Lütfen tekrar deneyin.");
          applyOtpValue("");
          setTimeout(() => otpInputRef.current?.focus(), 50);
        } else if (errCode === "auth/code-expired" || errCode === "auth/session-expired") {
          toast.error("Kodun süresi doldu. Lütfen yeni kod isteyin.");
          handleGoBackToPhone();
        } else if (errCode === "auth/timeout") {
          toast.error("Doğrulama zaman aşımına uğradı. Bağlantınızı kontrol edip tekrar deneyin.");
        } else {
          toast.error("Doğrulama başarısız. Lütfen tekrar deneyin.");
        }
      } finally {
        verifyingRef.current = false;
        setLoading(false);
      }
    },
    [handleGoBackToPhone, applyOtpValue, submitSession]
  );

  /** Consent step submit — the only place `kvkkConsent: true` is ever sent. */
  async function handleConsentSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!kvkkChecked) {
      toast.error("Devam etmek için KVKK aydınlatma metnini onaylamalısınız.");
      return;
    }

    const idToken = idTokenRef.current;
    if (!idToken) {
      toast.error("Oturum süresi doldu. Lütfen tekrar giriş yapın.");
      handleGoBackToPhone();
      return;
    }

    setLoading(true);
    try {
      const outcome = await submitSession(idToken, true);
      if (outcome === "consent-required") {
        // Should not happen: we just sent consent. Treat as a stale token.
        toast.error("Onay kaydedilemedi. Lütfen tekrar giriş yapın.");
        handleGoBackToPhone();
      }
    } catch (err) {
      console.error("[KVKK consent submit]", err);
      toast.error("Kayıt tamamlanamadı. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }

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
        const received = (credential as OTPCredential | null)?.code ?? "";
        // Write through applyOtpValue so state AND the DOM input are both
        // updated — the painted cells and the submit button read state, while
        // any later native event reads the input's own value.
        const digits = applyOtpValue(received);
        // Verify straight away instead of waiting for the effect below: the
        // synchronous guards inside verifyCode already de-duplicate, and this
        // removes one render round-trip from the happy path.
        if (digits.length === OTP_LENGTH) void verifyCode(digits);
      })
      .catch(() => {
        // AbortError on unmount/step change, or the user dismissed the prompt.
      });

    // Aborting is required — a pending WebOTP request otherwise outlives the step.
    return () => controller.abort();
  }, [step, applyOtpValue, verifyCode]);

  /**
   * Native-event bridge for auto-fill paths React does not see.
   *
   * React's synthetic `onChange` is wired to the `input` event only. Mobile
   * auto-fill (notably iOS "From Messages" and several Android IMEs) can commit
   * the value with a bare `change` event, which React would drop on the floor.
   * Listening to the real events on the real node closes that gap.
   */
  useEffect(() => {
    if (step !== "otp") return;
    const el = otpInputRef.current;
    if (!el) return;

    const sync = () => applyOtpValue(el.value);
    el.addEventListener("input", sync);
    el.addEventListener("change", sync);

    return () => {
      el.removeEventListener("input", sync);
      el.removeEventListener("change", sync);
    };
  }, [step, applyOtpValue]);

  /**
   * Last-resort poll for auto-fill that dispatches NO event at all (some WebView
   * and password-manager implementations simply assign `input.value`). Cheap,
   * scoped to the OTP step only, and stops as soon as the step changes. Without
   * it the field can visibly hold six digits while React state is still empty —
   * the "stuck form" symptom.
   */
  useEffect(() => {
    if (step !== "otp") return;

    const id = setInterval(() => {
      const el = otpInputRef.current;
      if (!el || verifyingRef.current) return;
      const digits = el.value.replace(/\D/g, "").slice(0, OTP_LENGTH);
      if (digits !== otpRef.current) applyOtpValue(digits);
    }, 200);

    return () => clearInterval(id);
  }, [step, applyOtpValue]);

  /**
   * Auto-confirm as soon as six digits land, whatever filled them.
   *
   * `loading` is a dependency on purpose: when a verification finishes it flips
   * back to false and re-runs this effect, so a code that arrived while another
   * confirm() was in flight is not silently dropped. `attemptedCodeRef` still
   * prevents the same code from being sent to Firebase twice.
   */
  useEffect(() => {
    if (step !== "otp") return;
    if (otp.length !== OTP_LENGTH) return;
    if (verifyingRef.current) return;
    if (attemptedCodeRef.current === otp) return;
    void verifyCode(otp);
  }, [otp, step, loading, verifyCode]);

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

      const result = await withTimeout(
        signInWithPhoneNumber(auth, fullPhone, verifier)
      );
      confirmationRef.current = result;

      attemptedCodeRef.current = null;
      verifyingRef.current = false;
      applyOtpValue("");
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
      } else if (code === "auth/timeout") {
        toast.error("SMS isteği zaman aşımına uğradı. Bağlantınızı kontrol edip tekrar deneyin.");
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
   * 6-digit code in a single event, so everything is normalised in one place.
   * Bound to both onChange and onInput — a duplicate call is a no-op because
   * applyOtpValue is idempotent for an unchanged value.
   */
  function handleOtpChange(e: React.ChangeEvent<HTMLInputElement> | React.FormEvent<HTMLInputElement>) {
    applyOtpValue((e.target as HTMLInputElement).value);
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
      ) : step === "otp" ? (
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
                onInput={handleOtpChange}
                onPaste={() => {
                  // The pasted text lands in the value only after this event;
                  // read it back on the next tick.
                  setTimeout(() => {
                    if (otpInputRef.current) applyOtpValue(otpInputRef.current.value);
                  }, 0);
                }}
                onFocus={() => setOtpFocused(true)}
                onBlur={() => setOtpFocused(false)}
                /*
                  readOnly, NOT disabled: a disabled input is dropped from the
                  browser's auto-fill target list mid-flight, so an SMS arriving
                  while a verification is in progress could no longer fill it.
                  readOnly blocks typing just the same and keeps the value.
                */
                readOnly={loading}
                aria-label="6 haneli doğrulama kodu"
                aria-busy={loading}
                className={`absolute inset-0 z-10 w-full h-full opacity-0 ${
                  loading ? "cursor-not-allowed" : "cursor-pointer"
                }`}
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
      ) : (
        /*
          KVKK consent step. Reached ONLY on a 428 from /api/customer/auth,
          i.e. the phone number is verified but no consented Customer row
          exists yet. Nothing has been written server-side at this point, so
          closing the page here leaves no record behind.
        */
        <form onSubmit={handleConsentSubmit} className="space-y-6">
          <div className="space-y-3">
            <h3 className="text-white font-semibold text-base">
              Son bir adım: KVKK Onayı
            </h3>
            <p className="text-sm text-green-300/80">
              <span className="font-semibold text-white">
                {`${countryCode} ${phoneNumber}`}
              </span>{" "}
              numarası doğrulandı. Sadakat kartınızın oluşturulabilmesi için
              kişisel verilerinizin işlenmesine onay vermeniz gerekiyor.
            </p>

            <div className="rounded-xl bg-white/10 border border-white/20 p-4 text-xs text-green-100/90 leading-relaxed max-h-44 overflow-y-auto space-y-2">
              <p>
                Ekrem Coşkun Döner olarak, sadakat programını yürütebilmek
                amacıyla <strong>adınızı ve telefon numaranızı</strong> ve
                programa ilişkin <strong>sipariş ve ödül kayıtlarınızı</strong>{" "}
                işliyoruz.
              </p>
              <p>
                Verileriniz yalnızca damga biriktirme, ödül tanımlama ve
                ödüllerin kasada kullandırılması için kullanılır; pazarlama
                amacıyla üçüncü kişilerle paylaşılmaz.
              </p>
              <p>
                6698 sayılı KVKK kapsamında verilerinize erişme, düzeltilmesini
                veya silinmesini isteme hakkına sahipsiniz. Silme talebiniz
                halinde kaydınız ve tüm sipariş/ödül geçmişiniz kalıcı olarak
                kaldırılır.
              </p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                id="kvkk-consent"
                type="checkbox"
                checked={kvkkChecked}
                onChange={(e) => setKvkkChecked(e.target.checked)}
                className="mt-0.5 w-5 h-5 shrink-0 rounded border-white/40 accent-green-500"
              />
              <span className="text-sm text-green-100">
                KVKK aydınlatma metnini okudum ve kişisel verilerimin yukarıda
                belirtilen amaçlarla işlenmesini onaylıyorum.
              </span>
            </label>
          </div>

          <button
            id="kvkk-consent-btn"
            type="submit"
            disabled={loading || !kvkkChecked}
            className="w-full py-3 px-6 rounded-xl bg-green-500 hover:bg-green-400 active:scale-[0.98] text-white font-semibold text-base shadow-lg shadow-green-900/40 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                Kaydediliyor...
              </>
            ) : (
              "Onaylıyorum ve Devam Et"
            )}
          </button>

          <button
            type="button"
            onClick={handleGoBackToPhone}
            className="w-full text-center text-xs text-green-300/70 hover:text-white transition-colors"
          >
            Vazgeç
          </button>
        </form>
      )}
    </div>
  );
}
