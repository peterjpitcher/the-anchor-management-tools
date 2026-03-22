# Private Bookings — Payment Transaction History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified chronological payment transaction history to the private booking detail page, with manager-only inline edit/delete capabilities.

**Architecture:** A new `getBookingPaymentHistory` service function assembles a discriminated-union list of deposit + balance payments from `private_bookings` and `private_booking_payments`. A new `PaymentHistoryTable` client component renders the table with an inline edit/delete state machine using `router.refresh()` as its update mechanism. Write mutations (`updateBalancePayment`, `deleteBalancePayment`, `updateDeposit`, `deleteDeposit`) call a new `apply_balance_payment_status` Postgres RPC for atomic final-payment recalculation. Two new server actions (`editPrivateBookingPayment`, `deletePrivateBookingPayment`) gate writes behind `checkUserPermission('private_bookings', 'manage')` and dispatch to the appropriate service function based on a `type` form field.

**Tech Stack:** Next.js 15 App Router, React 19, Supabase (PostgreSQL + admin client via `createAdminClient()`), Vitest, Zod, Tailwind CSS v4, `src/lib/dateUtils.ts` (`toLocalIsoDate`, `formatDateDdMmmmYyyy` — London timezone), `src/components/ui-v2/`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `supabase/migrations/<timestamp>_apply_balance_payment_status.sql` | **Create** | Postgres RPC for atomic balance/final-payment recalculation |
| `src/types/private-bookings.ts` | **Modify** | Add `DepositPaymentEntry`, `BalancePaymentEntry`, `PaymentHistoryEntry` types |
| `src/services/private-bookings.ts` | **Modify** | Add `getBookingPaymentHistory`, `updateBalancePayment`, `deleteBalancePayment`, `updateDeposit`, `deleteDeposit` |
| `src/services/private-bookings.test.ts` | **Create/Modify** | Unit tests for new service functions |
| `src/app/actions/privateBookingActions.ts` | **Modify** | Add `editPrivateBookingPayment`, `deletePrivateBookingPayment` server actions + Zod schemas |
| `src/app/actions/privateBookingActions.test.ts` | **Create/Modify** | Unit tests for new server actions |
| `src/app/(authenticated)/private-bookings/[id]/PaymentHistoryTable.tsx` | **Create** | Client component — payment history table with inline edit/delete state machine |
| `src/app/(authenticated)/private-bookings/[id]/page.tsx` | **Modify** | Fetch `paymentHistory` + derive `canEditPayments`; pass as props |
| `src/app/(authenticated)/private-bookings/PrivateBookingDetailServer.tsx` | **Modify** | Thread `paymentHistory` + `canEditPayments` props through to client |
| `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx` | **Modify** | Accept new props; replace payment summary block with `<PaymentHistoryTable />` |

---

### Task 1: Database Migration — `apply_balance_payment_status` RPC

**Files:**
- Create: `supabase/migrations/<timestamp>_apply_balance_payment_status.sql`

This creates the atomic Postgres function called after any balance payment mutation. It recalculates `final_payment_date` and `final_payment_method` on the booking in a single transaction. This is the foundation for all write operations in Tasks 4 and 5.

- [ ] **Step 1.1: Create the migration file**

```bash
npx supabase migration new apply_balance_payment_status
```

This creates a timestamped file in `supabase/migrations/`. Open that file and paste the following SQL:

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
        final_payment_method = v_last_method
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

- [ ] **Step 1.2: Apply migration locally**

```bash
npx supabase db push
```

Expected: Migration applies without errors. Verify by running in the Supabase SQL editor:

```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_name = 'apply_balance_payment_status';
```

Expected: 1 row returned.

- [ ] **Step 1.3: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: add apply_balance_payment_status postgres rpc"
```

---

### Task 2: Types — `PaymentHistoryEntry` Discriminated Union

**Files:**
- Modify: `src/types/private-bookings.ts`

- [ ] **Step 2.1: Add types at end of file**

Open `src/types/private-bookings.ts`. At the end of the file, add:

```typescript
export type DepositPaymentEntry = {
  id: 'deposit'
  type: 'deposit'
  amount: number
  method: 'cash' | 'card' | 'invoice' | 'paypal'  // all methods valid for deposit
  date: string  // YYYY-MM-DD (London timezone)
}

export type BalancePaymentEntry = {
  id: string    // UUID from private_booking_payments.id
  type: 'balance'
  amount: number
  method: 'cash' | 'card' | 'invoice'  // paypal never appears on balance; enforced by DB CHECK constraint
  date: string  // YYYY-MM-DD (London timezone)
}

