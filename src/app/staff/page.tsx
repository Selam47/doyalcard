import type { Metadata } from "next";
import { QrScannerSection } from "@/components/staff/QrScannerSection";
import { PhoneSearchSection } from "@/components/staff/PhoneSearchSection";
import { DeletedCustomerToast } from "@/components/staff/DeletedCustomerToast";
import { RecentActivitySection } from "@/components/staff/RecentActivitySection";
import { NearRewardSection } from "@/components/staff/NearRewardSection";

export const metadata: Metadata = { title: "Personel Paneli" };

interface Props {
  searchParams: Promise<{ deleted?: string | string[] }>;
}

export default async function StaffPage({ searchParams }: Props) {
  const { deleted } = await searchParams;
  const deletedName =
    typeof deleted === "string" && deleted.length > 0 ? deleted : null;

  return (
    <div className="space-y-6">
      {deletedName && <DeletedCustomerToast customerName={deletedName} />}

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

      {/* Glanceable branch context under the two action tools. Both fetch
          their own data client-side (Server Actions + polling), so they never
          block the scanner above from rendering. */}
      <div className="grid gap-6 md:grid-cols-2 items-start">
        <RecentActivitySection />
        <NearRewardSection />
      </div>
    </div>
  );
}
