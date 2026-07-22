"use client";

// src/components/customer/CustomerPhoneLoginForm.tsx
// Two-step Firebase Phone Auth flow:
//   Step 1 → Enter phone number, send OTP via Firebase invisible reCAPTCHA
//   Step 2 → Enter 6-digit OTP, confirm, POST to /api/customer/auth, redirect

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
  const otpInputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      try { recaptchaVerifierRef.current?.clear(); } catch { /* ignore */ }
    };
  }, []);

  // ── Initialise invisible reCAPTCHA ────────────────────────────────────────
  const initRecaptcha = useCallback(() => {
    if (recaptchaVerifierRef.current) {
      try { recaptchaVerifierRef.current.clear(); } catch { /* ignore */ }
    }
    recaptchaVerifierRef.current = new RecaptchaVerifier(
      auth,
      "recaptcha-container",
      { size: "invisible" }
    );
  }, []);

  // ── Start countdown timer for resend ─────────────────────────────────────
  const startCountdown = useCallback(() => {
    setResendCountdown(30);
    countdownRef.current = setInterval(() => {
      setResendCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

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
      initRecaptcha();
      const fullPhone = `${countryCode}${cleaned}`;
      const result = await signInWithPhoneNumber(
        auth,
        fullPhone,
        recaptchaVerifierRef.current!
      );
      confirmationRef.current = result;
      setStep("otp");
      startCountdown();
      toast.success("Doğrulama kodu gönderildi!");
      // Auto-focus first OTP cell
      setTimeout(() => otpInputsRef.current[0]?.focus(), 100);
    } catch (err: unknown) {
      console.error(err);
      const code = (err as { code?: string }).code;
      if (code === "auth/invalid-phone-number") {
        toast.error("Geçersiz telefon numarası formatı.");
      } else if (code === "auth/too-many-requests") {
        toast.error("Çok fazla deneme. Lütfen daha sonra tekrar deneyin.");
      } else {
        toast.error("OTP gönderilemedi. Lütfen tekrar deneyin.");
      }
      try { recaptchaVerifierRef.current?.clear(); } catch { /* ignore */ }
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

      // Send verified phone to our backend
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
      console.error(err);
      const code = (err as { code?: string }).code;
      if (code === "auth/invalid-verification-code") {
        toast.error("Hatalı doğrulama kodu. Lütfen tekrar deneyin.");
      } else if (code === "auth/code-expired") {
        toast.error("Kodun süresi doldu. Lütfen yeni kod isteyin.");
        setStep("phone");
        setOtp(["", "", "", "", "", ""]);
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

  async function handleResend() {
    if (resendCountdown > 0) return;
    setStep("phone");
    setOtp(["", "", "", "", "", ""]);
    confirmationRef.current = null;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Invisible reCAPTCHA container — must always be in the DOM */}
      <div id="recaptcha-container" />

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
                onClick={() => { setStep("phone"); setOtp(["", "", "", "", "", ""]); }}
                className="text-xs text-green-300 hover:text-white transition-colors"
              >
                ← Numarayı Değiştir
              </button>
            </div>

            <p className="text-sm text-green-300/80">
              <span className="font-semibold text-white">{countryCode} {phoneNumber}</span> numarasına gönderilen 6 haneli kodu girin.
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
