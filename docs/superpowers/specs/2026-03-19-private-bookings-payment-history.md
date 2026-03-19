# Private Bookings — Payment Transaction History

**Date:** 2026-03-19
**Status:** Approved for implementation

---

## Problem

The private bookings detail page shows only summary payment totals (deposit paid, balance remaining). Staff cannot see the individual payments made, when they were made, or by what method — making it difficult to manage customers who pay in instalments.

## Goal

Add a unified, chronological transaction history to the private booking detail page so staff can see every payment at a glance, and managers can correct mistakes by editing or deleting individual entries.

---

## Scope

### In scope
- Unified transaction history table on the booking detail page (deposit + all balance payments)
- Inline editing of method and amount per row (manager/super_admin only)
- Inline delete with confirmation per row (manager/super_admin only)
- Automatic recalculation of final-payment status after balance payment mutations
- Summary totals (Total · Paid to date · Outstanding) above the table

### Out of scope
- Editing the payment date
- Changing a payment's type (deposit → balance or vice versa)
- SMS/email notifications on edit or delete
- Export or print of payment history

---

## Data Layer

### New type: `PaymentHistoryEntry`

```typescript
// Add to src/types/private-bookings.ts
type PaymentHistoryEntry = {
  id: string                            // UUID of the row, or 'deposit' for the deposit entry
  type: 'deposit' | 'balance'
  amount: number
  method: 'cash' | 'card' | 'invoice' | 'paypal'
  // 'paypal' is valid only on type === 'deposit' entries.
  // Balance rows only carry 'cash' | 'card' | 'invoice' (DB CHECK constraint).
  date: string                          // YYYY-MM-DD (London timezone via toLocalIsoDate())
}
```

**Notes on what's omitted:**
- `notes` and `recorded_by` from `private_booking_payments` are intentionally excluded — neither column exists on `private_bookings` for the deposit, so they cannot be displayed uniformly. The four visible columns (Date · Type · Method · Amount) are sufficient.
- If future requirements need per-row notes/recorded-by, the type can be extended.

**Date handling:**
- `private_bookings.deposit_paid_date` is a `timestamptz` — convert via `toLocalIsoDate(deposit_paid_date)` to get `YYYY-MM-DD` in London timezone.
- `private_booking_payments.created_at` is a `timestamptz` — same conversion.
- Sort ascending by `date`; deposit entry sorts before balance entries on the same date.
- Include deposit entry only if `deposit_paid_date IS NOT NULL`.

### `getBookingPaymentHistory(bookingId: string): Promise<PaymentHistoryEntry[]>`

Uses the **admin client** (`getDb()`) for consistency with the write methods and to avoid any RLS SELECT policy ambiguity on `private_booking_payments`. Access control is enforced at the server action / page layer (the page already requires `private_bookings/view` permission before rendering).

Assembles:
1. Deposit entry (if `deposit_paid_date IS NOT NULL`) — `id: 'deposit'`, `type: 'deposit'`, from `deposit_amount`, `deposit_payment_method`, `deposit_paid_date`
2. All rows from `private_booking_payments` for the booking — `type: 'balance'`

Returns sorted ascending by `date`.

### `updateBalancePayment(paymentId: string, bookingId: string, data: { amount: number; method: string; notes?: string })`

Uses the **admin client** (`getDb()`) — no UPDATE RLS policy exists on `private_booking_payments`. Permission is pre-verified at the server action layer.

1. Fetch the row: `getDb().from('private_booking_payments').select().eq('id', paymentId).eq('booking_id', bookingId).single()` — abort with error if not found (ownership check)
2. Update `amount`, `method`, `notes` on the row
3. Recalculate balance and apply final-payment status rule (see Business Logic)

### `deleteBalancePayment(paymentId: string, bookingId: string)`

Uses the **admin client** (`getDb()`).

1. Fetch the row (ownership check as above)
2. Delete the row
3. Recalculate balance and apply final-payment status rule

