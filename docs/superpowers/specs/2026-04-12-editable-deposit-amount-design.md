# Editable Deposit Amount (Pre-Payment)

**Date:** 2026-04-12
**Status:** Approved
**Complexity:** XS (1) — single file UI change, no backend work

## Problem

When a private booking is created, the security deposit amount is set (default £250) but cannot be changed before payment is recorded. The only way to edit the amount is to record the payment first and then edit it via the PaymentHistoryTable — which is backwards.

## Solution

Add inline editing of the deposit amount on the booking detail page, before the deposit has been paid. This uses the existing backend (`editPrivateBookingPayment` server action + `updateDeposit` service function) and follows the same inline edit pattern used in `PaymentHistoryTable`.

## Scope

### In scope
- Inline edit of deposit amount on the detail page when deposit is unpaid
- Gated by existing `canManageDeposits` permission

### Out of scope
- Editing deposit amount after payment (already works via PaymentHistoryTable)
- Editing deposit payment method before payment (method is selected at payment time)
- Changes to the booking edit page (`/private-bookings/[id]/edit`)
- Backend changes (none needed)

## File Changes

**Single file:** `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx`

## Behaviour

1. When deposit is **unpaid** and user has `canManageDeposits` permission, a pencil icon appears next to the deposit amount in the blue deposit card
2. Clicking the pencil swaps the static amount for a number input (pre-filled with current amount) plus save (tick) and cancel (X) icon buttons
3. Save constructs a FormData and calls `editPrivateBookingPayment` with type `deposit`, the booking ID, and the new amount. Method is passed as the current `deposit_payment_method` or defaults to `cash` (the server action requires it but it's irrelevant for unpaid deposits)
4. On success: toast success, exit edit mode, `router.refresh()`
5. On failure: toast error, remain in edit mode
6. Cancel: revert to static display, no server call
7. Loading state on save button; both buttons disabled during save

## UI States

### Default (non-editing)
```
Security Deposit
Not paid                    £250.00 ✏️
                         [Record Payment]
                         [Pay via PayPal]
                         [Send payment link]
```

### Editing
```
Security Deposit
Not paid              [£___] [✓] [✗]
                         [Record Payment]
                         [Pay via PayPal]
                         [Send payment link]
```

### When deposit is already paid
No pencil icon shown — editing happens via PaymentHistoryTable as today.

## Implementation Notes

- Reuse `PencilIcon`, `CheckIcon`, `XMarkIcon` already imported from `@heroicons/react/24/outline`
- Reuse `Input` and `Button` from `ui-v2` already imported
- Add local state: `editingDeposit: boolean`, `editDepositAmount: string`, `savingDeposit: boolean`
- Input: `type="number"`, `min="0.01"`, `step="0.01"`, `inputSize="sm"`
- Icon buttons match PaymentHistoryTable sizing (sm buttons, h-4 w-4 icons)
- The `editPrivateBookingPayment` action expects FormData with: `paymentId` (booking ID for deposits), `bookingId`, `type` ("deposit"), `amount`, `method`
- Audit logging is already handled by the server action

## Validation

- Amount must be > 0 (enforced by `min="0.01"` on input and server-side Zod schema)
- No other validation needed — the existing `editDepositSchema` in the server action handles it

## Testing

- Manual: create a booking, verify pencil appears, edit amount, confirm it persists after refresh
- Manual: verify pencil does NOT appear when deposit is already paid
- Manual: verify pencil does NOT appear when user lacks `canManageDeposits` permission
- Existing server action tests (if any) are unaffected — no backend changes
