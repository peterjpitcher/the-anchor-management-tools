# PayPal Table Booking Deposits — Design Spec

**Date:** 2026-03-15
**Status:** Approved
**Scope:** Two codebases — OJ-AnchorManagementTools and OJ-The-Anchor.pub

---

## Problem

Customers booking Sunday lunch or a table for 7+ people are required to pay a £10/person deposit. Today this works via an SMS sent after booking, containing a Stripe payment link. This creates friction and drop-off — customers book but never pay.

The goal is to collect payment **inline at the point of booking** on the-anchor.pub, and to use **PayPal** as the sole payment method for deposits on table bookings.

For phone bookings entered by staff into AnchorManagementTools, the SMS-with-link flow is retained — but the link now leads to a PayPal payment page rather than Stripe.

---

## Deposit Rules (unchanged)

- **Trigger:** Sunday lunch bookings OR any booking with party size ≥ 7
- **Amount:** £10 per person
- **Not a credit card hold** — a real deposit collected upfront

---

## Architecture

All PayPal business logic lives in **AnchorManagementTools**. The-Anchor.pub only renders PayPal buttons and proxies two API calls. Both payment paths (inline on website, SMS link for phone bookings) converge on the same capture logic.

```
Online booking (the-anchor.pub)          Phone booking (staff in AnchorManagementTools)
─────────────────────────────            ──────────────────────────────────────────────
Customer fills form                       Staff enters booking
        ↓                                         ↓
AnchorManagementTools API                AnchorManagementTools API
creates booking → pending_payment        creates booking → pending_payment
        ↓                                         ↓
The-Anchor.pub form transforms           SMS sent: "Pay your deposit here →"
→ shows PayPal buttons inline            [link to /g/[token]/table-payment]
        ↓                                         ↓
createOrder → AnchorManagementTools      Customer opens guest payment page
captureOrder → AnchorManagementTools     → PayPal buttons rendered
        ↓                                         ↓
Confirmation shown inline                Capture → confirmation page
        ↓                                         ↓
        └──────────── Both paths ─────────────────┘
              booking confirmed + confirmation SMS sent
```

---

## Section 1 — AnchorManagementTools Changes

### 1a. Database Migration

```sql
ALTER TABLE bookings
  ADD COLUMN paypal_deposit_order_id TEXT,
  ADD COLUMN paypal_deposit_capture_id TEXT,
  ADD COLUMN deposit_amount INTEGER;  -- stored in pence; derived from party_size × 1000

-- Add paypal as a valid payment method
ALTER TYPE table_booking_payment_method ADD VALUE IF NOT EXISTS 'paypal';
```

The existing `deposit_status` enum (`Required` / `Paid` / `Not Required`) is reused. On successful capture: `deposit_status → 'Paid'`, `payment_method → 'paypal'`, `status → 'confirmed'`.

`deposit_amount` is stored at booking creation time (when party size is known) rather than derived at render time, so the detail view always has an accurate figure even if party size is later amended.

### 1b. External API Endpoints

Two new routes authenticated via `ANCHOR_API_KEY` (same mechanism used by The-Anchor.pub today):

**`POST /api/external/table-bookings/[id]/paypal/create-order`**
- Fetches booking, validates deposit is required and not already paid
- Calculates amount server-side: `party_size × 10` GBP (never trusts client amount)
- If `paypal_deposit_order_id` already exists, returns it (idempotent)
- Calls `createSimplePayPalOrder()` from `src/lib/paypal.ts` with `requestId: \`tb-deposit-${bookingId}\`` to avoid collision with parking idempotency keys
- Stores `paypal_deposit_order_id` on the booking
- Logs `payment.order_created` audit event
- Returns `{ orderId }`

**`POST /api/external/table-bookings/[id]/paypal/capture-order`**
- Input: `{ orderId }` — body must include `bookingId` (same as `[id]` in path)
- Validates `orderId` matches stored `paypal_deposit_order_id`
- Calls `capturePayPalPayment()` from `src/lib/paypal.ts`
- On success: updates booking — `deposit_status = 'Paid'`, `payment_method = 'paypal'`, `paypal_deposit_capture_id`, `status = 'confirmed'`
- Logs `payment.captured` audit event
- Idempotent — returns success if already captured (checks `paypal_deposit_capture_id` before calling PayPal)
- Returns `{ success: true }`

Both endpoints validate API key, validate booking ownership, and return structured errors.

### 1c. Guest Payment Page Rebuilt

**File:** `src/app/g/[token]/table-payment/page.tsx`

The existing page is a server component rendering a `<form>` that POSTs to the `/checkout` route handler. This is replaced with a server component that fetches booking data and passes it to a new **client component** `TablePaymentClient` which handles all PayPal interaction.

