"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { createBranch, deleteBranch } from "@/actions/admin";

interface Branch {
  id: string;
  name: string;
  location: string | null;
  _count: { users: number; customers: number };
}

export function BranchManager({ initialBranches }: { initialBranches: Branch[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await createBranch(formData);
      if (r?.success === false) toast.error(r.error);
      else { toast.success("Şube oluşturuldu"); setShowForm(false); router.refresh(); }
    });
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`"${name}" şubesini silmek istediğinizden emin misiniz?`)) return;
    startTransition(async () => {
      await deleteBranch(id);
      toast.success("Şube silindi");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        {initialBranches.map((branch) => (
          <div key={branch.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-gray-800">{branch.name}</h3>
                {branch.location && (
                  <p className="text-sm text-gray-500 mt-0.5">📍 {branch.location}</p>
                )}
              </div>
              <button
                onClick={() => handleDelete(branch.id, branch.name)}
                disabled={isPending}
                className="text-xs text-red-400 hover:text-red-600 transition-colors"
              >
                Sil
              </button>
            </div>
            <div className="flex gap-3 mt-4">
              <div className="text-center bg-blue-50 rounded-xl px-3 py-2 flex-1">
                <div className="font-bold text-blue-700">{branch._count.users}</div>
                <div className="text-xs text-gray-500">Personel</div>
              </div>
              <div className="text-center bg-green-50 rounded-xl px-3 py-2 flex-1">
                <div className="font-bold text-green-700">{branch._count.customers}</div>
                <div className="text-xs text-gray-500">Müşteri</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showForm ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">Yeni Şube Ekle</h3>
          <form onSubmit={handleCreate} className="space-y-3">
            <input
              id="branch-name"
              name="name"
              type="text"
              required
              placeholder="Şube Adı *"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
            />
            <input
              id="branch-location"
              name="location"
              type="text"
              placeholder="Konum (opsiyonel)"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
            />
            <div className="flex gap-3">
              <button type="submit" disabled={isPending} className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-500 disabled:opacity-50">
                Kaydet
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="px-5 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm">
                İptal
              </button>
            </div>
          </form>
        </div>
      ) : (
        <button
          id="add-branch-btn"
          onClick={() => setShowForm(true)}
          className="w-full py-3 rounded-xl border-2 border-dashed border-blue-300 text-blue-700 font-semibold hover:bg-blue-50 transition-colors text-sm"
        >
          + Yeni Şube Ekle
        </button>
      )}
    </div>
  );
}
