# Ekrem Coşkun Döner — Loyalty Program (Doyalcard)

## Project Overview & Core Logic
This project is a **Stamp-Card (Damga Kartı) Customer Loyalty System** designed for Ekrem Coşkun Döner. It allows customers to access a mobile-optimized PWA/web interface without needing a physical loyalty card. Customers sign in via SMS OTP, collect **one stamp per order** (no monetary point balance), and claim rewards at the checkout counter using their personal QR code.

> **There is no points system.** `totalPoints`, `pointsEarned` / `pointsRedeemed` and the old `Transaction` model were retired. The card state lives in two integer counters on `Customer` — `currentCycleCount` (resets on cycle completion) and `lifetimeCount` (never resets) — and rewards are rows in the `Reward` table.

## Tech Stack
- **Framework:** Next.js (App Router, React, TypeScript)
- **Deployment & Hosting:** Vercel
- **Authentication:**
  - *Customers:* Firebase Phone Auth (Identity Platform, Invisible reCAPTCHA, OTP SMS) → signed HTTP-only session cookie (`src/lib/customer-session.ts`)
  - *Staff & Admin:* NextAuth v5 Credentials provider + JWT sessions, bcrypt password hashes (`src/lib/auth.ts`)
- **Database & ORM:** Neon DB (Serverless PostgreSQL) + Prisma 7 (`prisma-client` generator → `src/generated/prisma`, `@prisma/adapter-pg` driver adapter)
- **Styling & UI:** Tailwind CSS, Sonner (Toast notifications)

---

## System Architecture & Authentication Flow

### 1. Customer Login & Auth Flow (`/customer/login`)
1. The customer enters their phone number in E.164 format (`+905XXXXXXXXX`).
2. Firebase Invisible reCAPTCHA evaluates the request and sends an OTP SMS code.
3. Upon OTP verification the client obtains a Firebase **ID token**.
4. The client `POST`s **only that `idToken`** to `/api/customer/auth` — never a bare `phone` / `uid` pair, which a caller could forge.
5. **Backend (Neon DB):**
   - Verifies the token's RS256 signature against Google's public JWKS, plus issuer and audience, and reads the phone number from the *verified* claims.
   - Looks the number up in `customers`; creates the row if missing (`isNew: true`).
   - Sets the HTTP-only session cookie and the client redirects to `/customer/dashboard`.

### 2. Staff & Admin Login (`/login`)
- NextAuth Credentials provider: email + bcrypt-verified password, JWT session carrying `id`, `role`, `branchId`, `branchName`.
- Inactive accounts (`isActive: false`) are rejected in `authorize()` — deactivating a user is an immediate lockout.

### 3. Cashier Operation (`/staff`) & Admin Panel (`/admin`)
- Staff searches by phone or scans the customer's personal QR code.
- **+1 order = +1 stamp.** No purchase amount is entered and nothing is multiplied into points.
- When `currentCycleCount` reaches the active cycle rule's `threshold`, a `Reward` row is created with status `PENDING` and the cycle counter resets to 0. Non-reset (milestone) rules grant an extra `PENDING` reward at their exact threshold.
- Claiming a reward flips its status to `CLAIMED` — it never subtracts a balance.

---

## Database Schema Model (Prisma + PostgreSQL)

Canonical source: `prisma/schema.prisma`. Keep every query in sync with it.

- **Branch:** `id`, `name`, `location?`, `isActive` — has `users`, `customers`, `orders`.
- **User** (staff & admin, table `users`): `id`, `name`, `email` (unique), `passwordHash`, `role` (`STAFF` | `ADMIN`), `isActive`, `lastLoginAt?`, `branchId?`. `Order.staffId` is `onDelete: SetNull`, so deleting a user preserves the order history.
- **Customer:** `id`, `name`, `phone` (unique, E.164), `qrUuid` (unique, `@db.Uuid`), **`currentCycleCount`**, **`lifetimeCount`**, `kvkkConsent`, `kvkkConsentAt?`, `isActive`, `branchId?`. There is no `firebaseUid` column — the phone number is the identity.
- **Order:** `id`, `customerId` (Cascade), `branchId?` (SetNull), `staffId?` (SetNull), `createdAt`. One row per stamp; there is no `amount` field.
- **CampaignRule:** `id`, `threshold` (unique), `rewardName`, `isResetPoint`, `isActive`, `validDays?`. The single active `isResetPoint` rule defines `maxStamps` — never hardcode 15.
- **Reward:** `id`, `status` (`PENDING` | `CLAIMED` | `EXPIRED`), `customerId` (Cascade), `ruleId` (Restrict), `orderId` (unique, Cascade), `claimedAt?`, `expiresAt?`.

---

## Development Guidelines & Rules for Claude

1. **Firebase reCAPTCHA Lifecycle Rules:**
   - The `#recaptcha-container` DOM node MUST remain continuously mounted. Never render it conditionally (e.g., avoid `{step === 'phone' && ...}`).
   - Do **NOT** call `RecaptchaVerifier.reset()` (it breaks TypeScript builds in Firebase v10+). Always use `verifier.clear()` or teardown via `destroyRecaptcha()`.

2. **Phone Number Standardization:**
   - All phone numbers must be formatted and sanitized into international E.164 format (`+905XXXXXXXXX`) across Firebase, backend APIs, and the database.

3. **Database Transactions:**
   - Any counter change (`currentCycleCount` / `lifetimeCount`) together with the `Order` and `Reward` rows it implies MUST run atomically inside a Prisma `$transaction` block, at `Serializable` isolation so two cashiers stamping the same card cannot lose an update.
   - Multi-row deletes (customer erasure, staff removal) likewise go in one `$transaction` so a failure can never leave half-detached rows.

4. **Server Action Error Contract:**
   - Mutations MUST return `{ success: false, error }` rather than `throw`. A thrown Server Action reaches the client as an opaque digest and surfaces as an unhandled rejection inside `startTransition`.
   - Clients MUST inspect the returned result before toasting success — never `await action(); toast.success(...)`.

5. **Deletion Safety:**
   - An admin can never delete or deactivate their own account, nor the last remaining active `ADMIN`.
   - Prefer the relation policy already declared in the schema (`SetNull` / `Cascade`) over refusing a delete outright; handle `P2025` (already gone) as success and `P2003` with an actionable message.

6. **UI/UX Standards:**
   - Mobile-first approach is mandatory. The customer portal must feel like a native PWA when viewed on mobile screens.

7. **Verification:**
   - After any change run `npx tsc --noEmit` and `npm run build`; both must finish with zero errors before the work is considered done.