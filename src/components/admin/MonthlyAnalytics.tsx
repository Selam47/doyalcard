"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Award,
  ChevronLeft,
  ChevronRight,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";

import {
  getMonthlyAnalytics,
  type BranchOption,
  type Kpi,
  type MonthlyAnalytics as MonthlyAnalyticsData,
} from "@/actions/analytics";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { monthIndex, SYSTEM_START_INDEX } from "@/lib/analytics-range";
import { cn } from "@/lib/utils";

// Hard-coded rather than Intl.DateTimeFormat: the labels render during SSR of
// this Client Component as well, and a Node build without full ICU would emit
// English month names on the server and Turkish ones in the browser —
// a hydration mismatch. The locale here is fixed Turkish anyway.
const MONTHS_LONG = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];
const MONTHS_SHORT = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
];

/** Turkish grouping: 1234 → "1.234". */
const nf = new Intl.NumberFormat("tr-TR");

/**
 * Upper bound on how many past months the selector offers. It never reaches
 * back past the system's launch month (SYSTEM_START_INDEX), so until that
 * many months have elapsed since launch, the list is shorter than this.
 */
const MAX_SELECTABLE_MONTHS = 24;

// Brand-aligned, CVD-validated categorical triad (light/dark pairs — see
// dataviz palette check): warm red/orange for orders, emerald for new
// registrations, amber/gold for rewards. Defined as CSS custom properties on
// the section root (below) rather than the shared --chart-* tokens so this
// dashboard's palette can't drift when those tokens change elsewhere.
const SERIES = {
  registrations: { label: "Kayıt", color: "var(--chart-registrations)", icon: Users },
  orders: { label: "Sipariş", color: "var(--chart-orders)", icon: ShoppingBag },
  rewards: { label: "Ödül", color: "var(--chart-rewards)", icon: Award },
} as const;

interface Props {
  /** Istanbul-local "today", resolved on the server so SSR and hydration agree. */
  currentYear: number;
  /** 0-based. */
  currentMonth: number;
  branches: BranchOption[];
}

