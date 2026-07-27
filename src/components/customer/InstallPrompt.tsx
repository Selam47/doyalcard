"use client";

import { useEffect, useState, useCallback } from "react";
import { X, Share, PlusSquare } from "lucide-react";

// Minimal shape of the `beforeinstallprompt` event — not yet part of the
// standard DOM lib types.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "doyalcard:install-prompt-dismissed-at";
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 gün

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari-specific flag
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !("MSStream" in window);
}

function wasRecentlyDismissed() {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const dismissedAt = Number(raw);
  if (Number.isNaN(dismissedAt)) return false;
  return Date.now() - dismissedAt < DISMISS_TTL_MS;
}

/**
 * Subtle "Ana Ekrana Ekle" banner shown on the customer card view.
 * - Android/Chrome: captures `beforeinstallprompt` and triggers the native
 *   install flow.
 * - iOS Safari: has no install event, so we show short manual instructions
 *   (Share -> Ana Ekrana Ekle) instead.
 * Dismissed state is remembered in localStorage for a week so it never
 * becomes annoying.
 */
export function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [ios, setIos] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || wasRecentlyDismissed()) return;

    if (isIos()) {
      // Intentional pre-paint sync from an external signal (the user agent);
      // the rule only flags the first call in the block.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIos(true);
      setVisible(true);
      return;
    }

    const handler = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = useCallback(() => {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setVisible(false);
  }, [deferredPrompt]);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Ana ekrana ekle"
      className="mx-auto max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300"
    >
      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3 backdrop-blur-sm shadow-lg">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-lg">
          🫓
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">Ana Ekrana Ekle</p>
          {ios ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-white/70">
              Safari&apos;de
              <Share className="inline size-3.5 shrink-0" aria-hidden />
              paylaş simgesine, ardından
              <PlusSquare className="inline size-3.5 shrink-0" aria-hidden />
              &quot;Ana Ekrana Ekle&quot;ye dokunun.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-white/70">
              Kartınıza tek dokunuşla erişin, uygulama gibi kullanın.
            </p>
          )}
        </div>

        {!ios && (
          <button
            type="button"
            onClick={handleInstall}
            className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-green-950 transition-colors hover:bg-white/90 active:translate-y-px"
          >
            Ekle
          </button>
        )}

        <button
          type="button"
          onClick={dismiss}
          aria-label="Kapat"
          className="shrink-0 rounded-md p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}