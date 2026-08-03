import { handlers } from "@/lib/auth";
import { stripSessionCookiePersistence } from "@/lib/session-cookie";

import type { NextRequest } from "next/server";

// NextAuth oturum cookie'sini HER çıkışta session-scoped hale getiriyoruz.
// Auth.js cookie'yi `expires` ile yazar ve bu değer `cookies.sessionToken.options`
// içindeki ayarları ezer — dolayısıyla config üzerinden kapatılamaz, başlığı
// burada düzeltmek gerekir. Sign-in / session yenileme / callback, hepsi bu
// handler'dan geçtiği için tek nokta yeterli.

export async function GET(req: NextRequest) {
  return stripSessionCookiePersistence(await handlers.GET(req));
}

export async function POST(req: NextRequest) {
  return stripSessionCookiePersistence(await handlers.POST(req));
}
