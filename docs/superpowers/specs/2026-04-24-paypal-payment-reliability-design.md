# PayPal Payment Reliability — Design Spec

> **Status:** Draft — consultant review incorporated, ready for implementation planning
> **Date:** 2026-04-24
> **Triggered by:** Sam Joy's £100 deposit payment lost — paid via card on PayPal checkout, booking never updated

---

## 1. Problem Statement

PayPal payments for private booking deposits are silently failing. The `webhook_logs` table shows a continuous stream of `signature_failed` entries (two every ~2 hours) since at least 23 April 2026. Every PayPal webhook delivery to the private-bookings endpoint is rejected, meaning **no customer deposit payment via the email link flow has been recorded since the webhook broke**.

Additionally, the system has architectural gaps that make it fragile even when the webhook is working correctly.

---

## 2. Discovery Findings

### 2.1 Root Cause — Webhook Signature Verification Failure

**Evidence:** 20+ consecutive `signature_failed` rows in `webhook_logs` with `source: private_bookings`, `event_id: null`, `event_type: null`, spanning 23–24 April 2026.

**Cause:** All four PayPal webhook routes share a single `PAYPAL_WEBHOOK_ID` environment variable. PayPal requires the webhook ID used for signature verification to match the specific webhook subscription registered in the PayPal dashboard. If the dashboard has separate subscriptions per endpoint URL, each has its own ID — but only one can match the shared env var.

**Impact:** Every webhook to `/api/webhooks/paypal/private-bookings` fails verification → returns 401 → PayPal retries with exponential backoff → all retries also fail → PayPal eventually gives up → payment is never recorded.

### 2.2 No Capture-on-Return for Customer Email Flow

**The two payment paths:**

| Path | Trigger | Capture mechanism | Status |
|------|---------|-------------------|--------|
| **A — Staff in-browser** | Staff clicks "Pay via PayPal" on admin page | `useEffect` on return URL calls `captureDepositPayment()` server action | Has a return URL bug (see 2.3) |
| **B — Customer email link** | Staff sends payment link, customer clicks | Webhook only — no capture on return | **Broken** (webhook failing) |

In Path B, when the customer completes payment and returns to `/booking-portal/[token]?payment_pending=1`, the portal page displays a "Payment received — being processed" banner but **does not call PayPal's capture API**. The order sits in `APPROVED` state indefinitely.

**This is worse than a webhook problem.** The webhook handler only processes `PAYMENT.CAPTURE.COMPLETED` events (route.ts line 223). But PayPal's Orders API with `intent: CAPTURE` requires the **server** to call `/v2/checkout/orders/{id}/capture` after buyer approval — the `PAYMENT.CAPTURE.COMPLETED` webhook only fires *after* that capture call succeeds. Since neither the portal return flow nor the webhook makes the capture call, the order can never progress from `APPROVED` to `COMPLETED`. The webhook cannot rescue an uncaptured order.

**Key architectural gap:** There is no fallback. The return flow doesn't capture, the webhook can't capture (it only reacts to already-captured orders), and there's no reconciliation job, no manual retry, no alerting. An approved-but-uncaptured order expires after ~72 hours and the money is never collected.

### 2.3 Staff Return URL Bug

**File:** `src/app/actions/privateBookingActions.ts` line 1710

```
returnUrl: `${appUrl}/private-bookings/${bookingId}?paypal_return=deposit&order_id=`
```

The URL ends with `order_id=` expecting PayPal to append the order ID value. However, PayPal appends its own `token` query parameter, not a value to an existing parameter. The `useEffect` at `PrivateBookingDetailClient.tsx:1616` checks `searchParams.get('order_id')` — which is empty — and aborts silently. The staff member sees the booking page but the capture never fires.

### 2.4 Silent Failure Paths in Webhook Handler

**File:** `src/app/api/webhooks/paypal/private-bookings/route.ts`

| # | Failure path | Risk | Booking updated? |
|---|-------------|------|-----------------|
| 1 | `custom_id` missing or doesn't start with `pb-deposit-` | HIGH | No — returns 200, PayPal stops retrying |
| 2 | Stuck idempotency claim (crashed function) | MEDIUM | No — returns 409 for 30 days |
| 3 | `deposit_paid_date` already set (expected) | LOW | No (intentional idempotency) |
| 4 | UPDATE affects zero rows (race with UI path) | HIGH | No — but writes a false-positive audit log |
| 5 | Unhandled event type with matching custom_id | MEDIUM | No — returns 200 |
| 6 | PayPal verification API outage | MEDIUM | No — returns 401, retries may recover |
| 7 | Audit log insert fails after successful update | LOW | Yes (update committed) — but 500 loop |

### 2.5 Affected PayPal Webhook Routes

