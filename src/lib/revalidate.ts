import { revalidatePath } from "next/cache";

/**
 * Invalidate every surface that renders a stamp counter.
 * Must be called from a Server Action or Route Handler.
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
