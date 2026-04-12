# Editable Deposit Amount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow staff to edit the security deposit amount on a private booking before payment, with backend fixes for method pollution, PayPal order invalidation, and permission alignment.

**Architecture:** Three files change: (1) service layer gets a new `updateDepositAmount` function that only touches `deposit_amount` and clears stale PayPal orders, (2) server action gets permission fix and routes unpaid vs paid deposit edits, (3) detail client gets inline edit UI matching the existing PaymentHistoryTable pattern.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase, Vitest

**Spec:** `docs/superpowers/specs/2026-04-12-editable-deposit-amount-design.md`

---

### Task 1: Add `updateDepositAmount` service function

**Files:**
- Modify: `src/services/private-bookings/payments.ts:577-588`
- Test: `src/services/private-bookings.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/services/private-bookings.test.ts` after the existing `updateDeposit` describe block. First add the import — find the existing import line for `updateDeposit` and add `updateDepositAmount`:

```typescript
// In the import from '@/services/private-bookings/payments' (or '@/services/private-bookings'),
// add updateDepositAmount alongside updateDeposit

describe('updateDepositAmount', () => {
  it('should update only deposit_amount and clear paypal_deposit_order_id', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate })
    mockedCreateAdminClient.mockReturnValue({ from: mockFrom } as any)

    await updateDepositAmount('booking-123', 350)

    expect(mockFrom).toHaveBeenCalledWith('private_bookings')
    expect(mockUpdate).toHaveBeenCalledWith({
      deposit_amount: 350,
      paypal_deposit_order_id: null,
    })
  })

  it('should throw when supabase update fails', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: { message: 'DB error' } }),
    })
    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ update: mockUpdate }),
    } as any)

    await expect(updateDepositAmount('booking-123', 200)).rejects.toThrow('Failed to update deposit amount: DB error')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/private-bookings.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — `updateDepositAmount` is not exported

- [ ] **Step 3: Write the implementation**

Add to `src/services/private-bookings/payments.ts` immediately after the existing `updateDeposit` function (after line 588):

```typescript
/**
 * Update only the deposit amount for an unpaid deposit.
 * Unlike updateDeposit, this does NOT write deposit_payment_method (avoids method pollution).
 * Also clears paypal_deposit_order_id to invalidate any in-flight PayPal order (CR-1).
 */
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/private-bookings.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/private-bookings/payments.ts src/services/private-bookings.test.ts
git commit -m "feat: add updateDepositAmount service function