| Route | Env var used | Purpose |
|-------|-------------|---------|
| `/api/webhooks/paypal` | `PAYPAL_WEBHOOK_ID` | General PayPal events |
| `/api/webhooks/paypal/private-bookings` | `PAYPAL_WEBHOOK_ID` | Private booking deposits |
| `/api/webhooks/paypal/parking` | `PAYPAL_WEBHOOK_ID` | Parking payments |
| `/api/webhooks/paypal/table-bookings` | `PAYPAL_WEBHOOK_ID` | Table booking deposits |

All share the same env var. This is only correct if a single PayPal webhook subscription fans out to all routes (e.g. via the general `/api/webhooks/paypal` handler forwarding). If they're registered as separate subscriptions in the PayPal dashboard, each needs its own webhook ID.

---

## 3. Proposed Fixes

### Fix 1 — Resolve Webhook ID Mismatch (Critical, immediate)

**Options:**

**(a) Single webhook subscription + router pattern**
Register one webhook URL in PayPal (`/api/webhooks/paypal`) and have the general handler route events to domain-specific handlers based on `custom_id` prefix. One webhook ID, one subscription, one verification step.

**(b) Separate webhook IDs per route (recommended for P0)**
Add `PAYPAL_PRIVATE_BOOKINGS_WEBHOOK_ID`, `PAYPAL_PARKING_WEBHOOK_ID`, `PAYPAL_TABLE_BOOKINGS_WEBHOOK_ID` env vars. Each route uses its own. Requires matching each to the correct PayPal dashboard subscription.

**Recommendation (updated per consultant review):** Option (b) for the immediate P0 fix. The single router pattern (a) is the better long-term architecture, but the current general handler (`/api/webhooks/paypal/route.ts`) only logs to `audit_logs` — it has no routing logic or domain-specific processing. Additionally, `custom_id` schemes are inconsistent across domains: private bookings use `pb-deposit-{id}`, parking uses raw booking IDs, and table bookings resolve by PayPal order ID. Refactoring all of this safely while the system is broken is higher risk than simply giving each route its own webhook ID. Option (a) can be pursued as a follow-up architectural improvement.

### Fix 2 — Add Capture-on-Return for Customer Email Flow (Critical)

When the customer returns from PayPal to the booking portal, capture the payment immediately:

1. The `returnUrl` for Path B should include the PayPal order ID (e.g. `?payment_pending=1&order_id={orderId}`)
2. The booking portal page (or a client component within it) detects `payment_pending=1` + `order_id` and calls a new server action
3. New server action: `captureDepositPaymentByToken(bookingToken, paypalOrderId)` — authorises via the booking portal token (not staff auth), captures the PayPal order, and updates the booking
4. On success: show confirmed state. On failure: show "please contact us" message with the PayPal order reference

**This makes the return flow the primary capture mechanism**, with the webhook as a backup/reconciliation layer rather than the sole mechanism.

### Fix 3 — Fix Staff Return URL (High)

Change the `returnUrl` in `createDepositPaymentOrder` to not rely on PayPal appending to a bare `order_id=`. Instead, read the `token` parameter from PayPal's return redirect (which contains the order ID) in the `useEffect`.

### Fix 4 — Add Payment Reconciliation Cron (Critical)

A scheduled job that catches anything the return flow and webhook both missed. **This is the durable recovery path** — browser returns are inherently lossy (customer closes tab, network drop, JS error), and webhooks can fail for configuration or infrastructure reasons. The reconciliation cron is the safety net that guarantees eventual consistency.

1. Query `private_bookings` where `paypal_deposit_order_id IS NOT NULL` and `deposit_paid_date IS NULL` and `status = 'draft'`
2. For each, call PayPal's GET `/v2/checkout/orders/{orderId}` to check status
3. If status is `COMPLETED`: update the booking (deposit paid, confirm status)
4. If status is `APPROVED` but not captured: attempt capture via POST `/v2/checkout/orders/{id}/capture`, then update
5. If status is `VOIDED` or expired: log, clear `paypal_deposit_order_id`, and optionally notify staff so they can resend a link

**Schedule:** Every 15 minutes via `/api/cron/paypal-private-booking-reconciliation` (fits existing Vercel cron pattern in `vercel.json`).

### Fix 5 — Harden Webhook Handler (Medium)