### `updateDeposit(bookingId: string, data: { amount: number; method: string })`

Uses the **admin client** (`getDb()`).

- Updates `deposit_amount` and `deposit_payment_method` on `private_bookings`
- `deposit_paid_date` is **never modified** by this method
- Does **not** trigger `final_payment_date` recalculation — the deposit is a returnable bond and is not deducted from the event cost balance
- `method` is constrained to `'cash' | 'card' | 'invoice'` — PayPal is never editable

### `deleteDeposit(bookingId: string)`

Uses the **admin client** (`getDb()`).

- Clears `deposit_paid_date = NULL` and `deposit_payment_method = NULL`
- `deposit_amount` is **not cleared** — the column is non-nullable with a default, and the amount represents the required deposit figure, not just the payment record. Only the "paid" markers are cleared.
- Status reversion: if `booking.status === 'confirmed'` AND `COUNT(private_booking_payments WHERE booking_id = bookingId) === 0` → set `booking.status = 'draft'`
  - After status reversion, if `isCalendarConfigured()` is true: fetch the **full booking record** via `getDb().from('private_bookings').select('*').eq('id', bookingId).single()` (the full row is required by `syncCalendarEvent`), then call `syncCalendarEvent(updatedBooking)` from `src/lib/google-calendar.ts`. Mirror the same full-select pattern used in `recordDeposit()`.
- For `completed` or `cancelled` bookings: no status change
- Does **not** trigger `final_payment_date` recalculation

### Server actions (in `privateBookingActions.ts`)

#### Shared role check helper (inline in each action)

Use the same pattern as `src/app/(authenticated)/foh/page.tsx` — query `user_roles` with a `roles(name)` join via the admin client:

```typescript
const supabase = await getSupabaseServerClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) return { error: 'Unauthorized' }

const { data: userRoles } = await getDb()
  .from('user_roles')
  .select('roles(name)')
  .eq('user_id', user.id)

// userRoles is Array<{ roles: { name: string } }>
const isManagerOrAbove = userRoles?.some(
  (r: { roles: { name: string } }) =>
    r.roles?.name === 'manager' || r.roles?.name === 'super_admin'
) ?? false
if (!isManagerOrAbove) return { error: 'Forbidden' }
```

#### `editPrivateBookingPayment(formData: FormData)`

Dispatches on `type` field:

```typescript
const editBalancePaymentSchema = z.object({
  paymentId: z.string().uuid(),
  bookingId: z.string().uuid(),
  type: z.literal('balance'),
  amount: z.string().refine(v => !isNaN(parseFloat(v)) && parseFloat(v) > 0, {
    message: 'Amount must be greater than £0',
  }),
  method: z.enum(['cash', 'card', 'invoice']),
  notes: z.string().max(500).optional(),
})

const editDepositSchema = z.object({
  bookingId: z.string().uuid(),
  type: z.literal('deposit'),
  amount: z.string().refine(v => !isNaN(parseFloat(v)) && parseFloat(v) > 0, {
    message: 'Amount must be greater than £0',
  }),
  method: z.enum(['cash', 'card', 'invoice']),
  // PayPal method is never editable — excluded from schema
})
```

On success: call `logAuditEvent()`, call `revalidatePath('/private-bookings/[id]')`.

#### `deletePrivateBookingPayment(formData: FormData)`

```typescript
const deletePaymentSchema = z.object({
  paymentId: z.string().uuid(),
  type: z.enum(['deposit', 'balance']),
  bookingId: z.string().uuid(),
})
```

Dispatches:
- `type === 'balance'` → `deleteBalancePayment(paymentId, bookingId)`
- `type === 'deposit'` → `deleteDeposit(bookingId)` (paymentId is ignored for deposit)

On success: call `logAuditEvent()`, call `revalidatePath('/private-bookings/[id]')`.

### Audit logging

