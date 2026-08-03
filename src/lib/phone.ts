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

/** Default country for numbers typed without one. */
export const DEFAULT_COUNTRY_CODE = "+90";

/**
 * Country codes whose national number length we know exactly, so a truncated
 * entry can be rejected instead of being padded into a plausible-looking
 * number. Turkish numbers are always 10 national digits ("530 916 28 63").
 *
 * Without this, a half-typed "916 28 63" normalizes to "+909162863" — a string
 * that satisfies the generic E.164 regex and is therefore accepted as a real
 * number to search for. That is precisely how a partial entry turns into a
 * lookup nobody intended.
 */
const NATIONAL_NUMBER_LENGTHS: Record<string, number> = { "90": 10 };

/** Reject a number whose national part is the wrong length for its country. */
function hasExpectedNationalLength(e164: string): boolean {
  const digits = e164.replace(/\D/g, "");
  for (const [country, length] of Object.entries(NATIONAL_NUMBER_LENGTHS)) {
    if (digits.startsWith(country)) {
      return digits.length === country.length + length;
    }
  }
  return true;
}

/**
 * THE canonical phone normalizer. Every surface that looks a customer up by
 * phone — staff search, staff registration, the OTP callback — must funnel
 * through this, because a lookup is only ever as correct as the agreement
 * between the string that was STORED and the string being searched for.
 *
 * `sanitizePhoneInput` alone is not enough: it preserves a number exactly as
 * typed, so "0530 916 28 63" came out as the bare "05309162863" while the
 * customer's own OTP login stored the same person as "+905309162863". The two
 * spellings never match, which is how one human ends up looking like two
 * different records (or no record at all).
 *
 * Accepted spellings, all collapsing to the same E.164 string:
 *   "+905309162863", "00905309162863", "905309162863",
 *   "05309162863", "5309162863", and any of the above with spaces,
 *   dashes or parentheses.
 *
 * Returns `null` when the input cannot be resolved to a valid E.164 number —
 * never a "best effort" string. A caller must not be able to mistake an
 * unparseable number for a searchable one.
 */
export function normalizePhoneToE164(
  raw: string,
  defaultCountryCode: string = DEFAULT_COUNTRY_CODE
): string | null {
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const countryDigits = defaultCountryCode.replace(/\D/g, "");
  let digits = trimmed.replace(/\D/g, "");
  if (digits === "") return null;

  if (trimmed.startsWith("+")) {
    // Already international — take it as written.
    const candidate = `+${digits}`;
    return isValidE164(candidate) && hasExpectedNationalLength(candidate)
      ? candidate
      : null;
  }

  // "00" is the international access prefix used across TR/EU ("0090 530…").
  if (digits.startsWith("00")) {
    const candidate = `+${digits.slice(2)}`;
    return isValidE164(candidate) && hasExpectedNationalLength(candidate)
      ? candidate
      : null;
  }

  // National trunk prefix: "0530…" → "530…".
  if (digits.startsWith("0")) {
    digits = digits.replace(/^0+/, "");
    if (digits === "") return null;
  }

  // A number that already carries the country code but no "+" ("905309162863").
  // Guarded by a length check so a *local* number that merely happens to start
  // with the country digits is not silently beheaded.
  if (
    countryDigits !== "" &&
    digits.startsWith(countryDigits) &&
    digits.length > countryDigits.length + 6
  ) {
    const candidate = `+${digits}`;
    return isValidE164(candidate) && hasExpectedNationalLength(candidate)
      ? candidate
      : null;
  }

  const candidate = `+${countryDigits}${digits}`;
  return isValidE164(candidate) && hasExpectedNationalLength(candidate)
      ? candidate
      : null;
}