1. **Zero-row UPDATE detection:** After the UPDATE, use `.select('id').maybeSingle()` to confirm the row was actually modified (Supabase updates without `select()` don't give row-count confidence). Log a warning if no row was returned.
2. **Stuck idempotency claim cleanup:** Add a TTL check — if a claim has been in `processing` state for >5 minutes, allow reclaim
3. **Structured logging for verification failures:** Replace `console.error` in `verifyPayPalWebhook` with the structured logger so failures appear in `webhook_logs`
4. **Handle `PAYMENT.CAPTURE.PENDING`:** Log it properly rather than silently ignoring

### Fix 6 — Add Webhook Health Monitoring (Medium)

1. Track the last successful webhook per source in a simple table or KV
2. If no successful webhook in >24 hours for an active source, alert (email or Slack)
3. Dashboard widget showing webhook health status

---

## 4. Priority Order

| Priority | Fix | Effort | Impact |
|----------|-----|--------|--------|
| P0 | Fix 1 — Webhook ID mismatch (separate env vars) | S | Unblocks all current and queued webhook deliveries |
| P0 | Fix 2 — Capture-on-return for customer flow | M | Ensures payments are captured even without webhook |
| P0 | Fix 3 — Staff return URL | S | Fixes in-browser payment capture for staff |
| P0 | Fix 4 — Reconciliation cron | M | Durable recovery path — catches everything return flow and webhook miss |
| P1 | Fix 5 — Harden webhook handler | M | Prevents future silent failures |
| P1 | Fix 6 — Webhook health monitoring | S | Early warning system |
| P2 | Fix 1a — Single router refactor (future) | L | Architectural improvement — consolidate webhook routing |

---

## 5. Immediate Action Required

Before any code changes, Sam Joy's payment needs manual resolution:

1. Log into PayPal dashboard → search for order `02657028176815622`
2. If the order shows as `APPROVED` → capture it manually in PayPal
3. If already `COMPLETED` → note the capture ID
4. In the app, manually record the deposit as paid (method: `paypal` to maintain PayPal traceability — even though he used a card, it went through PayPal's checkout). Also store the PayPal order/capture reference somewhere visible so the payment source is auditable.
5. Booking will transition from `draft` to `confirmed`

**Additional finding:** The webhook has been broken since **26 March 2026** — nearly a month. There are **196 total `signature_failed` entries** spanning from `2026-03-26 09:37:17` to `2026-04-24 14:11:57`. Any customer who paid via the email link flow during this period would have had their payment lost.

Sam Joy is currently the only booking with a PayPal order ID and no payment recorded, suggesting most deposits during this period were either paid in person (staff recorded manually) or via the staff in-browser flow (which has its own capture path, albeit with the return URL bug).

---

## 6. Success Criteria

- [ ] All PayPal webhook deliveries pass signature verification
- [ ] Customer email payment flow captures deposits on return (no webhook dependency)
- [ ] Staff in-browser payment flow captures deposits on return correctly
- [ ] Reconciliation cron catches any payments missed by both return flow and webhook
- [ ] Zero-row UPDATE in webhook handler is detected and logged
- [ ] Webhook health monitoring alerts when deliveries fail for >24 hours
- [ ] Sam Joy's booking is confirmed with payment recorded

---

## 7. Out of Scope

- Migrating away from PayPal (separate initiative)
- Parking or table booking PayPal flows (separate review needed, but likely affected by the same webhook ID issue)
- Stripe integration for private bookings (not currently implemented)
- Refactoring the PayPal library beyond what's needed for these fixes

---

## 8. Consultant Review — Resolved Questions

Questions from the initial draft, with answers from the 3rd-party review:

1. **Single router vs. separate webhook IDs:** Separate env vars per route is the safer P0 fix. The single router is better long-term architecture but requires refactoring the general handler (currently audit-only) and harmonising inconsistent `custom_id` schemes across domains. → **Resolved: separate env vars for P0, router refactor deferred to P2.**

2. **Capture-on-return vs. webhook-first:** The return flow should be the primary capture mechanism. PayPal's Orders API with `intent: CAPTURE` requires a server-side capture call after approval — the `PAYMENT.CAPTURE.COMPLETED` webhook only fires *after* capture succeeds, so the webhook cannot rescue an uncaptured order. Both paths should attempt capture with existing idempotency handling dedup. → **Resolved: return flow captures, webhook confirms, reconciliation cron is the durable fallback.**

3. **PayPal order expiry:** ~72 hours for approved-but-uncaptured orders (per PayPal Orders API docs). The reconciliation cron should handle expired orders by clearing `paypal_deposit_order_id` and notifying staff to resend. → **Resolved: cron handles expiry.**

4. **Guest card payments:** No difference in event types — `PAYMENT.CAPTURE.COMPLETED` fires identically for guest card and PayPal balance payments. The webhook handler does not filter on payment instrument. → **Resolved: not a factor.**

5. **Retry behaviour:** PayPal retries non-2xx responses up to 25 times over 3 days. The `signature_failed` stream has been running since 26 March (~29 days), so all retry windows for older events are long exhausted. Only very recent events (last 3 days) may still have pending retries. → **Resolved: reconciliation cron will catch anything retries missed.**

### Remaining Open Question

6. **PayPal dashboard configuration:** Need to verify the actual webhook subscription setup in the PayPal dashboard — how many subscriptions exist, what URLs are registered, and what their individual webhook IDs are. This determines whether Fix 1 requires creating new subscriptions or just correcting env vars.
