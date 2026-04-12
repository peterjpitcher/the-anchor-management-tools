# Adversarial Review: Editable Deposit Amount (Pre-Payment)

**Date:** 2026-04-12
**Mode:** Spec Compliance (Mode C)
**Engines:** Claude + Codex
**Scope:** `docs/superpowers/specs/2026-04-12-editable-deposit-amount-design.md` vs codebase
**Spec:** `docs/superpowers/specs/2026-04-12-editable-deposit-amount-design.md`

## Inspection Inventory

### Inspected
- Spec document
- `src/app/actions/privateBookingActions.ts` — editDepositSchema (line 81), editPrivateBookingPayment (line 1736), createDepositPaymentOrder (line 1343), captureDepositPayment (line 1452), sendDepositPaymentLink (line 1672)
- `src/services/private-bookings/payments.ts` — updateDeposit (line 578), deleteDeposit (line 591), recordDeposit (line 29), getBookingPaymentHistory (line 478)
- `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx` — deposit card (line 2330), canManageDeposits usage (line 1368), PayPal deposit flow (line 1457)
- `src/app/(authenticated)/private-bookings/[id]/PaymentHistoryTable.tsx` — full inline edit pattern
- `src/app/(authenticated)/private-bookings/[id]/page.tsx` — permission derivation (line 46)
- `src/types/private-bookings.ts` — PaymentMethod, PaymentHistoryEntry, deposit fields
- `src/components/ui-v2/forms/Button.tsx` — loading prop support
- `tests/actions/privateBookingActions.test.ts` — existing test coverage

### Not Inspected
- Database RLS policies on `private_bookings` table (out of scope — no schema changes)
- Supabase migration SQL for `paypal_deposit_order_id` column definition

### Limited Visibility Warnings
- No runtime tests were executed; all findings are from static analysis

## Executive Summary

The spec describes a small UI addition but makes three incorrect assumptions: (1) no backend changes needed, (2) the existing server action works as-is for unpaid deposits, and (3) it's a single-file change. In reality, the `updateDeposit` service writes a fake payment method on unpaid deposits, there's a permission mismatch between the UI gate and the server action, and editing the deposit amount while a PayPal order is in flight can cause money to be captured without the booking being updated.

## What Appears Solid

- **UI pattern choice** — Inline edit matching PaymentHistoryTable is the right approach. All required components (Input, Button, PencilIcon, toast, router) are already imported or available.
- **Server action structure** — The deposit branch of `editPrivateBookingPayment` correctly parses bookingId/type/amount/method and has audit logging.
- **Validation** — Server-side Zod schema catches all edge cases (empty, zero, negative amounts). HTML min/step attributes provide first-line defence.
- **Stale data handling** — `router.refresh()` combined with `force-dynamic` ensures fresh data after save.
- **Payment link correctness** — `sendDepositPaymentLink` always reads the deposit amount fresh from DB, so edited amounts are reflected.

## Critical Risks

### CR-1: PayPal Race Condition — Money Captured, Booking Not Updated
- **Type:** Confirmed defect
- **Severity:** Critical
- **Confidence:** High
- **Evidence:** `createDepositPaymentOrder` (privateBookingActions.ts:1386) reads `deposit_amount` from DB and creates a PayPal order for that amount. If the deposit amount is then edited, the PayPal order remains for the old amount. When `captureDepositPayment` runs (line 1500-1507), the amount mismatch guard fires (`Math.abs(oldAmount - newAmount) > 0.01`), but the PayPal capture has already executed (line 1497). Result: customer's money is taken but booking is not updated as paid.
- **Additionally:** `createDepositPaymentOrder` reuses existing `paypal_deposit_order_id` (lines 1392-1411), so after an amount edit the stale order for the old amount would be reused rather than creating a new one.
- **Action:** When deposit amount is edited, clear `paypal_deposit_order_id` to invalidate any in-flight PayPal order. This IS a backend change.

## Spec Defects

### SD-1: "No backend changes needed" is incorrect
- **Type:** Spec ambiguity
- **Severity:** High
- **Evidence:** At minimum, `updateDeposit` or the server action needs modification to handle unpaid deposits differently (method pollution, PayPal order invalidation). The spec must acknowledge backend changes.

