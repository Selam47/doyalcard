// src/lib/revalidate.ts
// Shared cache invalidation for everything that displays stamp progress.
//
// NOTE: `revalidatePath("/card")` does NOT match the dynamic route
// `/card/[uuid]` — that was the source of the stale-card bug. Dynamic routes
// must be revalidated either by their concrete pathname (`/card/<uuid>`) or
// by passing the route pattern together with the "page" type. We do both:
// the concrete path clears the entry the customer is looking at right now,
// the pattern clears every other cached instance (e.g. the staff device).

import { revalidatePath } from "next/cache";

/**
 * Invalidate every surface that renders a stamp counter.
 * Must be called from a Server Action or Route Handler.
 *
 * @param qrUuid Optional customer QR uuid for an exact-path purge.
 */
export function revalidateStampSurfaces(qrUuid?: string | null): void {
  // Customer card — dynamic route, both forms required.
  revalidatePath("/card/[uuid]", "page");
  if (qrUuid) revalidatePath(`/card/${qrUuid}`);

  // Staff till — same customer, same counters, separate dynamic route. Missing
  // this leaves the cashier looking at a stale count right after they stamp.
  revalidatePath("/staff/customer/[uuid]", "page");
  if (qrUuid) revalidatePath(`/staff/customer/${qrUuid}`);

  // Self-service customer dashboard renders the same card component.
  revalidatePath("/customer/dashboard");

  // Staff + admin surfaces.
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