Amount-only update for unpaid deposits. Clears paypal_deposit_order_id
to invalidate stale PayPal orders (CR-1). Does not write
deposit_payment_method to avoid method pollution (ID-1)."
```

---

### Task 2: Fix server action — permission alignment and unpaid deposit routing

**Files:**
- Modify: `src/app/actions/privateBookingActions.ts:31-33` (import), `1736-1829` (editPrivateBookingPayment)
- Test: `tests/actions/privateBookingActions.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/actions/privateBookingActions.test.ts` inside the existing `describe('editPrivateBookingPayment', ...)` block. First add `updateDepositAmount` to the mock setup and imports:

In the mock block near line 125, add:
```typescript
updateDepositAmount: vi.fn(),
```

In the import near line 138, add `updateDepositAmount`:
```typescript
import { PrivateBookingService, updateBalancePayment, deleteBalancePayment, updateDeposit, deleteDeposit, updateDepositAmount } from '@/services/private-bookings'
```

Near line 179, add:
```typescript
const mockedUpdateDepositAmount = updateDepositAmount as unknown as Mock
```

Then add these new test cases inside the `editPrivateBookingPayment` describe block:

```typescript
    it('should use updateDepositAmount for unpaid deposit (no method pollution)', async () => {
      const adminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { deposit_amount: 250, deposit_payment_method: null, deposit_paid_date: null },
                error: null,
              }),
            }),
          }),
        }),
      }
      mockedCreateAdminClient.mockReturnValue(adminClient)
      mockedUpdateDepositAmount.mockResolvedValue(undefined)

      const fd = new FormData()
      fd.set('bookingId', '660e8400-e29b-41d4-a716-446655440000')
      fd.set('type', 'deposit')
      fd.set('amount', '150')
      fd.set('method', 'cash')

      const result = await editPrivateBookingPayment(fd)

      expect(result).toEqual({ success: true })
      expect(mockedUpdateDepositAmount).toHaveBeenCalledWith(
        '660e8400-e29b-41d4-a716-446655440000',
        150
      )
      expect(mockedUpdateDeposit).not.toHaveBeenCalled()
    })

    it('should use updateDeposit for paid deposit (preserves existing behaviour)', async () => {
      const adminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { deposit_amount: 250, deposit_payment_method: 'cash', deposit_paid_date: '2026-04-01T00:00:00Z' },
                error: null,
              }),
            }),
          }),
        }),
      }
      mockedCreateAdminClient.mockReturnValue(adminClient)
      mockedUpdateDeposit.mockResolvedValue(undefined)

      const fd = new FormData()
      fd.set('bookingId', '660e8400-e29b-41d4-a716-446655440000')
      fd.set('type', 'deposit')
      fd.set('amount', '300')
      fd.set('method', 'card')

      const result = await editPrivateBookingPayment(fd)

      expect(result).toEqual({ success: true })
      expect(mockedUpdateDeposit).toHaveBeenCalledWith(
        '660e8400-e29b-41d4-a716-446655440000',
        { amount: 300, method: 'card' }
      )
      expect(mockedUpdateDepositAmount).not.toHaveBeenCalled()
    })

    it('should allow manage_deposits permission for deposit edits', async () => {
      // First call (manage) returns false, second call (manage_deposits) returns true
      mockedPermission
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)

      const adminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { deposit_amount: 250, deposit_payment_method: null, deposit_paid_date: null },
                error: null,
              }),
            }),
          }),
        }),
      }
      mockedCreateAdminClient.mockReturnValue(adminClient)
      mockedUpdateDepositAmount.mockResolvedValue(undefined)

      const fd = new FormData()
      fd.set('bookingId', '660e8400-e29b-41d4-a716-446655440000')
      fd.set('type', 'deposit')
      fd.set('amount', '200')
      fd.set('method', 'cash')

      const result = await editPrivateBookingPayment(fd)

      expect(result).toEqual({ success: true })
      expect(mockedPermission).toHaveBeenCalledWith('private_bookings', 'manage', expect.any(String))
      expect(mockedPermission).toHaveBeenCalledWith('private_bookings', 'manage_deposits', expect.any(String))
    })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/actions/privateBookingActions.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: FAIL — `updateDepositAmount` not imported, permission logic unchanged, routing unchanged

- [ ] **Step 3: Implement the changes**

**3a. Add import** — in `src/app/actions/privateBookingActions.ts` at line 31, add `updateDepositAmount` to the import:

```typescript
  updateDeposit,
  updateDepositAmount,
  deleteDeposit,
```

**3b. Fix permission check** — replace lines 1743-1744:

```typescript
  const canEdit = await checkUserPermission('private_bookings', 'manage', user.id)
  if (!canEdit) {
    // For deposit edits, also accept manage_deposits permission (AI-1)
    if (type !== 'deposit' || !(await checkUserPermission('private_bookings', 'manage_deposits', user.id))) {
      return { error: 'Forbidden' }
    }
  }
```

**3c. Route unpaid vs paid deposit edits** — replace the deposit branch (lines 1792-1829) with:

