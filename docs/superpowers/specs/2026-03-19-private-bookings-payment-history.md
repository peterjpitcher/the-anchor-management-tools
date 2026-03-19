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

Use a **discriminated union** to accurately represent what each entry type can carry:

```typescript
// Add to src/types/private-bookings.ts
type DepositPaymentEntry = {
  id: 'deposit'
  type: 'deposit'
  amount: number
  method: 'cash' | 'card' | 'invoice' | 'paypal'  // all methods valid for deposit
  date: string  // YYYY-MM-DD
}

type BalancePaymentEntry = {
  id: string    // UUID
  type: 'balance'
  amount: number
  method: 'cash' | 'card' | 'invoice'  // 'paypal' never appears; DB CHECK constraint
  date: string  // YYYY-MM-DD
}

type PaymentHistoryEntry = DepositPaymentEntry | BalancePaymentEntry
```

**Date handling:**
- Both `deposit_paid_date` and `private_booking_payments.created_at` are `timestamptz`
- Convert both via `toLocalIsoDate()` to get `YYYY-MM-DD` in London timezone
- Include deposit entry only if `deposit_paid_date IS NOT NULL`

**Sort order:** Sort ascending by `date`, with deposit before balance on the same date. Use an explicit comparator:

```typescript
entries.sort((a, b) => {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  if (a.type === 'deposit' && b.type === 'balance') return -1
  if (a.type === 'balance' && b.type === 'deposit') return 1
  return 0
})
```

### `getBookingPaymentHistory(bookingId: string): Promise<PaymentHistoryEntry[]>`

Uses the **admin client** (`getDb()`) for consistency with write methods and to avoid RLS SELECT ambiguity. Access control is enforced at the page layer (page already requires `private_bookings/view`).

Assembles:
1. One `DepositPaymentEntry` with `id: 'deposit'` (if `deposit_paid_date IS NOT NULL`) from `deposit_amount`, `deposit_payment_method`, `deposit_paid_date` on `private_bookings`
2. All `BalancePaymentEntry` rows from `private_booking_payments` for the booking

The deposit entry **is present in the returned array** and can be found by `entries.find(e => e.id === 'deposit')`. This allows the client component to populate `editValues` from the same array for both deposit and balance rows.

Returns sorted using the comparator above.

### New Postgres RPC: `apply_balance_payment_status(p_booking_id uuid)`

To avoid the TOCTOU race between balance calculation and method lookup, these operations must be atomic. Create a migration with the following function (called by `updateBalancePayment` and `deleteBalancePayment`):

```sql
CREATE OR REPLACE FUNCTION apply_balance_payment_status(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total        numeric;
  v_paid         numeric;
  v_remaining    numeric;
  v_last_method  text;
BEGIN
  -- Sum line items
  SELECT COALESCE(SUM(line_total), 0) INTO v_total
  FROM private_booking_items WHERE booking_id = p_booking_id;

  -- Sum balance payments
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM private_booking_payments WHERE booking_id = p_booking_id;

  v_remaining := GREATEST(0, v_total - v_paid);

  -- Only stamp final payment if booking actually has items (total > 0)
  IF v_remaining = 0 AND v_total > 0 THEN
    -- Get method of last remaining payment for final_payment_method
    SELECT method INTO v_last_method
    FROM private_booking_payments
    WHERE booking_id = p_booking_id
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    UPDATE private_bookings
    SET final_payment_date   = now(),
        final_payment_method = v_last_method  -- NULL if no payments remain
    WHERE id = p_booking_id
      AND final_payment_date IS NULL;

  ELSIF v_remaining > 0 THEN
    UPDATE private_bookings
    SET final_payment_date   = NULL,
        final_payment_method = NULL
    WHERE id = p_booking_id
      AND final_payment_date IS NOT NULL;
  END IF;
END;
$$;
```

**File:** `supabase/migrations/<timestamp>_apply_balance_payment_status.sql`

