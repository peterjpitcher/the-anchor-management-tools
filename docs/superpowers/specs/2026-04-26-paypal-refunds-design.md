# PayPal Refunds Design

## Overview

Add the ability for super_admin staff to issue full or partial refunds against PayPal deposit payments across all three payment domains: private bookings, table bookings, and parking. Supports both PayPal API refunds and manual refund recording (cash, bank transfer, other). Customers are notified via email (preferred) or SMS fallback when a PayPal refund is processed.

## Scope

### In Scope

- Full and partial PayPal refunds via API
- Manual refund recording (cash, bank transfer, other) — no API call
- Multiple partial refunds against a single deposit
- Refund UI on private booking, table booking, and parking detail pages
- super_admin permission gating (UI + server-side) via existing RBAC (`'refund'` action)
- Customer notification (email with SMS fallback) for PayPal refunds only
- Webhook handling for `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.REFUND.PENDING`, `PAYMENT.REFUND.FAILED`
- Deposit refund status tracking (NULL / partially_refunded / refunded)
- Full audit trail
- Edge case handling: 180-day window, concurrent refunds, missing capture IDs, PayPal pending/failed states
- Dashboard refund reconciliation for refunds initiated directly in PayPal dashboard
- Fix existing `refundPayPalPayment()` to use `PayPal-Request-Id` header and not leak internal reason to `note_to_payer`

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
| `source_type` | TEXT | NOT NULL, CHECK in (`'private_booking'`, `'table_booking'`, `'parking'`) | |
| `source_id` | UUID | NOT NULL | Polymorphic FK to source booking (or `parking_booking_payments.id` for parking) |
| `paypal_capture_id` | TEXT | | Original capture being refunded (NULL for manual). Maps to `paypal_deposit_capture_id` on private/table bookings, `transaction_id` on `parking_booking_payments`. |
| `paypal_refund_id` | TEXT | UNIQUE partial index WHERE NOT NULL | Returned by PayPal API (NULL for manual) |
| `paypal_request_id` | UUID | | Idempotency key sent as `PayPal-Request-Id` header. Generated before API call. Ensures safe retry on ambiguous network failures. |
| `paypal_status` | TEXT | | PayPal's refund status: `'PENDING'`, `'COMPLETED'`, `'FAILED'`, `'CANCELLED'`. NULL for manual refunds. |
| `paypal_status_details` | TEXT | | PayPal's `status_details.reason` field (e.g. `ECHECK`) when status is `PENDING`. |
| `refund_method` | TEXT | NOT NULL, CHECK in (`'paypal'`, `'cash'`, `'bank_transfer'`, `'other'`) | |
| `amount` | NUMERIC(10,2) | NOT NULL, CHECK > 0 | Refund amount in GBP |
| `original_amount` | NUMERIC(10,2) | NOT NULL | Snapshot of original deposit for integrity |
| `reason` | TEXT | NOT NULL | Staff-provided reason (internal only — never sent to PayPal or customer) |
| `status` | TEXT | NOT NULL, default `'pending'`, CHECK in (`'pending'`, `'completed'`, `'failed'`) | Local processing status |
| `initiated_by` | UUID | FK `auth.users(id)`, NULL for system-originated | The super_admin who initiated. NULL when refund originated from PayPal dashboard and was reconciled via webhook. |
| `initiated_by_type` | TEXT | NOT NULL, default `'staff'`, CHECK in (`'staff'`, `'system'`) | Distinguishes staff-initiated from webhook-reconciled refunds |
| `notification_status` | TEXT | CHECK in (`'email_sent'`, `'sms_sent'`, `'skipped'`, `'failed'`) or NULL | NULL for manual refunds or system-originated |
| `completed_at` | TIMESTAMPTZ | | When the refund was confirmed complete (API response or webhook) |
| `failed_at` | TIMESTAMPTZ | | When the refund was confirmed failed |
| `failure_message` | TEXT | | Error detail from PayPal or internal failure |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `now()` | |

**RLS:** Enabled. No direct reads — all access through service-role server actions. The `getRefundHistory` action enforces domain-level permission checks (`private_bookings/view`, `table_bookings/view`, `parking/view`) before returning data, keeping internal reasons hidden from unprivileged users.

**Indexes:**
- `idx_payment_refunds_source` on `(source_type, source_id)` — lookup refunds for a booking
- `idx_payment_refunds_paypal_refund_id` on `paypal_refund_id` WHERE `paypal_refund_id IS NOT NULL` (partial unique) — webhook deduplication
- `idx_payment_refunds_paypal_capture_id` on `paypal_capture_id` WHERE `paypal_capture_id IS NOT NULL` — dashboard refund reconciliation by capture ID