export type PaymentHistoryEntry = DepositPaymentEntry | BalancePaymentEntry
```

- [ ] **Step 2.2: Type-check**

```bash
npx tsc --noEmit
```

Expected: Zero errors.

- [ ] **Step 2.3: Commit**

```bash
git add src/types/private-bookings.ts
git commit -m "feat: add PaymentHistoryEntry discriminated union types"
```

---

### Task 3: Service — `getBookingPaymentHistory`

**Files:**
- Modify: `src/services/private-bookings.ts`
- Modify/Create: `src/services/private-bookings.test.ts`

This function uses the admin client (`createAdminClient()`) for consistency with the write functions that follow. Access control is enforced at the page layer (the page already requires `private_bookings/view`).

- [ ] **Step 3.1: Write failing tests**

Check if `src/services/private-bookings.test.ts` exists. If not, create it. Add the following tests:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- Mocks (must be declared before imports that use them) ----

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/dateUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dateUtils')>()
  return {
    ...actual,
    // toLocalIsoDate receives a Date object (not a raw string)
    toLocalIsoDate: vi.fn((d: Date) => d.toISOString().split('T')[0]),
  }
})

// ---- Imports ----

import { createAdminClient } from '@/lib/supabase/admin'
import { getBookingPaymentHistory } from './private-bookings'

// ---- Helpers ----

type MockAdminClientOptions = {
  booking: Record<string, unknown> | null
  paymentsError?: boolean
  payments: Record<string, unknown>[]
}

function mockAdminClient({ booking, payments, paymentsError = false }: MockAdminClientOptions) {
  ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'private_bookings') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: booking, error: null }),
        }
      }
      if (table === 'private_booking_payments') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: paymentsError ? null : payments,
            error: paymentsError ? { message: 'db error' } : null,
          }),
        }
      }
      return {}
    }),
  })
}

// ---- Tests ----

describe('getBookingPaymentHistory', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array when no deposit paid and no balance payments', async () => {
    mockAdminClient({
      booking: { deposit_paid_date: null, deposit_amount: 100, deposit_payment_method: 'cash' },
      payments: [],
    })
    const result = await getBookingPaymentHistory('booking-id')
    expect(result).toEqual([])
  })

  it('includes deposit entry when deposit_paid_date is set', async () => {
    mockAdminClient({
      booking: {
        deposit_paid_date: '2024-01-10T10:00:00Z',
        deposit_amount: 250,
        deposit_payment_method: 'card',
      },
      payments: [],
    })
    const result = await getBookingPaymentHistory('booking-id')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'deposit',
      type: 'deposit',
      amount: 250,
      method: 'card',
      date: '2024-01-10',
    })
  })

  it('includes balance payment entries from private_booking_payments', async () => {
    mockAdminClient({
      booking: { deposit_paid_date: null },
      payments: [{ id: 'uuid-1', amount: 500, method: 'cash', created_at: '2024-02-01T09:00:00Z' }],
    })
    const result = await getBookingPaymentHistory('booking-id')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'uuid-1',
      type: 'balance',
      amount: 500,
      method: 'cash',
      date: '2024-02-01',
    })
  })

  it('sorts deposit before balance on the same date', async () => {
    mockAdminClient({
      booking: {
        deposit_paid_date: '2024-01-10T11:00:00Z',
        deposit_amount: 100,
        deposit_payment_method: 'cash',
      },
      payments: [{ id: 'uuid-1', amount: 200, method: 'card', created_at: '2024-01-10T09:00:00Z' }],
    })
    const result = await getBookingPaymentHistory('booking-id')
    expect(result[0].type).toBe('deposit')
    expect(result[1].type).toBe('balance')
  })

  it('sorts older dates first when entries are on different dates', async () => {
    mockAdminClient({
      booking: {
        deposit_paid_date: '2024-01-15T10:00:00Z',
        deposit_amount: 100,
        deposit_payment_method: 'cash',
      },
      payments: [{ id: 'uuid-1', amount: 200, method: 'card', created_at: '2024-01-05T10:00:00Z' }],
    })
    const result = await getBookingPaymentHistory('booking-id')
    expect(result[0].type).toBe('balance')   // Jan 5 before Jan 15
    expect(result[1].type).toBe('deposit')
  })

  it('throws if fetching balance payments fails', async () => {
    mockAdminClient({
      booking: { deposit_paid_date: null },
      payments: [],
      paymentsError: true,
    })
    await expect(getBookingPaymentHistory('booking-id')).rejects.toThrow()
  })
})
```

- [ ] **Step 3.2: Run tests to verify they fail**

```bash
npx vitest run src/services/private-bookings.test.ts
```

Expected: Failures because `getBookingPaymentHistory` is not exported yet.

- [ ] **Step 3.3: Implement `getBookingPaymentHistory`**

In `src/services/private-bookings.ts`, add the following function near the other read functions (e.g. near `getPrivateBooking`):

```typescript
export async function getBookingPaymentHistory(bookingId: string): Promise<PaymentHistoryEntry[]> {
  const db = createAdminClient()

  // Fetch deposit info from the booking row
  const { data: booking, error: bookingError } = await db
    .from('private_bookings')
    .select('deposit_paid_date, deposit_amount, deposit_payment_method')
    .eq('id', bookingId)
    .single()

  if (bookingError) throw new Error(`Failed to fetch booking: ${bookingError.message}`)

  // Fetch all balance payments for the booking
  const { data: payments, error: paymentsError } = await db
    .from('private_booking_payments')
    .select('id, amount, method, created_at')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true })

  if (paymentsError) throw new Error(`Failed to fetch payments: ${paymentsError.message}`)

  const entries: PaymentHistoryEntry[] = []

  // Include deposit entry only if the deposit has been paid
  if (booking.deposit_paid_date) {
    entries.push({
      id: 'deposit',
      type: 'deposit',
      amount: booking.deposit_amount,
      method: booking.deposit_payment_method as DepositPaymentEntry['method'],
      // toLocalIsoDate accepts a Date object, not a raw string
      date: toLocalIsoDate(new Date(booking.deposit_paid_date)),
    })
  }

  // Add balance payment entries
  for (const payment of payments ?? []) {
    entries.push({
      id: payment.id,
      type: 'balance',
      amount: payment.amount,
      method: payment.method as BalancePaymentEntry['method'],
      date: toLocalIsoDate(new Date(payment.created_at)),
    })
  }

  // Sort: ascending date; deposit before balance on the same date
  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    if (a.type === 'deposit' && b.type === 'balance') return -1
    if (a.type === 'balance' && b.type === 'deposit') return 1
    return 0
  })

  return entries
}
```

**Imports to verify/add** at the top of `src/services/private-bookings.ts`:
- `import type { PaymentHistoryEntry, DepositPaymentEntry, BalancePaymentEntry } from '@/types/private-bookings'` — add to the existing types import if the file already imports from that path
- `import { toLocalIsoDate } from '@/lib/dateUtils'` — add if not already imported
- `createAdminClient` — should already be imported

- [ ] **Step 3.4: Run tests to verify they pass**

```bash
npx vitest run src/services/private-bookings.test.ts
```

Expected: All `getBookingPaymentHistory` tests pass.

- [ ] **Step 3.5: Type-check**

```bash
npx tsc --noEmit
```

Expected: Zero errors.

- [ ] **Step 3.6: Commit**

```bash
git add src/services/private-bookings.ts src/services/private-bookings.test.ts
git commit -m "feat: add getBookingPaymentHistory service function"
```

---

### Task 4: Service — Write Functions

**Files:**
- Modify: `src/services/private-bookings.ts`
- Modify: `src/services/private-bookings.test.ts`

All four write functions use `createAdminClient()`. Balance mutations call `apply_balance_payment_status` RPC after the write. Deposit mutations do not — the deposit is a returnable bond, not part of the balance calculation.

- [ ] **Step 4.1: Write failing tests**

Add the following to `src/services/private-bookings.test.ts` (after the existing `getBookingPaymentHistory` tests):

