// src/app/admin/staff/page.tsx
import type { Metadata } from "next";

import { getStaffUsers, getBranches } from "@/actions/admin";
import { StaffManager } from "@/components/admin/StaffManager";

export const metadata: Metadata = { title: "Personel Yönetimi" };

export default async function StaffManagementPage() {
  const [users, branches] = await Promise.all([getStaffUsers(), getBranches()]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Personel Yönetimi</h1>
        <p className="text-gray-500 text-sm mt-1">Personel hesaplarını ekleyin veya yönetin</p>
      </div>
      <StaffManager
        initialUsers={users}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      />
    </div>
  );
}