```typescript
  if (type === 'deposit') {
    const parsed = editDepositSchema.safeParse({
      bookingId: formData.get('bookingId'),
      type: formData.get('type'),
      amount: formData.get('amount'),
      method: formData.get('method'),
    })
    if (!parsed.success) return { error: parsed.error.errors[0].message }

    const db = createAdminClient()
    const { data: oldBooking } = await db.from('private_bookings').select('deposit_amount, deposit_payment_method, deposit_paid_date').eq('id', parsed.data.bookingId).single()

    try {
      if (oldBooking?.deposit_paid_date) {
        // Paid deposit: update amount + method (existing behaviour)
        await updateDeposit(parsed.data.bookingId, {
          amount: parseFloat(parsed.data.amount),
          method: parsed.data.method,
        })
      } else {
        // Unpaid deposit: update amount only, clear PayPal order (CR-1, ID-1)
        await updateDepositAmount(parsed.data.bookingId, parseFloat(parsed.data.amount))
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Failed to update deposit' }
    }

    await logAuditEvent({
      user_id: user.id,
      operation_type: 'update',
      operation_status: 'success',
      resource_type: 'private_booking',
      additional_info: {
        action: 'edit_private_booking_deposit',
        booking_id: parsed.data.bookingId,
        old_amount: oldBooking?.deposit_amount,
        new_amount: parseFloat(parsed.data.amount),
        old_method: oldBooking?.deposit_payment_method,
        new_method: oldBooking?.deposit_paid_date ? parsed.data.method : oldBooking?.deposit_payment_method,
        deposit_paid: !!oldBooking?.deposit_paid_date,
      },
    })
    revalidatePath(`/private-bookings/${parsed.data.bookingId}`)
    return { success: true }
  }
```

- [ ] **Step 4: Update the existing deposit edit test**

The existing test at line 883 ("should edit a deposit payment successfully") mocks `deposit_payment_method: 'cash'` but does NOT include `deposit_paid_date`. With our new routing, this would hit `updateDepositAmount` instead of `updateDeposit`. Update the mock data to include `deposit_paid_date` to preserve its original intent of testing a PAID deposit edit:

```typescript
    it('should edit a deposit payment successfully', async () => {
      const adminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { deposit_amount: 80, deposit_payment_method: 'cash', deposit_paid_date: '2026-03-15T00:00:00Z' },
                error: null,
              }),
            }),
          }),
        }),
      }
      mockedCreateAdminClient.mockReturnValue(adminClient)
      mockedUpdateDeposit.mockResolvedValue(undefined)

      const fd = new FormData()
      fd.set('bookingId', '660e8400-e29b-41d4-a716-446655440000')
      fd.set('type', 'deposit')
      fd.set('amount', '120')
      fd.set('method', 'card')

      const result = await editPrivateBookingPayment(fd)

      expect(result).toEqual({ success: true })
      expect(mockedUpdateDeposit).toHaveBeenCalledWith(
        '660e8400-e29b-41d4-a716-446655440000',
        { amount: 120, method: 'card' }
      )
    })
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/actions/privateBookingActions.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/privateBookingActions.ts tests/actions/privateBookingActions.test.ts
git commit -m "fix: permission alignment and unpaid deposit routing in editPrivateBookingPayment

- Accept manage_deposits permission for deposit edits (AI-1)
- Route unpaid deposits to updateDepositAmount (amount only, no method pollution)
- Route paid deposits to updateDeposit (preserves existing behaviour)
- Add deposit_paid_date to select for routing decision"
```

---

### Task 3: Add inline deposit edit UI to detail page

**Files:**
- Modify: `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx`

- [ ] **Step 1: Add imports**

Add `CheckIcon` to the heroicon import block (line 7-33). Find `XMarkIcon,` and add `CheckIcon,` before it:

```typescript
  CheckIcon,
  XMarkIcon,
```

Add `editPrivateBookingPayment` to the server action imports (line 51-71). Add it after `sendDepositPaymentLink,`:

```typescript
  sendDepositPaymentLink,
  editPrivateBookingPayment,
```

- [ ] **Step 2: Add state variables**

After the `sendingDepositLink` state line (line 1342), add:

```typescript
  // Inline deposit amount edit state
  const [editingDeposit, setEditingDeposit] = useState(false);
  const [editDepositAmount, setEditDepositAmount] = useState('');
  const [savingDeposit, setSavingDeposit] = useState(false);
```

- [ ] **Step 3: Add save handler**

After the `handleSendDepositLink` callback (ends around line 1491), add:

