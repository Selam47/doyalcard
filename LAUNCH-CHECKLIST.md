# Launch Checklist — Doyalcard

Generated during the pre-launch audit. Work top to bottom.

---

## 0. Blockers — do these first

### 0.1 Verify the `revoked_customer_sessions` table exists in the PRODUCTION database

**If it does not, no customer can log in at all.** `isRevoked()` in
`src/lib/customer-session.ts` fails *closed*: when the table is missing, every
query raises `42P01`, every session is treated as revoked, and
`getCustomerSession()` returns `null` even for perfectly valid cookies. The
symptom is "OTP verified, but the dashboard bounces back to login", and the only
trace is one line in the server log. This has already happened once in this
project.

```sql
-- Should return one row:
SELECT to_regclass('public.revoked_customer_sessions');
```

If it returns `NULL`, run `prisma/sql/2026-08-03_revoked_customer_sessions.sql`
(or `npx prisma db push`) against production.

### 0.2 Set `NEXT_PUBLIC_BASE_URL` to the real customer-facing domain

`getBaseUrl()` in `src/lib/qr.ts` resolves in this order:

1. `window.location.origin` — browser only
2. `NEXT_PUBLIC_BASE_URL`
3. `NEXT_PUBLIC_APP_URL`
4. `VERCEL_URL`
5. `""`

QR codes are generated in **server components** (`/card/[uuid]`,
`/customer/dashboard`, `/staff/customer/[uuid]`), where `window` does not exist.
So:

- If none of the env vars are set, the QR encodes the relative string
  `/card/<uuid>`. **A phone camera cannot open that.** No error is thrown — the
  QR simply does not work, which breaks the core flow of the product.
- If only `VERCEL_URL` is set, the QR encodes the *per-deployment* hostname
  (`ecoskun-<hash>.vercel.app`), not your custom domain. Codes printed today
  point at a URL that changes on the next deploy.

Set `NEXT_PUBLIC_BASE_URL` explicitly, with no trailing slash, e.g.
`https://doyalcard.com`.

### 0.3 Run the build locally

The pre-launch audit could only verify `npx tsc --noEmit` (passes clean).
`npm run build` was **not** run. Per `CLAUDE.md` §7 both are required.

```bash
npx tsc --noEmit && npm run build
```

---

## 1. Required environment variables

Every `process.env.X` reference in the codebase, verified against actual usage.
No typos were found.

| Variable | Required? | Used by |
| --- | --- | --- |
| `DATABASE_URL` | **Yes** | Prisma / Neon (pooled) |
| `DIRECT_URL` | **Yes** | Prisma migrations (direct connection) |
| `AUTH_SECRET` | **Yes** | NextAuth JWT **and** the customer session JWT (`customer-session.ts`). Rotating it logs out every staff member and every customer at once. |
| `NEXT_PUBLIC_BASE_URL` | **Yes** — see 0.2 | `src/lib/qr.ts` |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | **Yes** | Firebase Phone Auth client |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | **Yes** | Firebase Phone Auth client |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | **Yes** | Firebase client **and** server-side ID-token verification (`/api/customer/auth` returns 500 without it) |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Yes | Firebase client init |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Yes | Firebase client init |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Yes | Firebase client init |
| `NEXT_PUBLIC_APP_URL` | Optional | Fallback for `NEXT_PUBLIC_BASE_URL`. Not in `.env.example` — intentional, not a typo. |
| `VERCEL_URL` | Auto | Injected by Vercel. Last-resort fallback only. |
| `NODE_ENV` | Auto | Sets the `secure` flag on the session cookie |

Also confirm in the Firebase console: the production domain is on the
**Authorized domains** list, or OTP SMS will fail on the live domain only.

---

## 2. Manual end-to-end test

Run against production (or a preview pointed at a **non-production** database)
with a real phone. Nothing below can be verified by static analysis.

### 2.1 Customer self-registration + KVKK

1. Open `/customer/login` on a phone, enter a number that has **never** been
   registered.
2. Receive the OTP, enter it.
3. → Expect the **KVKK consent screen** (backend answered `428`).
4. Confirm no `customers` row exists yet for that number.
5. Tick the box, submit. → lands on `/customer/dashboard`.
6. Confirm the row now exists with `kvkk_consent = true` and a non-null
   `kvkk_consent_at`.
7. Confirm **no second SMS** was sent for step 5.

### 2.2 Stamping

1. Sign in as staff at `/login`, go to `/staff`.
2. Scan the customer's QR with the **in-app scanner** → lands on
   `/staff/customer/<uuid>`.
3. Press **+1 Sipariş**. Check `currentCycleCount` and `lifetimeCount` both went
   up by exactly 1, and one `orders` row was created.
4. Press **-1 Damga**. Both counters go back down and the order row is deleted.
5. Stamp up to one below the threshold, then stamp once more →
   a `PENDING` reward appears and `currentCycleCount` resets to 0.
6. Press **-1 Damga** immediately after that reward-granting stamp →
   must be **refused** with the "son siparişe bir ödül bağlı" message, and
   nothing may change. (This is what keeps `orders.count() == lifetimeCount`.)
7. Claim the reward → status flips to `CLAIMED`, `claimedAt` set.

### 2.3 The public card — the one that must not break

1. Take a **different** phone that has never signed in.
2. Point the raw camera app (not the site) at the printed/displayed QR.
3. It must open `/card/<uuid>` and render the card **immediately** — no login,
   no redirect, no blank screen.
4. Confirm the page shows a **masked** phone number.
5. Confirm there is **no** `+1 Sipariş`, `-1 Damga`, `Müşteriyi Sil` button and
   **no** link to any staff page.
6. Repeat while signed in as an ADMIN in that browser — the page must look
   **identical**. Nothing on it may vary by viewer.

### 2.4 Two cashiers, one card (concurrency)

Have two staff devices open the same customer and press **+1 Sipariş** at the
same moment. Expect: counters land on +2, or one device shows
"Eşzamanlı işlem çakışması" and the operator retries. Never +1 with two order
rows, and never a lost update.

### 2.5 Admin dashboard

Load `/admin` and confirm the numbers match what you just did. If a counter
cannot be read the whole grid is replaced by a red error box — it will never
show a misleading `0`.

### 2.6 Immediate lockout

While a staff member is signed in and using `/staff`, set their `isActive` to
`false` in the admin panel. Their next page load must bounce to `/login`, and
any action they attempt must be refused.

---

## 3. Known residual risks

| Risk | Severity | Notes |
| --- | --- | --- |
| A leaked/copied customer token stays valid up to 12h | Low | Revocation exists (`jti` + `revoked_customer_sessions`), but only fires on explicit logout. Closing the browser drops the cookie without revoking the token. |
| `getCampaignRules()`, `getBranches()`, `getStaffUsers()` throw instead of returning a result | Low | Admin-only pages. Now caught by `src/app/admin/error.tsx` instead of showing a bare Next.js error screen. Convert to the `{success, data\|error}` contract after launch. |
| `/staff` is dynamic only incidentally (via `searchParams`), not via an explicit `force-dynamic` | Low | Add the export when convenient. See the note in `src/lib/revalidate.ts`. |
| Customer names and staff emails are written to server logs | Low (KVKK) | `src/actions/customer.ts:103,219`, `src/actions/reward.ts:66`. Consider logging ids only. |
| Rewards list is capped at 50 per card | Very low | `PENDING` always sorts first, so only old *claimed* history can fall out of the window — never something still owed. Depends on the `RewardStatus` enum keeping `PENDING` declared first. |