### New Columns on Existing Tables

| Table | Column | Type | Notes |
|-------|--------|------|-------|
| `private_bookings` | `deposit_refund_status` | TEXT | NULL / `'partially_refunded'` / `'refunded'` |
| `table_bookings` | `deposit_refund_status` | TEXT | NULL / `'partially_refunded'` / `'refunded'` |
| `parking_booking_payments` | `refund_status` | TEXT | NULL / `'partially_refunded'` / `'refunded'` |

Note: Parking stores payment data in a separate `parking_booking_payments` table (with `paypal_order_id`, `transaction_id`, `amount`), unlike private/table bookings which have PayPal columns directly on the booking row. The refund status column goes on the payment row for parking.

The `deposit_refund_status` / `refund_status` is updated by the server action after each successful refund by comparing total refunded vs original deposit amount. Only updated when refund status reaches `'completed'` — not on `'pending'`.

### Capture Date Source (for 180-day window check)

| Domain | Column | Notes |
|--------|--------|-------|
| Private bookings | `deposit_paid_date` | On `private_bookings` table |
| Table bookings | `deposit_paid_date` | On `table_bookings` table. If missing, fall back to `created_at` of the booking and warn in UI. |
| Parking | `paid_at` | On `parking_booking_payments` table |

## Changes to `src/lib/paypal.ts`

### Fix `refundPayPalPayment()`

The existing function needs three changes:

1. **Add `PayPal-Request-Id` header** — accept a `requestId` parameter (UUID) and pass it as the `PayPal-Request-Id` header. This is PayPal's documented REST idempotency mechanism. If the same `requestId` is sent twice, PayPal returns the original response instead of creating a duplicate refund.

2. **Do not send `note_to_payer`** — the current code maps `reason` to `note_to_payer`, which PayPal shows in the payer's transaction history and email. Since we decided the reason is internal only, remove the `note_to_payer` field entirely.

3. **Return full status information** — currently returns `{ refundId, status, amount }`. Extend to also return `status_details` (for PENDING reason) and the raw PayPal status string.

Updated signature:
```typescript
export async function refundPayPalPayment(
  captureId: string,
  amount: number,
  requestId: string,  // NEW: PayPal-Request-Id for idempotency
): Promise<{
  refundId: string;
  status: string;       // 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  statusDetails?: string; // e.g. 'ECHECK' when pending
  amount: string;
}>
```

## Server Actions

### File: `src/app/actions/refundActions.ts`

#### `processPayPalRefund(sourceType, sourceId, amount, reason)`

1. **Auth** — `getUser()` + `checkUserPermission(sourceModule, 'refund')` where `sourceModule` maps: `'private_booking'` → `'private_bookings'`, `'table_booking'` → `'table_bookings'`, `'parking'` → `'parking'`. Reject if no permission.
2. **Load booking** — fetch source record, get PayPal capture ID and original deposit amount. For parking, load from `parking_booking_payments`.
3. **Validate capture exists** — reject if no capture ID ("No PayPal payment to refund")
4. **Validate capture date** — reject if >180 days ("PayPal refund window expired — use manual refund")
5. **Acquire row lock + calculate remaining** — use a Supabase RPC (`calculate_refundable_balance`) that:
   - Acquires `pg_advisory_xact_lock` on a hash of `(source_type, source_id)`
   - Sums `amount` from `payment_refunds` WHERE `status IN ('completed', 'pending')` for this source
   - Returns `remaining = original_amount - sum`
   - Reject if requested `amount > remaining`
6. **Insert pending refund row** — within the same transaction if possible, or immediately after lock check. Generate `paypal_request_id` (UUID) and store it on the row. Set `custom_id` on the PayPal request to the local refund row UUID for webhook matching.
7. **Call PayPal** — `refundPayPalPayment(captureId, amount, paypalRequestId)`
8. **On success (status = COMPLETED):**
   - Update refund row → `status = 'completed'`, store `paypal_refund_id`, `paypal_status = 'COMPLETED'`, `completed_at = now()`
   - Update `deposit_refund_status` on booking (`'refunded'` or `'partially_refunded'`)
   - Send customer notification (email → SMS fallback)
   - Write audit log
   - `revalidatePath()`
   - Return `{ success: true, refundId }`
9. **On success (status = PENDING):**
   - Update refund row → `status = 'pending'` (remains), store `paypal_refund_id`, `paypal_status = 'PENDING'`, `paypal_status_details`
   - Do NOT update `deposit_refund_status` yet — wait for webhook confirmation
   - Do NOT send notification yet
   - Write audit log noting pending state
   - Return `{ success: true, refundId, pending: true, message: 'Refund initiated but pending at PayPal — status will update automatically' }`
