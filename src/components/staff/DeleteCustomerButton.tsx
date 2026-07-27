// src/components/staff/DeleteCustomerButton.tsx
"use client";

// Client Component — imports the Server Action only. Prisma (and everything
// under @/lib/prisma, which is marked `server-only`) must never be pulled in
// here; all database work happens inside deleteCustomer() on the server.
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteCustomer } from "@/actions/customer";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Props {
  /** `Customer.id` (cuid) — not the public qrUuid. */
  customerId: string;
  /** Shown in the confirmation copy so the admin can double-check the target. */
  customerName: string;
  /** Disable while a sibling action (add order / remove stamp) is running. */
  disabled?: boolean;
}

/**
 * Next.js implements `redirect()` by throwing a tagged error. When a Server
 * Action redirects, that error surfaces on the client so the router can act on
 * it — it must be re-thrown rather than reported as a failure.
 */
function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export function DeleteCustomerButton({
  customerId,
  customerName,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [isDeleting, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      try {
        const result = await deleteCustomer(customerId);
        // Reaching this line means the action returned instead of redirecting,
        // which it only does on failure.
        setOpen(false);
        toast.error(result?.error ?? "Müşteri silinemedi. Lütfen tekrar deneyin.");
      } catch (error) {
        if (isRedirectError(error)) throw error;
        console.error("[DeleteCustomerButton] Error:", error);
        setOpen(false);
        toast.error("Müşteri silinemedi. Lütfen tekrar deneyin.");
      }
    });
  }

  return (
    <AlertDialog
      open={open}
      // Ignore escape/close attempts while the delete is in flight so the
      // dialog can't be dismissed mid-transaction.
      onOpenChange={(nextOpen) => {
        if (!isDeleting) setOpen(nextOpen);
      }}
    >
      <AlertDialogTrigger
        id="delete-customer-btn"
        disabled={disabled || isDeleting}
        className="w-full py-2.5 px-6 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-sm shadow-md shadow-red-900/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-95"
      >
        <span aria-hidden="true">🗑️</span>
        Müşteriyi Sil
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Müşteriyi silmek istediğinize emin misiniz?</AlertDialogTitle>
          <AlertDialogDescription>
            <strong className="text-foreground">{customerName}</strong> adlı
            müşteri, tüm siparişleri ve kazandığı ödüller kalıcı olarak
            silinecek. Bu işlem geri alınamaz.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Vazgeç</AlertDialogCancel>
          <button
            id="delete-customer-confirm-btn"
            type="button"
            onClick={handleConfirm}
            disabled={isDeleting}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-red-500 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-red-500/40 disabled:pointer-events-none disabled:opacity-60"
          >
            {isDeleting ? (
              <>
                <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Siliniyor...
              </>
            ) : (
              "Evet, sil"
            )}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