export function MonthlyAnalytics({ currentYear, currentMonth, branches }: Props) {
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [branchId, setBranchId] = useState("");

  // The fetched result carries the filter combination it belongs to, so
  // "still loading" is *derived* (`stored key !== requested key`) rather than
  // a second state flipped on inside the effect. That keeps the effect body
  // free of synchronous setState — which would otherwise cascade an extra
  // render pass on every filter change — and makes a stale response
  // impossible to display even if it lands late.
  const requestKey = `${year}|${month}|${branchId}`;
  const [fetched, setFetched] = useState<{
    key: string;
    data: MonthlyAnalyticsData | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    const key = `${year}|${month}|${branchId}`;
    let cancelled = false;

    getMonthlyAnalytics({ year, month, branchId })
      .then((result) => {
        if (cancelled) return;
        setFetched(
          result.success
            ? { key, data: result.data, error: null }
            : { key, data: null, error: result.error }
        );
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[MonthlyAnalytics] fetch failed:", err);
        setFetched({
          key,
          data: null,
          error: "Analiz verileri yüklenemedi. Lütfen sayfayı yenileyin.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [year, month, branchId]);

  const isLoading = fetched?.key !== requestKey;
  const data = isLoading ? null : (fetched?.data ?? null);
  const error = isLoading ? null : (fetched?.error ?? null);

  // Absolute month index makes "is the selection in the future / before
  // launch?" a plain integer comparison instead of nested year/month checks.
  // Computed via the shared helper so this component can never drift from
  // the range logic used elsewhere (e.g. the server action).
  const selectedIndex = monthIndex(year, month);
  const currentIndex = monthIndex(currentYear, currentMonth);
  const isAtCurrentMonth = selectedIndex >= currentIndex;
  const isAtSystemStart = selectedIndex <= SYSTEM_START_INDEX;

  function shiftMonth(delta: number) {
    const next = selectedIndex + delta;
    // Never allow navigating into the future or before the system's launch
    // month — there is no data on either side of that window.
    if (next > currentIndex || next < SYSTEM_START_INDEX) return;
    setYear(Math.floor(next / 12));
    setMonth(next % 12);
  }

  const monthOptions = useMemo(() => {
    // Cap the list so it never reaches back past the system's launch month,
    // even if MAX_SELECTABLE_MONTHS would otherwise allow it (e.g. right
    // after launch, when fewer than 24 months of history exist at all).
    const monthCount = Math.min(
      MAX_SELECTABLE_MONTHS,
      currentIndex - SYSTEM_START_INDEX + 1
    );
    return Array.from({ length: monthCount }, (_, i) => {
      const index = currentIndex - i;
      const y = Math.floor(index / 12);
      const m = index % 12;
      return { value: `${y}-${m}`, label: `${MONTHS_LONG[m]} ${y}` };
    });
  }, [currentIndex]);

  const trendData = useMemo(() => {
    if (!data) return [];
    return data.trend.map((point) => {
      const [y, m] = point.key.split("-");
      return {
        ...point,
        label: `${MONTHS_SHORT[Number(m) - 1]} ${y.slice(2)}`,
      };
    });
  }, [data]);

  const hasTrendData = trendData.some(
    (p) => p.registrations > 0 || p.orders > 0 || p.rewards > 0
  );

  const selectClass =
    "h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

  return (
    <section
      className={cn(
        "space-y-4",
        // Brand triad — validated for lightness band, chroma floor, CVD
        // separation and surface contrast in both modes (dataviz skill).
        "[--chart-registrations:#0f9d68] [--chart-orders:#e8622d] [--chart-rewards:#b45309]",
        "dark:[--chart-registrations:#20a877] dark:[--chart-orders:#e0703f] dark:[--chart-rewards:#c47f1e]"
      )}
    >
      {/* ─── Header + filters ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">📈 Aylık Analiz</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {MONTHS_LONG[month]} {year} dönemi performansı
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Only worth showing when there is something to filter between. */}
          {branches.length > 1 && (
            <select
              aria-label="Şube filtresi"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className={selectClass}
            >
              <option value="">Tüm Şubeler</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Önceki ay"
              onClick={() => shiftMonth(-1)}
              disabled={isAtSystemStart}
              className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronLeft className="size-4" />
            </button>

            <select
              aria-label="Ay seçimi"
              value={`${year}-${month}`}
              onChange={(e) => {
                const [y, m] = e.target.value.split("-");
                setYear(Number(y));
                setMonth(Number(m));
              }}
              className={selectClass}
            >
              {monthOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              aria-label="Sonraki ay"
              onClick={() => shiftMonth(1)}
              disabled={isAtCurrentMonth}
              className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/30 py-5">
          <CardContent className="text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {/* ─── KPI cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard
          title="Müşteri Kaydı"
          hint="Bu ay sisteme kayıt olan / işlem yapan tekil müşteri"
          kpi={data?.kpis.registrations}
          accent={SERIES.registrations.color}
          icon={SERIES.registrations.icon}
          isLoading={isLoading}
        />
        <KpiCard
          title="Toplam Sipariş"
          hint="Bu ay verilen damga sayısı"
          kpi={data?.kpis.orders}
          accent={SERIES.orders.color}
          icon={SERIES.orders.icon}
          isLoading={isLoading}
        />
        <KpiCard
          title="Kullanılan Ödül"
          hint="Bu ay teslim edilen ödüller"
          kpi={data?.kpis.rewards}
          accent={SERIES.rewards.color}
          icon={SERIES.rewards.icon}
          isLoading={isLoading}
        />
      </div>

      {/* ─── 12-month trend ───────────────────────────────────────────────── */}
      <Card className="py-6 shadow-sm">
        <CardHeader className="px-6">
          <CardTitle>Son 12 Ay Trendi</CardTitle>
          <CardDescription>
            Kayıt, sipariş ve ödül sayılarının aylık seyri
          </CardDescription>
        </CardHeader>
        <CardContent className="px-2 sm:px-6">
          {isLoading ? (
            <ChartSkeleton />
          ) : !hasTrendData ? (
            <EmptyState message="Bu dönem için veri bulunmuyor" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart
                data={trendData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <defs>
                  {Object.entries(SERIES).map(([key, series]) => (
                    <linearGradient
                      key={key}
                      id={`trend-${key}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor={series.color} stopOpacity={0.45} />
                      <stop offset="60%" stopColor={series.color} stopOpacity={0.12} />
                      <stop offset="100%" stopColor={series.color} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  allowDecimals={false}
                  tickFormatter={(value: number) => nf.format(value)}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--border)", strokeWidth: 1 }} />
                <Legend content={<ChartLegend />} />
                {(Object.keys(SERIES) as Array<keyof typeof SERIES>).map((key) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={SERIES[key].label}
                    stroke={SERIES[key].color}
                    strokeWidth={2.5}
                    fill={`url(#trend-${key})`}
                    dot={false}
                    activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ─── Daily breakdown ──────────────────────────────────────────────── */}
      <Card className="py-6 shadow-sm">
        <CardHeader className="px-6">
          <CardTitle>
            Günlük Dağılım — {MONTHS_LONG[month]} {year}
          </CardTitle>
          <CardDescription>Gün bazında sipariş ve ödül sayıları</CardDescription>
        </CardHeader>
        <CardContent className="px-2 sm:px-6">
          {isLoading ? (
            <ChartSkeleton />
          ) : !data || data.isEmpty ? (
            <EmptyState message="Bu ay için veri bulunmuyor" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={data.daily}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                barGap={4}
              >
                <defs>
                  <linearGradient id="daily-orders" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES.orders.color} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={SERIES.orders.color} stopOpacity={0.55} />
                  </linearGradient>
                  <linearGradient id="daily-rewards" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES.rewards.color} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={SERIES.rewards.color} stopOpacity={0.55} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  minTickGap={8}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  allowDecimals={false}
                  tickFormatter={(value: number) => nf.format(value)}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  content={<ChartTooltip labelPrefix="Gün " />}
                />
                <Legend content={<ChartLegend />} />
                <Bar
                  dataKey="orders"
                  name={SERIES.orders.label}
                  fill="url(#daily-orders)"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="rewards"
                  name={SERIES.rewards.label}
                  fill="url(#daily-rewards)"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────
interface KpiCardProps {
  title: string;
  hint: string;
  kpi: Kpi | undefined;
  accent: string;
  icon: React.ComponentType<{ className?: string }>;
  isLoading: boolean;
}

function KpiCard({ title, hint, kpi, accent, icon: Icon, isLoading }: KpiCardProps) {
  return (
    <Card
      className="group relative gap-3 overflow-hidden py-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
      style={{
        borderColor: `color-mix(in oklab, ${accent} 22%, var(--border))`,
      }}
    >
      {/* Subtle accent glow, brightens slightly on hover — purely decorative. */}
      <div
        className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full opacity-[0.14] blur-2xl transition-opacity duration-300 group-hover:opacity-25"
        style={{ backgroundColor: accent }}
        aria-hidden
      />

      <CardHeader className="relative px-6">
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: accent }}
              aria-hidden
            />
            {title}
          </span>
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-xl"
            style={{
              backgroundColor: `color-mix(in oklab, ${accent} 16%, transparent)`,
              color: accent,
            }}
            aria-hidden
          >
            <Icon className="size-4.5" />
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="relative space-y-2 px-6">
        {isLoading || !kpi ? (
          <>
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-4 w-32" />
          </>
        ) : (
          <>
            <div className="text-3xl font-extrabold tracking-tight text-foreground">
              {nf.format(kpi.value)}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <ChangeBadge changePct={kpi.changePct} />
              <span className="text-muted-foreground">
                önceki ay{" "}
                {typeof kpi.previous === "number"
                  ? nf.format(kpi.previous)
                  : "—"}
              </span>
            </div>
          </>
        )}
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function ChangeBadge({ changePct }: { changePct: number | null }) {
  // No baseline (previous month was zero, or this is the system's launch
  // month with no prior month at all) — a percentage would be meaningless.
  if (changePct === null) {
    return (
      <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">
        — kıyas yok
      </span>
    );
  }

  const isUp = changePct >= 0;
  const Icon = isUp ? TrendingUp : TrendingDown;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold",
        isUp
          ? "bg-primary/10 text-primary"
          : "bg-destructive/10 text-destructive"
      )}
    >
      <Icon className="size-3" />
      {isUp ? "+" : ""}
      {nf.format(Math.round(changePct))}%
    </span>
  );
}

// ─── Chart chrome ─────────────────────────────────────────────────────────────
interface TooltipEntry {
  name?: string;
  value?: number;
  color?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  labelPrefix = "",
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  labelPrefix?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-xl border border-border/70 bg-card/90 px-3.5 py-2.5 text-xs shadow-lg backdrop-blur-md">
      <div className="mb-1.5 font-semibold text-card-foreground">
        {labelPrefix}
        {label}
      </div>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={entry.name} className="flex items-center gap-2.5">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{
                backgroundColor: entry.color,
                boxShadow: `0 0 0 3px color-mix(in oklab, ${entry.color ?? "transparent"} 20%, transparent)`,
              }}
              aria-hidden
            />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto font-semibold tabular-nums text-card-foreground">
              {nf.format(entry.value ?? 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartLegend({
  payload,
}: {
  payload?: Array<{ value?: string; color?: string }>;
}) {
  if (!payload?.length) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
      {payload.map((entry) => (
        <span
          key={entry.value}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground"
        >
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: entry.color }}
            aria-hidden
          />
          {entry.value}
        </span>
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-[240px] w-full rounded-xl" />
      <div className="flex justify-center gap-4">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-[240px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/30 text-center">
      <span className="text-4xl" aria-hidden>
        📭
      </span>
      <p className="mt-3 text-sm font-medium text-muted-foreground">{message}</p>
      <p className="mt-1 text-xs text-muted-foreground/80">
        Farklı bir ay veya şube seçmeyi deneyin
      </p>
    </div>
  );
}