### SD-2: Complexity score XS is understated
- **Type:** Spec ambiguity
- **Severity:** Medium
- **Evidence:** Changes span the detail client, server action (permission fix), service function (method handling, PayPal order clearing), and potentially tests. This is S (2-3 files), not XS.

### SD-3: "No restrictions" contradicts permission mismatch
- **Type:** Spec ambiguity
- **Severity:** Medium
- **Evidence:** The spec says "gated only by canManageDeposits" but the server action checks `checkUserPermission('private_bookings', 'manage')`. A user with `manage_deposits` but not `manage` sees the edit button but gets Forbidden. Either the UI gate or the server action must be aligned.

## Implementation Defects

### ID-1: Method Pollution on Unpaid Deposits
- **Type:** Strongly suspected defect
- **Severity:** Medium
- **Confidence:** High
- **Evidence:** `updateDeposit` (payments.ts:585) unconditionally writes `deposit_payment_method`. For unpaid deposits this field is NULL. The spec says to default to 'cash', which stamps a fake payment method before any payment occurs. This could confuse any code that checks `deposit_payment_method` as a state indicator. `recordDeposit` and `captureDepositPayment` do overwrite the method at payment time, so data eventually corrects — but the interim state is misleading. Audit logs would also record `old_method: null, new_method: 'cash'` for a pure amount edit.
- **Action:** Either make method optional in `editDepositSchema` and `updateDeposit` (only update amount for unpaid deposits), or create a dedicated `updateDepositAmount` function that only touches `deposit_amount`.

### ID-2: CheckIcon Not Imported
- **Type:** Confirmed defect (minor)
- **Severity:** Low
- **Evidence:** `CheckIcon` is not in the heroicon imports of `PrivateBookingDetailClient.tsx` (line 7-8). It IS imported in `PaymentHistoryTable.tsx`. The implementation must add it.

### ID-3: editPrivateBookingPayment Not Imported
- **Type:** Confirmed defect (minor)
- **Severity:** Low
- **Evidence:** The function is imported in `PaymentHistoryTable.tsx` (line 13) but not in `PrivateBookingDetailClient.tsx`. Must be added.

## Architecture & Integration Defects

### AI-1: Permission Gate Mismatch
- **Type:** Confirmed defect
- **Severity:** High
- **Confidence:** High
- **Evidence:** `canManageDeposits` = `actions.has('manage_deposits') || actions.has('manage')` (page.tsx:46). But `editPrivateBookingPayment` checks `checkUserPermission('private_bookings', 'manage')` only (privateBookingActions.ts:1743). Users with `manage_deposits` but not `manage` see the edit icon but get Forbidden on save.
- **Action:** Either update the server action to also accept `manage_deposits`, or narrow the UI gate to match. Recommendation: update the server action — it's the more permissive fix and matches intent.

## Workflow & Failure-Path Defects

### WF-1: Double-Click Guard Missing
- **Type:** Plausible but unverified
- **Severity:** Low
- **Evidence:** The spec defines `savingDeposit` state but doesn't specify a guard at the top of the save handler. The existing `handlePaypalDeposit` (line 1458) uses `if (paypalDepositLoading) return;` as a pattern. The backend is idempotent so no data corruption, but good hygiene to match existing patterns.

## Unproven Assumptions

1. **The PayPal amount mismatch guard order** — We inferred from line numbers that `capturePayPalPayment` runs before the amount check. If the order is reversed (check then capture), CR-1 severity drops from Critical to Medium. Needs runtime verification.

## Recommended Fix Order

1. **CR-1 + SD-1:** Design the backend change — clear `paypal_deposit_order_id` when deposit amount is edited
2. **AI-1 + SD-3:** Fix permission alignment between UI gate and server action
3. **ID-1:** Decide on method handling for unpaid deposits (amount-only update vs accepting the 'cash' default)
4. **SD-2:** Update complexity score to S
5. **ID-2, ID-3:** Minor import additions (handle during implementation)
6. **WF-1:** Add double-click guard (handle during implementation)

## Follow-Up Review Required

- CR-1: Verify the PayPal capture vs amount-check ordering at runtime after fix is applied
- AI-1: After permission fix, verify with a `manage_deposits`-only test user