**Server component responsibilities:**
- Validate guest token, fetch booking
- If `deposit_status === 'Paid'`: redirect to confirmation page immediately
- If booking hold has expired (`hold_expires_at < now()`): show "hold expired" message — booking may no longer be available
- Create or reuse `paypal_deposit_order_id` (server action)
- Pass `{ orderId, bookingRef, depositAmount, holdExpiresAt, partySize }` to client component

**Client component (`TablePaymentClient`) responsibilities:**
- Renders `PayPalScriptProvider` + `PayPalButtons`
- Shows hold expiry countdown (customer can see if their hold is close to expiring)
- `createOrder` callback returns the pre-created `orderId`
- `onApprove` → calls capture server action → shows inline confirmation
- `onError` → shows retry UI
- Handles `state=cancelled` search param (customer returned from abandoned PayPal flow) — shows reassuring message that their hold is still active

The `/checkout` route handler (`src/app/g/[token]/table-payment/checkout/route.ts`) is removed.

`NEXT_PUBLIC_PAYPAL_CLIENT_ID` and `@paypal/react-paypal-js` are already available.

### 1d. PayPal Webhook

**File:** `src/app/api/webhooks/paypal/table-bookings/route.ts`

A **separate webhook endpoint** registered in the PayPal dashboard, distinct from the existing private-bookings webhook. Requires its own env var `PAYPAL_TABLE_BOOKINGS_WEBHOOK_ID`.

Handles `PAYMENT.CAPTURE.COMPLETED` events:
1. Verifies signature via `verifyPayPalWebhook(headers, body, process.env.PAYPAL_TABLE_BOOKINGS_WEBHOOK_ID)`
2. Extracts `resource.id` (capture ID) and `resource.supplementary_data.related_ids.order_id`
3. Looks up booking by `paypal_deposit_order_id`
4. If booking already has `paypal_deposit_capture_id` — duplicate event, return 200 without reprocessing
5. Otherwise marks booking paid (same logic as capture endpoint)

Safety net for dropped browser connections during capture.

### 1e. SMS Flow

No change to SMS sending logic. The SMS already sends the `/g/[token]/table-payment` link. The page behind that link now uses PayPal instead of Stripe. Staff workflow is unchanged.

---

## Section 2 — The-Anchor.pub Changes

### 2a. Form State Machine

Two new states added to both booking forms:

```
idle → submitting → confirmed           (small groups, no deposit required)
                 → pending_payment      (7+ people or Sunday lunch)
                         → paying       (PayPal buttons rendered, customer interacting)
                         → confirmed    (after successful capture)
                         → pay_error    (PayPal failed — shows retry)
```

### 2b. PayPal Deposit UI

When `pending_payment` is returned from the API, the form transforms inline to show:

```
┌─────────────────────────────────────────┐
│  Almost there — secure your table       │
│                                         │
│  📅 Sunday 22 March · 1:00pm · 8 guests │
│  Deposit: £80 (£10 per person)          │
│                                         │
│  [  PayPal button  ]                    │
│                                         │
│  Your card details are never shared     │
│  with us. Powered by PayPal.            │
└─────────────────────────────────────────┘
```

- `createOrder` → calls `/api/table-bookings/paypal/create-order` (passing `bookingId`), returns `orderId`
- `onApprove` → calls `/api/table-bookings/paypal/capture-order` (passing `bookingId` + `orderId`), transitions to `confirmed`
- `onError` → transitions to `pay_error` with retry button and "or call us" fallback

`PayPalScriptProvider` wraps the booking page and lazy-loads the PayPal SDK only when `pending_payment` is reached.

### 2c. Shared Component

Both `ManagementTableBookingForm.tsx` and `SundayLunchBookingForm.tsx` share a single `PayPalDepositSection` component to avoid duplication. It accepts: `bookingId`, `depositAmount`, `bookingSummary`, `onSuccess`, `onError`. The `bookingId` is held in the component's scope and included in both API calls so the proxy routes can construct the correct upstream URL.

### 2d. New Proxy API Routes

Two thin routes — no business logic, just forwarding with API key. Both extract `bookingId` from the request body and include it in the upstream URL path:

- `POST /api/table-bookings/paypal/create-order`
  Body: `{ bookingId }` — validated as non-empty UUID (Zod) before forwarding
  Forwards to: `POST /api/external/table-bookings/[bookingId]/paypal/create-order`

- `POST /api/table-bookings/paypal/capture-order`
  Body: `{ bookingId, orderId }` — both validated as non-empty strings (Zod) before forwarding
  Forwards to: `POST /api/external/table-bookings/[bookingId]/paypal/capture-order`

