import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Masks a phone number for customer-facing display.
 * e.g. "+905551234567" → "+90 *** *** 4567"
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 4) return "***";
  const last4 = phone.slice(-4);
  const prefix = phone.length > 6 ? phone.slice(0, 3) : "";
  return `${prefix} *** *** ${last4}`;
}

/**
 * Format a date as a readable Turkish-locale string.
 */
export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