### `updateBalancePayment(paymentId: string, bookingId: string, data: { amount: number; method: string; notes?: string })`

Uses the **admin client** (`getDb()`).

1. **Ownership check:** `getDb().from('private_booking_payments').select('id').eq('id', paymentId).eq('booking_id', bookingId).single()` — return error if not found. This ensures a manager cannot mutate a payment from a different booking by submitting an arbitrary `paymentId`.
2. Update `amount`, `method`, `notes` on the row
3. **Assert row was updated:** verify the update returned `count === 1`; throw if not (catches silent RLS-like failures)
4. Call `supabase.rpc('apply_balance_payment_status', { p_booking_id: bookingId })`

### `deleteBalancePayment(paymentId: string, bookingId: string)`

Uses the **admin client** (`getDb()`).

1. **Ownership check:** same `.eq('id', paymentId).eq('booking_id', bookingId)` guard as above
2. Delete the row; assert `count === 1`
3. Call `supabase.rpc('apply_balance_payment_status', { p_booking_id: bookingId })`

The RPC handles all balance recalculation and `final_payment_date` stamping atomically, including the `ORDER BY created_at DESC, id DESC` method lookup after the deletion.

### `updateDeposit(bookingId: string, data: { amount: number; method: string })`

Uses the **admin client** (`getDb()`).

- Updates `deposit_amount` and `deposit_payment_method` on `private_bookings`
- `deposit_paid_date` is **never modified**
- Does **not** call `apply_balance_payment_status` — deposit is a returnable bond, not part of the balance

### `deleteDeposit(bookingId: string)`

Uses the **admin client** (`getDb()`).

1. Fetch current booking status and deposit fields (needed for audit log and status logic)
2. Set `deposit_paid_date = NULL`, `deposit_payment_method = NULL`
   - `deposit_amount` is **not cleared** — non-nullable column; represents the required deposit amount, not the payment record
3. If `booking.status === 'confirmed'` AND `COUNT(private_booking_payments WHERE booking_id) === 0` → set `booking.status = 'draft'`
   - After status reversion, if `isCalendarConfigured()` is true:
     - Fetch the full booking: `getDb().from('private_bookings').select('*').eq('id', bookingId).single()` using the same full-column select as `recordDeposit()` so `syncCalendarEvent` receives all required fields
     - Call `syncCalendarEvent(booking)` from `src/lib/google-calendar.ts`
4. For `completed` or `cancelled` bookings: no status change
5. Does **not** call `apply_balance_payment_status`

### Server actions (in `privateBookingActions.ts`)

#### Permission check — use existing RBAC system

Replace the raw role query with `checkUserPermission` for consistency with all other actions in this file:

```typescript
const supabase = await getSupabaseServerClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) return { error: 'Unauthorized' }

// 'manage' action is held by manager and super_admin roles
const canEdit = await checkUserPermission('private_bookings', 'manage', user.id)
if (!canEdit) return { error: 'Forbidden' }
```

Using `checkUserPermission('private_bookings', 'manage')` is consistent with the rest of the codebase, respects RBAC grants/overrides, and is equivalent to the manager/super_admin role check.

#### `editPrivateBookingPayment(formData: FormData)`

Dispatches on `type` field after auth guard:

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
  // 'paypal' is never editable
})
```

On success: `logAuditEvent()`, `revalidatePath('/private-bookings/[id]')`.

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
- `type === 'deposit'` → `deleteDeposit(bookingId)` (`paymentId` ignored for deposit)

On success: `logAuditEvent()`, `revalidatePath('/private-bookings/[id]')`.

> **Auth failures:** Follow existing codebase pattern — auth failures are not audit-logged (consistent with all other actions in `privateBookingActions.ts`).

### Audit logging

```typescript
// editPrivateBookingPayment — balance
logAuditEvent({ user_id, operation_type: 'update', action: 'edit_private_booking_payment',
  resource_type: 'private_booking_payment',
  additional_info: { booking_id, payment_id, payment_type: 'balance',
    old_amount, new_amount, old_method, new_method } })

