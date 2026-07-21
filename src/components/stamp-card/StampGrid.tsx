// src/components/stamp-card/StampGrid.tsx
import { cn } from "@/lib/utils";

const TOTAL_STAMPS = 11;

// Milestone rewards with visual styling
const MILESTONES: Record<number, { color: string; emoji: string; label: string }> = {
  5: { color: "bg-green-400 ring-green-500", emoji: "🥛", label: "Ayran" },
  7: { color: "bg-blue-400 ring-blue-500", emoji: "🍮", label: "Sütlaç" },
  11: { color: "bg-amber-400 ring-amber-500", emoji: "🏆", label: "Büyük Ödül" },
};

interface Props {
  currentCount: number;
}

export function StampGrid({ currentCount }: Props) {
  return (
    <div className="space-y-4">
      {/* Stamp Grid */}
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
        {Array.from({ length: TOTAL_STAMPS }, (_, i) => {
          const stampNumber = i + 1;
          const isFilled = stampNumber <= currentCount;
          const milestone = MILESTONES[stampNumber];

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
                    <span className="text-[8px] sm:text-[9px] font-bold text-white mt-0.5">
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
      <div className="flex flex-wrap gap-3 text-xs text-gray-600">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-green-500 inline-block shadow-sm" />
          <span>Normal Puan</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-green-400 inline-block shadow-sm" />
          <span>🥛 5. Ayran</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-blue-400 inline-block shadow-sm" />
          <span>🍮 7. Sütlaç</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-amber-400 inline-block shadow-sm" />
          <span>🏆 11. Büyük Ödül</span>
        </div>
      </div>
    </div>
  );
}
