import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <span className="text-6xl mb-5">🔍</span>
      <h1 className="text-xl font-bold text-gray-800 mb-2">
        Müşteri Bulunamadı
      </h1>
      <p className="text-gray-500 text-sm mb-8">
        Bu QR kod geçersiz veya müşteri kaydı silinmiş olabilir.
      </p>
      <Link
        href="/staff"
        className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl font-semibold transition-colors"
      >
        Personel Paneline Dön
      </Link>
    </div>
  );
}
