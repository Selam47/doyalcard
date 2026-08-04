// src/lib/customer-validation.ts
//
// The zod fragments that describe a customer's own details, shared by EVERY
// surface that can bring a Customer row into existence:
//
//   • src/actions/customer.ts        → registerCustomer  (staff registers someone)
//   • src/app/api/customer/auth      → the OTP callback   (customer self-registers)
//
// They live here rather than next to either caller because the two doors lead
// to the same table. When the KVKK rule was written out twice, one copy was a
// `z.refine(val === true)` and the other was an implicit truthiness check on a
// form field — which is how a row could be created with `kvkkConsent: false`
// through one door while the other door refused. A shared fragment makes
// "consent is the literal `true`" a property of the schema, not of the caller.
//
// Plain module, no "use server" and no "server-only": these are pure schemas
// with no database access, and the client register form re-uses the same rules
// to validate before it ever spends an SMS.

import { z } from "zod";

/**
 * Customer display name. Identical to the rule `registerCustomer` has always
 * applied — do not loosen it on one side only, or a name the cashier could not
 * enter becomes enterable by the customer (and vice versa).
 */
export const CustomerNameSchema = z
  .string()
  .min(2, "Ad en az 2 karakter olmalı")
  .max(100, "Ad en fazla 100 karakter olabilir")
  .trim();

/**
 * Raw phone input, BEFORE normalization. This only screens obvious junk; the
 * authoritative step is always `normalizePhoneToE164`, which is what decides
 * whether two strings describe the same human.
 */
export const CustomerPhoneInputSchema = z
  .string()
  .min(10, "Geçerli bir telefon numarası girin")
  .max(20, "Geçerli bir telefon numarası girin")
  .regex(/^[+]?[\d\s()-]+$/, "Geçerli bir telefon numarası formatı girin");

/**
 * KVKK consent.
 *
 * `z.boolean().refine((val) => val === true)` and NOT `z.literal(true)` on
 * purpose: this is the exact expression `registerCustomer` has always used, and
 * keeping it identical is the point of the extraction. Consent must be an
 * explicit affirmative act — `"true"`, `1`, `"on"` and any other truthy value
 * are NOT consent and must fail here rather than be coerced.
 */
export const KvkkConsentSchema = z.boolean().refine((val) => val === true, {
  message: "KVKK onayı zorunludur",
});

/** The message shown wherever consent is missing, so both doors say the same thing. */
export const KVKK_REQUIRED_MESSAGE = "KVKK onayı zorunludur";