```typescript
import {
  updateBalancePayment,
  deleteBalancePayment,
  updateDeposit,
  deleteDeposit,
} from './private-bookings'

// ---- updateBalancePayment ----

describe('updateBalancePayment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws if ownership check fails (payment not found for booking)', async () => {
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
      })),
    })
    await expect(
      updateBalancePayment('uuid-1', 'booking-id', { amount: 300, method: 'cash' })
    ).rejects.toThrow()
  })

  it('calls RPC after successful update', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ error: null })
    let callIndex = 0
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => {
        callIndex++
        if (callIndex === 1) {
          // First call: ownership check
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'uuid-1' }, error: null }),
          }
        }
        // Second call: update
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        }
      }),
      rpc: rpcMock,
    })

    await updateBalancePayment('uuid-1', 'booking-id', { amount: 300, method: 'cash' })

    expect(rpcMock).toHaveBeenCalledWith('apply_balance_payment_status', {
      p_booking_id: 'booking-id',
    })
  })
})

// ---- deleteBalancePayment ----

describe('deleteBalancePayment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws if payment not found for booking', async () => {
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
      })),
    })
    await expect(deleteBalancePayment('uuid-1', 'booking-id')).rejects.toThrow()
  })

  it('calls RPC after successful delete', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ error: null })
    let callIndex = 0
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => {
        callIndex++
        if (callIndex === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'uuid-1' }, error: null }),
          }
        }
        return {
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        }
      }),
      rpc: rpcMock,
    })

    await deleteBalancePayment('uuid-1', 'booking-id')

    expect(rpcMock).toHaveBeenCalledWith('apply_balance_payment_status', {
      p_booking_id: 'booking-id',
    })
  })
})

// ---- updateDeposit ----

describe('updateDeposit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates deposit fields without calling RPC', async () => {
    const rpcMock = vi.fn()
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      })),
      rpc: rpcMock,
    })

    await updateDeposit('booking-id', { amount: 150, method: 'card' })

    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('throws if update fails', async () => {
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: { message: 'db error' } }),
      })),
    })

    await expect(updateDeposit('booking-id', { amount: 150, method: 'card' })).rejects.toThrow()
  })
})

// ---- deleteDeposit ----

describe('deleteDeposit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws if booking not found', async () => {
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
      })),
    })

    await expect(deleteDeposit('booking-id')).rejects.toThrow()
  })

  it('completes without status change for a completed booking', async () => {
    let callIndex = 0
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => {
        callIndex++
        if (callIndex === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                status: 'completed',
                deposit_paid_date: '2024-01-10T10:00:00Z',
                deposit_amount: 100,
                deposit_payment_method: 'cash',
              },
              error: null,
            }),
          }
        }
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        }
      }),
    })

    const result = await deleteDeposit('booking-id')
    expect(result.statusReverted).toBe(false)  // completed booking — no status change
  })

  it('reverts status to draft if booking is confirmed with no balance payments', async () => {
    const updateMock = vi.fn().mockResolvedValue({ error: null })
    let fromCallIndex = 0
    ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'private_bookings') {
          fromCallIndex++
          if (fromCallIndex === 1) {
            // Fetch for status check
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  status: 'confirmed',
                  deposit_paid_date: '2024-01-10T10:00:00Z',
                  deposit_amount: 100,
                  deposit_payment_method: 'cash',
                },
                error: null,
              }),
            }
          }
          // Update calls
          return {
            update: vi.fn().mockReturnThis(),
            eq: updateMock,
          }
        }
        if (table === 'private_booking_payments') {
          // Simulate a count query returning 0 rows (no balance payments)
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: null, count: 0, error: null }),
          }
        }
        return {}
      }),
    })

    // Should not throw; status reversion happens internally
    // deleteDeposit returns { statusReverted: boolean }
    const result = await deleteDeposit('booking-id')
    expect(result.statusReverted).toBe(true)
  })
})
```

- [ ] **Step 4.2: Run tests to verify they fail**

```bash
npx vitest run src/services/private-bookings.test.ts -t "updateBalancePayment|deleteBalancePayment|updateDeposit|deleteDeposit"
```

Expected: Failures because the functions don't exist yet.

- [ ] **Step 4.3: Implement `updateBalancePayment`**

Add to `src/services/private-bookings.ts`:

```typescript
export async function updateBalancePayment(
  paymentId: string,
  bookingId: string,
  data: { amount: number; method: string; notes?: string }
): Promise<void> {
  const db = createAdminClient()

  // Ownership check: ensure payment belongs to this booking
  const { data: existing, error: checkError } = await db
    .from('private_booking_payments')
    .select('id')
    .eq('id', paymentId)
    .eq('booking_id', bookingId)
    .single()

  if (checkError || !existing) {
    throw new Error('Payment not found or does not belong to this booking')
  }

  // Update amount, method, and optionally notes
  const updatePayload: Record<string, unknown> = { amount: data.amount, method: data.method }
  if (data.notes !== undefined) updatePayload.notes = data.notes

  const { count: updateCount, error: updateError } = await db
    .from('private_booking_payments')
    .update(updatePayload, { count: 'exact' })
    .eq('id', paymentId)

  if (updateError) throw new Error(`Failed to update payment: ${updateError.message}`)
  // Guard against silent failures (e.g. RLS blocking the update without throwing)
  if (updateCount !== 1) throw new Error(`Update affected ${updateCount} rows, expected 1`)

  // Atomically recalculate final payment status
  const { error: rpcError } = await db.rpc('apply_balance_payment_status', {
    p_booking_id: bookingId,
  })
  if (rpcError) throw new Error(`Failed to recalculate payment status: ${rpcError.message}`)
}
```

- [ ] **Step 4.4: Implement `deleteBalancePayment`**

