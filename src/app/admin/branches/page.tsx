// src/app/admin/branches/page.tsx
import type { Metadata } from "next";
import { getBranches } from "@/actions/admin";
import { BranchManager } from "@/components/admin/BranchManager";

export const metadata: Metadata = { title: "Şube Yönetimi" };

export default async function BranchesPage() {
  const branches = await getBranches();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Şube Yönetimi</h1>
        <p className="text-gray-500 text-sm mt-1">Restoran şubelerini ekleyin veya silin</p>
      </div>
      <BranchManager initialBranches={branches} />
    </div>
  );
}