### 2e. Confirmation

After capture, the existing `BookingConfirmation` component is shown — identical to a direct confirmed booking. "We've sent confirmation details by SMS" remains accurate since AnchorManagementTools sends the confirmation SMS on capture.

---

## Section 3 — Payment Status in AnchorManagementTools Staff UI

### 3a. BOH Bookings List

A dedicated **Deposit** column added to the table alongside the Status column:

| State | Badge |
|---|---|
| Not required | — (nothing shown) |
| Required, unpaid | 🟠 Deposit outstanding |
| Paid via PayPal | 🟢 Deposit paid · PayPal |
| Paid via card | 🟢 Deposit paid · Card |

Currently only "Deposit outstanding" shows in one specific combined state. The new column covers all states correctly, driven by `deposit_status` and `payment_method` fields.

### 3b. Booking Detail View

A **Payment** section added to `BookingDetailClient.tsx`:

**When paid:**
```
Deposit
● Paid via PayPal  ✓
  £80.00 · 15 Mar 2026
  Capture ID: 5XY12345ABC
```

**When outstanding:**
```
Deposit
⚠ Outstanding — £80.00
[Send payment link SMS]
```

Deposit amount displayed from stored `deposit_amount` column (added in migration 1a). Uses `paypal_deposit_capture_id`, `deposit_status`, and `payment_method`.

---

## Error Handling

| Scenario | Handling |
|---|---|
| PayPal order creation fails | Show "Unable to process payment — please call us" + log error |
| Customer abandons PayPal | Returns to form in `pending_payment` state; `state=cancelled` param shows reassuring message; buttons re-render |
| Booking hold expired | Guest page shows "hold expired" message; no payment UI shown |
| Capture fails (PayPal error) | Show retry button; if repeated failures, "please call us" fallback |
| Browser drops during capture | Webhook catches and marks booking paid |
| Double capture attempt | Idempotent — checks `paypal_deposit_capture_id` before calling PayPal; returns success |
| Booking already paid | create-order returns 409; UI shows "already confirmed" |
| Wrong `orderId` on capture | 400 error — orderId doesn't match stored value |

---

## Environment Variables

**AnchorManagementTools** (additions/changes):
```
PAYPAL_CLIENT_ID                      # already present
PAYPAL_CLIENT_SECRET                  # already present
PAYPAL_ENVIRONMENT                    # already present
PAYPAL_TABLE_BOOKINGS_WEBHOOK_ID      # NEW — separate from private bookings webhook
```

**The-Anchor.pub** (already present, no changes):
```
NEXT_PUBLIC_PAYPAL_CLIENT_ID
ANCHOR_API_KEY
ANCHOR_API_BASE_URL
```

---

## Testing Strategy

**AnchorManagementTools:**
- Unit tests for create-order endpoint: valid payload, booking not found, already paid (idempotent, returns existing orderId), PayPal API error → 502, deposit not required → 400
- Unit tests for capture-order endpoint: valid capture, wrong orderId → 400, already captured (idempotent), PayPal API error → 502
- Unit test for webhook: valid signature + correct event updates booking; duplicate event (already has captureId) is ignored; invalid signature → 401
- All PayPal SDK calls mocked — never hit real PayPal in tests

**The-Anchor.pub:**
- Unit tests for proxy routes: forwards bookingId correctly, handles upstream 409/400/502 errors
- Component tests for `PayPalDepositSection`: renders in pending_payment state, transitions to confirmed on success, shows retry on error, shows "call us" after repeated failures
- PayPal JS SDK mocked in tests

---

## Implementation Order

1. AnchorManagementTools DB migration (columns + enum value)
2. AnchorManagementTools external API endpoints (create-order, capture-order) + tests
3. AnchorManagementTools PayPal webhook handler + tests
4. AnchorManagementTools guest payment page rebuilt (`TablePaymentClient` component, hold expiry display, abandoned-flow handling)
5. AnchorManagementTools staff UI — deposit column in BOH list + detail panel payment section
6. The-Anchor.pub — `PayPalDepositSection` shared component
7. The-Anchor.pub — proxy API routes (create-order, capture-order)
8. The-Anchor.pub — wire `PayPalDepositSection` into `ManagementTableBookingForm` and `SundayLunchBookingForm`
9. Register new PayPal webhook in PayPal dashboard, set `PAYPAL_TABLE_BOOKINGS_WEBHOOK_ID`
10. End-to-end test in PayPal sandbox (both online booking flow and SMS link flow)
11. Deploy AnchorManagementTools first, then The-Anchor.pub