```typescript
export async function deleteBalancePayment(paymentId: string, bookingId: string): Promise<void> {
  const db = createAdminClient()

  // Ownership check
  const { data: existing, error: checkError } = await db
    .from('private_booking_payments')
    .select('id')
    .eq('id', paymentId)
    .eq('booking_id', bookingId)
    .single()

  if (checkError || !existing) {
    throw new Error('Payment not found or does not belong to this booking')
  }

  // Delete the payment row
  const { count: deleteCount, error: deleteError } = await db
    .from('private_booking_payments')
    .delete({ count: 'exact' })
    .eq('id', paymentId)

  if (deleteError) throw new Error(`Failed to delete payment: ${deleteError.message}`)
  // Guard against silent failures
  if (deleteCount !== 1) throw new Error(`Delete affected ${deleteCount} rows, expected 1`)

  // Atomically recalculate final payment status (ORDER BY in RPC handles method lookup post-delete)
  const { error: rpcError } = await db.rpc('apply_balance_payment_status', {
    p_booking_id: bookingId,
  })
  if (rpcError) throw new Error(`Failed to recalculate payment status: ${rpcError.message}`)
}
```

- [ ] **Step 4.5: Implement `updateDeposit`**

```typescript
export async function updateDeposit(
  bookingId: string,
  data: { amount: number; method: string }
): Promise<void> {
  const db = createAdminClient()

  // Update deposit_amount and deposit_payment_method only.
  // deposit_paid_date is intentionally NOT modified.
  // Does NOT call apply_balance_payment_status — deposit is a returnable bond, not part of balance.
  const { error } = await db
    .from('private_bookings')
    .update({ deposit_amount: data.amount, deposit_payment_method: data.method })
    .eq('id', bookingId)

  if (error) throw new Error(`Failed to update deposit: ${error.message}`)
}
```

- [ ] **Step 4.6: Implement `deleteDeposit`**

Note: `isCalendarConfigured` and `syncCalendarEvent` are already imported at the top of `src/services/private-bookings.ts` (used by `recordDeposit`/`recordBalancePayment`). Verify before writing — if they use different names, use those.

```typescript
// Returns statusReverted so the calling server action can include it in the audit log.
export async function deleteDeposit(bookingId: string): Promise<{ statusReverted: boolean }> {
  const db = createAdminClient()

  // Fetch current state for status logic
  const { data: booking, error: fetchError } = await db
    .from('private_bookings')
    .select('status, deposit_paid_date, deposit_amount, deposit_payment_method')
    .eq('id', bookingId)
    .single()

  if (fetchError || !booking) throw new Error('Booking not found')

  // Clear the deposit payment record.
  // deposit_amount is NOT cleared — it is non-nullable and represents the required deposit amount.
  const { error: updateError } = await db
    .from('private_bookings')
    .update({ deposit_paid_date: null, deposit_payment_method: null })
    .eq('id', bookingId)

  if (updateError) throw new Error(`Failed to clear deposit: ${updateError.message}`)

  // Status reversion: confirmed → draft only if no balance payments exist
  let statusReverted = false
  if (booking.status === 'confirmed') {
    const { count, error: countError } = await db
      .from('private_booking_payments')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', bookingId)

    if (!countError && count === 0) {
      const { error: statusError } = await db
        .from('private_bookings')
        .update({ status: 'draft' })
        .eq('id', bookingId)

      if (statusError) throw new Error(`Failed to revert booking status: ${statusError.message}`)

      statusReverted = true

      // Sync calendar if configured (non-blocking)
      if (isCalendarConfigured()) {
        const { data: fullBooking } = await db
          .from('private_bookings')
          .select('*')
          .eq('id', bookingId)
          .single()

        if (fullBooking) {
          syncCalendarEvent(fullBooking).catch(() => {})
        }
      }
    }
  }

  // completed and cancelled bookings: no status change
  return { statusReverted }
}
```

- [ ] **Step 4.7: Run all service tests**

```bash
npx vitest run src/services/private-bookings.test.ts
```

Expected: All tests pass.

- [ ] **Step 4.8: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4.9: Commit**

```bash
git add src/services/private-bookings.ts src/services/private-bookings.test.ts
git commit -m "feat: add updateBalancePayment, deleteBalancePayment, updateDeposit, deleteDeposit service functions"
```

---

### Task 5: Server Actions

**Files:**
- Modify: `src/app/actions/privateBookingActions.ts`
- Modify/Create: `src/app/actions/privateBookingActions.test.ts`

**Before starting:** Open `src/app/actions/privateBookingActions.ts` and check:
1. The exact import path used for `checkUserPermission` — it may be from `@/services/permission-service` or similar. Use that same path in your mocks and new code.
2. The existing import paths for `z` (Zod), `logAuditEvent`, `revalidatePath`, and `createAdminClient`. Add any that aren't already imported.
3. The existing pattern for `getSupabaseServerClient`.

- [ ] **Step 5.1: Write failing tests**

Check if `src/app/actions/privateBookingActions.test.ts` exists. If not, create it. Add:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- Mocks ----
// IMPORTANT: Adjust the module paths below to match actual imports in privateBookingActions.ts

// createClient (not getSupabaseServerClient) — matches the actual import in privateBookingActions.ts line 3
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

// Import confirmed from privateBookingActions.ts line 7
vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/services/private-bookings', () => ({
  updateBalancePayment: vi.fn(),
  deleteBalancePayment: vi.fn(),
  updateDeposit: vi.fn(),
  deleteDeposit: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { amount: 100, method: 'cash', deposit_amount: 100, deposit_payment_method: 'cash' }, error: null }),
    })),
  })),
}))

// ---- Imports ----

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import {
  updateBalancePayment,
  deleteBalancePayment,
  updateDeposit,
  deleteDeposit,
} from '@/services/private-bookings'
import { editPrivateBookingPayment, deletePrivateBookingPayment } from './privateBookingActions'

// ---- Helpers ----

function mockUnauthenticated() {
  ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
  })
}

function mockAuthenticatedNoPermission() {
  ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-id' } } }) },
  })
  ;(checkUserPermission as ReturnType<typeof vi.fn>).mockResolvedValue(false)
}

function mockAuthenticatedWithPermission() {
  ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-id' } } }) },
  })
  ;(checkUserPermission as ReturnType<typeof vi.fn>).mockResolvedValue(true)
}

// ---- Tests: editPrivateBookingPayment ----

