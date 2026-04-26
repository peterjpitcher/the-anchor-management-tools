# Claude Hand-Off Brief: PayPal Refunds

**Generated:** 2026-04-26
**Review mode:** B (Code Review)
**Overall risk:** High (money-movement concurrency gaps)

## DO NOT REWRITE

- `refundPayPalPayment()` in `src/lib/paypal.ts` — idempotency header, no note_to_payer, full status return. All correct.
- Migration table structure, indexes, RLS, RPC skeleton. All correct.
- Auth + permission checks in server actions. Correct pattern.
- RefundDialog UI flow (method selection, amount capping, loading state). Correct.
- Parking webhook removal of booking cancellation. Correct decision.

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **Finding 1 — Atomic balance check + reservation:** Replace the two-step RPC-then-insert with a single Supabase RPC that acquires the advisory lock, checks the balance, inserts the pending row, and returns the new row ID — all inside one transaction. Update `processPayPalRefund` and `processManualRefund` to call this new RPC instead of `calculate_refundable_balance` + separate insert.

  **File:** `supabase/migrations/20260626000001_payment_refunds.sql` — create new RPC `reserve_refund_balance` that does the lock + check + insert atomically.
  **File:** `src/app/actions/refundActions.ts:174-200` — replace RPC call + insert with single `reserve_refund_balance` call.

- [ ] **Finding 2 — Stable PayPal-Request-Id across retries:** Before creating a new pending row, check if a pending row already exists for `(source_type, source_id, status='pending', refund_method='paypal')`. If found, reuse its `paypal_request_id` and row ID instead of creating a new one. This ensures retries use the same idempotency key.

  **File:** `src/app/actions/refundActions.ts:188-200` — add pending-row lookup before insert.

- [ ] **Finding 3 — Webhook fallback match for pending rows:** In `handleRefundEvent`, after the `paypal_refund_id` lookup misses, before creating a system-originated row, check for a pending row matching `(source_type, source_id, paypal_capture_id, status='pending')`. If found, update that row instead of creating a duplicate.

  **File:** `src/lib/paypal-refund-webhook.ts:89` — add pending-row fallback lookup before dashboard reconciliation.

- [ ] **Finding 4 — Use row source_type in webhook handler:** In `handleExistingRefund`, use `existingRefund.source_type` instead of the route-supplied `sourceType` for `updateBookingRefundStatus` and all subsequent operations.

  **File:** `src/lib/paypal-refund-webhook.ts:86` — change `handleExistingRefund(supabase, existingRefund, event, sourceType)` to use `existingRefund.source_type`.

- [ ] **Finding 5 — Check post-PayPal DB errors:** After each critical `db.from('payment_refunds').update(...)` call, check the returned `{ error }`. If the refund row update fails after PayPal success, return a warning result: `{ success: true, warning: 'Refund processed but status update failed. Please refresh.' }`.

  **File:** `src/app/actions/refundActions.ts:211-230` — add error checks on update calls.

- [ ] **Finding 6 — Restrict getRefundHistory columns:** Replace `select('*')` with an explicit column list: `select('id, source_type, source_id, refund_method, amount, original_amount, reason, status, paypal_status, paypal_refund_id, notification_status, initiated_by_type, completed_at, failed_at, created_at')`. Omit `paypal_request_id`, `paypal_capture_id`, `failure_message`, `initiated_by`.

  **File:** `src/app/actions/refundActions.ts:391` — replace `select('*')`.

- [ ] **Finding 7 — Remove skipSafetyGuards:** Remove `skipSafetyGuards: true` from the SMS options in `sendRefundNotification`.

  **File:** `src/lib/refund-notifications.ts:47` — change `{ skipSafetyGuards: true }` to `{}`.

- [ ] **Finding 8 — Validate manual refund method:** Add guard at the start of `processManualRefund`: `if (refundMethod === 'paypal') return { error: 'Use PayPal refund for PayPal payments' }`.

  **File:** `src/app/actions/refundActions.ts` — add at start of `processManualRefund`.

## ASSUMPTIONS TO RESOLVE

- [ ] **Parking payment_status:** Confirm whether a full parking refund should set `parking_bookings.payment_status = 'refunded'`, or if the payment-level `refund_status` is sufficient. Current parking UI filters by `payment_status`.
- [ ] **Table booking capture date:** Verify `card_capture_completed_at` is populated for PayPal deposits on table bookings. If not, the 180-day check is effectively disabled server-side for this domain.
- [ ] **Permission forwarding:** Verify `PrivateBookingDetailServer` forwards the expanded permissions object including `canRefund` to the client component.

## REPO CONVENTIONS TO PRESERVE

- Server actions return `Promise<{ success?: boolean; error?: string }>` pattern
- Use `createAdminClient()` for service-role DB access, `createClient()` for auth
- Audit via `logAuditEvent()` from `@/app/actions/audit`
- Idempotency via `claimIdempotencyKey` with 30-day TTL
- SMS via `sendSMS` with safety guard eligibility checks

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] Finding 1: verify the new atomic RPC prevents concurrent over-refunding
- [ ] Finding 2+3: verify retry and webhook race scenarios after idempotency fix
