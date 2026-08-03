// src/lib/firebase.ts
//
// Firebase istemcisi — YALNIZCA tarayıcıda anlamlıdır (Phone Auth + reCAPTCHA).
//
// ─── NEDEN BURADA DOĞRULAMA VAR ──────────────────────────────────────────────
// Bu dosya eskiden `process.env.NEXT_PUBLIC_FIREBASE_API_KEY!` gibi TypeScript
// non-null assertion'ları kullanıyordu. `!` derleme zamanı bir iddiadır;
// ÇALIŞMA ZAMANINDA hiçbir şey yapmaz. Daha kötüsü `authDomain` bir template
// literal ile kuruluyordu:
//
//     authDomain: `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.firebaseapp.com`
//
// Değişken tanımsızsa bu SESSİZCE "undefined.firebaseapp.com" literal string'ini
// üretir. Firebase de bunu geçerli bir alan adı sanıp opak bir hatayla
// başarısız olur ve hiçbir yerde teşhis edilebilir bir iz kalmaz.
//
// Bu, Vercel'de gerçek bir tuzak: NEXT_PUBLIC_* değişkenleri BUILD ANINDA
// bundle'a gömülür. Değişkeni Vercel'e sonradan eklerseniz, YENİDEN DEPLOY
// etmediğiniz sürece eski build'de hâlâ `undefined` durur.

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

/** Eksikse Phone Auth'un çalışma ihtimali olmayan değişkenler. */
const REQUIRED_ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
} as const;

/**
 * Eksik/boş Firebase ortam değişkenlerinin listesi. Boş dizi = yapılandırma
 * tam demektir.
 *
 * Modül seviyesinde THROW ETMİYORUZ: bir client component import'unda atılan
 * hata müşteri giriş sayfasını komple boş ekrana çevirir. Bunun yerine liste
 * dışa aktarılıyor ve giriş formu SMS göndermeye çalışmadan ÖNCE kontrol edip
 * kullanıcıya ve konsola anlaşılır bir mesaj veriyor.
 */
export function getFirebaseConfigIssues(): string[] {
  return Object.entries(REQUIRED_ENV)
    .filter(([, value]) => !value || value.trim() === "")
    .map(([key]) => key);
}

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "";

/**
 * Özel alan adı kullananlar için açık override; yoksa Firebase'in varsayılanı.
 * Template literal ile `undefined.firebaseapp.com` üretmemek için projectId
 * boşken authDomain'i de boş bırakıyoruz — Firebase o durumda net bir
 * `auth/invalid-api-key` / config hatası verir, uydurma bir alan adı değil.
 */
const authDomain =
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
  (projectId ? `${projectId}.firebaseapp.com` : "");

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain,
  projectId,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};

if (typeof window !== "undefined") {
  const missing = getFirebaseConfigIssues();
  if (missing.length > 0) {
    console.error(
      "[firebase] Eksik ortam değişkenleri: " +
        missing.join(", ") +
        ". SMS OTP çalışmayacak. NEXT_PUBLIC_* değişkenleri BUILD ANINDA " +
        "gömülür — Vercel'e ekledikten sonra mutlaka yeniden deploy edin."
    );
  } else {
    // Teşhis için: hangi projeye ve hangi authDomain'e bağlandığımız,
    // "SMS gelmiyor" durumunda ilk bakılacak şeydir.
    console.info(
      `[firebase] project=${firebaseConfig.projectId} authDomain=${firebaseConfig.authDomain}`
    );
  }
}

const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth: Auth = getAuth(app);
export default app;