describe('editPrivateBookingPayment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns error when not authenticated', async () => {
    mockUnauthenticated()
    const fd = new FormData()
    fd.set('type', 'balance')
    fd.set('paymentId', 'uuid-1')
    fd.set('bookingId', '00000000-0000-0000-0000-000000000001')
    fd.set('amount', '100')
    fd.set('method', 'cash')
    const result = await editPrivateBookingPayment(fd)
    expect(result.error).toBeTruthy()
  })

  it('returns Forbidden when user lacks manage permission', async () => {
    mockAuthenticatedNoPermission()
    const fd = new FormData()
    fd.set('type', 'balance')
    fd.set('paymentId', 'uuid-1')
    fd.set('bookingId', '00000000-0000-0000-0000-000000000001')
    fd.set('amount', '100')
    fd.set('method', 'cash')
    const result = await editPrivateBookingPayment(fd)
    expect(result.error).toBe('Forbidden')
  })

  it('returns validation error for invalid amount', async () => {
    mockAuthenticatedWithPermission()
    const fd = new FormData()
    fd.set('type', 'balance')
    fd.set('paymentId', '00000000-0000-0000-0000-000000000002')
    fd.set('bookingId', '00000000-0000-0000-0000-000000000001')
    fd.set('amount', '-5')
    fd.set('method', 'cash')
    const result = await editPrivateBookingPayment(fd)
    expect(result.error).toBeTruthy()
    expect(result.success).toBeUndefined()
  })

  it('calls updateBalancePayment and returns success for type=balance', async () => {
    mockAuthenticatedWithPermission()
    ;(updateBalancePayment as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    const fd = new FormData()
    fd.set('type', 'balance')
    fd.set('paymentId', '00000000-0000-0000-0000-000000000002')
    fd.set('bookingId', '00000000-0000-0000-0000-000000000001')
    fd.set('amount', '300')
    fd.set('method', 'cash')

    const result = await editPrivateBookingPayment(fd)
    expect(result.success).toBe(true)
    expect(updateBalancePayment).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001',
      { amount: 300, method: 'cash' }
    )
  })

  it('calls updateDeposit and returns success for type=deposit', async () => {
    mockAuthenticatedWithPermission()
    ;(updateDeposit as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    const fd = new FormData()
    fd.set('type', 'deposit')
    fd.set('bookingId', '00000000-0000-0000-0000-000000000001')
    fd.set('amount', '150')
    fd.set('method', 'card')

    const result = await editPrivateBookingPayment(fd)
    expect(result.success).toBe(true)
    expect(updateDeposit).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      { amount: 150, method: 'card' }
    )
  })
})

// ---- Tests: deletePrivateBookingPayment ----

describe('deletePrivateBookingPayment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls deleteBalancePayment for type=balance', async () => {
    mockAuthenticatedWithPermission()
    ;(deleteBalancePayment as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    const fd = new FormData()
    fd.set('type', 'balance')
    fd.set('paymentId', '00000000-0000-0000-0000-000000000002')
    fd.set('bookingId', '00000000-0000-0000-0000-000000000001')

    const result = await deletePrivateBookingPayment(fd)
    expect(result.success).toBe(true)
    expect(deleteBalancePayment).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001'
    )
  })

  it('calls deleteDeposit for type=deposit', async () => {
    mockAuthenticatedWithPermission()
    ;(deleteDeposit as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    const fd = new FormData()
    fd.set('type', 'deposit')
    fd.set('paymentId', 'deposit')
    fd.set('bookingId', '00000000-0000-0000-0000-000000000001')

    const result = await deletePrivateBookingPayment(fd)
    expect(result.success).toBe(true)
    expect(deleteDeposit).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001')
  })

  it('returns error when not authenticated', async () => {
    mockUnauthenticated()
    const fd = new FormData()
    fd.set('type', 'balance')
    fd.set('paymentId', '00000000-0000-0000-0000-000000000002')
    fd.set('bookingId', '00000000-0000-0000-0000-000000000001')
    const result = await deletePrivateBookingPayment(fd)
    expect(result.error).toBeTruthy()
  })
})
```

- [ ] **Step 5.2: Run tests to verify they fail**

```bash
npx vitest run src/app/actions/privateBookingActions.test.ts -t "editPrivateBookingPayment|deletePrivateBookingPayment"
```

Expected: Failures because the functions don't exist yet.

- [ ] **Step 5.3: Add Zod schemas to `privateBookingActions.ts`**

Add these at the module level (outside any function, near the top of the file alongside existing schemas):

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
  // paypal is intentionally excluded — deposit paid by PayPal is read-only
})

const deletePaymentSchema = z.object({
  // DELIBERATE DEVIATION FROM SPEC: spec says z.string().uuid() but paymentId can be the literal
  // string 'deposit' when deleting a deposit entry. z.string() is correct here.
  paymentId: z.string(),
  type: z.enum(['deposit', 'balance']),
  bookingId: z.string().uuid(),
})
```

- [ ] **Step 5.4: Implement `editPrivateBookingPayment`**

Add to `privateBookingActions.ts`:

```typescript
export async function editPrivateBookingPayment(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  // Auth guard — createClient() is the cookie-based server client (matches privateBookingActions.ts line 3)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const canEdit = await checkUserPermission('private_bookings', 'manage', user.id)
  if (!canEdit) return { error: 'Forbidden' }

  const type = formData.get('type') as string

  if (type === 'balance') {
    const parsed = editBalancePaymentSchema.safeParse({
      paymentId: formData.get('paymentId'),
      bookingId: formData.get('bookingId'),
      type: formData.get('type'),
      amount: formData.get('amount'),
      method: formData.get('method'),
      notes: formData.get('notes') ?? undefined,
    })
    if (!parsed.success) return { error: parsed.error.errors[0].message }

    // Fetch old values for audit log
    const db = createAdminClient()
    const { data: oldPayment } = await db
      .from('private_booking_payments')
      .select('amount, method')
      .eq('id', parsed.data.paymentId)
      .single()

    try {
      await updateBalancePayment(parsed.data.paymentId, parsed.data.bookingId, {
        amount: parseFloat(parsed.data.amount),
        method: parsed.data.method,
        notes: parsed.data.notes,
      })
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Failed to update payment' }
    }

    await logAuditEvent({
      user_id: user.id,
      operation_type: 'update',
      action: 'edit_private_booking_payment',
      resource_type: 'private_booking_payment',
      additional_info: {
        booking_id: parsed.data.bookingId,
        payment_id: parsed.data.paymentId,
        payment_type: 'balance',
        old_amount: oldPayment?.amount,
        new_amount: parseFloat(parsed.data.amount),
        old_method: oldPayment?.method,
        new_method: parsed.data.method,
      },
    })

    revalidatePath(`/private-bookings/${parsed.data.bookingId}`)
    return { success: true }
  }

  if (type === 'deposit') {
    const parsed = editDepositSchema.safeParse({
      bookingId: formData.get('bookingId'),
      type: formData.get('type'),
      amount: formData.get('amount'),
      method: formData.get('method'),
    })
    if (!parsed.success) return { error: parsed.error.errors[0].message }

    // Fetch old values for audit log
    const db = createAdminClient()
    const { data: oldBooking } = await db
      .from('private_bookings')
      .select('deposit_amount, deposit_payment_method')
      .eq('id', parsed.data.bookingId)
      .single()

    try {
      await updateDeposit(parsed.data.bookingId, {
        amount: parseFloat(parsed.data.amount),
        method: parsed.data.method,
      })
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Failed to update deposit' }
    }

    await logAuditEvent({
      user_id: user.id,
      operation_type: 'update',
      action: 'edit_private_booking_deposit',
      resource_type: 'private_booking',
      additional_info: {
        booking_id: parsed.data.bookingId,
        old_amount: oldBooking?.deposit_amount,
        new_amount: parseFloat(parsed.data.amount),
        old_method: oldBooking?.deposit_payment_method,
        new_method: parsed.data.method,
      },
    })

    revalidatePath(`/private-bookings/${parsed.data.bookingId}`)
    return { success: true }
  }

  return { error: 'Invalid payment type' }
}
```

