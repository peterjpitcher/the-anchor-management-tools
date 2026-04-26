# Adversarial Review: PayPal Refunds

**Date:** 2026-04-26
**Mode:** B (Code Review)
**Scope:** 19 files — migration, PayPal lib, server actions, notifications, webhooks, UI
**Pack:** `tasks/codex-qa-review/2026-04-26-paypal-refunds-review-pack.md`
**Reviewers:** Assumption Breaker, Integration & Architecture, Workflow & Failure-Path, Security & Data Risk

## Executive Summary

The refund implementation has correct top-level auth, proper RLS, no `note_to_payer` leak, and good UI guard patterns. However, **four reviewers independently flagged the same critical concurrency flaw**: the advisory lock releases before the refund row is inserted, allowing concurrent over-refunding of real money. Two other high-severity issues (unstable PayPal idempotency key across retries, webhook/action race creating duplicate rows) also need fixing before merge. Total: 8 distinct blocking findings after deduplication from 25 raw findings.

## What Appears Solid

- `refundPayPalPayment` correctly sends `PayPal-Request-Id` and omits `note_to_payer`, with tests covering both (all 4 reviewers confirmed)
- Server actions re-authenticate and check domain `refund` permission before processing
- Migration enables RLS and restricts `payment_refunds` to service role
- Unique partial index on `paypal_refund_id` is correct for webhook dedup
- Parking webhook no longer cancels bookings on refund
- RefundDialog prevents UI double-submit during loading
- Shared webhook handler centralises reconciliation logic

## Blocking Findings

### 1. Advisory lock does not protect refund reservation (AB-001, ARCH-001, WF-001, SEC-001)

**Severity: Critical | Confidence: High | All 4 reviewers flagged**

`calculate_refundable_balance` acquires `pg_advisory_xact_lock` inside the RPC, but the lock is released when the RPC transaction ends — before the server action inserts the pending refund row. Two concurrent refunds can both see the same remaining balance and both proceed, over-refunding real money.

**Fix:** Combine the balance check and pending row insert into a single RPC that runs under the advisory lock. Or use a Supabase transaction wrapper.

### 2. PayPal idempotency key not stable across retries (AB-003, WF-002, SEC-002)

**Severity: High | Confidence: High | 3 reviewers flagged**

Each call to `processPayPalRefund` generates a fresh `randomUUID()` for `PayPal-Request-Id`. If PayPal processes a refund but the response is lost (network timeout), the action marks the row as failed. Staff retries with a new UUID — PayPal treats it as a new refund request, potentially double-refunding.

**Fix:** Store the `paypal_request_id` on the pending row before calling PayPal, and reuse it on retry. When the action detects a pending row for the same source, reuse that row's `paypal_request_id` instead of creating a new one.

### 3. Webhook race creates duplicate refund rows (WF-003)

**Severity: High | Confidence: High**

The action inserts a pending row without `paypal_refund_id` (not yet known), then calls PayPal. If the webhook arrives before the action stores the `paypal_refund_id`, the webhook lookup by refund ID misses, triggering dashboard reconciliation which creates a second system-originated row. The pending row then reserves balance indefinitely.

**Fix:** Add a fallback webhook match: if no row matches by `paypal_refund_id`, also check for a pending row matching `(source_type, source_id, paypal_capture_id, status='pending')` before creating a system row.

### 4. Webhook uses route sourceType instead of row source_type (AB-002, ARCH-003, WF-005, SEC-005)

**Severity: High | Confidence: Medium | 4 reviewers flagged**

`handleExistingRefund` receives the route-supplied `sourceType` and uses it for `updateBookingRefundStatus`. If a refund event reaches the wrong route (misconfigured webhook ID or shared fallback), the wrong domain table is updated.

**Fix:** When an existing row is found, use `existingRefund.source_type` instead of the route-supplied `sourceType` for all subsequent operations.

### 5. Post-PayPal DB errors silently ignored (AB-008, WF-004)

**Severity: High | Confidence: High**

After PayPal returns COMPLETED, the action updates the refund row and booking status without checking Supabase errors. If these updates fail, the action returns success while local state remains stale — the refund shows as pending despite money having moved.

**Fix:** Check `{ error }` from all post-PayPal updates. If critical updates fail, return a warning-style success ("Refund processed at PayPal but local status update failed — please refresh") rather than a clean success.

### 6. Internal reasons exposed via getRefundHistory (AB-004, SEC-003)

**Severity: Medium | Confidence: High**

`getRefundHistory` uses `select('*')` and checks only `view` permission, returning internal reasons, PayPal capture/request IDs, staff UUIDs, and failure messages to any viewer. The UI labels reason as "internal only" which contradicts this.

**Fix:** Use an explicit column list in the select, omitting `paypal_request_id`, `paypal_capture_id`, `failure_message`, and `initiated_by` for view-only users. Or restrict the action to `refund` permission.

### 7. SMS safety guards bypassed for refund notifications (AB-005)

**Severity: Medium | Confidence: High**

`sendRefundNotification` passes `skipSafetyGuards: true` to `sendSMS`, bypassing opt-out checks and rate limits. Other payment notification code (parking) performs SMS eligibility checks before sending.

**Fix:** Remove `skipSafetyGuards: true`. Refund confirmations are transactional but should still respect customer opt-outs.

### 8. Manual refund allows refund_method='paypal' (SEC-004)

**Severity: Medium | Confidence: High**

`processManualRefund` accepts any `refundMethod` value. A caller could pass `'paypal'` to record a completed PayPal refund without actually calling PayPal, corrupting the refund trail.

**Fix:** Validate `refundMethod` is not `'paypal'` in `processManualRefund`. Add a runtime check: `if (refundMethod === 'paypal') return { error: 'Use processPayPalRefund for PayPal refunds' }`.

## Non-Blocking Findings

### 9. Parking booking payment_status not updated (AB-006, ARCH-005, WF-006)

The old handler updated `parking_bookings.payment_status = 'refunded'`. The new code only updates `parking_booking_payments.refund_status`. ParkingClient filters by `payment_status` — fully refunded bookings may still show as "paid". **Needs product decision.**

### 10. Table booking captureExpired hardcoded false (AB-007, ARCH-006)

`BookingDetailClient` passes `captureExpired={false}` for table bookings. If `card_capture_completed_at` is unreliable, the 180-day check is skipped on the UI side (server still validates). Low risk.

### 11. Permission contract: manage vs refund (ARCH-002)

Some pages may show the refund button via `manage` permission fallback while the server action requires `refund`. This can cause UI-visible controls to fail server-side. Verify pages use only `canRefund` from the `refund` permission check.

## Recommended Fix Order

1. **Finding 1** (advisory lock) — critical money safety, fix first
2. **Finding 2** (idempotency key) — critical money safety, fix second
3. **Finding 3** (webhook race) — directly related to Finding 2
4. **Finding 4** (source_type mismatch) — simple fix, high impact
5. **Finding 5** (error handling) — simple fix, high impact
6. **Finding 6** (data exposure) — simple fix
7. **Finding 7** (SMS safety) — one-line fix
8. **Finding 8** (manual method validation) — one-line fix
