import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-green-950 to-emerald-800 text-white p-6">
      <span className="text-7xl mb-6">🔍</span>
      <h1 className="text-2xl font-bold mb-2">Kart Bulunamadı</h1>
      <p className="text-green-300 text-sm mb-8 text-center">
        Bu QR kod geçersiz veya müşteri kaydı silinmiş olabilir.
      </p>
      {/*
        Customer-facing route: this page must not advertise the staff panel.
        Anyone reaching it lands back on the customer surface instead.
      */}
      <Link
        href="/customer/dashboard"
        className="px-6 py-3 bg-green-500 hover:bg-green-400 rounded-xl font-semibold transition-colors"
      >
        Kartıma Dön
      </Link>
    </div>
  );
}
