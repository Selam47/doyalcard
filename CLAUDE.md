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

### 3. Card Routes — Read Surface vs. Action Surface (SECURITY CRITICAL)

Two distinct routes render a stamp card. Never merge them.

| Route | Who may open it | What it renders |
| --- | --- | --- |
| `/card/[uuid]` | **Everyone. No login, no session, no cookie.** | Read-only card. **Zero** action buttons and **zero** links to `/staff/*` — the file does not import `StaffActionPanel`, `DeleteCustomerButton` or any mutation, and renders nothing that varies by viewer. |
| `/staff/customer/[uuid]` | Active `STAFF` / `ADMIN` only | Read-only card **plus** the staff action panel (`+1 Sipariş`, `-1 Damga`, `Müşteriyi Sil`). |

#### `/card/[uuid]` is public on purpose — do not gate it

This route is **intentionally outside the app's auth/session system**. A customer points a raw phone camera at the QR printed on their card; the camera opens a **fresh, cookie-less tab** straight at this URL and must render the card immediately. Any login requirement breaks the single flow the product exists for.

Concretely, three things must stay true together — fixing one without the others reintroduces the bug:

1. **`src/app/card/[uuid]/page.tsx` reads no session.** No `auth()`, no `getStaffPrincipal()`, no `getCustomerSession()`. The only non-render exit is `notFound()` for a UUID that matches no customer. There is no `redirect()` in the file.
2. **`src/middleware.ts` lets it through untouched** — `/card` is in `CUSTOMER_PAGE_PREFIXES` and returns `NextResponse.next()` *before* the session is consulted.
3. **`src/components/auth/TabSessionGuard.tsx` treats `/card` as public** — it is in `PUBLIC_PREFIXES`, not `CUSTOMER_PREFIXES`. A raw scan is *always* a "fresh tab", so guarding it there would bounce every scan to `/customer/login`, and the reset call would silently drop the scanner's own session (this is exactly how the cashier-logged-out-mid-shift bug happened). On `/card` the guard skips the `/api/session/reset` call entirely and never redirects.

**Auth work on other flows must not spread here.** Staff/admin layout guards, customer OTP login, tab-session invalidation and session-cookie rotation are all deliberately scoped away from `/card`. If a future "auth fix" adds a session read, a role branch or a redirect to any of the three files above, that is a regression, not a hardening.

#### What actually protects the card

Not authentication — **shape**:

- `Customer.qrUuid` is a v4 UUID (122 bits) and is **never** enumerated, listed, searched or range-queried. No route returns more than the single card the caller already named. `resolvePublicCardAccess()` shape-checks the UUID before touching the database.
- **`CARD_SELECT` in `src/lib/card-access.ts` is the privacy boundary.** It is a fixed, narrow projection and must never grow to include a raw phone number, email, address or extra internal id. `CustomerCardView` masks the phone at render time. Widening this select widens what a photographed QR code discloses.
- Read access confers nothing, because the page renders no mutation.

#### Remaining invariants

- `/card/[uuid]` MUST NOT gain an action button **or a link to the staff terminal**, ever — not behind a role check, not for an `ADMIN`. A role check that decides whether to render controls is one bug away from rendering them; the guarantee is structural — the page never learns who is looking, so nothing it renders can vary by viewer.
- Staff reach the till by signing into the staff portal and scanning with the **in-app scanner** (`src/components/staff/QrScannerSection.tsx`), which decodes `/card/<uuid>` and routes to `/staff/customer/<uuid>` itself. That is the only navigation path into the action surface.
- The two loaders live in `src/lib/card-access.ts` — `resolvePublicCardAccess` (no session, `/card`) and `resolveStaffCardAccess` (active staff required, `/staff/customer`). Keep them separate; a customer session must never satisfy the staff one. The module is a plain `server-only` file, deliberately NOT `"use server"`, because every export of a `"use server"` file is a publicly callable endpoint.
- The customer's QR encodes `/card/<uuid>` (that is what the customer's own phone opens). The staff scanner rewrites it to `/staff/customer/<uuid>` after decoding.

### 3a. Role Checks Must Hit the Database

`auth()` only decodes the JWT, which carries the role from **login time** and stays valid for its full lifetime. Never gate anything privileged on it directly. Use `src/lib/staff-guard.ts`:

- `getStaffPrincipal()` → `StaffPrincipal | null`, re-read from the `users` table.
- `authorizeStaff({ adminOnly? })` → `{ ok, staff } | { ok: false, error }` for Server Actions.

Both fail **closed** — a lookup error, missing row, `isActive: false` row or unexpected role resolves to unauthorized. This is what makes the "deactivating a user is an immediate lockout" promise true; without it a deactivated or demoted account keeps its old privileges for up to 30 days. Also derive `branchId` / `staffId` from the principal, never from `session.user`. There is no `CASHIER` role — the enum is `STAFF | ADMIN`.

### 4. Cashier Operation (`/staff`) & Admin Panel (`/admin`)
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