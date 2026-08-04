import { revalidatePath } from "next/cache";

/**
 * Invalidate every surface that renders a stamp counter.
 * Must be called from a Server Action or Route Handler.
 *
 * ─── These calls are currently NO-OPS. That is deliberate. ───────────────────
 *
 * Audited before launch: every path below is already rendered dynamically, so
 * there is nothing cached for these to purge.
 *
 *   • /card/[uuid], /staff/customer/[uuid], /customer/dashboard, /admin
 *     all `export const dynamic = "force-dynamic"`.
 *   • /staff has no such export, but reads `searchParams`, which opts it into
 *     dynamic rendering anyway. It is the fragile one — adding that export
 *     would make the guarantee explicit rather than incidental.
 *   • On Next 15 with no `staleTimes` override in next.config.ts,
 *     `staleTimes.dynamic` defaults to 0, so the CLIENT Router Cache does not
 *     reuse these payloads across soft navigations either.
 *
 * They are kept rather than deleted because they cost nothing — `revalidatePath`
 * is in-memory bookkeeping, no I/O — and because they are the safety net that
 * makes the list above a performance detail instead of a correctness
 * dependency. Remove a `force-dynamic`, or set `staleTimes.dynamic`, and these
 * calls start doing real work again; without them, a stamp would silently stop
 * appearing on the cashier's screen and nothing would point here.
 *
 * So: if you delete these, you are promising that every page above stays
 * dynamic forever.
 *
 * @param qrUuid Optional customer QR uuid for an exact-path purge.
 */
export function revalidateStampSurfaces(qrUuid?: string | null): void {
  revalidatePath("/card/[uuid]", "page");
  if (qrUuid) revalidatePath(`/card/${qrUuid}`);

  revalidatePath("/staff/customer/[uuid]", "page");
  if (qrUuid) revalidatePath(`/staff/customer/${qrUuid}`);

  revalidatePath("/customer/dashboard");

  revalidatePath("/staff");
  revalidatePath("/admin");
}

/**
 * Invalidate everything affected by a campaign-rule change. A threshold edit
 * changes `maxStamps` for EVERY customer, so this purges the card route
 * wholesale plus the landing page, whose marketing copy quotes thresholds.
 */
export function revalidateCampaignSurfaces(): void {
  revalidateStampSurfaces();
  revalidatePath("/admin/rules");
  revalidatePath("/");
}
