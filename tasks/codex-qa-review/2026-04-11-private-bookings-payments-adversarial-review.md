# Adversarial Review: Private Bookings Payment System

**Date:** 2026-04-11
**Mode:** Code Review (Mode B)
**Engines:** Codex (4 reviewers in parallel)
**Scope:** All files under `src/app/(authenticated)/private-bookings/`, payment-related server actions, services, types, and migrations
**Spec:** N/A

## Inspection Inventory

### Inspected
- All UI components under `src/app/(authenticated)/private-bookings/`
- `src/app/actions/privateBookingActions.ts` (payment actions: lines 603-728, 1343-1883)
- `src/app/actions/private-bookings-dashboard.ts`
- `src/services/private-bookings/payments.ts`, `queries.ts`, `mutations.ts`
- `src/types/private-bookings.ts`
- All payment-related migrations (`20260502000000`, `20260514000001-3`, `20260319124206`)
- `src/app/booking-portal/[token]/page.tsx` (customer-facing portal)
- `src/app/api/cron/private-booking-monitor/route.ts` (balance reminder cron)
- `src/app/api/cron/private-bookings-weekly-summary/route.ts`
- `src/services/private-bookings.test.ts`

### Not Inspected
- PayPal SDK integration internals (`src/lib/paypal.ts`) — referenced but not deeply audited
- Calendar sync side effects
- SMS/email delivery reliability
- RLS policies in the squashed migration (referenced by line number only)

### Limited Visibility Warnings
- Whether existing production rows contain stale `final_payment_date` values from earlier item/discount changes
- Whether downstream refund/accounting flows need both "configured deposit" and "actual captured deposit"

## Executive Summary

The PaymentHistoryTable deposit-counting bug (the original issue) has been correctly fixed. However, the review uncovered **significant systemic issues** in the payment system: a critical RBAC bypass at the database level, multiple places where deposit and balance calculations diverge, missing server-side validation for overpayments, and stale `final_payment_date` when items/discounts change after full payment. The most urgent fix is the RPC permission gap (SEC-001).

## What Appears Solid

- **PaymentHistoryTable fix is correct** — deposit now excluded from "Paid to date" calculation
- **`calculate_private_booking_balance()` DB function** correctly excludes deposits
- **Balance payment RPC** uses `FOR UPDATE` locks to serialise concurrent writes
- **Server actions have auth checks** — all payment actions verify `manage_deposits` or `manage`
- **`private_booking_payments` table constraints** are sound: `amount > 0`, method CHECK constraint
- **Deposit/balance storage separation** is architecturally correct (deposit on booking row, payments in ledger table)
- **Payment history synthesis** correctly merges both types for display

## Critical Risks

### CR-1: RBAC bypass via `record_balance_payment` RPC (SEC-001)
- **Severity:** Critical | **Confidence:** High
- **Evidence:** `20260514000002_record_balance_payment_rpc.sql:6,71` — function is `SECURITY DEFINER`, granted to `authenticated`, no internal permission check
- **Exploit:** Any logged-in user can call `supabase.rpc('record_balance_payment', { p_booking_id: '...', p_amount: 1000, ... })` directly and create payments for any booking
- **Fix:** Add `user_has_permission(auth.uid(), 'private_bookings', 'manage_deposits')` check inside the RPC, or revoke `authenticated` EXECUTE and grant only to `service_role`
- **Blocking:** Yes

### CR-2: DB/UI disagree on booking total when discounts exist (AB — Contradicted)
- **Severity:** High | **Confidence:** High
- **Evidence:** UI `calculateTotal()` at `PrivateBookingDetailClient.tsx:1666` applies booking-level discounts. DB functions (`calculate_private_booking_balance`, `record_balance_payment` RPC, `apply_balance_payment_status`, view) all use raw `SUM(line_total)` ignoring booking-level discounts
- **Impact:** A discounted booking shows correct total in UI (e.g., £137.50) but DB thinks the total is the pre-discount amount (e.g., £175). Payment status, balance_remaining, and "Fully Paid" stamping all use the wrong total
- **Fix:** DB functions must account for discounts — either use `total_amount` column or replicate discount logic
- **Blocking:** Yes — financial correctness issue

## Implementation Defects

### ID-1: `final_payment_date` becomes stale when items/discounts change after full payment
- **Severity:** High | **Confidence:** High
- **Evidence:** Item add/edit/delete (`privateBookingActions.ts:803,1149,1192,1219`) and discount changes never call `apply_balance_payment_status`. If a booking is "Fully Paid" and items are added, it stays marked Fully Paid
- **File(s):** `privateBookingActions.ts`, `payments.ts:549,570`
- **Action:** Call `apply_balance_payment_status` after any item or discount mutation