10. **On failure:**
    - Update refund row → `status = 'failed'`, `failed_at = now()`, `failure_message`
    - Write audit log with error
    - Return `{ error: 'PayPal refund failed: [message]. You can try again or use manual refund.' }`

#### `processManualRefund(sourceType, sourceId, amount, reason, refundMethod)`

Same as above but:
- Skips PayPal capture validation (works for any payment method)
- Skips PayPal API call — records directly as `'completed'` with `completed_at = now()`
- `refund_method` = `'cash'` | `'bank_transfer'` | `'other'`
- No customer notification
- Still acquires advisory lock and checks remaining balance
- Still updates `deposit_refund_status` and writes audit log

#### `getRefundHistory(sourceType, sourceId)`

- Auth check — `checkUserPermission(sourceModule, 'view')` for the relevant domain
- Returns all `payment_refunds` rows for the source, ordered by `created_at` desc
- Includes: amount, method, reason, status, paypal_status, initiated_by (with staff name or "System"), created_at, paypal_refund_id, completed_at, failure_message
- Used by the UI to display refund history and calculate remaining refundable amount

### Supabase RPC: `calculate_refundable_balance`

```sql
CREATE OR REPLACE FUNCTION calculate_refundable_balance(
  p_source_type TEXT,
  p_source_id UUID,
  p_original_amount NUMERIC(10,2)
) RETURNS NUMERIC(10,2) AS $$
DECLARE
  v_total_reserved NUMERIC(10,2);
BEGIN
  -- Advisory lock prevents concurrent refund race conditions
  PERFORM pg_advisory_xact_lock(
    hashtext(p_source_type || ':' || p_source_id::text)
  );

  SELECT COALESCE(SUM(amount), 0)
  INTO v_total_reserved
  FROM payment_refunds
  WHERE source_type = p_source_type
    AND source_id = p_source_id
    AND status IN ('completed', 'pending');

  RETURN p_original_amount - v_total_reserved;
END;
$$ LANGUAGE plpgsql;
```

The server action calls this, checks the returned value >= requested amount, then proceeds. The advisory lock is released at transaction end, serialising concurrent refund attempts.

## UI Design

### Refund Button

- **Location:** On each booking detail page, within the existing payment/deposit section
- **Visibility:** Only rendered for users with `refund` permission on the relevant module
- **Condition:** Only shown when there is a paid deposit (any payment method)
- **Disabled state:** Greyed out with tooltip "Fully refunded" when deposit_refund_status = 'refunded'

### Refund Dialog (Modal)

| Element | Detail |
|---------|--------|
| Header | "Refund Deposit" |
| Deposit summary | Original amount, total already refunded (completed + pending), remaining refundable |
| Refund method | Radio group: "PayPal" (disabled if no capture ID or >180 days, with explanatory tooltip), "Cash", "Bank Transfer", "Other" |
| Amount input | Number field, pre-filled with remaining refundable, max capped at remaining |
| "Refund in full" button | Sets amount to remaining balance |
| Reason | Required textarea |
| Submit | "Process Refund" — disabled until amount > 0 and reason provided |
| Loading | Spinner + disabled form during API call |
| Success (pending) | Info banner: "Refund initiated but pending at PayPal. Status will update automatically." |
| Error | Inline error banner if PayPal fails, with suggestion to use manual method |

### Payment Section Updates

- Deposit status badge: `Paid` / `Partially Refunded` / `Refunded` / `Refund Pending`
- Refund history table below deposit info:
  - Columns: Date, Amount, Method, Status, Processed By, PayPal Ref (if applicable), Reason
  - Status column shows: Completed, Pending, Failed — with colour coding
  - Failed rows shown in muted style with failure message on hover/expand
  - System-originated rows (from PayPal dashboard reconciliation) show "System" as processed by
- Each row is a `payment_refunds` record

### Shared Components

The refund modal and refund history table are parameterised by `sourceType` and `sourceId` — same component used across all three domains.

## Webhook Handling

### Events Handled

Added to each existing webhook handler (`/api/webhooks/paypal/private-bookings/`, `/api/webhooks/paypal/table-bookings/`, `/api/webhooks/paypal/parking/`):

| Event | Handler |
|-------|---------|
| `PAYMENT.CAPTURE.REFUNDED` | Refund completed |
| `PAYMENT.REFUND.PENDING` | Refund pending (e.g. eCheck) |
| `PAYMENT.REFUND.FAILED` | Refund failed at PayPal |