// editPrivateBookingPayment — deposit
logAuditEvent({ user_id, operation_type: 'update', action: 'edit_private_booking_deposit',
  resource_type: 'private_booking',
  additional_info: { booking_id, old_amount, new_amount, old_method, new_method } })

// deletePrivateBookingPayment — balance
logAuditEvent({ user_id, operation_type: 'delete', action: 'delete_private_booking_payment',
  resource_type: 'private_booking_payment',
  additional_info: { booking_id, payment_id, payment_type: 'balance', amount, method } })

// deletePrivateBookingPayment — deposit
logAuditEvent({ user_id, operation_type: 'delete', action: 'delete_private_booking_deposit',
  resource_type: 'private_booking',
  additional_info: { booking_id, amount: deposit_amount, method: deposit_payment_method,
    status_reverted: boolean } })
```

---

## Business Logic

### Final payment status recalculation

Handled entirely by the `apply_balance_payment_status(p_booking_id)` RPC (defined above). Called after `updateBalancePayment` and `deleteBalancePayment` only. Key guards in the RPC:

- `v_total > 0` guard: prevents stamping `final_payment_date` on a booking with no line items
- `ORDER BY created_at DESC, id DESC`: deterministic even when payments share the same `created_at`
- Atomicity: balance calculation and `final_payment_date` update happen in a single transaction

### Deposit deletion status rules

See `deleteDeposit` above. Status reverts to `'draft'` only when `status === 'confirmed'` AND no balance payments exist. `completed`/`cancelled` bookings are not modified.

---

## Component Architecture

### New component: `PaymentHistoryTable`

**File:** `src/app/(authenticated)/private-bookings/[id]/PaymentHistoryTable.tsx`
**Type:** Client component (`'use client'`)

```typescript
type Props = {
  payments: PaymentHistoryEntry[]   // includes deposit entry with id='deposit' if deposit paid
  bookingId: string
  canEditPayments: boolean
  totalAmount: number               // from parent's calculateTotal() call at render time
}
```

**Local state:**

```typescript
editingId: string | null           // 'deposit' or a UUID
editValues: { amount: string; method: string }
savingId: string | null
deletingId: string | null
confirmDeleteId: string | null
error: string | null
```

**No local payments copy** — controlled component. The `payments` prop is the source of truth. Updates arrive via `router.refresh()`.

**Populating `editValues`:** When ✏️ is clicked, find the row: `payments.find(p => p.id === editingId)`. The deposit entry is present in `payments` with `id: 'deposit'`, so this lookup works uniformly for both types.

**State machine:**
- ✏️ on row X: `editingId = X.id`, clear `confirmDeleteId`, `editValues = { amount: String(row.amount), method: row.method }`
- 🗑 on row X: `confirmDeleteId = X.id`, clear `editingId`
- Cancel: clear `editingId`
- Save: `savingId = editingId`, call server action
  - On success: clear `savingId` + `editingId`, call `router.refresh()`
  - On error: clear `savingId`, set `error`, call `router.refresh()` (ensures UI shows current server state)
- Confirm delete Yes: `deletingId = confirmDeleteId`, clear `confirmDeleteId`, call server action
  - On success: clear `deletingId`, call `router.refresh()`
  - On error: clear `deletingId`, set `error`, call `router.refresh()`
- **Global lock:** while `savingId !== null` OR `deletingId !== null`, ALL action buttons across ALL rows are disabled — not just the row being saved/deleted
- `error` clears on any new user interaction

**Summary row** (above the table):
- Total = `totalAmount` prop
- Paid to date = `payments.reduce((sum, p) => sum + p.amount, 0)`
- Outstanding = `Math.max(0, totalAmount - paidToDate)`

### Integration into `PrivateBookingDetailClient.tsx`

1. Add `paymentHistory: PaymentHistoryEntry[]` and `canEditPayments: boolean` to `PrivateBookingDetailClientProps`
2. Replace the existing payment summary block with:
   ```tsx
   <PaymentHistoryTable
     payments={paymentHistory}
     bookingId={bookingId}
     canEditPayments={canEditPayments}
     totalAmount={calculateTotal()}
   />
   ```

### Changes to `page.tsx`

1. Fetch payment history:
   ```typescript
   const paymentHistory = await getBookingPaymentHistory(bookingId)
   ```

2. Derive `canEditPayments` using the same RBAC system as other permissions:
   ```typescript
   const canEditPayments = await checkUserPermission('private_bookings', 'manage', user.id)
   ```
   This is consistent with how `canEdit`, `canDelete`, and `canManageDeposits` are derived in the existing permission block.

3. Forward `paymentHistory` and `canEditPayments` through `PrivateBookingDetailServer` → `PrivateBookingDetailClient`. Update `PrivateBookingDetailServer.tsx` to accept and pass through both props.

---

## Inline Edit UX

### Table columns
Date · Type badge · Method · Amount · Actions (visible only when `canEditPayments === true`)

### Row states

**Read state**
- Type badge: blue pill "Deposit" / grey pill "Part payment"
- Actions: ✏️ + 🗑 (only when `canEditPayments`, disabled when global lock is active)

**Edit state** (amber tint `bg-amber-50`)
- Method:
  - `type === 'balance'` or (`type === 'deposit'` and `method !== 'paypal'`): `<select>` Cash / Card / Invoice
  - `type === 'deposit'` and `method === 'paypal'`: read-only text "PayPal" (not editable)
- Amount: `<input type="text">` right-aligned
- Actions: "Save" (primary) + "✕" Cancel; both disabled during global lock

**Saving state** — 60% opacity, inputs disabled, "saving…"

**Delete confirmation** — "Delete this payment?" + "Yes" (destructive) + "No"

**Deleting state** — dimmed, "deleting…"

**Error state** — row reverts to read state (edit values lost); red callout below table; `router.refresh()` called so UI shows current server state; error clears on next interaction

### Client-side validation
- Amount must parse as float > 0 — inline error beneath input if not
- No hard maximum

---

## Permissions Summary

| Action | Requirement |
|--------|------------|
| View transaction history | `private_bookings/view` (existing RLS) |
| Record deposit | `private_bookings/manage_deposits` (existing) |
| Record balance payment | `private_bookings/manage_deposits` (existing) |
| Edit any payment | `checkUserPermission('private_bookings', 'manage')` |
| Delete any payment | `checkUserPermission('private_bookings', 'manage')` |

The `manage` action is held by `manager` and `super_admin` roles and is consistent with the rest of `privateBookingActions.ts`.

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `supabase/migrations/<timestamp>_apply_balance_payment_status.sql` | **Create** — new `apply_balance_payment_status` RPC |
| `src/app/(authenticated)/private-bookings/[id]/PaymentHistoryTable.tsx` | **Create** — new client component |
| `src/services/private-bookings.ts` | **Modify** — add `getBookingPaymentHistory`, `updateBalancePayment`, `deleteBalancePayment`, `updateDeposit`, `deleteDeposit` |
| `src/app/actions/privateBookingActions.ts` | **Modify** — add `editPrivateBookingPayment`, `deletePrivateBookingPayment` |
| `src/app/(authenticated)/private-bookings/[id]/page.tsx` | **Modify** — fetch payment history, derive `canEditPayments`, pass as props |
| `src/app/(authenticated)/private-bookings/PrivateBookingDetailServer.tsx` | **Modify** — add `paymentHistory` and `canEditPayments` to props chain |
| `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx` | **Modify** — add props, replace payment summary block with `<PaymentHistoryTable />` |
| `src/types/private-bookings.ts` | **Modify** — add `DepositPaymentEntry`, `BalancePaymentEntry`, `PaymentHistoryEntry` types |