```typescript
// editPrivateBookingPayment — balance path
logAuditEvent({ user_id, operation_type: 'update', action: 'edit_private_booking_payment',
  resource_type: 'private_booking_payment',
  additional_info: { booking_id, payment_id, payment_type: 'balance',
    old_amount, new_amount, old_method, new_method } })

// editPrivateBookingPayment — deposit path
logAuditEvent({ user_id, operation_type: 'update', action: 'edit_private_booking_deposit',
  resource_type: 'private_booking',
  additional_info: { booking_id, old_amount, new_amount, old_method, new_method } })

// deletePrivateBookingPayment — balance path
logAuditEvent({ user_id, operation_type: 'delete', action: 'delete_private_booking_payment',
  resource_type: 'private_booking_payment',
  additional_info: { booking_id, payment_id, payment_type: 'balance', amount, method } })

// deletePrivateBookingPayment — deposit path
logAuditEvent({ user_id, operation_type: 'delete', action: 'delete_private_booking_deposit',
  resource_type: 'private_booking',
  additional_info: { booking_id, amount: deposit_amount, method: deposit_payment_method,
    status_reverted: boolean } })
```

---

## Business Logic

### Final payment status recalculation

Runs after `updateBalancePayment` and `deleteBalancePayment` **only** (not after deposit mutations):

```
remainingBalance = calculate_private_booking_balance(bookingId)   // via supabase.rpc()

IF remainingBalance == 0 AND booking.final_payment_date IS NULL:
  SET final_payment_date = now()
  SET final_payment_method = <method of the balance payment just edited/deleted>
  // For delete: use the method of the last remaining balance payment
  // (query ORDER BY created_at DESC LIMIT 1 after deletion).
  // If no balance payments remain, set final_payment_method = NULL.

IF remainingBalance > 0 AND booking.final_payment_date IS NOT NULL:
  SET final_payment_date = NULL
  SET final_payment_method = NULL
```

Both updates to `final_payment_date` / `final_payment_method` use the **admin client**.

---

## Component Architecture

### New component: `PaymentHistoryTable`

**File:** `src/app/(authenticated)/private-bookings/[id]/PaymentHistoryTable.tsx`
**Type:** Client component (`'use client'`)

```typescript
type Props = {
  payments: PaymentHistoryEntry[]
  bookingId: string
  canEditPayments: boolean  // true if current user is manager or super_admin
  totalAmount: number       // from parent's calculateTotal() — the display total already shown on page
}
```

**Local state:**

```typescript
editingId: string | null          // 'deposit' or a UUID
editValues: { amount: string; method: string }
savingId: string | null
deletingId: string | null
confirmDeleteId: string | null
error: string | null
```

**Important:** No local copy of `payments`. The component is controlled — it re-renders from props after `router.refresh()` completes. During the save/delete operation, the row is shown in a loading state; the list updates when the server response arrives via `router.refresh()`. This avoids optimistic-vs-server-refresh race conditions.

**State machine transitions:**
- ✏️ on row X: `editingId = X.id`, clears `confirmDeleteId`, populates `editValues` from row
- 🗑 on row X: `confirmDeleteId = X.id`, clears `editingId`
- Cancel: clears `editingId`
- Save: sets `savingId = editingId`, calls server action, on resolve: clears `savingId`/`editingId`, calls `router.refresh()`; on error: clears `savingId`, sets `error`
- Confirm delete Yes: sets `deletingId = confirmDeleteId`, clears `confirmDeleteId`, calls server action, on resolve: clears `deletingId`, calls `router.refresh()`; on error: clears `deletingId`, sets `error`
- New ✏️ or 🗑 click while `savingId` or `deletingId` is set: ignored (buttons disabled)
- `error` clears on any new user interaction

### Integration into `PrivateBookingDetailClient.tsx`

