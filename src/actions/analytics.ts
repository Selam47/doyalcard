// src/actions/analytics.ts
"use server";

import { prisma } from "@/lib/prisma";
import { getStaffPrincipal } from "@/lib/staff-guard";
import { isDbConnectionError } from "@/lib/db-errors";
import { Prisma } from "@/generated/prisma/client";
import { ISTANBUL_OFFSET_HOURS } from "@/lib/istanbul-time";
import { monthIndex, SYSTEM_START_INDEX } from "@/lib/analytics-range";
import { z } from "zod";

// ─── Timezone ─────────────────────────────────────────────────────────────────
// Prisma maps `DateTime` to Postgres `timestamp(3)` WITHOUT time zone and
// stores the UTC wall clock. A raw `date_trunc('month', created_at)` would
// therefore bucket by UTC months, pushing every order taken between 00:00 and
// 03:00 Istanbul time into the previous day (and, on the 1st, the previous
// month). Türkiye has been on a fixed UTC+3 since 2016 with no DST, so a plain
// interval shift is exact — no tz database lookup needed.
const TZ_OFFSET_HOURS = ISTANBUL_OFFSET_HOURS;
const TZ_SHIFT = Prisma.raw(`INTERVAL '${TZ_OFFSET_HOURS} hours'`);

/** UTC instant at which the given Istanbul-local month begins. */
function istanbulMonthStart(year: number, monthIndex: number): Date {
  // Date.UTC normalises out-of-range months (-1 → December of year-1).
  return new Date(
    Date.UTC(year, monthIndex, 1) - TZ_OFFSET_HOURS * 60 * 60 * 1000
  );
}

/**
 * Bind a Date as a Postgres `timestamp` matching the UTC wall clock we store.
 *
 * Passing a JS `Date` straight through would let the driver serialise it with
 * the *server process'* local offset, which Postgres then truncates when
 * casting to a tz-less `timestamp` — silently shifting every window boundary.
 * The ISO string is unambiguous and the explicit cast pins the type.
 */
function tsParam(date: Date) {
  return Prisma.sql`${date.toISOString()}::timestamp`;
}

