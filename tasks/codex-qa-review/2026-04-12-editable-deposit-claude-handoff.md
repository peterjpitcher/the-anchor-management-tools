# Claude Hand-Off Brief: Editable Deposit Amount

**Generated:** 2026-04-12
**Review mode:** Spec Compliance (Mode C)
**Overall risk assessment:** High (one critical, two high-severity findings)

## DO NOT REWRITE

- The inline edit UI pattern choice (pencil → input + save/cancel) — this is correct
- The use of existing `editPrivateBookingPayment` server action as the entry point — correct structure
- Toast + router.refresh() for success/error feedback — matches existing patterns
- Server-side Zod validation for amount > 0 — already solid
- The `sendDepositPaymentLink` flow — reads fresh from DB, no fix needed

## SPEC REVISION REQUIRED

- [ ] **SPEC-1:** Remove claim "No backend changes needed" — backend changes ARE required (method handling, PayPal order invalidation, permission fix)
- [ ] **SPEC-2:** Update complexity from XS (1) to S (2) — changes span 3+ files (detail client, server action, service function)
- [ ] **SPEC-3:** Add requirement: "Editing deposit amount must clear `paypal_deposit_order_id` to invalidate any in-flight PayPal order"
- [ ] **SPEC-4:** Add requirement: "When editing an unpaid deposit, only update `deposit_amount` — do not write `deposit_payment_method`"
- [ ] **SPEC-5:** Clarify permission alignment: "Server action must accept `manage_deposits` permission in addition to `manage`"
- [ ] **SPEC-6:** Add implementation note: "Import `CheckIcon` and `editPrivateBookingPayment` in PrivateBookingDetailClient.tsx"
- [ ] **SPEC-7:** Add implementation note: "Pencil icon condition must be `!booking.deposit_paid_date && canManageDeposits` — NOT the same condition as the payment buttons which also check status"
- [ ] **SPEC-8:** Add implementation note: "Add `if (savingDeposit) return;` guard at top of save handler, matching existing PayPal handler pattern"

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **IMPL-1:** `src/services/private-bookings/payments.ts` — Create `updateDepositAmount(bookingId, amount)` that ONLY updates `deposit_amount` (not `deposit_payment_method`). OR modify `updateDeposit` to accept optional method and skip the method update when undefined.
- [ ] **IMPL-2:** `src/services/private-bookings/payments.ts` or `src/app/actions/privateBookingActions.ts` — When deposit amount is edited, also clear `paypal_deposit_order_id` and `paypal_deposit_capture_id` on the booking row to invalidate stale PayPal orders.
- [ ] **IMPL-3:** `src/app/actions/privateBookingActions.ts` line 1743 — Change permission check from `checkUserPermission('private_bookings', 'manage')` to also accept `manage_deposits`. E.g., `const canEdit = await checkUserPermission('private_bookings', 'manage', user.id) || await checkUserPermission('private_bookings', 'manage_deposits', user.id)`
- [ ] **IMPL-4:** `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx` — Add inline edit UI as designed, with corrected condition (`!booking.deposit_paid_date && canManageDeposits`, no status gate)
- [ ] **IMPL-5:** Add `CheckIcon` to heroicon imports and `editPrivateBookingPayment` to action imports in the detail client

## ASSUMPTIONS TO RESOLVE

- [ ] **ASM-1:** PayPal capture ordering — Does `capturePayPalPayment` execute before or after the amount mismatch check? If after, CR-1 severity drops (no money captured on mismatch). → Check `captureDepositPayment` function at privateBookingActions.ts ~line 1490-1520 to confirm ordering.
- [ ] **ASM-2:** Is `manage_deposits` a real permission in production RBAC data, or only theoretical? → Check `src/types/rbac.ts` and the permissions seed data. If no user has `manage_deposits` without `manage`, AI-1 is theoretical.

## REPO CONVENTIONS TO PRESERVE

- Inline edit state pattern: `editing: boolean`, `editValue: string`, `saving: boolean` (match PaymentHistoryTable)
- Save handler pattern: guard → setSaving(true) → await action → toast → setSaving(false) → router.refresh()
- Error handling: toast.error() for failures, no inline error display needed (deposit card is small)
- FormData construction for server actions (not JSON body)
- Audit logging via existing `logAuditEvent` in the server action

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] CR-1: Verify PayPal order invalidation works — create a PayPal order, edit amount, confirm old order is cleared
- [ ] AI-1: Test with a `manage_deposits`-only user to confirm the edit flow works end-to-end
- [ ] ID-1: Verify that editing an unpaid deposit does NOT write `deposit_payment_method`

## REVISION PROMPT

You are revising the editable deposit amount spec and preparing for implementation based on an adversarial review.

Apply these changes in order:

1. **Spec revisions:** Update docs/superpowers/specs/2026-04-12-editable-deposit-amount-design.md:
   - Change complexity from XS to S
   - Replace "No backend changes" with list of required backend changes
   - Add PayPal order invalidation requirement
   - Add amount-only update requirement (no method pollution)
   - Add permission alignment requirement
   - Add missing import notes and condition clarification

2. **Implementation changes (3 files):**
   - `src/services/private-bookings/payments.ts`: Add `updateDepositAmount()` or modify `updateDeposit()` for amount-only updates; clear PayPal order IDs
   - `src/app/actions/privateBookingActions.ts`: Fix permission check to accept `manage_deposits`; handle amount-only edit path for unpaid deposits
   - `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx`: Add inline edit UI with correct condition

3. **Preserve these decisions:**
   - Inline edit pattern matching PaymentHistoryTable
   - editPrivateBookingPayment as entry point
   - Toast + router.refresh() feedback pattern

4. **Verify these assumptions before proceeding:**
   - Check PayPal capture vs amount-check ordering in captureDepositPayment
   - Check whether manage_deposits permission exists in real RBAC data

After applying changes, confirm:
- [ ] All spec revisions applied
- [ ] All implementation changes applied
- [ ] No sound decisions were overwritten
- [ ] Assumptions flagged for human review
