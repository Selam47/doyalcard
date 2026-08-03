/**
 * Loose E.164 sanity check: a leading "+", a non-zero first digit, then
 * 7–14 more digits (matches the ITU E.164 max length of 15 digits total).
 */
export const E164_REGEX = /^\+[1-9]\d{7,14}$/;

export function isValidE164(phone: string): boolean {
  return E164_REGEX.test(phone);
}

/**
 * Strips everything but digits, then strips a leading national trunk "0"
 * (very common in TR/EU local numbers: "0555 123 45 67" → "5551234567").
 * Without this, "+90" + "0555..." becomes the invalid "+900555..." and
 * Firebase (or anything else validating E.164) rejects it.
 */
export function normalizeDigits(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^0+/, "");
}

/**
 * Combine a "+"-prefixed country code with a raw local number into a
 * clean E.164 string. Used by the phone login form, which collects the
 * country code and local number as two separate inputs.
 */
export function toE164(countryCode: string, rawPhone: string): string {
  const trimmed = rawPhone.trim();
  const rawDigits = trimmed.replace(/\D/g, "");
  const countryDigits = countryCode.replace(/\D/g, "");

  // Also accept a complete international number pasted into the local field.
  if (trimmed.startsWith("+")) return `+${rawDigits}`;

  const localDigits = normalizeDigits(trimmed);
  if (localDigits.startsWith(countryDigits)) return `+${localDigits}`;

  return `+${countryDigits}${localDigits}`;
}

/**
 * Sanitize a single already-combined phone string (e.g. "+90 555 123 45 67"
 * typed into one field, as in the staff registration form) into a strict
 * E.164 string by stripping whitespace/formatting characters while
 * preserving the leading "+" and digits.
 */
export function sanitizePhoneInput(raw: string): string {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return hasPlus ? `+${digits}` : digits;
}
