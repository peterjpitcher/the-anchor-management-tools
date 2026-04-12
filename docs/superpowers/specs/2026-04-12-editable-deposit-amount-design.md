# Editable Deposit Amount (Pre-Payment)

**Date:** 2026-04-12
**Status:** Approved (revised after adversarial review)
**Complexity:** S (2) — UI change + backend fixes across 3 files
**Adversarial Review:** `tasks/codex-qa-review/2026-04-12-editable-deposit-adversarial-review.md`

## Problem

When a private booking is created, the security deposit amount is set (default £250) but cannot be changed before payment is recorded. The only way to edit the amount is to record the payment first and then edit it via the PaymentHistoryTable — which is backwards.

## Solution

Add inline editing of the deposit amount on the booking detail page, before the deposit has been paid. This follows the same inline edit pattern used in `PaymentHistoryTable`, with targeted backend fixes to handle unpaid deposits correctly.

## Scope

### In scope
- Inline edit of deposit amount on the detail page when deposit is unpaid
- Gated by existing `canManageDeposits` permission
- Backend: amount-only update for unpaid deposits (no method pollution)
- Backend: clear PayPal order ID when deposit amount changes (prevent stale order race condition)
- Backend: fix permission check to accept `manage_deposits` in addition to `manage`

### Out of scope
- Editing deposit amount after payment (already works via PaymentHistoryTable)
- Editing deposit payment method before payment (method is selected at payment time)
- Changes to the booking edit page (`/private-bookings/[id]/edit`)

## File Changes

1. `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx` — inline edit UI
2. `src/app/actions/privateBookingActions.ts` — permission fix, amount-only edit path
3. `src/services/private-bookings/payments.ts` — amount-only update function, PayPal order invalidation

## Behaviour

1. When deposit is **unpaid** and user has `canManageDeposits` permission, a pencil icon appears next to the deposit amount in the blue deposit card. Condition: `!booking.deposit_paid_date && canManageDeposits` (NO status restriction — differs from payment buttons which also check draft/confirmed)
2. Clicking the pencil swaps the static amount for a number input (pre-filled with current amount) plus save (tick) and cancel (X) icon buttons
3. Save constructs a FormData and calls `editPrivateBookingPayment` with type `deposit`, the booking ID, and the new amount. For unpaid deposits, the server action updates ONLY `deposit_amount` — it does NOT write `deposit_payment_method`
4. On success: toast success, exit edit mode, `router.refresh()`
5. On failure: toast error, remain in edit mode
6. Cancel: revert to static display, no server call
7. Loading state on save button; both buttons disabled during save
8. Double-click guard: `if (savingDeposit) return;` at top of save handler

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

## Backend Changes

### 1. Amount-only update for unpaid deposits (ID-1)

The current `updateDeposit` function writes both `deposit_amount` and `deposit_payment_method`. For unpaid deposits, the method should remain NULL. Add a `updateDepositAmount` function that only updates `deposit_amount`:

```typescript
// src/services/private-bookings/payments.ts
export async function updateDepositAmount(
  bookingId: string,
  amount: number
): Promise<void> {
  const db = createAdminClient()
  const { error } = await db
    .from('private_bookings')
    .update({ deposit_amount: amount, paypal_deposit_order_id: null })
    .eq('id', bookingId)
  if (error) throw new Error(`Failed to update deposit amount: ${error.message}`)
}
```

### 2. PayPal order invalidation (CR-1)

**Critical:** When the deposit amount is edited, any in-flight PayPal order becomes stale (created for the old amount). The `captureDepositPayment` function captures money BEFORE checking the amount mismatch (line 1497 vs 1502), meaning a stale order results in money captured but booking not updated.

The `updateDepositAmount` function above clears `paypal_deposit_order_id` in the same update to invalidate any stale PayPal orders.

### 3. Permission alignment (AI-1)

The `editPrivateBookingPayment` server action checks `checkUserPermission('private_bookings', 'manage')` but the UI gate `canManageDeposits` accepts `manage_deposits` OR `manage`. Fix: when type is `deposit`, also accept `manage_deposits`:

```typescript
// In editPrivateBookingPayment, before the type branching:
const canEdit = await checkUserPermission('private_bookings', 'manage', user.id)
  || (type === 'deposit' && await checkUserPermission('private_bookings', 'manage_deposits', user.id))
if (!canEdit) return { error: 'Forbidden' }
```

### 4. Server action: route unpaid vs paid deposit edits

In the deposit branch of `editPrivateBookingPayment`, check whether the deposit is paid:
- If `deposit_paid_date` is NULL: call `updateDepositAmount` (amount only, clears PayPal order)
- If `deposit_paid_date` is set: call existing `updateDeposit` (amount + method, as today)

The `editDepositSchema` method field should be made optional for this path, OR the UI should still pass a method value and the server action decides whether to use it based on paid state.

## Implementation Notes

- Import `CheckIcon` from `@heroicons/react/24/outline` in PrivateBookingDetailClient (not currently imported there)
- Import `editPrivateBookingPayment` from `@/app/actions/privateBookingActions` in PrivateBookingDetailClient (not currently imported there)
- Reuse `PencilIcon`, `XMarkIcon` already imported; reuse `Input` and `Button` from `ui-v2` already imported
- Add local state: `editingDeposit: boolean`, `editDepositAmount: string`, `savingDeposit: boolean`
- Input: `type="number"`, `min="0.01"`, `step="0.01"`, `inputSize="sm"`
- Icon buttons match PaymentHistoryTable sizing (sm buttons, h-4 w-4 icons)
- FormData fields for unpaid deposit edit: `bookingId`, `type` ("deposit"), `amount`. Method can be passed as `cash` — the server action will ignore it for unpaid deposits.
- Audit logging is already handled by the server action

## Validation

- Amount must be > 0 (enforced by `min="0.01"` on input and server-side Zod schema)
- No other validation needed — the existing `editDepositSchema` in the server action handles it

## Testing

- Manual: create a booking, verify pencil appears, edit amount, confirm it persists after refresh
- Manual: verify pencil does NOT appear when deposit is already paid
- Manual: verify pencil does NOT appear when user lacks `canManageDeposits` permission
- Manual: edit amount, then check that `paypal_deposit_order_id` is cleared in DB
- Manual: verify a `manage_deposits`-only user can edit the deposit amount (permission fix)
- Existing server action tests should be updated for the new `updateDepositAmount` path
