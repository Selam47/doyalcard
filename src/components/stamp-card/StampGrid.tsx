import { cn } from "@/lib/utils";
import { clampCycleCount, type ActiveCampaignRule } from "@/lib/campaign-rules";

const RESET_STYLE = { color: "bg-amber-400 ring-amber-500", emoji: "🫓" };
const MILESTONE_PALETTE: { color: string; emoji: string }[] = [
  { color: "bg-green-400 ring-green-500", emoji: "🥛" },
  { color: "bg-blue-400 ring-blue-500", emoji: "🍮" },
  { color: "bg-purple-400 ring-purple-500", emoji: "🎁" },
  { color: "bg-pink-400 ring-pink-500", emoji: "🍰" },
  { color: "bg-teal-400 ring-teal-500", emoji: "🍪" },
];

interface Milestone {
  color: string;
  emoji: string;
  label: string;
}

interface Props {
  currentCount: number;
  activeRules: ActiveCampaignRule[];
  /** Authoritative slot count from the active campaign rule. Always > 0. */
  maxStamps: number;
}

function buildMilestones(
  rules: ActiveCampaignRule[],
  maxStamps: number
): Record<number, Milestone> {
  const milestones: Record<number, Milestone> = {};
  let paletteIndex = 0;

  for (const rule of rules) {
    if (rule.threshold < 1 || rule.threshold > maxStamps) continue;

    if (rule.isResetPoint || rule.threshold === maxStamps) {
      milestones[rule.threshold] = { ...RESET_STYLE, label: rule.rewardName };
    } else {
      const style = MILESTONE_PALETTE[paletteIndex % MILESTONE_PALETTE.length];
      paletteIndex += 1;
      milestones[rule.threshold] = { ...style, label: rule.rewardName };
    }
  }

  return milestones;
}

/**
 * Static class strings (Tailwind cannot see interpolated names) chosen from
 * the slot count so a 40-stamp campaign stays readable on a phone.
 */
function gridColumnsClass(maxStamps: number): string {
  if (maxStamps <= 12) return "grid-cols-4 sm:grid-cols-6";
  if (maxStamps <= 24) return "grid-cols-5 sm:grid-cols-8";
  return "grid-cols-6 sm:grid-cols-10";
}

export function StampGrid({ currentCount, activeRules, maxStamps }: Props) {
  const milestones = buildMilestones(activeRules, maxStamps);
  const filledCount = clampCycleCount(currentCount, maxStamps);
  const legendRules = activeRules.filter(
    (r) => r.threshold >= 1 && r.threshold <= maxStamps
  );

  return (
    <div className="space-y-4">
      {/* Stamp Grid */}
      <div className={cn("grid gap-3", gridColumnsClass(maxStamps))}>
        {Array.from({ length: maxStamps }, (_, i) => {
          const stampNumber = i + 1;
          const isFilled = stampNumber <= filledCount;
          const milestone = milestones[stampNumber];

          return (
            <div
              key={stampNumber}
              className={cn(
                "relative aspect-square rounded-xl flex flex-col items-center justify-center border-2 transition-all duration-300",
                isFilled
                  ? milestone
                    ? `${milestone.color} ring-2 ring-offset-2 border-transparent shadow-lg scale-105 animate-in zoom-in-50 duration-500`
                    : "bg-green-500 border-green-600 shadow-md"
                  : "bg-gray-50 border-dashed border-gray-300 hover:border-gray-400"
              )}
            >
              {/* Content */}
              {isFilled ? (
                milestone ? (
                  <div className="flex flex-col items-center">
                    <span className="text-2xl sm:text-3xl">{milestone.emoji}</span>
                    <span className="text-[8px] sm:text-[9px] font-bold text-white mt-0.5 px-1 text-center leading-tight">
                      {milestone.label}
                    </span>
                  </div>
                ) : (
                  <svg
                    className="w-5 h-5 sm:w-6 sm:h-6 text-white drop-shadow-sm"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )
              ) : (
                <span className="text-xs sm:text-sm font-bold text-gray-400">
                  {stampNumber}
                </span>
              )}

              {/* Stamp number badge (for filled stamps) */}
              {isFilled && !milestone && (
                <span className="absolute -top-1 -right-1 w-4 h-4 sm:w-5 sm:h-5 bg-white text-green-700 rounded-full text-[9px] sm:text-[10px] font-bold flex items-center justify-center shadow-sm border border-green-200">
                  {stampNumber}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Milestone Legend */}
      {legendRules.length > 0 && (
        <div className="flex flex-wrap gap-3 text-xs text-gray-600">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-green-500 inline-block shadow-sm" />
            <span>Normal Puan</span>
          </div>
          {legendRules.map((rule) => {
            const milestone = milestones[rule.threshold];
            if (!milestone) return null;
            return (
              <div key={rule.id} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "w-3 h-3 rounded-full inline-block shadow-sm",
                    milestone.color.split(" ")[0]
                  )}
                />
                <span>
                  {milestone.emoji} {rule.threshold}. {milestone.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
