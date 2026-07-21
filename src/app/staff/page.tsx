// src/app/staff/page.tsx
import type { Metadata } from "next";
import { QrScannerSection } from "@/components/staff/QrScannerSection";
import { PhoneSearchSection } from "@/components/staff/PhoneSearchSection";

export const metadata: Metadata = { title: "Personel Paneli" };

export default function StaffPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Müşteri İşlemleri</h1>
        <p className="text-gray-500 text-sm mt-1">
          QR kodu tarayın veya telefon numarasıyla arama yapın
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <QrScannerSection />
        <PhoneSearchSection />
      </div>
    </div>
  );
}