- [ ] **Step 5.5: Implement `deletePrivateBookingPayment`**

```typescript
export async function deletePrivateBookingPayment(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  // Auth guard — createClient() is the cookie-based server client (matches privateBookingActions.ts line 3)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const canDelete = await checkUserPermission('private_bookings', 'manage', user.id)
  if (!canDelete) return { error: 'Forbidden' }

  const parsed = deletePaymentSchema.safeParse({
    paymentId: formData.get('paymentId'),
    type: formData.get('type'),
    bookingId: formData.get('bookingId'),
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const { paymentId, type, bookingId } = parsed.data

  if (type === 'balance') {
    const db = createAdminClient()
    const { data: payment } = await db
      .from('private_booking_payments')
      .select('amount, method')
      .eq('id', paymentId)
      .single()

    try {
      await deleteBalancePayment(paymentId, bookingId)
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Failed to delete payment' }
    }

    await logAuditEvent({
      user_id: user.id,
      operation_type: 'delete',
      action: 'delete_private_booking_payment',
      resource_type: 'private_booking_payment',
      additional_info: {
        booking_id: bookingId,
        payment_id: paymentId,
        payment_type: 'balance',
        amount: payment?.amount,
        method: payment?.method,
      },
    })
  } else {
    // type === 'deposit'
    const db = createAdminClient()
    const { data: booking } = await db
      .from('private_bookings')
      .select('deposit_amount, deposit_payment_method, status')
      .eq('id', bookingId)
      .single()

    let statusReverted = false
    try {
      const result = await deleteDeposit(bookingId)
      statusReverted = result.statusReverted
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Failed to delete deposit' }
    }

    await logAuditEvent({
      user_id: user.id,
      operation_type: 'delete',
      action: 'delete_private_booking_deposit',
      resource_type: 'private_booking',
      additional_info: {
        booking_id: bookingId,
        amount: booking?.deposit_amount,
        method: booking?.deposit_payment_method,
        status_reverted: statusReverted,
      },
    })
  }

  revalidatePath(`/private-bookings/${bookingId}`)
  return { success: true }
}
```

**Verify imports** at the top of `privateBookingActions.ts`. You need:
- `updateBalancePayment`, `deleteBalancePayment`, `updateDeposit`, `deleteDeposit` from `@/services/private-bookings`
- `createAdminClient` from `@/lib/supabase/admin`
- `createClient` from `@/lib/supabase/server` (cookie-based, for auth checks)
- `revalidatePath` from `next/cache`
- `logAuditEvent` from `@/app/actions/audit`
- `z` from `zod`
- `checkUserPermission` from `@/app/actions/rbac`

- [ ] **Step 5.6: Run tests**

```bash
npx vitest run src/app/actions/privateBookingActions.test.ts
```

Expected: All new tests pass.

- [ ] **Step 5.7: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 5.8: Commit**

```bash
git add src/app/actions/privateBookingActions.ts src/app/actions/privateBookingActions.test.ts
git commit -m "feat: add editPrivateBookingPayment and deletePrivateBookingPayment server actions"
```

---

### Task 6: Component — `PaymentHistoryTable`

**Files:**
- Create: `src/app/(authenticated)/private-bookings/[id]/PaymentHistoryTable.tsx`

This is a pure client component with no server-side tests. It is tested manually in Task 7. Before writing, open `PrivateBookingDetailClient.tsx` and note which `ui-v2` component imports are used (Button, Badge, etc.) — use the same imports for consistency.

- [ ] **Step 6.1: Create the component**

