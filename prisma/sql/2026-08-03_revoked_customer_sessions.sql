-- 2026-08-03 — revoked_customer_sessions
--
-- Backfills the table for prisma/schema.prisma `model RevokedCustomerSession`,
-- which was added in commit 9188171 but never pushed to Neon.
--
-- WHY THIS MATTERS: src/lib/customer-session.ts `isRevoked()` fails CLOSED —
-- any error from this lookup is treated as "revoked". With the table missing,
-- every query raised 42P01, so `getCustomerSession()` returned null for EVERY
-- customer with a perfectly valid cookie. Symptoms: OTP login never lands on
-- /customer/dashboard, and /card/<uuid> bounces to the login screen, which in
-- turn means the customer can never display a QR code for staff to scan.
--
-- Written by hand rather than via `prisma db push` so nothing else is touched.
-- Column types match what Prisma generates for the model:
--   String @id @db.Uuid  -> UUID
--   DateTime             -> TIMESTAMP(3)
--   @default(now())      -> DEFAULT CURRENT_TIMESTAMP
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS "revoked_customer_sessions" (
    "jti"         UUID         NOT NULL,
    "customer_id" TEXT         NOT NULL,
    "expires_at"  TIMESTAMP(3) NOT NULL,
    "revoked_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revoked_customer_sessions_pkey" PRIMARY KEY ("jti")
);

-- Supports the opportunistic prune in revokeJti().
CREATE INDEX IF NOT EXISTS "revoked_customer_sessions_expires_at_idx"
    ON "revoked_customer_sessions" ("expires_at");

-- Deliberately NOT a foreign key to customers(id): a revocation must outlive
-- the row it refers to, and deleteCustomer() must not have to know about this
-- table to keep its transaction correct.
CREATE INDEX IF NOT EXISTS "revoked_customer_sessions_customer_id_idx"
    ON "revoked_customer_sessions" ("customer_id");