```typescript
  const handleSaveDepositAmount = useCallback(async () => {
    if (savingDeposit) return;
    setSavingDeposit(true);
    try {
      const formData = new FormData();
      formData.set('bookingId', bookingId);
      formData.set('type', 'deposit');
      formData.set('amount', editDepositAmount);
      formData.set('method', booking?.deposit_payment_method ?? 'cash');
      const result = await editPrivateBookingPayment(formData);
      if (result.success) {
        toast.success('Deposit amount updated');
        setEditingDeposit(false);
        router.refresh();
      } else {
        toast.error(result.error ?? 'Failed to update deposit amount');
      }
    } catch {
      toast.error('Failed to update deposit amount');
    } finally {
      setSavingDeposit(false);
    }
  }, [bookingId, editDepositAmount, savingDeposit, booking?.deposit_payment_method, router]);
```

- [ ] **Step 4: Update the deposit card UI**

Replace the static amount display and pencil icon section. Find the block at lines 2346-2378 (from `<div className="text-right">` through the closing `</div>` of the payment buttons). Replace it with:

```tsx
                  <div className="text-right">
                    {editingDeposit ? (
                      <div className="flex items-center gap-1 justify-end">
                        <Input
                          type="number"
                          value={editDepositAmount}
                          onChange={(e) => setEditDepositAmount(e.target.value)}
                          disabled={savingDeposit}
                          min="0.01"
                          step="0.01"
                          placeholder="Amount"
                          aria-label="Deposit amount"
                          inputSize="sm"
                          className="w-24"
                        />
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={handleSaveDepositAmount}
                          loading={savingDeposit}
                          disabled={savingDeposit}
                          aria-label="Save deposit amount"
                        >
                          <CheckIcon className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setEditingDeposit(false)}
                          disabled={savingDeposit}
                          type="button"
                          aria-label="Cancel edit"
                        >
                          <XMarkIcon className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 justify-end">
                        <p className="text-sm font-medium text-gray-900">
                          {formatMoney(booking.deposit_amount ?? 250)}
                        </p>
                        {!booking.deposit_paid_date && canManageDeposits && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditDepositAmount(String(booking.deposit_amount ?? 250));
                              setEditingDeposit(true);
                            }}
                            className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-400 rounded"
                            aria-label="Edit deposit amount"
                          >
                            <PencilIcon className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                    {!booking.deposit_paid_date &&
                      (booking.status === "draft" || booking.status === "confirmed") &&
                      canManageDeposits && (
                        <div className="mt-1 flex flex-col gap-1 items-end">
                          <button type="button"
                            onClick={() => setShowDepositModal(true)}
                            className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                          >
                            Record Payment
                          </button>
                          <button
                            type="button"
                            onClick={handlePaypalDeposit}
                            disabled={paypalDepositLoading}
                            className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                          >
                            {paypalDepositLoading ? 'Creating link…' : 'Pay via PayPal'}
                          </button>
                          <button
                            type="button"
                            onClick={handleSendDepositLink}
                            disabled={sendingDepositLink}
                            className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {sendingDepositLink ? 'Sending…' : 'Send payment link'}
                          </button>
                        </div>
                      )}
                    </div>
```

Note: The pencil icon condition is `!booking.deposit_paid_date && canManageDeposits` (NO status gate). The payment buttons below retain their existing `draft || confirmed` status check.

- [ ] **Step 5: Run build to verify no type errors**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `npm run lint 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/app/\(authenticated\)/private-bookings/\[id\]/PrivateBookingDetailClient.tsx
git commit -m "feat: add inline deposit amount editing on booking detail page

Pencil icon next to deposit amount when unpaid + canManageDeposits.
Swaps to number input with save/cancel buttons matching
PaymentHistoryTable inline edit pattern."
```

---

### Task 4: Full verification

- [ ] **Step 1: Run full test suite**

Run: `npm test 2>&1 | tail -20`
Expected: ALL PASS

- [ ] **Step 2: Run build**

Run: `npm run build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 3: Run lint**

Run: `npm run lint 2>&1 | tail -10`
Expected: Zero warnings, zero errors
