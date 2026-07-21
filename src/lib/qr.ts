// src/lib/qr.ts
import QRCode from "qrcode";

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

/**
 * Generates a data-URL (base64 PNG) for a customer's QR code.
 * The QR code encodes the full card URL: /card/<uuid>
 */
export async function generateQrDataUrl(qrUuid: string): Promise<string> {
  const url = `${BASE_URL}/card/${qrUuid}`;
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
  return `${BASE_URL}/card/${qrUuid}`;
}
