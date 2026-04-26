# PayPal Refunds Design

## Overview

Add the ability for super_admin staff to issue full or partial refunds against PayPal deposit payments across all three payment domains: private bookings, table bookings, and parking. Supports both PayPal API refunds and manual refund recording (cash, bank transfer, other). Customers are notified via email (preferred) or SMS fallback when a PayPal refund is processed.

## Scope

### In Scope

- Full and partial PayPal refunds via API
- Manual refund recording (cash, bank transfer, other) — no API call
- Multiple partial refunds against a single deposit
- Refund UI on private booking, table booking, and parking detail pages
- super_admin permission gating (UI + server-side)
- Customer notification (email with SMS fallback) for PayPal refunds only
- Webhook handling for `PAYMENT.CAPTURE.REFUNDED` events
- Deposit refund status tracking (NULL / partially_refunded / refunded)
- Full audit trail
- Edge case handling: 180-day window, concurrent refunds, missing capture IDs

### Out of Scope

- Centralised payments/refund overview page (future iteration)
- Editable notification templates (hardcoded for now)
- Booking status changes on refund (deposit refund does not affect booking state)
- Refund queuing/retry on PayPal failure (staff retries manually)

## Data Model

### New Table: `payment_refunds`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, default `gen_random_uuid()` | |
| `source_type` | TEXT | NOT NULL | `'private_booking'`, `'table_booking'`, `'parking'` |
| `source_id` | UUID | NOT NULL | Polymorphic FK to source booking |
| `paypal_capture_id` | TEXT | | Original capture being refunded (NULL for manual). Maps to `paypal_deposit_capture_id` on private/table bookings, `transaction_id` on `parking_booking_payments`. |
| `paypal_refund_id` | TEXT | | Returned by PayPal API (NULL for manual) |
| `refund_method` | TEXT | NOT NULL | `'paypal'`, `'cash'`, `'bank_transfer'`, `'other'` |
| `amount` | NUMERIC(10,2) | NOT NULL | Refund amount in GBP |
| `original_amount` | NUMERIC(10,2) | NOT NULL | Snapshot of original deposit for integrity |
| `reason` | TEXT | NOT NULL | Staff-provided reason (internal only, not sent to customer) |
| `status` | TEXT | NOT NULL, default `'pending'` | `'pending'`, `'completed'`, `'failed'` |
| `refunded_by` | UUID | NOT NULL, FK `auth.users(id)` | The super_admin who initiated |
| `notification_status` | TEXT | | `'email_sent'`, `'sms_sent'`, `'skipped'`, `'failed'`, NULL (manual) |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `now()` | |

**RLS:** Enabled. Read for authenticated users (permission-gated in app layer). Insert/update via service role only (server actions).

**Indexes:**
- `idx_payment_refunds_source` on `(source_type, source_id)` — lookup refunds for a booking
- `idx_payment_refunds_paypal_refund_id` on `paypal_refund_id` — webhook deduplication

### New Columns on Existing Tables

| Table | Column | Type | Notes |
|-------|--------|------|-------|
| `private_bookings` | `deposit_refund_status` | TEXT | NULL / `'partially_refunded'` / `'refunded'` |
| `table_bookings` | `deposit_refund_status` | TEXT | NULL / `'partially_refunded'` / `'refunded'` |
| `parking_booking_payments` | `refund_status` | TEXT | NULL / `'partially_refunded'` / `'refunded'` |

Note: Parking stores payment data in a separate `parking_booking_payments` table (with `paypal_order_id`, `transaction_id`, `amount`), unlike private/table bookings which have PayPal columns directly on the booking row. The refund status column goes on the payment row for parking.

The `deposit_refund_status` / `refund_status` is updated by the server action after each successful refund by comparing total refunded vs original deposit amount. Avoids joins for at-a-glance status.

## Server Actions

### File: `src/app/actions/refundActions.ts`

#### `processPayPalRefund(sourceType, sourceId, amount, reason)`

1. **Auth** — `getUser()` + `checkUserPermission('super_admin')` — reject if not super_admin
2. **Load booking** — fetch source record, get `paypal_deposit_capture_id` and original deposit amount
3. **Validate capture exists** — reject if no capture ID ("No PayPal payment to refund")
4. **Validate capture date** — reject if >180 days ("PayPal refund window expired — use manual refund")
5. **Calculate remaining** — sum completed `payment_refunds` for this source, subtract from original. Reject if requested amount > remaining.
6. **Optimistic lock** — insert `payment_refunds` row with `status = 'pending'` before calling PayPal. Concurrent requests caught by step 5 balance check.
7. **Call PayPal** — `refundPayPalPayment(captureId, amount, reason)`
8. **On success:**
   - Update refund row → `status = 'completed'`, store `paypal_refund_id`
   - Update `deposit_refund_status` on booking (`'refunded'` or `'partially_refunded'`)
   - Send customer notification (email → SMS fallback)
   - Write audit log
   - `revalidatePath()`
   - Return `{ success: true, refundId }`
9. **On failure:**
   - Update refund row → `status = 'failed'`
   - Write audit log with error
   - Return `{ error: 'PayPal refund failed: [message]. You can try again or use manual refund.' }`

#### `processManualRefund(sourceType, sourceId, amount, reason, refundMethod)`

Same as above but:
- Skips PayPal capture validation (works for any payment method)
- Skips PayPal API call — records directly as `'completed'`
- `refund_method` = `'cash'` | `'bank_transfer'` | `'other'`
- No customer notification
- Still updates `deposit_refund_status` and writes audit log