1. Add `paymentHistory: PaymentHistoryEntry[]` and `canEditPayments: boolean` to `PrivateBookingDetailClientProps`
2. Replace the existing payment summary block with:
   ```tsx
   <PaymentHistoryTable
     payments={paymentHistory}
     bookingId={bookingId}
     canEditPayments={canEditPayments}
     totalAmount={calculateTotal()}   // the same function already used on the page
   />
   ```

### Changes to `page.tsx`

1. Fetch payment history:
   ```typescript
   const paymentHistory = await getBookingPaymentHistory(bookingId)
   ```

2. Derive `canEditPayments` (same pattern as the server action role check):
   ```typescript
   const { data: userRoles } = await getDb()
     .from('user_roles')
     .select('roles(name)')
     .eq('user_id', user.id)
   const canEditPayments = userRoles?.some(
     (r: { roles: { name: string } }) =>
       r.roles?.name === 'manager' || r.roles?.name === 'super_admin'
   ) ?? false
   ```
   (`user` is already resolved earlier in `page.tsx` via `supabase.auth.getUser()`)

3. Pass both through `PrivateBookingDetailServer` → `PrivateBookingDetailClient` by adding them to the props chain. Update `PrivateBookingDetailServer.tsx` to accept and forward `paymentHistory` and `canEditPayments`.

---

## Inline Edit UX

### Table columns
Date · Type badge · Method · Amount · Actions (visible to `canEditPayments` only)

### Row states

**Read state**
- Type badge: blue pill "Deposit" / grey pill "Part payment"
- Actions: ✏️ edit icon + 🗑 delete icon (only when `canEditPayments === true`)

**Edit state** (amber tint `bg-amber-50`)
- Method:
  - `type === 'balance'` OR (`type === 'deposit'` AND `method !== 'paypal'`): `<select>` Cash / Card / Invoice
  - `type === 'deposit'` AND `method === 'paypal'`: read-only text "PayPal" (no select — not editable)
- Amount: `<input type="text">` right-aligned
- Actions: "Save" (primary) + "✕" Cancel

**Saving state**
- Row: 60% opacity, inputs disabled, "saving…" in actions column

**Delete confirmation state**
- Row content replaced inline: "Delete this payment?" + "Yes" (destructive) + "No"

**Deleting state**
- Row: dimmed, "deleting…" — list updates after `router.refresh()`

**Error state**
- Row reverts to read state
- Red error callout below the table
- Clears on next user interaction

### Client-side validation (before calling server action)
- Amount must parse as float > 0; show inline error beneath the input if not
- No hard maximum (admin corrections may legitimately exceed the booking total)

---

## Permissions Summary

| Action | Requirement |
|--------|------------|
| View transaction history | `private_bookings/view` (existing RLS) |
| Record deposit | `private_bookings/manage_deposits` (existing) |
| Record balance payment | `private_bookings/manage_deposits` (existing) |
| Edit any payment | `Role.name === 'manager'` or `'super_admin'` |
| Delete any payment | `Role.name === 'manager'` or `'super_admin'` |

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `src/app/(authenticated)/private-bookings/[id]/PaymentHistoryTable.tsx` | **Create** — new client component |
| `src/services/private-bookings.ts` | **Modify** — add `getBookingPaymentHistory`, `updateBalancePayment`, `deleteBalancePayment`, `updateDeposit`, `deleteDeposit` |
| `src/app/actions/privateBookingActions.ts` | **Modify** — add `editPrivateBookingPayment`, `deletePrivateBookingPayment` |
| `src/app/(authenticated)/private-bookings/[id]/page.tsx` | **Modify** — fetch payment history, derive `canEditPayments`, pass as props |
| `src/app/(authenticated)/private-bookings/PrivateBookingDetailServer.tsx` | **Modify** — add `paymentHistory` and `canEditPayments` to props interface and forwarding |
| `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx` | **Modify** — add props, replace payment summary block with `<PaymentHistoryTable />` |
| `src/types/private-bookings.ts` | **Modify** — add `PaymentHistoryEntry` type |
