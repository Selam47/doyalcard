// src/lib/session-cookie.ts
//
// "Kalıcı olmayan oturum" politikasının tek kaynağı.
//
// Bu projede oturum verisi ASLA localStorage/sessionStorage'da tutulamaz:
// hem müşteri (`customer_session`) hem personel (NextAuth) oturumu HTTP-only
// cookie'dir ve doğrulaması sunucuda yapılır. Sunucu sessionStorage'ı okuyamaz,
// dolayısıyla oturumu oraya taşımak XSS ile çalınabilir bir token üretmekten
// başka bir işe yaramaz.
//
// Bunun yerine iki katman kullanıyoruz:
//
//   1. Cookie'den `Expires` / `Max-Age` niteliklerini kaldırıyoruz. Bu cookie'yi
//      bir *session cookie* yapar; tarayıcı tamamen kapandığında silinir.
//   2. Sekme bazlı davranış için `TabSessionGuard` (client) her yeni sekmede
//      `/api/session/reset` çağırıp cookie'leri düşürür. Sekme kapanışı
//      sunucuya bildirilemeyeceği için (`beforeunload` güvenilmezdir ve F5'te
//      de tetiklenir) doğru yaklaşım budur: kapanışı yakalamak yerine yeni bir
//      sekme AÇILDIĞINI tespit etmek.
//
// Bu modül middleware'den (Edge runtime) de import edildiği için saf string
// işlemleri dışında hiçbir Node.js API'si kullanamaz.

/** Müşteri portalının HTTP-only oturum cookie'si. */
export const CUSTOMER_SESSION_COOKIE = "customer_session";

/**
 * NextAuth v5 oturum cookie'si. Prod'da `__Secure-` öneki alır ve token 4KB'ı
 * aşarsa `.0`, `.1` ... şeklinde parçalanır — üç varyantı da yakalamalıyız.
 */
const AUTH_SESSION_COOKIE_PATTERN =
  /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/;

/**
 * Hangi oturum sınıfı hedefleniyor?
 *
 *  • "customer" — sadece müşteri portalının cookie'si.
 *  • "staff"    — sadece NextAuth personel/yönetici cookie'si.
 *  • "all"      — ikisi de. `stripSessionCookiePersistence` için tek doğru
 *                 değer budur: `Expires` sökme politikası her iki oturum
 *                 türü için de geçerli.
 */
export type SessionScope = "customer" | "staff" | "all";

/** Bu cookie "kalıcı olmayan oturum" politikasına tabi mi? */
export function isSessionScopedCookie(
  name: string,
  scope: SessionScope = "all"
): boolean {
  const isCustomer = name === CUSTOMER_SESSION_COOKIE;
  const isStaff = AUTH_SESSION_COOKIE_PATTERN.test(name);

  if (scope === "customer") return isCustomer;
  if (scope === "staff") return isStaff;
  return isCustomer || isStaff;
}

/** Gövdeden/parametreden gelen serbest metni güvenli bir scope'a indirger. */
export function parseSessionScope(value: unknown): SessionScope {
  return value === "customer" || value === "staff" ? value : "all";
}

/** `Expires=` veya `Max-Age=` niteliği mi? (cookie'nin adı/değeri değil) */
function isPersistenceAttribute(part: string): boolean {
  return /^\s*(?:expires|max-age)\s*=/i.test(part);
}

/**
 * Giden `Set-Cookie` başlıklarını yeniden yazar: oturum cookie'lerinden
 * `Expires` / `Max-Age` niteliklerini söker.
 *
 * Neden gerekli: Auth.js oturum cookie'sini her zaman `expires` ile yazar
 * (`sessionStore.chunk(token, { expires: newExpires })`), ve bu değer
 * `cookies.sessionToken.options` içine konan ayarları EZER. Yani NextAuth
 * config'inden "kalıcı olmasın" demek mümkün değil; başlığı çıkışta düzeltmek
 * gerekiyor.
 *
 * SİLME cookie'lerine dokunulmaz (`Max-Age=0` / boş değer). Onlardan expiry'yi
 * kaldırmak logout'u bozar — cookie hiç silinmez.
 */
export function stripSessionCookiePersistence<T extends Response>(response: T): Response {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  if (setCookies.length === 0) return response;

  let changed = false;

  const rewritten = setCookies.map((cookie) => {
    const separator = cookie.indexOf("=");
    if (separator === -1) return cookie;

    const name = cookie.slice(0, separator).trim();
    if (!isSessionScopedCookie(name)) return cookie;

    const parts = cookie.split(";");
    const value = parts[0].slice(separator + 1).trim();

    // Silme cookie'si → olduğu gibi bırak.
    if (value === "" || value === '""' || /(?:^|;)\s*max-age\s*=\s*0\s*(?:;|$)/i.test(cookie)) {
      return cookie;
    }

    const kept = parts.filter((part, index) => index === 0 || !isPersistenceAttribute(part));
    if (kept.length === parts.length) return cookie;

    changed = true;
    return kept.join(";");
  });

  if (!changed) return response;

  // Headers'ı yerinde değiştirmek yerine kopyalıyoruz: redirect yanıtlarının
  // header'ları "immutable" guard taşıyabilir ve `.delete()` sessizce/hata ile
  // başarısız olur.
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  for (const cookie of rewritten) headers.append("set-cookie", cookie);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
