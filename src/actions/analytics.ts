"use server";

import { prisma } from "@/lib/prisma";
import { getStaffPrincipal } from "@/lib/staff-guard";
import { isDbConnectionError } from "@/lib/db-errors";
import { Prisma } from "@/generated/prisma/client";
import { ISTANBUL_OFFSET_HOURS } from "@/lib/istanbul-time";
import { monthIndex, SYSTEM_START_INDEX } from "@/lib/analytics-range";
import { z } from "zod";

const TZ_OFFSET_HOURS = ISTANBUL_OFFSET_HOURS;
const TZ_SHIFT = Prisma.raw(`INTERVAL '${TZ_OFFSET_HOURS} hours'`);

/** UTC instant at which the given Istanbul-local month begins. */
function istanbulMonthStart(year: number, monthIndex: number): Date {
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

/**
 * Upper bound on how many months (including the selected one) the trend chart
 * covers. The window is also floored at the system's launch month, so early on
 * it is shorter than this and grows by one point per month.
 */
const MAX_TREND_MONTHS = 12;

const AnalyticsInput = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(0).max(11),
  branchId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type AnalyticsInput = z.input<typeof AnalyticsInput>;

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

  const selectedIndex = monthIndex(year, month);
  if (selectedIndex < SYSTEM_START_INDEX) {
    return {
      success: false,
      error: "Sistem Temmuz 2026'da devreye girdi — daha eski bir dönem yok.",
    };
  }

  const firstTrendIndex = Math.max(
    selectedIndex - (MAX_TREND_MONTHS - 1),
    SYSTEM_START_INDEX
  );
  const trendMonths = selectedIndex - firstTrendIndex + 1;

  const trendStart = istanbulMonthStart(year, month - (trendMonths - 1));
  const monthStart = istanbulMonthStart(year, month);
  const monthEnd = istanbulMonthStart(year, month + 1);

  const orderBranch = branchId
    ? Prisma.sql`AND o.branch_id = ${branchId}`
    : Prisma.empty;

  const customerBranch = branchId
    ? Prisma.sql`AND c.branch_id = ${branchId}`
    : Prisma.empty;

  try {
    const [monthlyRegistrations, monthlyOrders, monthlyRewards, dailyOrders, dailyRewards] =
      await Promise.all([
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

    const currentKey = monthKey(year, month);
    const previousKey = monthKey(year, month - 1);
    const current = trend.find((p) => p.key === currentKey);
    const previous = trend.find((p) => p.key === previousKey);

    const hasBaseline = selectedIndex > SYSTEM_START_INDEX;

    const kpi = (value: number, prev: number): Kpi => ({
      value,
      previous: hasBaseline ? prev : null,
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