#### `getRefundHistory(sourceType, sourceId)`

- Auth check — any authenticated staff with view permission on the relevant domain
- Returns all `payment_refunds` rows for the source, ordered by `created_at` desc
- Includes: amount, method, reason, status, refunded_by (with staff name), created_at, paypal_refund_id

## UI Design

### Refund Button

- **Location:** On each booking detail page, within the existing payment/deposit section
- **Visibility:** Only rendered for `super_admin` role
- **Condition:** Only shown when there is a paid deposit (any payment method)
- **Disabled state:** Greyed out with tooltip "Fully refunded" when deposit_refund_status = 'refunded'

### Refund Dialog (Modal)

| Element | Detail |
|---------|--------|
| Header | "Refund Deposit" |
| Deposit summary | Original amount, total already refunded, remaining refundable |
| Refund method | Radio group: "PayPal" (disabled if no capture ID or >180 days), "Cash", "Bank Transfer", "Other" |
| Amount input | Number field, pre-filled with remaining refundable, max capped at remaining |
| "Refund in full" button | Sets amount to remaining balance |
| Reason | Required textarea |
| Submit | "Process Refund" — disabled until amount > 0 and reason provided |
| Loading | Spinner + disabled form during API call |
| Error | Inline error banner if PayPal fails, with suggestion to use manual method |

### Payment Section Updates

- Deposit status badge: `Paid` / `Partially Refunded` / `Refunded`
- Refund history table below deposit info:
  - Columns: Date, Amount, Method, Reason, Processed By, PayPal Ref (if applicable), Status
  - Each row is a `payment_refunds` record

### Shared Components

The refund modal and refund history table are parameterised by `sourceType` and `sourceId` — same component used across all three domains.

## Webhook Handling

### Event: `PAYMENT.CAPTURE.REFUNDED`

Added to each existing webhook handler (`/api/webhooks/paypal/private-bookings/`, `/api/webhooks/paypal/table-bookings/`, `/api/webhooks/paypal/parking/`):

1. Extract `paypal_refund_id` from payload
2. Look up `payment_refunds` row by `paypal_refund_id`
3. **Found + status `completed`** → no-op (already processed by our API call)
4. **Found + status `pending`** → update to `completed` (API call timed out but PayPal processed it)
5. **Not found** → log to `webhook_logs` as unmatched refund for manual investigation
6. Idempotency key check — same 24-hour TTL pattern as existing capture webhooks

No changes to webhook signature verification — existing `verifyPayPalWebhook()` handles this.

## Customer Notification

### Trigger

Only for PayPal refunds (`refund_method = 'paypal'`), after successful processing. Manual refunds do not trigger notifications.

### Resolution Order

1. Check for email on customer/booking record → send via `sendEmail()` (Microsoft Graph)
2. If no email or send fails → check for phone number → send via Twilio SMS
3. If neither available → log `notification_skipped` in audit, do not block refund

### Email Template

```
Subject: Refund Confirmation — The Anchor

Hi {customerName},

We've initiated a refund of £{amount} to your PayPal account.

Please allow up to 5 business days for this to appear in your account.

If you have any questions, please don't hesitate to contact us.

Kind regards,
The Anchor Team
```

### SMS Template

```
Hi {customerName}, we've initiated a refund of £{amount} to your PayPal account. Please allow up to 5 business days for this to appear. — The Anchor
```

### Notification Recording

The `notification_status` column on `payment_refunds` records the outcome: `'email_sent'`, `'sms_sent'`, `'skipped'` (no contact info), or `'failed'` (both channels failed). NULL for manual refunds.

## Edge Cases

| Edge Case | Handling |
|-----------|----------|
| Refund exceeds remaining balance | Amount input capped at remaining refundable. Server-side validation rejects if exceeded. |
| No PayPal capture ID | "PayPal" radio option disabled. Only manual refund methods available. |
| Deposit not yet captured | Refund button not shown (no deposit_paid_date). |
| PayPal 180-day window | Check capture date. If >180 days, disable PayPal option with tooltip. Server-side rejects too. |
| Amount > original | Validation: max amount = original minus sum of completed refunds. |
| Concurrent refunds | Optimistic lock via pending row + balance check before PayPal call. |
| Webhook for unmatched refund | Logged to webhook_logs for manual investigation (e.g. refund issued directly in PayPal dashboard). |
| Audit completeness | Every refund (PayPal or manual) writes to audit_logs: who, when, amount, method, reason, PayPal ref if applicable, notification outcome. |

## Permissions

| Action | Required Role |
|--------|--------------|
| View refund history | Any authenticated staff with view permission on the domain |
| Process PayPal refund | `super_admin` only |
| Process manual refund | `super_admin` only |

Both UI rendering and server actions enforce the permission check independently.

## Existing Infrastructure Used

| Component | Location | Usage |
|-----------|----------|-------|
| `refundPayPalPayment()` | `src/lib/paypal.ts` | Already exists, calls PayPal refund API |
| `verifyPayPalWebhook()` | `src/lib/paypal.ts` | Webhook signature validation |
| `sendEmail()` | `src/lib/email/emailService.ts` | Email notification via Microsoft Graph |
| Twilio SMS service | `src/lib/sms/` | SMS fallback notification |
| `checkUserPermission()` | `src/services/PermissionService` | RBAC check |
| `logAuditEvent()` | Audit logging utility | Audit trail |
| PayPal webhook handlers | `src/app/api/webhooks/paypal/*/route.ts` | Add refund event handling |
