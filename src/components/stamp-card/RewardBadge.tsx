import { formatDate } from "@/lib/utils";

interface Reward {
  id: string;
  status: string;
  createdAt: Date;
  claimedAt: Date | null;
  rule: { rewardName: string };
}

export function RewardBadge({ reward }: { reward: Reward }) {
  const isPending = reward.status === "PENDING";

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-xl border ${
        isPending
          ? "bg-amber-50 border-amber-200"
          : "bg-gray-50 border-gray-200 opacity-60"
      }`}
    >
      <span className="text-2xl">{isPending ? "🎁" : "✅"}</span>
      <div className="flex-1 min-w-0">
        <p
          className={`font-semibold text-sm truncate ${
            isPending ? "text-amber-800" : "text-gray-600"
          }`}
        >
          {reward.rule.rewardName}
        </p>
        <p className="text-xs text-gray-400">
          {isPending
            ? `Kazanıldı: ${formatDate(reward.createdAt)}`
            : `Kullanıldı: ${reward.claimedAt ? formatDate(reward.claimedAt) : "-"}`}
        </p>
      </div>
      <span
        className={`text-xs px-2 py-1 rounded-full font-semibold ${
          isPending
            ? "bg-amber-200 text-amber-800"
            : "bg-gray-200 text-gray-600"
        }`}
      >
        {isPending ? "Kullanılabilir" : "Kullanıldı"}
      </span>
    </div>
  );
}