/** "YYYY-MM" key for an Istanbul-local month, matching to_char() in SQL. */
function monthKey(year: number, monthIndex: number): string {
  const d = new Date(Date.UTC(year, monthIndex, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ─── Public types ─────────────────────────────────────────────────────────────
export interface Kpi {
  value: number;
  /**
   * The previous month's value, or null when the selected month is the first
   * month the system existed — there is no earlier month to compare against.
   */
  previous: number | null;
  /** Percent change vs. the previous month; null when there is no baseline. */
  changePct: number | null;
}

export interface TrendPoint {
  /** "YYYY-MM" */
  key: string;
  /** Customers whose account was created in this month. */
  registrations: number;
  orders: number;
  rewards: number;
}

export interface DailyPoint {
  /** Day of month, 1-based. */
  day: number;
  orders: number;
  rewards: number;
}

export interface MonthlyAnalytics {
  year: number;
  /** 0-based, to match JS Date semantics. */
  month: number;
  branchId: string | null;
  kpis: { registrations: Kpi; orders: Kpi; rewards: Kpi };
  trend: TrendPoint[];
  daily: DailyPoint[];
  /** True when the *selected* month has no activity at all. */
  isEmpty: boolean;
}

export type AnalyticsResult =
  | { success: true; data: MonthlyAnalytics }
  | { success: false; error: string };

export interface BranchOption {
  id: string;
  name: string;
}

// ─── Auth guard ───────────────────────────────────────────────────────────────
// Middleware already gates /admin, but a Server Action is a public HTTP
// endpoint reachable by its action id from anywhere — it re-checks the role
// itself. Returns a result instead of throwing, per the project's error
// contract (a thrown action reaches the client as an opaque digest).
// The role is re-read from the database, not taken from the JWT, so a demoted
// or deactivated admin loses access to revenue analytics immediately.
async function ensureAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const staff = await getStaffPrincipal();

  if (!staff) {
    return {
      ok: false,
      error: "Oturum bulunamadı veya süresi doldu. Lütfen tekrar giriş yapın.",
    };
  }

  if (!staff.isAdmin) {
    return {
      ok: false,
      error: "Yetkisiz erişim: Bu rapor yalnızca yönetici hesabına açıktır.",
    };
  }

  return { ok: true };
}

// ─── Input validation ─────────────────────────────────────────────────────────
/**
 * Upper bound on how many months (including the selected one) the trend chart
 * covers. The window is also floored at the system's launch month, so early on
 * it is shorter than this and grows by one point per month.
 */
const MAX_TREND_MONTHS = 12;

const AnalyticsInput = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(0).max(11),
  // "" from an unselected <select> means "all branches".
  branchId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type AnalyticsInput = z.input<typeof AnalyticsInput>;

// ─── Raw row shapes ───────────────────────────────────────────────────────────
// Every COUNT is cast to ::int in SQL — Postgres' bigint would otherwise
// arrive as a BigInt, which is not serialisable across the RSC boundary.
interface MonthlyOrderRow {
  bucket: string;
  orders: number;
}
interface MonthlyRegistrationRow {
  bucket: string;
  registrations: number;
}
interface MonthlyRewardRow {
  bucket: string;
  rewards: number;
}
interface DailyOrderRow {
  bucket: string;
  orders: number;
}
interface DailyRewardRow {
  bucket: string;
  rewards: number;
}

/** Branch options for the filter dropdown. Empty list ⇒ hide the filter. */
export async function getAnalyticsBranches(): Promise<BranchOption[]> {
  const guard = await ensureAdmin();
  if (!guard.ok) return [];

  try {
    return await prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  } catch (error) {
    console.error("[getAnalyticsBranches] Error:", error);
    return [];
  }
}

/**
 * Monthly analytics for the admin dashboard.
 *
 * All bucketing and counting happens inside Postgres — five aggregate queries
 * return at most 12 + 12 + 12 + 31 + 31 rows regardless of how many customers
 * or orders exist. Nothing is counted in JS.
 */
export async function getMonthlyAnalytics(
  input: AnalyticsInput
): Promise<AnalyticsResult> {
  const guard = await ensureAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  const parsed = AnalyticsInput.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Geçersiz rapor dönemi seçildi." };
  }
  const { year, month, branchId } = parsed.data;

  // A Server Action is reachable by its action id from anywhere, so the floor
  // is enforced here too — not only by the (bounded) month selector in the UI.
  const selectedIndex = monthIndex(year, month);
  if (selectedIndex < SYSTEM_START_INDEX) {
    return {
      success: false,
      error: "Sistem Temmuz 2026'da devreye girdi — daha eski bir dönem yok.",
    };
  }

  // Trend window: at most MAX_TREND_MONTHS ending with (and including) the
  // selected month, but never reaching back past the month the system went
  // live. The previous month used for the KPI deltas is inside this window
  // (when it exists at all), so no extra round-trip is needed for it.
  const firstTrendIndex = Math.max(
    selectedIndex - (MAX_TREND_MONTHS - 1),
    SYSTEM_START_INDEX
  );
  const trendMonths = selectedIndex - firstTrendIndex + 1;

  const trendStart = istanbulMonthStart(year, month - (trendMonths - 1));
  const monthStart = istanbulMonthStart(year, month);
  const monthEnd = istanbulMonthStart(year, month + 1);

  // `Prisma.empty` keeps the WHERE clause valid when no branch is selected.
  const orderBranch = branchId
    ? Prisma.sql`AND o.branch_id = ${branchId}`
    : Prisma.empty;

  // Customer.branchId is the branch the customer was *registered at*, which is
  // a different column from Order.branchId (where a stamp was given) — hence a
  // separate fragment rather than reusing `orderBranch`.
  const customerBranch = branchId
    ? Prisma.sql`AND c.branch_id = ${branchId}`
    : Prisma.empty;

  try {
    const [monthlyRegistrations, monthlyOrders, monthlyRewards, dailyOrders, dailyRewards] =
      await Promise.all([
        // 1 ─ New customer registrations per month, dated by when the customer
        //     row was created. Raw SQL because Prisma's groupBy cannot bucket
        //     by a date expression; the counting still happens in Postgres.
        prisma.$queryRaw<MonthlyRegistrationRow[]>`
          SELECT
            to_char(date_trunc('month', c.created_at + ${TZ_SHIFT}), 'YYYY-MM') AS bucket,
            COUNT(*)::int AS registrations
          FROM customers c
          WHERE c.created_at >= ${tsParam(trendStart)}
            AND c.created_at <  ${tsParam(monthEnd)}
            ${customerBranch}
          GROUP BY 1
        `,

        // 2 ─ Orders (stamps given) per month.
        prisma.$queryRaw<MonthlyOrderRow[]>`
          SELECT
            to_char(date_trunc('month', o.created_at + ${TZ_SHIFT}), 'YYYY-MM') AS bucket,
            COUNT(*)::int AS orders
          FROM orders o
          WHERE o.created_at >= ${tsParam(trendStart)}
            AND o.created_at <  ${tsParam(monthEnd)}
            ${orderBranch}
          GROUP BY 1
        `,

        // 3 ─ Claimed rewards per month, dated by when they were CLAIMED.
        //     Joined to orders so the branch filter has something to match:
        //     Reward has no branch of its own. The join never changes the
        //     count — Reward.orderId is NOT NULL and unique.
        prisma.$queryRaw<MonthlyRewardRow[]>`
          SELECT
            to_char(date_trunc('month', r.claimed_at + ${TZ_SHIFT}), 'YYYY-MM') AS bucket,
            COUNT(*)::int AS rewards
          FROM rewards r
          JOIN orders o ON o.id = r.order_id
          WHERE r.status = 'CLAIMED'
            AND r.claimed_at IS NOT NULL
            AND r.claimed_at >= ${tsParam(trendStart)}
            AND r.claimed_at <  ${tsParam(monthEnd)}
            ${orderBranch}
          GROUP BY 1
        `,

        // 4 ─ Day-by-day orders for the selected month.
        prisma.$queryRaw<DailyOrderRow[]>`
          SELECT
            to_char(date_trunc('day', o.created_at + ${TZ_SHIFT}), 'YYYY-MM-DD') AS bucket,
            COUNT(*)::int AS orders
          FROM orders o
          WHERE o.created_at >= ${tsParam(monthStart)}
            AND o.created_at <  ${tsParam(monthEnd)}
            ${orderBranch}
          GROUP BY 1
        `,

        // 5 ─ Day-by-day claimed rewards for the selected month.
        prisma.$queryRaw<DailyRewardRow[]>`
          SELECT
            to_char(date_trunc('day', r.claimed_at + ${TZ_SHIFT}), 'YYYY-MM-DD') AS bucket,
            COUNT(*)::int AS rewards
          FROM rewards r
          JOIN orders o ON o.id = r.order_id
          WHERE r.status = 'CLAIMED'
            AND r.claimed_at IS NOT NULL
            AND r.claimed_at >= ${tsParam(monthStart)}
            AND r.claimed_at <  ${tsParam(monthEnd)}
            ${orderBranch}
          GROUP BY 1
        `,
      ]);

    // ─── Densify the monthly series ───────────────────────────────────────────
    // Postgres only returns months that actually have rows; the chart needs a
    // continuous x-axis, so gaps become explicit zeroes.
    const registrationsByMonth = new Map(
      monthlyRegistrations.map((r) => [r.bucket, r.registrations])
    );
    const ordersByMonth = new Map(monthlyOrders.map((r) => [r.bucket, r.orders]));
    const rewardsByMonth = new Map(
      monthlyRewards.map((r) => [r.bucket, r.rewards])
    );

    const trend: TrendPoint[] = [];
    for (let i = trendMonths - 1; i >= 0; i--) {
      const key = monthKey(year, month - i);
      trend.push({
        key,
        registrations: registrationsByMonth.get(key) ?? 0,
        orders: ordersByMonth.get(key) ?? 0,
        rewards: rewardsByMonth.get(key) ?? 0,
      });
    }

    // ─── KPIs ────────────────────────────────────────────────────────────────
    const currentKey = monthKey(year, month);
    const previousKey = monthKey(year, month - 1);
    const current = trend.find((p) => p.key === currentKey);
    const previous = trend.find((p) => p.key === previousKey);

    // The launch month has no predecessor. Reporting `previous: 0` there would
    // read as "last month we served nobody" rather than "there was no last
    // month", so the baseline is dropped entirely instead of fabricated.
    const hasBaseline = selectedIndex > SYSTEM_START_INDEX;

    const kpi = (value: number, prev: number): Kpi => ({
      value,
      previous: hasBaseline ? prev : null,
      // A 0 → n jump has no meaningful percentage either (it is division by
      // zero, not "+∞%"). The UI renders a neutral dash for null in both cases
      // instead of a fake trend.
      changePct: hasBaseline && prev > 0 ? ((value - prev) / prev) * 100 : null,
    });

    const kpis = {
      registrations: kpi(
        current?.registrations ?? 0,
        previous?.registrations ?? 0
      ),
      orders: kpi(current?.orders ?? 0, previous?.orders ?? 0),
      rewards: kpi(current?.rewards ?? 0, previous?.rewards ?? 0),
    };

    // ─── Densify the daily series ────────────────────────────────────────────
    // Day 0 of the next month = last day of this one.
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const ordersByDay = new Map(dailyOrders.map((r) => [r.bucket, r.orders]));
    const rewardsByDay = new Map(dailyRewards.map((r) => [r.bucket, r.rewards]));

    const daily: DailyPoint[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const key = `${currentKey}-${String(day).padStart(2, "0")}`;
      daily.push({
        day,
        orders: ordersByDay.get(key) ?? 0,
        rewards: rewardsByDay.get(key) ?? 0,
      });
    }

    return {
      success: true,
      data: {
        year,
        month,
        branchId,
        kpis,
        trend,
        daily,
        isEmpty:
          kpis.registrations.value === 0 &&
          kpis.orders.value === 0 &&
          kpis.rewards.value === 0,
      },
    };
  } catch (error) {
    console.error("[getMonthlyAnalytics] Error:", error);

    if (isDbConnectionError(error)) {
      return {
        success: false,
        error:
          "Veritabanı bağlantısı zaman aşımına uğradı. Lütfen tekrar deneyin.",
      };
    }

    return { success: false, error: "Analiz verileri yüklenemedi." };
  }
}