### Routing Fix

Current webhook handlers have routing assumptions that will block refund events:

- **Private bookings webhook** ignores events whose `resource.custom_id` doesn't start with `pb-dep-`. Refund resources have a different structure — the capture ID is in `resource.links[rel=up]`, not `custom_id`. Fix: for refund event types, extract the capture ID from the `up` link (same pattern parking already uses), then look up the source booking via `paypal_deposit_capture_id`.
- **Table bookings webhook** only handles `PAYMENT.CAPTURE.COMPLETED`. Add the three refund event types to the switch.
- **Parking webhook** already handles `PAYMENT.CAPTURE.REFUNDED` via `handleRefundCompleted()`. However, it currently sets `booking.status = 'cancelled'` — this must be changed to NOT alter booking status, only update `parking_booking_payments.refund_status`. Also integrate with the new `payment_refunds` table.

### Matching Logic

For all three webhooks, refund event handling follows this flow:

1. Extract `paypal_refund_id` from `resource.id`
2. Extract `paypal_capture_id` from `resource.links[rel=up].href` (last path segment)
3. **Try match by `paypal_refund_id`** — look up `payment_refunds` row:
   - **Found + status `completed`** → no-op (already processed by our API call)
   - **Found + status `pending`** → update to `completed`, set `completed_at`, update booking refund status, send notification
   - **Found + status `failed`** → update to `completed` (PayPal overrode our failure — rare but possible)
4. **Not found — dashboard refund reconciliation:**
   - Look up the source booking by `paypal_capture_id` (matching against `paypal_deposit_capture_id` or `transaction_id`)
   - If found, create a new `payment_refunds` row with `initiated_by = NULL`, `initiated_by_type = 'system'`, `reason = 'Refund initiated via PayPal dashboard'`, `status = 'completed'`
   - Update `deposit_refund_status` on the booking
   - Write audit log: `paypal_dashboard_refund_reconciled`
   - This prevents local balance drift and blocks potential over-refunds
5. Idempotency: use existing `claimIdempotencyKey` with 30-day TTL (matching current `24 * 30` hours pattern)

### `PAYMENT.REFUND.PENDING` Handler

- Match by `paypal_refund_id` — if found and status is `pending`, store `paypal_status = 'PENDING'` and `paypal_status_details`. No other changes needed (row is already pending).
- If not found, create system-originated pending row (same as dashboard reconciliation but with `status = 'pending'`).

### `PAYMENT.REFUND.FAILED` Handler

- Match by `paypal_refund_id` — update row to `status = 'failed'`, `paypal_status = 'FAILED'`, `failed_at = now()`, `failure_message` from PayPal payload.
- If there was a pending reservation, the balance is now freed for a new refund attempt.
- Write audit log.

## Customer Notification

### Trigger

Only for PayPal refunds (`refund_method = 'paypal'`), after confirmed completion (`paypal_status = 'COMPLETED'`). Manual refunds and pending PayPal refunds do not trigger notifications. If a pending refund later completes via webhook, the webhook handler sends the notification at that point.

### Resolution Order

1. Check for email on customer/booking record → send via `sendEmail()` (Microsoft Graph)
2. If no email or send fails → check for phone number → send via Twilio SMS
3. If neither available → log `notification_skipped` in audit, do not block refund

### Customer Contact Resolution by Domain

| Domain | Email source | Phone source |
|--------|-------------|-------------|
| Private bookings | `private_bookings.email` or linked `customers.email` | `private_bookings.phone` or linked `customers.phone` |
| Table bookings | `table_bookings.email` or linked `customers.email` | `table_bookings.phone` or linked `customers.phone` |
| Parking | `parking_bookings.email` | `parking_bookings.phone` |

### Email Template

```
Subject: Refund Confirmation — The Anchor

Hi {customerName},

We've initiated a refund of {amount} to your original payment method.

Please allow up to 5 business days for this to appear in your account.

If you have any questions, please don't hesitate to contact us.

Kind regards,
The Anchor Team
```

Note: Uses "original payment method" rather than "PayPal account" — more accurate since PayPal may refund to the underlying card/bank.

### SMS Template

```
Hi {customerName}, we've initiated a refund of {amount} to your original payment method. Please allow up to 5 business days for this to appear. — The Anchor
```

### Notification Recording

The `notification_status` column on `payment_refunds` records the outcome: `'email_sent'`, `'sms_sent'`, `'skipped'` (no contact info), or `'failed'` (both channels failed). NULL for manual refunds or system-originated.

## Edge Cases

