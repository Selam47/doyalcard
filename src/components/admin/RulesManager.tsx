'use client';

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  createCampaignRule,
  deleteCampaignRule,
  toggleRuleActive,
} from "@/actions/admin";
interface Rule {
  id: string;
  threshold: number;
  rewardName: string;
  isResetPoint: boolean;
  isActive: boolean;
}

interface Props {
  initialRules: Rule[];
}

export function RulesManager({ initialRules }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [rules, setRules] = useState<Rule[]>(initialRules);
  const [syncedRules, setSyncedRules] = useState(initialRules);
  if (initialRules !== syncedRules) {
    setSyncedRules(initialRules);
    setRules(initialRules);
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await createCampaignRule(formData);
      if (r?.success === false) {
        toast.error(r.error ?? "Hata oluştu");
      } else {
        toast.success("Kural oluşturuldu");
        setShowForm(false);
        router.refresh();
      }
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Bu kuralı silmek istediğinizden emin misiniz?")) return;
    startTransition(async () => {
      const result = await deleteCampaignRule(id);
      if (!result || !result.success) {
        toast.error(result?.error ?? "Kural silinemedi");
        return;
      }

      setRules((prev) => prev.filter((rule) => rule.id !== id));
      toast.success("Kural silindi");
      router.refresh();
    });
  }

  function handleToggle(id: string, current: boolean) {
    startTransition(async () => {
      const result = await toggleRuleActive(id, !current);
      if (!result || !result.success) {
        toast.error(result?.error ?? "Kural durumu değiştirilemedi");
        return;
      }
      setRules((prev) =>
        prev.map((rule) => (rule.id === id ? { ...rule, isActive: !current } : rule))
      );
      toast.success(current ? "Kural devre dışı bırakıldı" : "Kural aktif edildi");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* Rules table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Eşik</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Ödül</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Sıfırlama</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Durum</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-green-100 text-green-700 font-bold">
                      {rule.threshold}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-800">
                    {rule.rewardName}
                    {rule.isResetPoint && (
                      <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                        🏆 Grand Prix
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${rule.isResetPoint ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>
                      {rule.isResetPoint ? "Evet" : "Hayır"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggle(rule.id, rule.isActive)}
                      disabled={isPending}
                      className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                        rule.isActive
                          ? "bg-green-100 text-green-700 hover:bg-green-200"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      {rule.isActive ? "✅ Aktif" : "⏸ Pasif"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(rule.id)}
                      disabled={isPending}
                      className="text-xs text-red-600 hover:text-red-800 transition-colors px-2 py-1 rounded hover:bg-red-50"
                    >
                      Sil
                    </button>
                  </td>
                </tr>
              ))}
              {rules.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    Henüz kural eklenmemiş
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add rule form */}
      {showForm ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">Yeni Kural Ekle</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">
                Eşik Değeri (1-100) *
              </label>
              <input
                id="rule-threshold"
                name="threshold"
                type="number"
                min={1}
                max={100}
                required
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">Ödül Adı *</label>
              <input
                id="rule-reward-name"
                name="rewardName"
                type="text"
                required
                placeholder="1 Ücretsiz Ayran"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              />
            </div>
            <div className="col-span-2 flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  id="rule-is-reset"
                  name="isResetPoint"
                  type="checkbox"
                  value="true"
                  className="accent-green-600 w-4 h-4"
                />
                <span className="text-sm text-gray-700">
                  Bu ödül kazanıldığında döngüyü sıfırla (Grand Prix)
                </span>
              </label>
            </div>
            <div className="col-span-2 flex gap-3">
              <button
                id="create-rule-btn"
                type="submit"
                disabled={isPending}
                className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-500 disabled:opacity-50"
              >
                Kaydet
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-5 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200"
              >
                İptal
              </button>
            </div>
          </form>
        </div>
      ) : (
        <button
          id="add-rule-btn"
          onClick={() => setShowForm(true)}
          className="w-full py-3 rounded-xl border-2 border-dashed border-green-300 text-green-700 font-semibold hover:bg-green-50 transition-colors text-sm"
        >
          + Yeni Kural Ekle
        </button>
      )}
    </div>
  );
}
