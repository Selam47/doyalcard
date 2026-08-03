"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Html5Qrcode } from "html5-qrcode";

const CONTAINER_ID = "qr-scanner-container";

/**
 * Müşterinin QR'ı public /card/<uuid> adresini kodlar — müşterinin kendi
 * telefonunun açtığı adres budur. Personel taradığında ise işlem yüzeyine,
 * yani /staff/customer/<uuid> adresine yönlendiriyoruz. Bu yeniden yazma
 * KASITLI olarak burada, istemcide yapılır; /card/[uuid] sayfası personele
 * dahi kasa terminaline giden bir bağlantı RENDER ETMEZ (bkz. CLAUDE.md §3).
 */
const CARD_UUID_PATTERN = /\/card\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export function QrScannerSection() {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  /**
   * Çözülen ilk QR'ı mandallar.
   *
   * html5-qrcode başarı geri çağrısını saniyede `fps` kez tetikler ve
   * `stopScanner()` asenkrondur — durdurma tamamlanana kadar geri çağrı
   * defalarca çalışabiliyordu. Mandal olmadan tek bir tarama arka arkaya
   * birden fazla `router.push` üretir; Next.js router bu yarışta gezinmeyi
   * iptal edip yerinde sayabiliyor, yani "hiçbir şey olmuyor" belirtisi.
   */
  const handledRef = useRef(false);

  /**
   * SADECE kamerayı söker — React state'ine DOKUNMAZ.
   *
   * Bu ayrım şart: teardown effect temizliğinden de çağrılıyor ve orada
   * `setScanning(false)` çağırmak React Strict Mode'da (dev'de effect'ler iki
   * kez çalışır) ilk kopyanın temizliğinin taramayı daha başlar başlamaz
   * kapatmasına yol açıyordu.
   */
  const teardownScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try {
      await scanner.stop();
      scanner.clear();
    } catch {
      /* zaten durmuş ya da hiç başlamamış olabilir — sorun değil */
    }
  }, []);

  function startScanner() {
    setError(null);
    handledRef.current = false;
    // Gerçek başlatma aşağıdaki effect'te. Bkz. oradaki açıklama.
    setScanning(true);
  }

  /** "Taramayı Durdur" düğmesi: state'i kapat, teardown'ı effect yapar. */
  function stopScanner() {
    setScanning(false);
  }

  /**
   * Kamerayı `scanning` true olarak RENDER EDİLDİKTEN SONRA başlatıyoruz.
   *
   * Eskiden `startScanner()` içinde `setScanning(true)` ile aynı tick'te
   * `new Html5Qrcode()` ve `scanner.start()` çağrılıyordu. React state
   * güncellemeleri toplu (batched) uygulandığı için kapsayıcı o anda hâlâ
   * `hidden` (display:none) durumdaydı; html5-qrcode tarama bölgesinin
   * genişliğini 0 ölçüp sessizce kurulamıyordu. Effect'e taşımak, DOM'un
   * görünür hâle geldiğini garanti eder.
   */
  useEffect(() => {
    if (!scanning) return;

    let cancelled = false;

    (async () => {
      try {
        const scanner = new Html5Qrcode(CONTAINER_ID);
        if (cancelled) return;
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            if (handledRef.current) return;
            const match = decodedText.match(CARD_UUID_PATTERN);
            if (!match?.[1]) return;

            handledRef.current = true;
            // Gezinmeyi beklemeden tetikliyoruz; kamerayı kapatmak
            // `setScanning(false)` üzerinden effect temizliğine düşer.
            router.push(`/staff/customer/${match[1]}`);
            setScanning(false);
          },
          () => {}
        );

        // Başlatma tamamlanana kadar effect iptal edilmiş olabilir
        // (unmount ya da Strict Mode'un ikinci koşusu) — o durumda hemen sök.
        if (cancelled) void teardownScanner();
      } catch (err) {
        if (cancelled) return;
        console.error("[QR scanner] başlatılamadı:", err);
        setScanning(false);
        setError("Kamera erişilemedi. Lütfen tarayıcı izinlerini kontrol edin.");
      }
    })();

    return () => {
      cancelled = true;
      void teardownScanner();
    };
  }, [scanning, router, teardownScanner]);

  return (
    <div className="bg-white rounded-2xl shadow-md overflow-hidden">
      <div className="bg-gradient-to-r from-green-700 to-emerald-600 px-5 py-4">
        <h2 className="text-white font-semibold flex items-center gap-2">
          <span className="text-lg">📷</span> QR Kod Tarayıcı
        </h2>
        <p className="text-green-200 text-xs mt-0.5">
          Müşterinin QR kodunu kamerayla tarayın
        </p>
      </div>

      <div className="p-5 space-y-4">
        {/* Scanner viewport */}
        <div
          id={CONTAINER_ID}
          className={`rounded-xl overflow-hidden bg-gray-900 ${
            scanning ? "block" : "hidden"
          }`}
          style={{ minHeight: "280px" }}
        />

        {!scanning && (
          <div className="flex flex-col items-center justify-center py-8 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
            <span className="text-5xl mb-3">📱</span>
            <p className="text-gray-500 text-sm text-center">
              Müşterinin telefonundaki QR kodu kamerayla okutun
            </p>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            ⚠️ {error}
          </p>
        )}

        <button
          id={scanning ? "stop-scanner-btn" : "start-scanner-btn"}
          onClick={scanning ? stopScanner : startScanner}
          className={`w-full py-3 rounded-xl font-semibold text-sm transition-all ${
            scanning
              ? "bg-red-100 text-red-700 hover:bg-red-200"
              : "bg-green-600 text-white hover:bg-green-500 shadow-md"
          }`}
        >
          {scanning ? "⏹ Taramayı Durdur" : "▶ Taramayı Başlat"}
        </button>
      </div>
    </div>
  );
}
