# Ekrem Coşkun Döner — Loyalty Program (Doyalcard)

## Project Overview & Core Logic
This project is a full-fledged **Customer Loyalty and Reward Points Management System** designed for Ekrem Coşkun Döner. It allows customers to access a mobile-optimized PWA/web interface without needing a physical loyalty card. Customers sign in via SMS OTP, accumulate reward points on their purchases, and redeem rewards at the checkout counter using personal QR codes.

## Tech Stack
- **Framework:** Next.js (App Router, React, TypeScript)
- **Deployment & Hosting:** Vercel
- **Authentication:** Firebase Phone Auth (Identity Platform, Invisible reCAPTCHA, OTP SMS)
- **Database & ORM:** Neon DB (Serverless PostgreSQL) + Prisma ORM
- **Styling & UI:** Tailwind CSS, Sonner (Toast notifications)

---

## System Architecture & Authentication Flow

### 1. Customer Login & Auth Flow (`/customer/login`)
1. The customer enters their phone number in E.164 format (`+905XXXXXXXXX`).
2. Firebase Invisible reCAPTCHA evaluates the request and sends an OTP SMS code.
3. Upon OTP verification, the Firebase Client SDK generates a `firebaseUid`.
4. The client issues a request to `POST /api/customer/auth` containing `phone` and `firebaseUid`.
5. **Backend (Neon DB):**
   - Queries the `customers` table for the provided phone number/UID.
   - If not found, creates a new `Customer` record (`isNew: true`).
   - If exists, fetches the profile (`isNew: false`).
   - Establishes a session/cookie and redirects the user to `/customer/dashboard`.

### 2. Admin / Cashier Operation (`/admin`)
- Store staff enters the customer's phone number or scans the customer's personal QR code from their dashboard.
- Based on the purchase amount, the system automatically calculates and awards loyalty points.
- When a customer redeems a reward, the staff scans the generated redemption QR code to deduct points.

---

## Database Schema Model (Prisma + PostgreSQL)

- **Customer:** `id`, `phone` (unique), `firebaseUid` (unique), `totalPoints`, `createdAt`, `updatedAt`
- **Transaction:** `id`, `customerId`, `amount`, `pointsEarned`, `pointsRedeemed`, `type` (EARN / REDEEM), `createdAt`
- **AdminUser:** Handles cashier and management portal authentication/authorization.

---

## Development Guidelines & Rules for Claude

1. **Firebase reCAPTCHA Lifecycle Rules:**
   - The `#recaptcha-container` DOM node MUST remain continuously mounted. Never render it conditionally (e.g., avoid `{step === 'phone' && ...}`).
   - Do **NOT** call `RecaptchaVerifier.reset()` (it breaks TypeScript builds in Firebase v10+). Always use `verifier.clear()` or teardown via `destroyRecaptcha()`.

2. **Phone Number Standardization:**
   - All phone numbers must be formatted and sanitized into international E.164 format (`+905XXXXXXXXX`) across Firebase, backend APIs, and the database.

3. **Database Transactions:**
   - Any point adjustments along with transaction log creations (`Transaction`) MUST be executed atomically inside a Prisma `$transaction` block.

4. **UI/UX Standards:**
   - Mobile-first approach is mandatory. The customer portal must feel like a native PWA when viewed on mobile screens.