### ID-2: Overpayments accepted server-side
- **Severity:** Medium | **Confidence:** High
- **Evidence:** `privateBookingActions.ts:684` only checks `> 0`. RPC at `record_balance_payment_rpc.sql:35` accepts any positive amount. `GREATEST(0, ...)` hides the overpayment
- **Action:** Add server-side cap: `amount <= balance_remaining` in the RPC or service layer

### ID-3: Customer booking portal still subtracts deposit from balance
- **Severity:** High | **Confidence:** High
- **Evidence:** `src/app/booking-portal/[token]/page.tsx:157` — the customer-facing portal uses the old formula that deducts deposit from the event balance
- **Action:** Align with the corrected formula (deposit excluded)

### ID-4: Balance reminder cron also subtracts deposit from balance
- **Severity:** Medium | **Confidence:** High
- **Evidence:** `src/app/api/cron/private-booking-monitor/route.ts:646`
- **Action:** Align with the corrected formula

### ID-5: Deposit amount overwritten on recording
- **Severity:** Medium | **Confidence:** High
- **Evidence:** `payments.ts:56` — `recordDeposit()` overwrites `deposit_amount` with whatever the user enters. A £1 manual deposit marks deposit as paid and destroys the original configured amount
- **Action:** Validate entered amount matches `deposit_amount`, or keep original and record actual separately

### ID-6: Cancelled bookings can accept balance payments
- **Severity:** Medium | **Confidence:** High
- **Evidence:** `payments.ts:319` and `PrivateBookingDetailClient.tsx:2419` — no status guard for balance payments (deposit path blocks `cancelled` but balance path doesn't)
- **Action:** Add booking status check in `recordBalancePayment` and hide button for cancelled/completed bookings

## Workflow & Failure-Path Defects

### WF-1: Post-payment UI shows contradictory state
- **Severity:** Medium | **Confidence:** High
- **Evidence:** `PrivateBookingDetailClient.tsx:1417` — `refreshBooking()` refreshes `booking.payments` but not the server-provided `paymentHistory` prop. Balance card updates while payment history summary stays stale
- **Action:** Call `router.refresh()` after payment to reload all server data

### WF-2: Deposit recording not atomic — concurrent submissions can double-send
- **Severity:** Medium | **Confidence:** Medium
- **Evidence:** `payments.ts:29` — pre-reads `deposit_paid_date`, then updates without `WHERE deposit_paid_date IS NULL` guard
- **Action:** Add conditional update guard or use a DB-level lock

### WF-3: No refund ledger
- **Severity:** Low | **Confidence:** High
- **Evidence:** Only deletion available, no negative/refund entries. Acceptable for current scale but worth noting for future
- **Advisory only**

## Security & Data Risks

### SEC-4: Payment fields on `private_bookings` not protected by column-level RLS
- **Severity:** High | **Confidence:** Medium
- **Evidence:** `20251123120000_squashed.sql:2943,4979` — booking update policy requires `private_bookings.edit` permission, which allows direct UPDATE of `deposit_paid_date`, `final_payment_date`, etc.
- **Action:** Consider column-level restrictions or a trigger that blocks payment field updates except from service role

### SEC-3: PayPal deposit capture doesn't validate amount/currency
- **Severity:** High | **Confidence:** High
- **Evidence:** `privateBookingActions.ts:1487` — capture ignores PayPal's returned status, amount, and currency. An older lower-value order can satisfy a higher deposit
- **Action:** Verify captured amount matches expected `deposit_amount` and currency is GBP

## Unproven Assumptions

1. **Existing production data may have stale `final_payment_date`** from item changes after full payment — needs a data audit
2. **Deposit amount vs configured amount** — may already be divergent in production from manual entry overwriting

## Recommended Fix Order

1. **SEC-001 (Critical):** Fix RPC permission bypass — immediate security risk
2. **CR-2 (High):** Align DB balance calculations with discount-aware totals
3. **ID-3 (High):** Fix customer booking portal deposit subtraction
4. **ID-1 (High):** Reconcile payment status after item/discount changes
5. **SEC-3 (High):** Validate PayPal capture amount
6. **ID-2 (Medium):** Add server-side overpayment cap
7. **ID-6 (Medium):** Block payments on cancelled bookings
8. **ID-4 (Medium):** Fix cron balance reminder formula
9. **WF-1 (Medium):** Fix post-payment UI staleness
10. **WF-2 (Medium):** Make deposit recording atomic
11. **ID-5 (Medium):** Protect deposit amount from overwrite
12. **SEC-4 (High):** Protect payment columns from direct update

## Follow-Up Review Required

- After CR-2 fix: re-verify all balance calculations across DB functions, views, services, and UI
- After ID-1 fix: audit existing production data for stale `final_payment_date` values
- After SEC-001 fix: verify RPC is no longer callable by unprivileged users
