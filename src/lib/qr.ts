// src/lib/qr.ts
import QRCode from "qrcode";

/**
 * Gets the current base URL dynamically.
 * Priority:
 * 1. window.location.origin (if running in browser - guarantees exact domain)
 * 2. NEXT_PUBLIC_BASE_URL / NEXT_PUBLIC_APP_URL (from environment variables)
 * 3. VERCEL_URL (automatically injected by Vercel for preview/production deployments)
 * No hardcoded domain fallback — avoids stale redirect issues on redeployments.
 */
function getBaseUrl(): string {
  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin;
  }
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    return process.env.NEXT_PUBLIC_BASE_URL;
  }
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  // VERCEL_URL is injected by Vercel at build time (without the protocol)
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "";
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