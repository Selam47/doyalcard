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
  signOut,
  type ConfirmationResult,
} from "firebase/auth";
import { auth, getFirebaseConfigIssues } from "@/lib/firebase";
import { normalizePhoneToE164, isValidE164 } from "@/lib/phone";
import {
  CustomerNameSchema,
  KVKK_REQUIRED_MESSAGE,
} from "@/lib/customer-validation";
import { CustomerNotRegisteredPanel } from "@/components/customer/CustomerNotRegisteredPanel";
import { CustomerRegisterStep } from "@/components/customer/CustomerRegisterStep";
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
 * Two routes through this form, decided BEFORE any SMS is spent:
 *
 *   returning customer   "phone" → "otp" → dashboard
 *   new customer         "phone" → "notfound" → "register" → "otp" → dashboard
 *
 * The fork is `/api/customer/exists`. Previously there was no fork at all: the
 * OTP went out unconditionally and an unknown number was only discovered AFTER
 * verification, as a 428 from /api/customer/auth. Every other non-2xx status on
 * that path (503, 500, an unparseable body) fell through to a thrown Error in
 * `submitSession` and surfaced as the opaque "Doğrulama başarısız." — so "you
 * have no account" and "something broke" looked identical, and when the 428 DID
 * arrive the row was created with the placeholder name "Müşteri" because no
 * name had ever been asked for.
 *
 * "consent" is now a LEGACY-ONLY step. It is still reached on a 428 for a row
 * that predates the consent requirement (`kvkkConsent: false`), which needs a
 * backfill but not a registration. A brand-new customer sends name + consent
 * together from the "register" step, so they never see it.
 */
type Step = "phone" | "notfound" | "register" | "otp" | "consent";

/**
 * A registration that has been filled in but NOT yet committed. Its presence is
 * what tells `verifyCode` to create an account rather than just sign in, and
 * what sends a back-navigation to the register form instead of the phone entry.
 *
 * Nothing here is written server-side until the OTP verifies — that is the
 * whole reason it is held in the client for the length of the OTP step.
 */
interface PendingRegistration {
  name: string;
}

interface ExistingIdentity {
  name: string;
  maskedPhone: string;
}

interface CustomerPhoneLoginFormProps {
  /**
   * The account this browser is ALREADY signed in as, if any — resolved and
   * masked server-side. Never acted upon automatically; see the identity gate
   * below.
   */
  existingIdentity?: ExistingIdentity | null;
  /** Validated server-side destination, usually the card URL that was scanned. */
  redirectTo?: string;
}

