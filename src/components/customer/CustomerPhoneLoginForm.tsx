"use client";

// src/components/customer/CustomerPhoneLoginForm.tsx
// Two-step Firebase Phone Auth flow:
//   Step 1 → Enter phone number, send OTP via Firebase invisible reCAPTCHA
//   Step 2 → Enter 6-digit OTP, confirm, POST to /api/customer/auth, redirect
//
// reCAPTCHA lifecycle rules followed here:
//  1. The container div is ALWAYS mounted (never conditionally rendered) and
//     carries a stable id="recaptcha-container" so Firebase resolves it via
//     document.getElementById — the most reliable lookup across SDK versions.
//  2. destroyRecaptcha() calls verifier.clear() AND wipes innerHTML so
//     Firebase's internal widget registry is fully reset.
//  3. createRecaptcha() always destroys first, then creates + render()s a
//     fresh verifier.  render() is called eagerly so the invisible widget is
//     pre-registered before signInWithPhoneNumber is invoked.
//  4. Every error path and every "go back" path calls destroyRecaptcha() so
//     the next send attempt always starts with a clean slate.

// Extend window so TypeScript accepts window.recaptchaVerifier
declare global {
  interface Window {
    recaptchaVerifier?: import("firebase/auth").RecaptchaVerifier;
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
import { toast } from "sonner";

// ── Country code options ──────────────────────────────────────────────────────
const COUNTRY_CODES = [
  { code: "+90", flag: "🇹🇷", label: "TR" },
  { code: "+1",  flag: "🇺🇸", label: "US" },
  { code: "+44", flag: "🇬🇧", label: "GB" },
  { code: "+49", flag: "🇩🇪", label: "DE" },
  { code: "+33", flag: "🇫🇷", label: "FR" },
  { code: "+31", flag: "🇳🇱", label: "NL" },
  { code: "+971", flag: "🇦🇪", label: "AE" },
];

type Step = "phone" | "otp";

export function CustomerPhoneLoginForm() {
  const router = useRouter();

  // ── State ─────────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("phone");
  const [countryCode, setCountryCode] = useState("+90");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);
  // Direct ref to the stable container DOM node (never conditionally rendered)
  const recaptchaContainerRef = useRef<HTMLDivElement | null>(null);
  const otpInputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── destroyRecaptcha ──────────────────────────────────────────────────────
  // Fully tears down the verifier AND wipes the container innerHTML so
  // Firebase's internal registry no longer sees a rendered widget.
  const destroyRecaptcha = useCallback(() => {
    if (recaptchaVerifierRef.current) {
      try {
        recaptchaVerifierRef.current.clear();
      } catch {
        // Widget may already be gone — safe to ignore
      }
      recaptchaVerifierRef.current = null;
    }
    // Remove from window to prevent stale references
    delete window.recaptchaVerifier;
    // Manually clear the DOM node so next RecaptchaVerifier starts fresh
    if (recaptchaContainerRef.current) {
      recaptchaContainerRef.current.innerHTML = "";
    }
  }, []);

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      destroyRecaptcha();
    };
  }, [destroyRecaptcha]);

  // ── createRecaptcha ───────────────────────────────────────────────────────
  // Always destroys any previous instance, then creates + eagerly renders a
  // fresh invisible verifier using the string id 'recaptcha-container'.
  // Using a string id (resolved via document.getElementById internally by
  // Firebase) is the most reliable approach and avoids the 503
  // auth/error-code:-39 that can occur when passing a DOM element reference.
  const createRecaptcha = useCallback(async (): Promise<RecaptchaVerifier> => {
    destroyRecaptcha(); // clean slate — prevents "already rendered" error

    const verifier = new RecaptchaVerifier(
      auth,
      "recaptcha-container", // string id — Firebase resolves via getElementById
      {
        size: "invisible",
        // Called when the reCAPTCHA challenge is solved — token is ready to
        // be consumed by signInWithPhoneNumber (Firebase handles this internally)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        callback: (_response: any) => {
          // reCAPTCHA solved — allow SMS send
        },
        // Called when the token expires before it is used.
        // We clear (not destroy) the widget so it can silently re-arm itself
        // without a full teardown, preventing captcha-check-failed on resend.
        "expired-callback": () => {
          if (window.recaptchaVerifier) {
            try { window.recaptchaVerifier.clear(); } catch { /* already gone */ }
          }
        },
        // Called on a hard reCAPTCHA error — full teardown is required.
        // The catch block in handleSendOtp shows the user-facing error.
        "error-callback": () => {
          destroyRecaptcha();
        },
      }
    );

    // Expose on window so expired-callback / error-callback can reference it
    // without closing over a potentially stale ref.
    window.recaptchaVerifier = verifier;

    // Eagerly render the invisible widget so it is pre-registered before
    // signInWithPhoneNumber is called — avoids async race conditions.
    await verifier.render();

    recaptchaVerifierRef.current = verifier;
    return verifier;
  }, [destroyRecaptcha]);

  // ── startCountdown ────────────────────────────────────────────────────────
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

  // ── handleGoBackToPhone ───────────────────────────────────────────────────
  // Single source of truth for "go back to step 1" — always destroys verifier.
  const handleGoBackToPhone = useCallback(() => {
    destroyRecaptcha();
    confirmationRef.current = null;
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
    setResendCountdown(0);
    setStep("phone");
    setOtp(["", "", "", "", "", ""]);
  }, [destroyRecaptcha]);

  // ── Step 1: Send OTP ─────────────────────────────────────────────────────
  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = phoneNumber.replace(/\D/g, "");
    if (cleaned.length < 7) {
      toast.error("Geçerli bir telefon numarası girin.");
      return;
    }

    setLoading(true);
    try {
      // Always create a fresh verifier for every send attempt
      const verifier = await createRecaptcha();
      const fullPhone = `${countryCode}${cleaned}`;

      const result = await signInWithPhoneNumber(auth, fullPhone, verifier);
      confirmationRef.current = result;

      setStep("otp");
      startCountdown();
      toast.success("Doğrulama kodu gönderildi!");
      // Auto-focus first OTP cell after React re-renders the OTP form
      setTimeout(() => otpInputsRef.current[0]?.focus(), 100);
    } catch (err: unknown) {
      console.error("[reCAPTCHA / OTP send error]", err);
      // Always destroy on failure so the next attempt starts fresh
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
      } else {
        toast.error("SMS gönderilemedi. Lütfen tekrar deneyin.");
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: Verify OTP ────────────────────────────────────────────────────
  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    const code = otp.join("");
    if (code.length !== 6) {
      toast.error("Lütfen 6 haneli kodu girin.");
      return;
    }

    setLoading(true);
    try {
      const credential = await confirmationRef.current!.confirm(code);
      const user = credential.user;
      const phone = `${countryCode}${phoneNumber.replace(/\D/g, "")}`;

      // Send verified phone + Firebase UID to our backend
      const res = await fetch("/api/customer/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, firebaseUid: user.uid }),
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
      const code = (err as { code?: string }).code;
      if (code === "auth/invalid-verification-code") {
        toast.error("Hatalı doğrulama kodu. Lütfen tekrar deneyin.");
      } else if (code === "auth/code-expired" || code === "auth/session-expired") {
        toast.error("Kodun süresi doldu. Lütfen yeni kod isteyin.");
        // Full reset — destroy verifier so next send is clean
        handleGoBackToPhone();
      } else {
        toast.error("Doğrulama başarısız. Lütfen tekrar deneyin.");
      }
    } finally {
      setLoading(false);
    }
  }

  // ── OTP input helpers ─────────────────────────────────────────────────────
  function handleOtpChange(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);
    if (digit && index < 5) otpInputsRef.current[index + 1]?.focus();
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpInputsRef.current[index - 1]?.focus();
    }
    if (e.key === "ArrowLeft" && index > 0) otpInputsRef.current[index - 1]?.focus();
    if (e.key === "ArrowRight" && index < 5) otpInputsRef.current[index + 1]?.focus();
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    const next = ["", "", "", "", "", ""];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setOtp(next);
    otpInputsRef.current[Math.min(pasted.length, 5)]?.focus();
  }

  // Resend = go back to phone step with a clean slate
  function handleResend() {
    if (resendCountdown > 0) return;
    handleGoBackToPhone();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/*
        IMPORTANT: This div is ALWAYS in the DOM — never conditionally rendered.
        It is referenced via recaptchaContainerRef (not a string id) so React
        never unmounts it between step 1 and step 2, preventing duplicate-widget
        errors caused by Firebase re-scanning the DOM.
        position:absolute / visibility:hidden keeps it invisible to users.
      */}
      <div
        id="recaptcha-container"
        ref={recaptchaContainerRef}
        aria-hidden="true"
        style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
      />

      {step === "phone" ? (
        /* ── Step 1: Phone Input ─────────────────────────────────────── */
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
                type="tel"
                inputMode="tel"
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
        /* ── Step 2: OTP Verification ────────────────────────────────── */
        <form onSubmit={handleVerifyOtp} className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-green-100">
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
                {countryCode} {phoneNumber}
              </span>{" "}
              numarasına gönderilen 6 haneli kodu girin.
            </p>

            {/* 6-cell OTP input */}
            <div className="flex gap-2 justify-center" onPaste={handleOtpPaste}>
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { otpInputsRef.current[i] = el; }}
                  id={`otp-cell-${i}`}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(i, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(i, e)}
                  className="w-11 h-14 text-center text-2xl font-bold rounded-xl bg-white/10 border border-white/30 text-white focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent transition-all caret-transparent"
                  aria-label={`OTP hane ${i + 1}`}
                />
              ))}
            </div>
          </div>

          <button
            id="verify-otp-btn"
            type="submit"
            disabled={loading || otp.join("").length !== 6}
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
