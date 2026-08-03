"use client";

// src/components/auth/TabSessionGuard.tsx
//
// "Sekme kapanınca oturum bitsin" politikasının client tarafı.
//
// NEDEN sessionStorage'a oturum KOYMUYORUZ:
// Oturum HTTP-only bir cookie ve doğrulaması sunucuda yapılıyor. Sunucu
// sessionStorage'ı okuyamaz; token'ı oraya taşımak onu JS'ten okunabilir —
// yani XSS ile çalınabilir — hale getirir ve /card, /staff, /admin sayfalarının
// server-side guard'larını çalışamaz duruma sokar. sessionStorage'ı bu yüzden
// sadece bir İŞARET (marker) olarak kullanıyoruz, veri deposu olarak değil.
//
// NEDEN `beforeunload` KULLANMIYORUZ:
// F5 ve her sayfa geçişinde de tetiklenir, mobilde sekme kapanışında çoğu zaman
// hiç tetiklenmez, ve unload sırasında atılan istek iptal edilebilir. Kapanışı
// yakalamak yerine tersini yapıyoruz: yeni bir sekmenin AÇILDIĞINI tespit
// ediyoruz. sessionStorage sekme başına izoledir ve sekme kapanınca silinir —
// yani "işaret yoksa bu taze bir sekmedir" güvenilir bir testtir ve F5'i yanlış
// pozitif üretmez (yenilemede sessionStorage korunur).

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const TAB_MARKER_KEY = "doyalcard.tab-session";

/** Personel oturumu gerektiren, /login'e yönlendirilecek yollar. */
const STAFF_PREFIXES = ["/staff", "/admin"] as const;

/** Müşteri oturumu gerektiren, /customer/login'e yönlendirilecek yollar. */
const CUSTOMER_PREFIXES = ["/customer/dashboard", "/card"] as const;

/** Segment-aware: "/staff" matches "/staff/x" but not "/staffroom". */
function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function loginTargetFor(pathname: string, search = ""): string | null {
  if (STAFF_PREFIXES.some((prefix) => isUnder(pathname, prefix))) return "/login";
  if (CUSTOMER_PREFIXES.some((prefix) => isUnder(pathname, prefix))) {
    if (isUnder(pathname, "/card")) {
      const params = new URLSearchParams({ callbackUrl: `${pathname}${search}` });
      return `/customer/login?${params.toString()}`;
    }
    return "/customer/login";
  }
  return null;
}

/**
 * Kontrol sayfa yüklemesi başına TAM OLARAK bir kez çalışmalı ve sonucu her
 * çağırana aynı şekilde dönmeli. Modül seviyesinde bir promise tutmamızın
 * sebebi React Strict Mode: dev'de effect'ler iki kez çalışır, bunu effect
 * içindeki bir bayrakla korumaya çalışırsak ilk kopya iptal edilir, ikincisi
 * "işaret zaten var" görüp yönlendirmeyi atlar ve taze sekmede eski içerik
 * ekranda kalır. Promise'i paylaşınca ikinci kopya da doğru sonucu alır.
 */
let tabCheckPromise: Promise<"fresh" | "resumed"> | null = null;

function runTabCheck(): Promise<"fresh" | "resumed"> {
  if (tabCheckPromise) return tabCheckPromise;

  tabCheckPromise = (async () => {
    let alreadySeen: string | null = null;
    try {
      alreadySeen = window.sessionStorage.getItem(TAB_MARKER_KEY);
      window.sessionStorage.setItem(TAB_MARKER_KEY, "1");
    } catch {
      // Gizli mod / storage kapalı: işaret konulamıyorsa her yükleme "taze
      // sekme" sayılır. Fail-closed — kullanıcı fazladan giriş yapar, oturum
      // kazara kalıcı hale gelmez.
    }

    if (alreadySeen) return "resumed" as const;

    try {
      // Taze sekme → sunucudaki oturumu düşür.
      await fetch("/api/session/reset", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch {
      // Ağ hatası olsa bile yönlendirmeye devam: kullanıcı yeniden giriş
      // yapacak ve cookie o sırada zaten yenilenecek.
    }

    return "fresh" as const;
  })();

  return tabCheckPromise;
}

export function TabSessionGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const isProtected = loginTargetFor(pathname) !== null;

  // Korumalı sayfalarda içerik, sekme kontrolü bitene kadar GİZLENİR.
  // Sunucu oturumu hâlâ geçerli olduğu için sayfa dolu olarak render edilir;
  // bu kapı olmadan taze bir sekmede kasa ekranı bir an için görünür.
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void runTabCheck().then((result) => {
      if (cancelled) return;

      // Hedefi window.location'dan okuyoruz ki effect'in bağımlılığı olmasın
      // ve sekme başına tek sefer çalışsın, her rota değişiminde değil.
      const target =
        result === "fresh"
          ? loginTargetFor(window.location.pathname, window.location.search)
          : null;

      if (target) {
        // replace(): geri tuşuyla "hâlâ girişli" görünen sayfaya dönülmesin.
        window.location.replace(target);
        return;
      }

      setChecked(true);
    });

    return () => {
      cancelled = true;
    };
    // Kasıtlı olarak boş: bu kontrol sekme başına bir kez çalışmalı.
  }, []);

  if (isProtected && !checked) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-[#0B2B1B]"
        role="status"
        aria-live="polite"
      >
        <span className="sr-only">Oturum doğrulanıyor…</span>
        <span className="animate-spin inline-block w-6 h-6 border-2 border-white/70 border-t-transparent rounded-full" />
      </div>
    );
  }

  return <>{children}</>;
}