export function CustomerPhoneLoginForm({
  existingIdentity = null,
  redirectTo = "/customer/dashboard",
}: CustomerPhoneLoginFormProps) {
  const router = useRouter();

  /*
   * The identity gate.
   *
   * There is deliberately NO effect here that navigates on the strength of an
   * existing session. The previous version did exactly that, and it is how a
   * visitor could land on a stranger's stamp card without authenticating: the
   * cookie left behind by whoever used the device last was treated as this
   * visitor's identity. A session is now an OFFER the user accepts or rejects
   * by name, and rejecting it destroys it before any new sign-in begins.
   */
  const [identityOffer, setIdentityOffer] = useState<ExistingIdentity | null>(
    existingIdentity
  );
  const [switchingAccount, setSwitchingAccount] = useState(false);

  function handleContinueAsExisting() {
    router.push(redirectTo);
    router.refresh();
  }

  async function handleUseDifferentNumber() {
    setSwitchingAccount(true);
    try {
      // Drop the previous occupant's session server-side BEFORE collecting a
      // new number, so an abandoned sign-in cannot leave it live and reusable.
      await fetch("/api/customer/logout", { method: "POST" });
    } catch {
      // Even if the call fails the new login overwrites the cookie; carry on.
    } finally {
      setIdentityOffer(null);
      setSwitchingAccount(false);
      router.refresh();
    }
  }

  const [step, setStep] = useState<Step>("phone");
  const [countryCode, setCountryCode] = useState("+90");
  const [phoneNumber, setPhoneNumber] = useState("");
  /**
   * The exact E.164 string that was handed to Firebase. Shown on the OTP and
   * consent screens instead of the raw `countryCode + phoneNumber` pair, so the
   * customer sees the number the SMS actually went to — the two can differ
   * (leading "0" stripped, country code already typed in) and when they do, the
   * raw echo hides precisely the mismatch worth noticing.
   */
  const [sentPhone, setSentPhone] = useState("");
  /** The OTP is a single string — one real <input> drives six styled cells. */
  const [otp, setOtp] = useState("");
  const [otpFocused, setOtpFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [kvkkChecked, setKvkkChecked] = useState(false);
  /** Name typed on the self-registration step. Never sent until OTP succeeds. */
  const [registerName, setRegisterName] = useState("");
  /**
   * The normalized number `/api/customer/exists` positively reported as having
   * NO account, echoed on the "not registered" screen so a typo is obvious.
   */
  const [checkedPhone, setCheckedPhone] = useState("");
  /**
   * Non-null only between "register form submitted" and "OTP verified".
   * See {@link PendingRegistration}.
   */
  const [pendingRegistration, setPendingRegistration] =
    useState<PendingRegistration | null>(null);

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
  /**
   * True from just before `signInWithPhoneNumber` until it settles.
   *
   * grecaptcha fires `expired-callback` / `error-callback` on its own schedule,
   * and those used to call `destroyRecaptcha()` unconditionally. When one landed
   * WHILE `signInWithPhoneNumber` was awaiting `verifier.verify()`, Firebase was
   * left holding a verifier that had just been `clear()`ed and whose host node
   * had been ripped out of the DOM. The call then rejected with
   * `auth/internal-error` / `auth/invalid-app-credential` / `auth/argument-error`
   * — none of which were mapped, so all three surfaced as the generic
   * "SMS gönderilemedi" toast. That is the reported bug's most common shape.
   *
   * During a send the callbacks now only INVALIDATE the verifier; the actual
   * teardown happens in sendOtp's own catch, after Firebase has
   * finished with it.
   */
  const sendInFlightRef = useRef(false);
  /** The permanently-mounted wrapper (see the JSX comment below). */
  const recaptchaContainerRef = useRef<HTMLDivElement | null>(null);
  /**
   * The throw-away child node the CURRENT verifier is bound to.
   *
   * grecaptcha refuses to render twice into the same element — that is
   * literally the "reCAPTCHA has already been rendered in this element"
   * error. `verifier.clear()` is not a reliable inverse of `render()`: it is a
   * no-op for a widget whose render() has not resolved yet, so a verifier that
   * was superseded mid-initialization still drops its widget into the
   * container afterwards, and the next render() collides with it.
   *
   * Binding every verifier to a BRAND-NEW div removes the race by
   * construction: a node that was just created cannot already hold a widget,
   * and tearing the node out of the DOM takes any leftover widget with it. The
   * outer container stays mounted for the whole component lifetime as CLAUDE.md
   * requires; only this inner node churns.
   */
  const recaptchaHostRef = useRef<HTMLDivElement | null>(null);
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

  /**
   * Detach one verifier and the node it was rendered into. Both halves matter:
   * `clear()` unhooks Firebase's own bookkeeping, removing the host node
   * evicts any widget grecaptcha may still paint (or may already have painted)
   * there. Never throws — teardown runs on paths that are already failing.
   */
  const teardownVerifier = useCallback(
    (verifier: RecaptchaVerifier | null | undefined, host: HTMLElement | null) => {
      if (verifier) {
        try {
          // clear(), never reset(): reset() breaks the build on firebase v10+.
          verifier.clear();
        } catch {
          // Widget may already be gone — safe to ignore.
        }
      }
      try {
        host?.parentNode?.removeChild(host);
      } catch {
        // Node already detached.
      }
    },
    []
  );

  const destroyRecaptcha = useCallback(() => {
    // Bumping the generation invalidates any render() still in flight, so a
    // verifier that resolves after this point tears itself down instead of
    // leaving a live widget behind.
    recaptchaGenerationRef.current += 1;

    // Both handles are checked before anything is constructed: a leftover
    // window.recaptchaVerifier from a previous mount (Fast Refresh, Strict
    // Mode's double effect, bfcache restore) must be cleared, not orphaned.
    const verifiers = new Set<RecaptchaVerifier>();
    if (recaptchaVerifierRef.current) verifiers.add(recaptchaVerifierRef.current);
    if (window.recaptchaVerifier) verifiers.add(window.recaptchaVerifier);

    for (const verifier of verifiers) {
      teardownVerifier(verifier, null);
    }

    recaptchaVerifierRef.current = null;
    recaptchaHostRef.current = null;
    delete window.recaptchaVerifier;

    // Empty the wrapper itself: this also sweeps hosts belonging to verifiers
    // we no longer hold a reference to (e.g. one abandoned by a Fast Refresh).
    const container = recaptchaContainerRef.current;
    if (container) {
      while (container.firstChild) container.removeChild(container.firstChild);
    }
  }, [teardownVerifier]);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      destroyRecaptcha();
    };
  }, [destroyRecaptcha]);

  const createRecaptcha = useCallback(async (): Promise<RecaptchaVerifier> => {
    // Always dispose of whatever is there before constructing anything —
    // window.recaptchaVerifier included. Firebase also forbids reusing a
    // verifier across two signInWithPhoneNumber calls, so every send gets a
    // fresh one rather than a cached instance.
    destroyRecaptcha();
    const generation = recaptchaGenerationRef.current;

    const container = recaptchaContainerRef.current;
    if (!container) {
      throw new Error("reCAPTCHA container is not mounted");
    }

    // Fresh node per verifier — see recaptchaHostRef. Passing the element
    // itself (not the "recaptcha-container" id string) keeps Firebase from
    // re-resolving the id to a node that another widget already owns.
    const host = document.createElement("div");
    container.appendChild(host);

    // See sendInFlightRef: tearing the verifier down from under an in-flight
    // signInWithPhoneNumber is what turns a recoverable challenge into an
    // unmapped auth/internal-error. While a send is running these callbacks
    // only note the problem; sendOtp disposes of the verifier itself.
    const disposeUnlessSending = (reason: string) => {
      console.warn(`[reCAPTCHA] ${reason}`);
      if (sendInFlightRef.current) return;
      destroyRecaptcha();
    };

    const verifier = new RecaptchaVerifier(auth, host, {
      size: "invisible",
      callback: () => {
        // reCAPTCHA solved — allow SMS send.
      },
      "expired-callback": () => disposeUnlessSending("expired-callback"),
      "error-callback": () => disposeUnlessSending("error-callback"),
    });

    // Store every handle before render(): a submit or a Strict Mode cleanup can
    // now reliably clear an initialization that is still in flight.
    recaptchaVerifierRef.current = verifier;
    recaptchaHostRef.current = host;
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
      // Tear down THIS verifier unconditionally, even when it is no longer the
      // current one. The previous version only cleaned up while it still held
      // the ref, so a verifier superseded mid-render() finished rendering into
      // the shared container and was never cleared — the widget it left behind
      // is what made the next render() throw "reCAPTCHA has already been
      // rendered in this element".
      teardownVerifier(verifier, host);

      if (recaptchaVerifierRef.current === verifier) recaptchaVerifierRef.current = null;
      if (recaptchaHostRef.current === host) recaptchaHostRef.current = null;
      if (window.recaptchaVerifier === verifier) delete window.recaptchaVerifier;

      throw error;
    }
  }, [destroyRecaptcha, teardownVerifier]);

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

  /**
   * Tear down the OTP ATTEMPT itself — verifier, confirmation, token, timers —
   * without touching anything the customer typed. Split out so a self-
   * registering customer whose code expired is not also stripped of the name
   * and consent they already gave.
   */
  const resetOtpAttempt = useCallback(() => {
    destroyRecaptcha();
    confirmationRef.current = null;
    idTokenRef.current = null;
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
    verifyingRef.current = false;
    attemptedCodeRef.current = null;
    setResendCountdown(0);
    setSentPhone("");
    applyOtpValue("");
    // Firebase istemcisinde asılı kalmış kullanıcıyı da düşür: aksi halde
    // yarıda bırakılan bir KVKK adımından sonra bir sonraki SMS isteği
    // hâlâ açık bir oturumun üzerine biniyor. Best-effort.
    void signOut(auth).catch(() => {});
  }, [destroyRecaptcha, applyOtpValue]);

  /**
   * Full restart: back to phone entry, discarding any half-finished
   * registration. Used by "Numarayı Değiştir" and by the legacy consent step's
   * "Vazgeç" — both are statements that the current attempt is abandoned.
   */
  const handleGoBackToPhone = useCallback(() => {
    resetOtpAttempt();
    setPendingRegistration(null);
    setKvkkChecked(false);
    setRegisterName("");
    setCheckedPhone("");
    setStep("phone");
  }, [resetOtpAttempt]);

  /**
   * Back to whichever screen the customer came FROM.
   *
   * A self-registering customer whose code expired must land on their filled-in
   * registration form, not on an empty phone field — dumping them back to the
   * start would silently discard the name and the KVKK tick and make an expired
   * SMS feel like a rejection.
   */
  const handleGoBackToEntry = useCallback(() => {
    resetOtpAttempt();
    setStep(pendingRegistration ? "register" : "phone");
  }, [resetOtpAttempt, pendingRegistration]);

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
      consent: boolean,
      /**
       * Only ever sent alongside consent, and only by the self-registration
       * path. The backend uses it on its CREATE branch exclusively — a
       * returning customer's name is never overwritten from here.
       */
      name?: string | null
    ): Promise<"ok" | "consent-required"> => {
      const payload: Record<string, unknown> = { idToken };
      if (consent) {
        payload.kvkkConsent = true;
        if (name) payload.name = name;
      }

      const res = await withTimeout(
        fetch("/api/customer/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
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
        handleGoBackToEntry();
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

        /*
         * THE ACCOUNT IS CREATED HERE AND NOWHERE EARLIER.
         *
         * The register form only collected data and asked Firebase for an SMS;
         * no row existed until this line. So a customer who abandons the OTP
         * step, mistypes the code, or lets it expire leaves nothing behind —
         * which is exactly requirement "do not create the record until the code
         * verifies", and also what makes the number provably theirs.
         */
        const outcome = pendingRegistration
          ? await submitSession(idToken, true, pendingRegistration.name)
          : await submitSession(idToken, false);

        if (outcome === "ok") {
          setPendingRegistration(null);
        } else if (pendingRegistration) {
          /*
           * We just sent `kvkkConsent: true`, so a 428 here means the backend
           * did not accept it — a stale token, or a body that never arrived.
           * Do NOT fall through to the legacy consent screen: it would ask for
           * a consent that was already given and drop the name on the way.
           */
          toast.error("Kayıt tamamlanamadı. Lütfen tekrar deneyin.");
          handleGoBackToEntry();
        } else {
          // Legacy path: a row that predates the consent requirement. The phone
          // is verified but nothing is stored until consent arrives.
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
          handleGoBackToEntry();
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
    [handleGoBackToEntry, applyOtpValue, submitSession, pendingRegistration]
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

  /**
   * Resolve what the customer typed into THE canonical E.164 spelling.
   *
   * The SAME normalizer `registerCustomer` (staff side), `/api/customer/auth`
   * (OTP callback) and `/api/customer/exists` use. This form previously called
   * `toE164`, a looser helper that only glued the country code onto whatever
   * digits were typed:
   *
   *   • it applied no national-length rule, so a half-entered "916 28 63"
   *     became "+909162863" — a string the generic E164 regex happily
   *     accepts, sent straight to Firebase, which rejects it;
   *   • it produced a spelling that could differ from the one the cashier's
   *     registration stored, so even a successful OTP resolved to a
   *     different (or missing) Customer row.
   *
   * Funnelling every surface through one normalizer is what makes "the number
   * the staff registered", "the number the customer types" and "the number the
   * existence check looks up" the same string, byte for byte. If they could
   * differ, the new "no account found" screen would be shown to registered
   * customers.
   */
  function resolvePhone(): string | null {
    const fullPhone = normalizePhoneToE164(phoneNumber, countryCode);

    if (!fullPhone || !isValidE164(fullPhone)) {
      toast.error(
        "Geçerli bir telefon numarası girin (örn: 0530 123 45 67 veya 530 123 45 67)."
      );
      return null;
    }

    return fullPhone;
  }

  /**
   * Yapılandırma eksikse Firebase'i hiç çağırmıyoruz. Aksi halde hata,
   * "SMS gönderilemedi" gibi genel bir toast'a dönüşüyor ve gerçek sebep —
   * Vercel'de tanımlanmamış (ya da eklendikten sonra yeniden deploy
   * edilmemiş) bir NEXT_PUBLIC_FIREBASE_* değişkeni — hiç görünmüyordu.
   */
  function firebaseConfigOk(): boolean {
    const configIssues = getFirebaseConfigIssues();
    if (configIssues.length === 0) return true;

    console.error("[OTP send] Firebase yapılandırması eksik:", configIssues);
    toast.error(
      "SMS servisi yapılandırılmamış. Lütfen yönetici ile iletişime geçin."
    );
    return false;
  }

  /**
   * "Does this number already have an account?" — asked BEFORE an SMS is spent.
   *
   * Three outcomes, and the third is the one that matters most: a check that
   * could not RUN is never reported as "no account". Doing so would tell a
   * registered customer to create a duplicate that the UNIQUE phone index would
   * then refuse, stranding them on a screen with no way forward. The endpoint
   * answers 503 in that case and we surface a retry.
   */
  async function checkExistingAccount(
    fullPhone: string
  ): Promise<"exists" | "missing" | "failed"> {
    try {
      const res = await withTimeout(
        fetch("/api/customer/exists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ phone: fullPhone }),
        })
      );

      const data = (await res.json().catch(() => ({}))) as {
        exists?: unknown;
        error?: string;
      };

      // A 200 whose body we cannot read is NOT a "no account" answer either.
      if (res.ok && typeof data.exists === "boolean") {
        return data.exists ? "exists" : "missing";
      }

      console.error(
        `[account check] status=${res.status} error=${data.error ?? "(yok)"}`
      );
      toast.error(
        data.error ?? "Hesap kontrolü yapılamadı. Lütfen tekrar deneyin."
      );
      return "failed";
    } catch (error) {
      console.error("[account check]", error);
      toast.error(
        "Hesap kontrolü yapılamadı. Bağlantınızı kontrol edip tekrar deneyin."
      );
      return "failed";
    }
  }

  /**
   * Send the SMS and move to the OTP step. Shared verbatim by both paths —
   * the returning customer and the self-registering one — so a Firebase failure
   * is reported with the same real, code-carrying message either way instead of
   * one path crashing and the other toasting.
   *
   * Returns false (never throws) when no code went out; callers decide what the
   * customer sees next. Does not manage `loading`: the caller owns that, since
   * for the login path the spinner also covers the existence check.
   */
  async function sendOtp(fullPhone: string): Promise<boolean> {
    try {
      /*
       * OTURUM TEMİZLİĞİ — Firebase'e dokunmadan ÖNCE.
       *
       * İki ayrı artık, iki ayrı arıza:
       *
       * 1. `customer_session` cookie'si. Bu cihazda daha önce başka biri (ya da
       *    aynı kişi başka bir numarayla) giriş yaptıysa cookie hâlâ canlıdır.
       *    Yeni numara doğrulanana kadar o kimlik geçerli kalır; akış yarıda
       *    kalırsa eski oturum hiç düşmeden yerinde durur.
       *
       * 2. Firebase istemcisinde ASILI KALMIŞ kullanıcı. `confirm()` başarılı
       *    olduğu hâlde /api/customer/auth 428 (KVKK onayı gerekli) döndüğünde
       *    — yani TAM OLARAK yeni müşteri senaryosunda — kullanıcı formu
       *    kapatırsa Firebase oturumu açık kalır. Bir sonraki denemede
       *    signInWithPhoneNumber, hâlâ oturumu açık bir kullanıcının üzerine
       *    yeni bir doğrulama başlatmaya çalışır ve reCAPTCHA jetonu bu
       *    durumda `auth/invalid-app-credential` ile reddedilebilir. Kod
       *    haritalanmamış olduğu için ekrana düşen tek şey "SMS gönderilemedi"
       *    oluyordu.
       *
       * İkisi de best-effort: burada bir hata, kullanıcının SMS almasına engel
       * olmamalı.
       */
      await Promise.allSettled([
        fetch("/api/customer/logout", { method: "POST", cache: "no-store" }),
        signOut(auth),
      ]);

      // A fresh, fully rendered verifier for this send. Never reuse the one
      // from a previous attempt: Firebase treats a verifier as single-use.
      const verifier = await createRecaptcha();

      // Bu iki log kasıtlı: "SMS hiç gelmiyor" şikâyetinde ilk sorulacak soru
      // çağrının GERÇEKTEN yapılıp yapılmadığıdır. Promise resolve olduğu hâlde
      // SMS gelmiyorsa sorun kodda değil, Firebase konsolundadır (test
      // numarası, SMS bölge politikası, kota/faturalandırma).
      console.info("[OTP send] signInWithPhoneNumber çağrılıyor →", fullPhone);

      sendInFlightRef.current = true;
      let result: ConfirmationResult;
      try {
        result = await withTimeout(
          signInWithPhoneNumber(auth, fullPhone, verifier)
        );
      } finally {
        // Firebase artık verifier ile işini bitirdi; expired/error geri
        // çağrıları bu andan itibaren yeniden yıkım yapabilir.
        sendInFlightRef.current = false;
      }
      confirmationRef.current = result;

      console.info(
        "[OTP send] Firebase isteği BAŞARILI (verificationId alındı). " +
          "Bu noktadan sonra SMS gelmiyorsa sebep Firebase konsolundadır: " +
          "test telefon numarası, SMS bölge politikası, kota veya faturalandırma."
      );

      attemptedCodeRef.current = null;
      verifyingRef.current = false;
      applyOtpValue("");
      setSentPhone(fullPhone);
      setStep("otp");
      startCountdown();
      toast.success("Doğrulama kodu gönderildi!");
      setTimeout(() => otpInputRef.current?.focus(), 100);
      return true;
    } catch (err: unknown) {
      sendInFlightRef.current = false;
      const code = (err as { code?: string }).code;
      const message = (err as { message?: string }).message;
      /*
       * Teşhis bilgisinin TAMAMINI tek satırda logluyoruz.
       *
       * Sorunun kökü buydu: Firebase'in `code` alanı — `auth/…` ile başlayan ve
       * "neden SMS gitmedi" sorusunun tek gerçek cevabı olan alan — tek bir
       * genel toast'un içinde kayboluyordu. Kullanıcı "SMS gönderilemedi"
       * görüyor, konsolda katlanmış bir hata nesnesi duruyor ve numaranın mı,
       * reCAPTCHA'nın mı, kotanın mı yoksa alan adı yetkisinin mi sorun olduğu
       * hiçbir yerden anlaşılamıyordu. Artık kod, mesaj ve denenen numara
       * birlikte yazılıyor.
       */
      console.error(
        `[OTP send error] code=${code ?? "(yok)"} phone=${fullPhone} message=${
          message ?? "(yok)"
        }`,
        err
      );

      /*
       * Her hata yolunda verifier'ı YOK EDİYORUZ: hem ref'i hem
       * window.recaptchaVerifier'ı temizler, hem de widget'ın DOM
       * düğümünü söker. Yarım kalmış bir widget kapsayıcıda kalırsa
       * kullanıcının bir sonraki denemesi "reCAPTCHA has already been
       * rendered in this element" ile patlar ve sayfa yenilemeden
       * kurtulmanın yolu kalmaz. Böylece "Tekrar Dene" her zaman
       * sıfırdan başlar.
       */
      destroyRecaptcha();

      if ((err as { name?: string }).name === "AbortError") {
        // Bu deneme daha yenisi tarafından geçersiz kılındı (ör. çift tık).
        // Kullanıcıya gösterilecek bir hata yok; yeni deneme zaten yolda.
        return false;
      }

      if (code === "auth/operation-not-allowed") {
        toast.error(
          "Telefon ile giriş Firebase'de etkin değil. Lütfen yönetici ile iletişime geçin."
        );
      } else if (code === "auth/invalid-api-key" || code === "auth/api-key-not-valid") {
        toast.error(
          "SMS servisi yapılandırması hatalı. Lütfen yönetici ile iletişime geçin."
        );
      } else if (code === "auth/billing-not-enabled") {
        toast.error(
          "SMS servisi için faturalandırma etkin değil. Lütfen yönetici ile iletişime geçin."
        );
      } else if (code === "auth/invalid-phone-number") {
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
      } else if (
        /*
         * reCAPTCHA jetonu geçersiz / süresi dolmuş / zaten kullanılmış.
         * Firebase'in tek bir jetonu iki kez görmesi, yıkılmış bir verifier'a
         * denk gelmesi ve yetkisiz alan adı hep buraya düşer. Yeni bir verifier
         * ile ikinci deneme neredeyse her zaman başarılı olur — bu yüzden
         * kullanıcıya "tekrar deneyin" diyoruz, "yönetici ile görüşün" değil.
         */
        code === "auth/invalid-app-credential" ||
        code === "auth/missing-app-credential" ||
        code === "auth/invalid-recaptcha-token" ||
        code === "auth/missing-recaptcha-token" ||
        code === "auth/invalid-recaptcha-action" ||
        code === "auth/argument-error"
      ) {
        toast.error(
          "Güvenlik doğrulaması yenilenmeli. Lütfen tekrar deneyin."
        );
      } else if (code === "auth/app-not-authorized") {
        toast.error(
          "Uygulama bu Firebase projesinde yetkili değil. Lütfen yönetici ile iletişime geçin."
        );
      } else if (code === "auth/web-storage-unsupported") {
        toast.error(
          "Tarayıcınız çerezleri/depolamayı engelliyor. Gizli moddan çıkıp tekrar deneyin."
        );
      } else if (code === "auth/user-disabled") {
        toast.error("Bu numara devre dışı bırakılmış. Lütfen yönetici ile iletişime geçin.");
      } else {
        /*
         * Bilinmeyen kod. Kodu MESAJIN İÇİNE yazıyoruz: telefondaki bir müşteri
         * konsolu açamaz, ama ekran görüntüsünü gönderebilir. Sadece "SMS
         * gönderilemedi" demek, teşhis için gereken tek bilgiyi atmak demekti.
         */
        toast.error(
          code
            ? `SMS gönderilemedi (${code}). Lütfen tekrar deneyin.`
            : "SMS gönderilemedi. Lütfen tekrar deneyin."
        );
      }

      /*
       * Explicit failure, always. The two callers below stay on the screen the
       * customer is already looking at, so a failed send is a retry rather than
       * a dead end — including on the registration path, where silently
       * advancing to an OTP screen with no code on its way would look like the
       * account was created.
       */
      return false;
    }
  }

  /**
   * STEP 1 — phone entry. This is the fork.
   *
   * The existence check runs BEFORE Firebase is touched, so an unregistered
   * number costs no SMS and lands on a real "kayıtlı hesap bulunamadı" screen
   * instead of the opaque verification failure it used to produce.
   */
  async function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault();

    const fullPhone = resolvePhone();
    if (!fullPhone) return;
    if (!firebaseConfigOk()) return;

    setLoading(true);
    try {
      const outcome = await checkExistingAccount(fullPhone);

      // The check already toasted a real, actionable message. Stay put.
      if (outcome === "failed") return;

      if (outcome === "missing") {
        // Nothing is created here and nothing is assumed — the customer is
        // shown the state and chooses. Explicitly clear any stale pending
        // registration so this number cannot inherit an earlier attempt's name.
        setPendingRegistration(null);
        setCheckedPhone(fullPhone);
        setStep("notfound");
        return;
      }

      // Known customer: the path below is byte-for-byte the one that already
      // worked — same verifier, same signInWithPhoneNumber, same OTP step.
      await sendOtp(fullPhone);
    } finally {
      setLoading(false);
    }
  }

  /** "Kayıt Ol" from the not-registered screen. Phone stays as typed. */
  function handleStartRegistration() {
    setRegisterName("");
    setKvkkChecked(false);
    setStep("register");
  }

  /**
   * STEP 2 (new customers) — registration form submit.
   *
   * Deliberately does NOT create the Customer row: it validates, remembers the
   * name in `pendingRegistration`, and asks Firebase for an SMS. Phone
   * ownership is proved first; `verifyCode` commits afterwards.
   */
  async function handleRegisterSubmit(e: React.FormEvent) {
    e.preventDefault();

    // The SAME schema `registerCustomer` (staff side) applies, imported rather
    // than re-typed — and re-checked server-side by /api/customer/auth, because
    // a Route Handler is public and this check is only a courtesy.
    const parsedName = CustomerNameSchema.safeParse(registerName);
    if (!parsedName.success) {
      toast.error(parsedName.error.issues[0]?.message ?? "Geçerli bir ad girin.");
      return;
    }

    // Mirrors KvkkConsentSchema's `refine(val === true)`. Consent must be an
    // explicit affirmative act; there is no path that infers it.
    if (!kvkkChecked) {
      toast.error(KVKK_REQUIRED_MESSAGE);
      return;
    }

    const fullPhone = resolvePhone();
    if (!fullPhone) return;
    if (!firebaseConfigOk()) return;

    setLoading(true);
    try {
      setPendingRegistration({ name: parsedName.data });
      const sent = await sendOtp(fullPhone);
      if (!sent) {
        // No code went out, so there is nothing to verify and nothing to
        // commit. Drop the pending registration rather than leave a name
        // attached to a future, unrelated OTP.
        setPendingRegistration(null);
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
    // Back to the entry screen the customer came from — a self-registering
    // customer keeps their name and consent, and simply re-submits.
    handleGoBackToEntry();
  }

  const activeCell = Math.min(otp.length, OTP_LENGTH - 1);

  return (
    <div className="space-y-6">
      {/*
        IMPORTANT: This div is ALWAYS in the DOM — never conditionally rendered.
        It is referenced via recaptchaContainerRef (not a string id) so React
        never unmounts it between step 1 and step 2, preventing duplicate-widget
        errors caused by Firebase re-scanning the DOM.
        React must also never own its children: each verifier is rendered into a
        throw-away <div> that createRecaptcha appends here and destroyRecaptcha
        removes, which is why this element is left empty in JSX. Reusing one node
        for two widgets is exactly what triggers "reCAPTCHA has already been
        rendered in this element".
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

      {identityOffer ? (
        /*
          Someone is already signed in on this browser. Name them and let the
          visitor decide — never assume the session belongs to whoever is
          holding the phone right now.
        */
        <div className="space-y-5">
          <div className="rounded-xl bg-white/10 border border-white/20 p-4 space-y-1">
            <p className="text-xs text-green-300/80">
              Bu cihazda zaten açık bir oturum var:
            </p>
            <p className="text-white font-semibold text-base">
              {identityOffer.name}
            </p>
            <p className="text-green-400 text-xs">{identityOffer.maskedPhone}</p>
          </div>

          <p className="text-sm text-green-300/80">
            Bu hesap size ait değilse{" "}
            <span className="text-white font-medium">
              &quot;Farklı numarayla giriş yap&quot;
            </span>{" "}
            seçeneğini kullanın.
          </p>

          <button
            id="continue-as-existing-btn"
            type="button"
            onClick={handleContinueAsExisting}
            className="w-full py-3 px-6 rounded-xl bg-green-500 hover:bg-green-400 active:scale-[0.98] text-white font-semibold text-base shadow-lg shadow-green-900/40 transition-all duration-200"
          >
            {identityOffer.name} olarak devam et
          </button>

          <button
            id="use-different-number-btn"
            type="button"
            onClick={handleUseDifferentNumber}
            disabled={switchingAccount}
            className="w-full py-3 px-6 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-medium text-sm transition-all disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {switchingAccount ? (
              <>
                <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                Oturum kapatılıyor...
              </>
            ) : (
              "Farklı numarayla giriş yap"
            )}
          </button>
        </div>
      ) : step === "phone" ? (
        <form onSubmit={handlePhoneSubmit} className="space-y-5">
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
                Devam Et
              </>
            )}
          </button>
        </form>
      ) : step === "notfound" ? (
        /*
          Reached ONLY on a positive `{ exists: false }` from the backend — a
          lookup that merely failed stays on the phone step with a retry, so a
          registered customer is never told to create a second account.
        */
        <CustomerNotRegisteredPanel
          phone={checkedPhone}
          onRegister={handleStartRegistration}
          onChangePhone={handleGoBackToPhone}
        />
      ) : step === "register" ? (
        /*
          Customer SELF-registration. Submitting only sends an SMS; the Customer
          row is created by /api/customer/auth after the code verifies. Kept
          entirely separate from the staff-side registerCustomer action, which
          is authorizeStaff-gated and stamps the cashier's branchId.
        */
        <CustomerRegisterStep
          countryCodes={COUNTRY_CODES}
          countryCode={countryCode}
          onCountryCodeChange={setCountryCode}
          phoneNumber={phoneNumber}
          onPhoneNumberChange={setPhoneNumber}
          name={registerName}
          onNameChange={setRegisterName}
          kvkkChecked={kvkkChecked}
          onKvkkChange={setKvkkChecked}
          loading={loading}
          onSubmit={handleRegisterSubmit}
          onBack={handleGoBackToPhone}
        />
      ) : step === "otp" ? (
        <form onSubmit={handleVerifySubmit} className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label htmlFor="otp-input" className="block text-sm font-medium text-green-100">
                Doğrulama Kodu
              </label>
              <button
                type="button"
                onClick={handleGoBackToEntry}
                className="text-xs text-green-300 hover:text-white transition-colors"
              >
                {pendingRegistration ? "← Bilgileri Düzenle" : "← Numarayı Değiştir"}
              </button>
            </div>

            <p className="text-sm text-green-300/80">
              <span className="font-semibold text-white">
                {sentPhone || `${countryCode} ${phoneNumber}`}
              </span>{" "}
              numarasına gönderilen 6 haneli kodu girin.
            </p>

            {pendingRegistration && (
              /*
                Says out loud what the code is FOR. The account does not exist
                yet and will not exist unless this code verifies — a customer
                who closes the page here leaves no record behind.
              */
              <p className="text-xs text-green-300/70">
                Kod doğrulandığında{" "}
                <span className="text-white font-medium">
                  {pendingRegistration.name}
                </span>{" "}
                adına sadakat kartınız oluşturulacak.
              </p>
            )}

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
                {sentPhone || `${countryCode} ${phoneNumber}`}
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
