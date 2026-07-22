// src/lib/qr.ts
import QRCode from "qrcode";

/**
 * Gets the current base URL dynamically.
 * Priority:
 * 1. window.location.origin (if running in browser - guarantees exact domain)
 * 2. NEXT_PUBLIC_BASE_URL / NEXT_PUBLIC_APP_URL (from environment variables)
 * 3. Default fallback to the new Vercel domain
 */
function getBaseUrl(): string {
  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin;
  }
  return (
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://doyalcard.vercel.app"
  );
}

/**
 * Generates a data-URL (base64 PNG) for a customer's QR code.
 * The QR code encodes the full card URL: /card/<uuid>
 */
export async function generateQrDataUrl(qrUuid: string): Promise<string> {
  const url = `${getBaseUrl()}/card/${qrUuid}`;
  const dataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: "H",
    margin: 2,
    width: 300,
    color: {
      dark: "#1a3a2a",  // deep green
      light: "#ffffff",
    },
  });
  return dataUrl;
}

/**
 * Returns the plain card URL for a given UUID.
 */
export function getCardUrl(qrUuid: string): string {
  return `${getBaseUrl()}/card/${qrUuid}`;
}