| Edge Case | Handling |
|-----------|----------|
| Refund exceeds remaining balance | Amount input capped at remaining refundable (including pending reservations). Server-side advisory lock + balance check rejects if exceeded. |
| No PayPal capture ID | "PayPal" radio option disabled. Only manual refund methods available. |
| Deposit not yet captured | Refund button not shown (no deposit_paid_date / paid_at). |
| PayPal 180-day window | Check capture date (see Capture Date Source table). If >180 days, disable PayPal option with tooltip explaining expiry. Server-side rejects too. |
| Amount > original | Validation: max = original minus sum of completed + pending refunds. |
| Concurrent refunds | `pg_advisory_xact_lock` on `(source_type, source_id)` serialises balance checks. Pending rows included in balance calculation. |
| PayPal returns PENDING | Store as pending, do not update booking refund status, do not notify customer. Wait for webhook to confirm COMPLETED. |
| PayPal returns FAILED | Mark row as failed, free the reserved balance, log failure message. |
| Webhook for unmatched refund (dashboard) | Reconcile by looking up capture ID → create system-originated refund row, update booking refund status. Prevents balance drift. |
| Dashboard refund then staff refund | The reconciled system row is included in the balance check, preventing over-refunding. |
| Network timeout on PayPal call | `PayPal-Request-Id` header ensures PayPal won't duplicate the refund on retry. Pending row remains until webhook confirms or staff retries. |
| Audit completeness | Every refund (PayPal, manual, or system-reconciled) writes to audit_logs: who, when, amount, method, reason, PayPal ref if applicable, notification outcome. |
| Parking webhook status conflict | Remove existing `status: 'cancelled'` from parking refund webhook handler. Refunds do not change booking status. |

## Permissions

| Action | RBAC Check | Notes |
|--------|------------|-------|
| View refund history | `checkUserPermission(module, 'view')` | Module = `private_bookings` / `table_bookings` / `parking` |
| Process PayPal refund | `checkUserPermission(module, 'refund')` | `'refund'` action already exists in `ActionType`. Assign only to `super_admin` role. |
| Process manual refund | `checkUserPermission(module, 'refund')` | Same as above |

Both UI rendering and server actions enforce the permission check independently. The `'refund'` permission must be seeded for `super_admin` across the three modules via migration.

## Tests

| Area | Test Cases |
|------|-----------|
| PayPal idempotency | Verify `PayPal-Request-Id` header is sent; verify retry with same ID returns original response |
| Internal reason hidden | Verify `note_to_payer` is NOT included in PayPal refund request body |
| Concurrent refunds | Two simultaneous refund requests: second should be rejected or serialised, never over-refund |
| PayPal PENDING status | Verify booking refund status NOT updated; verify notification NOT sent; verify webhook later completes it |
| PayPal FAILED status | Verify row marked failed; verify balance freed for new attempt |
| Webhook routing (private) | Verify refund webhook matched by capture ID, not `custom_id` prefix |
| Webhook routing (table) | Verify new event types handled |
| Parking no-status-change | Verify parking booking status is NOT changed on refund (fix from current behaviour) |
| Dashboard reconciliation | Unmatched refund webhook creates system-originated row and updates balance |
| 180-day window | Verify capture date check; verify rejection message suggests manual refund |
| Notification fallback | Email sent → success; no email → SMS sent; neither → skipped and logged |
| Manual refund | No PayPal call, no notification, balance updated correctly |
| Full refund status | Verify `deposit_refund_status` = `'refunded'` when total refunded = original |
| Partial refund status | Verify `deposit_refund_status` = `'partially_refunded'` when total < original |

## Existing Infrastructure Used

| Component | Location | Usage |
|-----------|----------|-------|
| `refundPayPalPayment()` | `src/lib/paypal.ts` | Exists but needs fixes (idempotency header, remove note_to_payer, return full status) |
| `verifyPayPalWebhook()` | `src/lib/paypal.ts` | Webhook signature validation — no changes needed |
| `sendEmail()` | `src/lib/email/emailService.ts` | Email notification via Microsoft Graph |
| Twilio SMS service | `src/lib/sms/` | SMS fallback notification |
| `checkUserPermission()` | `src/app/actions/rbac.ts` | RBAC check using module + `'refund'` action |
| `logAuditEvent()` | `src/app/actions/audit.ts` | Audit trail |
| PayPal webhook handlers | `src/app/api/webhooks/paypal/*/route.ts` | Add refund event handling + fix routing |
| `claimIdempotencyKey` | `src/lib/api/idempotency.ts` | Webhook idempotency (30-day TTL) |