Create `src/app/(authenticated)/private-bookings/[id]/PaymentHistoryTable.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PaymentHistoryEntry } from '@/types/private-bookings'
import {
  editPrivateBookingPayment,
  deletePrivateBookingPayment,
} from '@/app/actions/privateBookingActions'
import { formatDateDdMmmmYyyy } from '@/lib/dateUtils'

type Props = {
  payments: PaymentHistoryEntry[]
  bookingId: string
  canEditPayments: boolean
  totalAmount: number
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  invoice: 'Invoice',
  paypal: 'PayPal',
}

const EDITABLE_METHOD_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'invoice', label: 'Invoice' },
]

function formatGBP(amount: number) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

export function PaymentHistoryTable({ payments, bookingId, canEditPayments, totalAmount }: Props) {
  const router = useRouter()

  // State machine
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<{ amount: string; method: string }>({
    amount: '',
    method: '',
  })
  const [savingId, setSavingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [amountError, setAmountError] = useState<string | null>(null)

  // Global lock: while any operation is in flight, ALL action buttons are disabled
  const isLocked = savingId !== null || deletingId !== null

  // Summary calculations
  const paidToDate = payments.reduce((sum, p) => sum + p.amount, 0)
  const outstanding = Math.max(0, totalAmount - paidToDate)

  // ---- Event handlers ----

  function startEdit(entry: PaymentHistoryEntry) {
    setError(null)
    setAmountError(null)
    setConfirmDeleteId(null)
    setEditingId(entry.id)
    setEditValues({ amount: String(entry.amount), method: entry.method })
  }

  function cancelEdit() {
    setError(null)
    setAmountError(null)
    setEditingId(null)
  }

  function startDelete(id: string) {
    setError(null)
    setEditingId(null)
    setConfirmDeleteId(id)
  }

  function cancelDelete() {
    setError(null)
    setConfirmDeleteId(null)
  }

  async function handleSave(entry: PaymentHistoryEntry) {
    const amount = parseFloat(editValues.amount)
    if (isNaN(amount) || amount <= 0) {
      setAmountError('Amount must be greater than £0')
      return
    }
    setAmountError(null)

    setSavingId(entry.id)

    const formData = new FormData()
    formData.set('type', entry.type)
    formData.set('bookingId', bookingId)
    formData.set('amount', String(amount))
    formData.set('method', editValues.method)
    if (entry.type === 'balance') {
      formData.set('paymentId', entry.id)
    }

    const result = await editPrivateBookingPayment(formData)

    setSavingId(null)
    if (result.error) {
      setError(result.error)
    } else {
      setEditingId(null)
    }
    router.refresh()
  }

  async function handleDelete(entry: PaymentHistoryEntry) {
    setDeletingId(entry.id)
    setConfirmDeleteId(null)

    const formData = new FormData()
    formData.set('type', entry.type)
    formData.set('bookingId', bookingId)
    formData.set('paymentId', entry.id)

    const result = await deletePrivateBookingPayment(formData)

    setDeletingId(null)
    if (result.error) {
      setError(result.error)
    }
    router.refresh()
  }

  // ---- Render ----

  return (
    <div className="space-y-4">
      {/* Summary totals */}
      <div className="grid grid-cols-3 gap-4 rounded-lg border border-border bg-muted/30 p-4">
        <div>
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="font-semibold">{formatGBP(totalAmount)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Paid to date</p>
          <p className="font-semibold text-green-600">{formatGBP(paidToDate)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Outstanding</p>
          <p className={`font-semibold ${outstanding > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
            {formatGBP(outstanding)}
          </p>
        </div>
      </div>

      {/* Error display — clears on next interaction */}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Transaction table */}
      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Date</th>
                <th className="pb-2 pr-4 font-medium">Type</th>
                <th className="pb-2 pr-4 font-medium">Method</th>
                <th className="pb-2 pr-4 text-right font-medium">Amount</th>
                {canEditPayments && <th className="pb-2 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {payments.map(entry => {
                const isEditing = editingId === entry.id
                const isSaving = savingId === entry.id
                const isDeleting = deletingId === entry.id
                const isConfirmingDelete = confirmDeleteId === entry.id

                // Deposit paid via PayPal: method is read-only in edit mode
                const isPayPalDeposit = entry.type === 'deposit' && entry.method === 'paypal'

                return (
                  <tr
                    key={entry.id}
                    className={[
                      isEditing ? 'bg-amber-50 dark:bg-amber-950/20' : '',
                      isDeleting ? 'opacity-60' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {/* Date */}
                    <td className="py-2 pr-4 text-muted-foreground">
                      {formatDateDdMmmmYyyy(entry.date)}
                    </td>

                    {/* Type badge */}
                    <td className="py-2 pr-4">
                      {entry.type === 'deposit' ? (
                        <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                          Deposit
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          Part payment
                        </span>
                      )}
                    </td>

                    {/* Method */}
                    <td className="py-2 pr-4">
                      {isEditing ? (
                        isPayPalDeposit ? (
                          <span className="text-muted-foreground">PayPal</span>
                        ) : (
                          <select
                            value={editValues.method}
                            onChange={e => {
                              setError(null)
                              setEditValues(v => ({ ...v, method: e.target.value }))
                            }}
                            disabled={isSaving}
                            className="rounded border border-input bg-background px-2 py-1 text-sm"
                          >
                            {EDITABLE_METHOD_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        )
                      ) : (
                        METHOD_LABELS[entry.method] ?? entry.method
                      )}
                    </td>

                    {/* Amount */}
                    <td className="py-2 pr-4 text-right font-mono">
                      {isEditing ? (
                        <div>
                          <input
                            type="text"
                            value={editValues.amount}
                            onChange={e => {
                              setError(null)
                              setAmountError(null)
                              setEditValues(v => ({ ...v, amount: e.target.value }))
                            }}
                            disabled={isSaving}
                            className="w-24 rounded border border-input bg-background px-2 py-1 text-right text-sm"
                          />
                          {amountError && (
                            <p className="mt-0.5 text-xs text-destructive">{amountError}</p>
                          )}
                        </div>
                      ) : isDeleting ? (
                        <span className="text-muted-foreground text-xs">deleting…</span>
                      ) : (
                        formatGBP(entry.amount)
                      )}
                    </td>

                    {/* Actions */}
                    {canEditPayments && (
                      <td className="py-2">
                        {isEditing ? (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSave(entry)}
                              disabled={isLocked}
                              className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                            >
                              {isSaving ? 'saving…' : 'Save'}
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={isLocked}
                              className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                            >
                              ✕
                            </button>
                          </div>
                        ) : isConfirmingDelete ? (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground">Delete this payment?</span>
                            <button
                              onClick={() => handleDelete(entry)}
                              disabled={isLocked}
                              className="rounded bg-destructive px-2 py-1 font-medium text-destructive-foreground disabled:opacity-50"
                            >
                              Yes
                            </button>
                            <button
                              onClick={cancelDelete}
                              disabled={isLocked}
                              className="rounded px-2 py-1 font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                            >
                              No
                            </button>
                          </div>
                        ) : isDeleting ? (
                          <span className="text-xs text-muted-foreground">deleting…</span>
                        ) : (
                          <div className="flex gap-1">
                            <button
                              onClick={() => startEdit(entry)}
                              disabled={isLocked}
                              title="Edit payment"
                              aria-label={`Edit ${entry.type} payment of ${formatGBP(entry.amount)}`}
                              className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => startDelete(entry.id)}
                              disabled={isLocked}
                              title="Delete payment"
                              aria-label={`Delete ${entry.type} payment of ${formatGBP(entry.amount)}`}
                              className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-40"
                            >
                              🗑
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

**Styling note:** The component uses raw Tailwind classes. Before finalising, compare against other sections of `PrivateBookingDetailClient.tsx` and align button/badge styles to match `ui-v2` patterns. If `ui-v2` exports `Button` or `Badge` components, prefer those.

- [ ] **Step 6.2: Type-check**

```bash
npx tsc --noEmit
```

Fix any errors.

- [ ] **Step 6.3: Commit**

```bash
git add src/app/(authenticated)/private-bookings/[id]/PaymentHistoryTable.tsx
git commit -m "feat: add PaymentHistoryTable client component"
```

---

### Task 7: Page Integration — Wire Up Props and Replace Payment Summary

**Files:**
- Modify: `src/app/(authenticated)/private-bookings/[id]/page.tsx`
- Modify: `src/app/(authenticated)/private-bookings/PrivateBookingDetailServer.tsx`
- Modify: `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx`

- [ ] **Step 7.1: Update `page.tsx`**

1. Add imports (check which paths already exist and add only what's missing):

```typescript
import { getBookingPaymentHistory } from '@/services/private-bookings'
import { checkUserPermission } from '@/app/actions/rbac'  // confirmed import path from privateBookingActions.ts
import type { PaymentHistoryEntry } from '@/types/private-bookings'
```

2. Inside the async page function, after the existing permission/booking fetches, add:

```typescript
const [paymentHistory, canEditPayments] = await Promise.all([
  getBookingPaymentHistory(params.id),
  checkUserPermission('private_bookings', 'manage', user.id),
])
```

Replace `params.id` with whatever variable name is used for `bookingId` in this file.

3. Pass through to `PrivateBookingDetailServer`:

```tsx
<PrivateBookingDetailServer
  bookingId={bookingId}
  booking={booking}
  permissions={permissions}
  paymentHistory={paymentHistory}
  canEditPayments={canEditPayments}
/>
```

- [ ] **Step 7.2: Update `PrivateBookingDetailServer.tsx`**

1. Add import:
```typescript
import type { PaymentHistoryEntry } from '@/types/private-bookings'
```

2. Add to props type (locate the existing props interface and add):
```typescript
paymentHistory: PaymentHistoryEntry[]
canEditPayments: boolean
```

3. Destructure and forward to client:
```tsx
export function PrivateBookingDetailServer({
  ...,
  paymentHistory,
  canEditPayments,
}: Props) {
  return (
    <PrivateBookingDetailClient
      ...
      paymentHistory={paymentHistory}
      canEditPayments={canEditPayments}
    />
  )
}
```

- [ ] **Step 7.3: Update `PrivateBookingDetailClient.tsx`**

1. Add import:
```typescript
import type { PaymentHistoryEntry } from '@/types/private-bookings'
import { PaymentHistoryTable } from './PaymentHistoryTable'
```

2. Add to the props interface:
```typescript
paymentHistory: PaymentHistoryEntry[]
canEditPayments: boolean
```

3. Search for the existing payment summary block. It likely contains text or elements like "Deposit Paid", "Balance Due", "Balance Remaining", or renders `deposit_amount`, `final_payment_date`. **Read the file carefully** to identify the exact JSX block before removing it.

4. Replace the identified payment summary block with:
```tsx
<PaymentHistoryTable
  payments={paymentHistory}
  bookingId={bookingId}
  canEditPayments={canEditPayments}
  totalAmount={calculateTotal()}
/>
```

If `calculateTotal()` doesn't exist as a named function, look for how the total is computed inline and extract it, or inline the calculation as `totalAmount={booking.items?.reduce((sum, i) => sum + i.line_total, 0) ?? 0}`. Use whatever pattern exists in the file.

- [ ] **Step 7.4: Type-check**

```bash
npx tsc --noEmit
```

Fix any errors.

- [ ] **Step 7.5: Lint**

```bash
npm run lint
```

Fix all warnings and errors.

- [ ] **Step 7.6: Build**

```bash
npm run build
```

Expected: Successful production build with zero errors.

- [ ] **Step 7.7: Manual verification checklist**

Start dev server:
```bash
npm run dev
```

Navigate to `/private-bookings/[id]` and test each scenario:

**Read-only display:**
- [ ] Booking with deposit paid only → one "Deposit" row; summary shows correct Paid/Outstanding
- [ ] Booking with balance payment(s) only → only balance rows shown; no deposit row
- [ ] Booking with both → deposit first (or before balance on same date)
- [ ] Booking with no payments → "No payments recorded yet." message; summary shows Total / £0 paid / outstanding = total

**Manager edit flow:**
- [ ] Click ✏️ → row goes amber, amount input and method select appear, Save + ✕ shown
- [ ] Enter "-5" in amount → inline error "Amount must be greater than £0"; Save not executed
- [ ] Enter valid amount, click Save → row returns to read state, summary recalculates
- [ ] Click ✕ → edit cancelled, no changes made

**Manager delete flow:**
- [ ] Click 🗑 → "Delete this payment? Yes / No" appears
- [ ] Click No → confirmation dismissed, row unchanged
- [ ] Click 🗑 → Yes → payment removed, summary recalculates
- [ ] Deleting last balance payment on a "confirmed" booking → check that booking status reverts to "draft"

**PayPal deposit:**
- [ ] For a deposit paid via PayPal, entering edit mode shows "PayPal" as read-only text (not a select)

**Global lock:**
- [ ] While saving, ALL ✏️ and 🗑 buttons on ALL rows are disabled

**Staff user (no manage permission):**
- [ ] Actions column is not rendered; table is read-only

- [ ] **Step 7.8: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 7.9: Commit**

```bash
git add src/app/(authenticated)/private-bookings/[id]/page.tsx \
        src/app/(authenticated)/private-bookings/PrivateBookingDetailServer.tsx \
        src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx
git commit -m "feat: integrate PaymentHistoryTable into private booking detail page"
```

---

## Final Verification Checklist

- [ ] `npm run lint` — zero warnings/errors
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npm test` — all tests pass (including pre-existing tests)
- [ ] `npm run build` — production build succeeds
- [ ] Manual verification checklist in Step 7.7 fully checked off
