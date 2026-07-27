"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { createStaffUser, toggleUserActive, deleteStaffUser } from "@/actions/admin";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  branch: { name: string } | null;
  _count?: { orders: number };
}

interface Props {
  initialUsers: User[];
  branches: { id: string; name: string }[];
  /** Id of the signed-in admin — used to block self-delete in the UI too. */
  currentUserId?: string;
}

export function StaffManager({ initialUsers, branches, currentUserId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  // Mirror the server list locally so a delete/toggle disappears immediately
  // instead of waiting on the router.refresh() round-trip, and re-adopt the
  // server data whenever a fresh render arrives (React's "adjust state on
  // prop change" pattern — no effect, no extra render).
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [syncedUsers, setSyncedUsers] = useState(initialUsers);
  if (initialUsers !== syncedUsers) {
    setSyncedUsers(initialUsers);
    setUsers(initialUsers);
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await createStaffUser(formData);
      if (!r?.success) {
        toast.error(r?.error ?? "Personel oluşturulamadı");
        return;
      }
      toast.success("Personel oluşturuldu");
      setShowForm(false);
      router.refresh();
    });
  }

  function handleToggle(id: string, isActive: boolean, name: string) {
    startTransition(async () => {
      const r = await toggleUserActive(id, isActive);
      // A Server Action can legitimately refuse (self-lockout, last admin).
      // Never report success without looking at what came back.
      if (!r?.success) {
        toast.error(r?.error ?? "Kullanıcı durumu değiştirilemedi");
        return;
      }
      setUsers((prev) =>
        prev.map((u) => (u.id === id ? { ...u, isActive } : u))
      );
      toast.success(`${name} ${isActive ? "aktif edildi" : "devre dışı bırakıldı"}`);
      router.refresh();
    });
  }

  function handleDelete(user: User) {
    if (user.id === currentUserId) {
      toast.error("Kendi hesabınızı silemezsiniz.");
      return;
    }

    const orderCount = user._count?.orders ?? 0;
    const notice =
      orderCount > 0
        ? `\n\n${orderCount} sipariş kaydı silinmeyecek, kullanıcıdan ayrılacak (ciro geçmişi korunur).`
        : "";

    if (
      !confirm(
        `"${user.name}" kullanıcısını silmek istediğinizden emin misiniz?${notice}`
      )
    )
      return;

    startTransition(async () => {
      const r = await deleteStaffUser(user.id);
      if (!r?.success) {
        toast.error(r?.error ?? "Kullanıcı silinemedi");
        return;
      }
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      toast.success(
        r.detachedOrders > 0
          ? `${user.name} silindi — ${r.detachedOrders} sipariş kaydı korundu`
          : `${user.name} silindi`
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Ad</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Rol</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Şube</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Durum</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-800">
                    {user.name}
                    {user.id === currentUserId && (
                      <span className="ml-2 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full align-middle">
                        siz
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{user.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      user.role === "ADMIN" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{user.branch?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggle(user.id, !user.isActive, user.name)}
                      disabled={isPending}
                      className={`text-xs px-2 py-1 rounded-full font-medium ${
                        user.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {user.isActive ? "✅ Aktif" : "⏸ Pasif"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(user)}
                      disabled={isPending || user.id === currentUserId}
                      title={
                        user.id === currentUserId
                          ? "Kendi hesabınızı silemezsiniz"
                          : "Kullanıcıyı sil"
                      }
                      className="text-xs text-red-600 hover:text-red-800 px-2 py-1 rounded hover:bg-red-50 disabled:text-gray-300 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                    >
                      Sil
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    Henüz personel eklenmemiş
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">Yeni Personel Ekle</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600">Ad Soyad *</label>
              <input id="new-staff-name" name="name" required className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Email *</label>
              <input id="new-staff-email" name="email" type="email" required className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Şifre *</label>
              <input id="new-staff-password" name="password" type="password" minLength={8} required className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Rol *</label>
              <select id="new-staff-role" name="role" className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-400">
                <option value="STAFF">Personel (STAFF)</option>
                <option value="ADMIN">Yönetici (ADMIN)</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-600">Şube</label>
              <select id="new-staff-branch" name="branchId" className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-400">
                <option value="">Şube Seçin (Opsiyonel)</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2 flex gap-3">
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
          id="add-staff-btn"
          onClick={() => setShowForm(true)}
          className="w-full py-3 rounded-xl border-2 border-dashed border-purple-300 text-purple-700 font-semibold hover:bg-purple-50 transition-colors text-sm"
        >
          + Yeni Personel Ekle
        </button>
      )}
    </div>
  );
}
