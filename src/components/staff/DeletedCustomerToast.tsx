"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface Props {
  /** Name carried over by the `?deleted=` param set by deleteCustomer(). */
  customerName: string;
}

/**
 * Raises the post-delete success toast on /staff.
 *
 * The delete Server Action ends in `redirect("/staff?deleted=…")`, which means
 * the calling component is torn down before it can toast. The destination page
 * shows it instead, then strips the param so a refresh or a back-navigation
 * doesn't replay the message.
 */
export function DeletedCustomerToast({ customerName }: Props) {
  const router = useRouter();
  const hasShown = useRef(false);

  useEffect(() => {
    if (hasShown.current) return;
    hasShown.current = true;

    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      toast.success(`🗑️ "${customerName}" ve tüm kayıtları silindi`, {
        duration: 5000,
      });

      router.replace("/staff", { scroll: false });
    });

    return () => {
      cancelled = true;
    };
  }, [customerName, router]);

  return null;
}
