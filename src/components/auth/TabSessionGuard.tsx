"use client";



import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const TAB_MARKER_KEY = "doyalcard.tab-session";

/** Personel oturumu gerektiren, /login'e yönlendirilecek yollar. */
const STAFF_PREFIXES = ["/staff", "/admin"] as const;

/**
 * Müşteri oturumu gerektiren, /customer/login'e yönlendirilecek yollar.
 *
 * DİKKAT: `/card` bu listede DEĞİL ve asla eklenmemeli. /card/<uuid> herkese
 * açık, salt-okunur bir sayfadır ve oturum gerektirmez. Üstelik ham kamera
 * taraması bu adresi HER ZAMAN yeni bir sekmede açar; burada listelenseydi
 * `runTabCheck()` her taramayı "taze sekme" sayıp müşteriyi /customer/login'e
 * fırlatırdı — yani ürünün ana akışı hiç çalışmazdı. Sayfanın kendisi de
 * sunucuda hiçbir oturum okumuyor (src/app/card/[uuid]/page.tsx), bu iki taraf
 * birlikte "QR tarayan kişi kartını görür" garantisini veriyor.
 */
const CUSTOMER_PREFIXES = ["/customer/dashboard"] as const;

/** Segment-aware: "/staff" matches "/staff/x" but not "/staffroom". */
function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Sekme sıfırlaması HANGİ oturum sınıfını düşürmeli?
 *
 * Kural: sekmenin indiği sayfanın sahibi olan oturum sınıfı silinir. Nötr
 * sayfalarda (/, /login, /customer/login) korunacak bir bağlam yok, orada
 * eski davranış — hepsini sil — geçerli kalır.
 *
 * /card hiç buraya gelmez; PUBLIC_PREFIXES sayesinde sıfırlama o yolda hiç
 * çalışmaz (aşağıya bakınız).
 */
type ResetScope = "customer" | "staff" | "all";

/**
 * Sekme sıfırlamasının hiç çalışmaması gereken, herkese açık yollar.
 *
 * /card/<uuid> oturumsuz ve salt-okunur bir sayfa: ne bir oturum okuyor ne de
 * koruyacak bir bağlamı var. Ham kamera taraması burayı her seferinde YENİ bir
 * sekmede açtığı için, sıfırlama çalışsaydı her QR okutma ya kasiyerin personel
 * oturumunu ya da müşterinin panel oturumunu sessizce düşürürdü. Bu yüzden
 * burada /api/session/reset'e istek bile atmıyoruz.
 */
const PUBLIC_PREFIXES = ["/card"] as const;

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => isUnder(pathname, prefix));
}

function resetScopeFor(pathname: string): ResetScope {
  if (STAFF_PREFIXES.some((prefix) => isUnder(pathname, prefix))) return "staff";
  if (CUSTOMER_PREFIXES.some((prefix) => isUnder(pathname, prefix))) {
    return "customer";
  }
  return "all";
}

/**
 * Hangi login ekranına gidilecek? `null` → yönlendirme yok.
 *
 * /card asla buradan bir hedef almaz: herkese açık olduğu için hem
 * PUBLIC_PREFIXES ile korunuyor hem de CUSTOMER_PREFIXES'te yer almıyor.
 */
function loginTargetFor(pathname: string): string | null {
  if (isPublicPath(pathname)) return null;
  if (STAFF_PREFIXES.some((prefix) => isUnder(pathname, prefix))) return "/login";
  if (CUSTOMER_PREFIXES.some((prefix) => isUnder(pathname, prefix))) {
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

    // Herkese açık sayfada inen taze sekme hiçbir oturumu düşürmez. QR
    // taraması her zaman yeni sekme açtığı için buradaki bir sıfırlama,
    // taramayı yapan kişinin (kasiyer ya da müşteri) mevcut oturumunu
    // kazara sonlandırırdı.
    if (isPublicPath(window.location.pathname)) return "resumed" as const;

    try {
      // Taze sekme → sunucudaki oturumu düşür. Scope, sekmenin İNDİĞİ yola
      // göre belirlenir; window.location kullanıyoruz çünkü bu kontrol sekme
      // başına bir kez, ilk yüklemede çalışır.
      await fetch("/api/session/reset", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: resetScopeFor(window.location.pathname) }),
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
        result === "fresh" ? loginTargetFor(window.location.pathname) : null;

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
