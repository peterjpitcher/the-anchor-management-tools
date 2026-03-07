# Table Bookings Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all known defects in the table-bookings system — remove legacy card capture infrastructure, implement correct refund/cancellation policy, fix data integrity issues, and make the deposit flow the single path for all group bookings.

**Architecture:** All mutations use Next.js server actions or API routes. DB changes go through Supabase migrations. The Stripe deposit flow (PaymentIntent via Checkout Session) is the single authorised payment mechanism. Card capture (SetupIntent) is legacy and being removed entirely.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase (PostgreSQL), Stripe API, Twilio SMS, Vercel Cron.

**Confirmed business policy:**
- Deposit: £10/person for party_size ≥ 7 or Sunday lunch
- Refund tiers: 7+ days before = 100%, 3–6 days before = 50%, <3 days = 0%
- No-show / late cancellation: no additional fees — deposit is kept
- Party size reduction: full deposit kept; only reduced-party amount comes off bill (no partial refund)
- No manager override of deposit rules — rules are fixed

**Latest migration prefix:** `20260507000002` — new migrations use `20260508000001`, `20260508000002`, etc.

---

## Task 1: Data cleanup migration — fix stale payment_status records

**Context:** 103 confirmed bookings with party_size < 7 have `payment_status = 'pending'` even though no deposit was ever needed. 8 bookings are stuck in `pending_payment` status but the booking date has already passed. Both are data noise that makes admin views misleading.

**Files:**
- Create: `supabase/migrations/20260508000001_data_cleanup_payment_status.sql`

**Step 1: Write the migration**

```sql
-- supabase/migrations/20260508000001_data_cleanup_payment_status.sql
-- Fix stale payment_status records from legacy manager booking flow

BEGIN;

-- 1. Confirmed bookings where no deposit was ever required (party_size < 7,
--    not a Sunday lunch) but payment_status is incorrectly 'pending'.
--    These were manager-confirmed bookings where payment_status was never cleared.
--    Verified: none have any payment record in the payments table.
UPDATE table_bookings
SET
  payment_status = NULL,
  updated_at = NOW()
WHERE
  status = 'confirmed'
  AND payment_status = 'pending'
  AND party_size < 7
  AND EXTRACT(DOW FROM booking_date) != 0  -- 0 = Sunday
  AND NOT EXISTS (
    SELECT 1 FROM payments p
    WHERE p.table_booking_id = table_bookings.id
  );

-- 2. Past bookings stuck in pending_payment (deposit required but never paid,
--    booking date has now passed). Cancel them administratively.
UPDATE table_bookings
SET
  status = 'cancelled',
  cancelled_at = NOW(),
  cancelled_by = 'system',
  cancellation_reason = 'deposit_never_paid_booking_passed',
  updated_at = NOW()
WHERE
  status = 'pending_payment'
  AND booking_date < CURRENT_DATE;

COMMIT;
```

**Step 2: Apply the migration**

```bash
cd /Users/peterpitcher/Cursor/anchor-management-tools
npx supabase db push
```

Expected: migration applied with no errors.

**Step 3: Verify**

Run against production DB:
```sql
-- Should return 0
SELECT COUNT(*) FROM table_bookings
WHERE status = 'confirmed' AND payment_status = 'pending' AND party_size < 7
AND EXTRACT(DOW FROM booking_date) != 0;

-- Should return 0
SELECT COUNT(*) FROM table_bookings
WHERE status = 'pending_payment' AND booking_date < CURRENT_DATE;
```

**Step 4: Commit**

```bash
git add supabase/migrations/20260508000001_data_cleanup_payment_status.sql
git commit -m "fix: clean up stale payment_status records from legacy manager booking flow"
```

---

## Task 2: Remove pending_card_capture from TypeScript types

**Context:** `pending_card_capture` exists in the `TableBookingState` union type in `src/lib/table-bookings/bookings.ts` but is NOT in the DB enum. It causes type confusion and routes bookings into the legacy card capture path. Remove it everywhere.

**Files:**
- Modify: `src/lib/table-bookings/bookings.ts`
- Modify: `src/app/g/[token]/table-manage/page.tsx`

**Step 1: Read both files in full before editing**

```bash
# Note full line count and content before touching anything
wc -l src/lib/table-bookings/bookings.ts
wc -l src/app/g/[token]/table-manage/page.tsx
```

**Step 2: Update TableBookingState in bookings.ts**

Find:
```typescript
export type TableBookingState = 'confirmed' | 'pending_card_capture' | 'pending_payment' | 'blocked'
```

Replace with:
```typescript
export type TableBookingState = 'confirmed' | 'pending_payment' | 'blocked'
```

**Step 3: Remove sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed**

In `src/lib/table-bookings/bookings.ts`, find and delete the entire function `sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed`. It is only called from the card capture webhook handler (removed in Task 4).

**Step 4: Update table-manage guest page**

In `src/app/g/[token]/table-manage/page.tsx`, in the `humanizeStatus()` function, remove the `pending_card_capture` case entirely. Any booking that was in card capture state should now display as `'Awaiting deposit'` (the same as `pending_payment`).

**Step 5: Find all remaining references**

```bash
grep -r "pending_card_capture\|CardCapture\|cardCapture\|card_capture" \
  src/ --include="*.ts" --include="*.tsx" -l
```

List every file found — these are addressed in Tasks 3, 4, and 5.

**Step 6: Commit**

```bash
git add src/lib/table-bookings/bookings.ts src/app/g/[token]/table-manage/page.tsx
git commit -m "fix: remove pending_card_capture from TypeScript types and guest manage page"
```

---

## Task 3: Remove card capture from the BOH admin UI

**Context:** The BOH bookings client has `pending_card_capture` in its StatusFilter type, filter UI, status label function, and badge colour logic. Also fix the bug where `confirmed + payment_status = 'pending'` bookings (e.g. the April 17th 20-person booking) are not visible.

**Files:**
- Modify: `src/app/(authenticated)/table-bookings/boh/BohBookingsClient.tsx`

**Step 1: Read the full file before editing**

**Step 2: Remove pending_card_capture from StatusFilter type**

Find (around line 13):
```typescript
type StatusFilter =
  | 'all'
  | 'confirmed'
  | 'pending_payment'
  | 'pending_card_capture'   // ← remove this line
  | 'seated'
  ...
```

**Step 3: Remove from filter button/select UI**

Find where filter options are rendered. Remove the `pending_card_capture` option.

**Step 4: Remove from getStatusLabel()**

Find `getStatusLabel()` (around line 269). Remove:
```typescript
case 'pending_card_capture':
  return 'Pending card'
```

**Step 5: Remove from badge colour logic**

Find where `pending_card_capture` appears in badge/colour mapping (around line 244). Remove those cases.

**Step 6: Fix the confirmed+pending_payment visibility bug**

Find where the booking list is fetched or filtered. Look for any condition that would exclude bookings with `status = 'confirmed'` AND `payment_status = 'pending'`. Remove or fix that condition — these bookings MUST appear in the admin view.

Then add a visual indicator: confirmed bookings with `payment_status = 'pending'` should show a yellow "Deposit outstanding" badge alongside the green "Confirmed" badge so staff can see at a glance.

**Step 7: Commit**

```bash
git add src/app/(authenticated)/table-bookings/boh/BohBookingsClient.tsx
git commit -m "fix: remove pending_card_capture from BOH UI; show confirmed bookings with outstanding deposits"
```

---

## Task 4: Remove card capture from the Stripe webhook handler

**Context:** `src/app/api/stripe/webhook/route.ts` has a large block (lines ~472–745) handling `payment_kind === 'table_card_capture'`. This calls `complete_table_card_capture_v05` and `sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed`. Once card capture is removed from the product, this branch becomes dead code and must be deleted.

**Files:**
- Modify: `src/app/api/stripe/webhook/route.ts`

**Step 1: Read the file, identify the exact boundaries of the card capture block**

The block starts at the `if (paymentKind === 'table_card_capture')` check and ends at the corresponding closing brace. Note the exact line numbers.

**Step 2: Delete the entire card capture block**

Remove lines 472–745 (adjust to actual boundaries found in Step 1).

**Step 3: Remove the retrieveStripeSetupIntent import if now unused**

```bash
grep -n "retrieveStripeSetupIntent" src/app/api/stripe/webhook/route.ts
```

If it only appeared in the deleted block, remove the import.

**Step 4: Verify build**

```bash
npm run build 2>&1 | head -60
```

Expected: no TypeScript errors.

**Step 5: Commit**

```bash
git add src/app/api/stripe/webhook/route.ts
git commit -m "fix: remove legacy card capture webhook handler — deposit PaymentIntent is now the only payment path"
```

---

## Task 5: Deprecate the card capture guest page

**Context:** Guests with old card capture links will visit `/g/[token]/card-capture`. Since the card capture system is being removed, this page must not error. Replace it with a message that card details are no longer required and their booking is confirmed (or send them to their deposit payment page if applicable).

**Files:**
- Modify: `src/app/g/[token]/card-capture/page.tsx`

**Step 1: Read the current page in full**

**Step 2: Replace the page content**

Rewrite the page to simply display a message. Do not attempt to process any card:

```typescript
export default async function CardCapturePage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-2xl font-semibold">Card details no longer required</h1>
        <p className="text-gray-600">
          Your booking has been updated. No card details are needed.
          You will receive an SMS with your booking confirmation.
        </p>
        <p className="text-gray-600">
          If you have any questions, please contact us directly.
        </p>
      </div>
    </main>
  )
}
```

**Step 3: Verify build**

```bash
npm run build 2>&1 | grep -i "card-capture"
```

**Step 4: Commit**

```bash
git add src/app/g/[token]/card-capture/
git commit -m "fix: replace card capture guest page with deprecation message"
```

---

## Task 6: Implement tiered deposit refund on cancellation and deletion

**Context:** When a booking is cancelled or deleted by admin, if a deposit was paid it must be refunded according to the confirmed policy tiers. `createStripeRefund()` already exists in `src/lib/payments/stripe.ts`. The deletion endpoint is `DELETE /api/boh/table-bookings/[id]`. The cancellation action is `POST /api/boh/table-bookings/[id]/status` with `{ action: 'cancelled' }`.

**Files:**
- Create: `src/lib/table-bookings/refunds.ts`
- Modify: `src/lib/table-bookings/bookings.ts` (add cancellation SMS function)
- Modify: `src/app/api/boh/table-bookings/[id]/route.ts`
- Modify: `src/app/api/boh/table-bookings/[id]/status/route.ts` (or wherever cancellation action lives — find it first)

**Step 1: Read the DELETE handler in full**

Read `src/app/api/boh/table-bookings/[id]/route.ts` completely.

**Step 2: Find the cancellation status handler**

```bash
grep -r "action.*cancelled\|cancelled.*action\|status.*cancel" \
  src/app/api/boh/ --include="*.ts" -l
```

Read the identified file.

**Step 3: Create src/lib/table-bookings/refunds.ts**

```typescript
import { createStripeRefund } from '@/lib/payments/stripe'
import { createClient } from '@/lib/supabase/server'

export type RefundTier = 'full' | 'half' | 'none'

export type RefundResult =
  | { refunded: false; reason: 'no_deposit' | 'zero_tier' | 'already_refunded' }
  | { refunded: true; amountPence: number; refundId: string; tier: RefundTier }

/**
 * Calculate refund percentage based on days until booking.
 * Policy: 7+ days = 100%, 3–6 days = 50%, <3 days = 0%
 */
export function calculateRefundTier(bookingDate: Date): { percent: number; tier: RefundTier } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffMs = bookingDate.getTime() - today.getTime()
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  if (days >= 7) return { percent: 100, tier: 'full' }
  if (days >= 3) return { percent: 50, tier: 'half' }
  return { percent: 0, tier: 'none' }
}

/**
 * Issue a Stripe refund for a table booking deposit if one was paid.
 * Updates the payment record in the DB.
 */
export async function refundTableBookingDeposit(
  tableBookingId: string,
  bookingDate: Date
): Promise<RefundResult> {
  const supabase = await createClient()

  const { data: payment } = await supabase
    .from('payments')
    .select('id, amount, stripe_payment_intent_id, status')
    .eq('table_booking_id', tableBookingId)
    .eq('charge_type', 'table_deposit')
    .eq('status', 'succeeded')
    .maybeSingle()

  if (!payment?.stripe_payment_intent_id) return { refunded: false, reason: 'no_deposit' }
  if (payment.status === 'refunded') return { refunded: false, reason: 'already_refunded' }

  const { percent, tier } = calculateRefundTier(bookingDate)
  if (percent === 0) return { refunded: false, reason: 'zero_tier' }

  // Amount stored in DB is in pounds; Stripe refund needs pence
  const refundAmountPence = Math.round(payment.amount * percent)

  const stripeRefund = await createStripeRefund({
    paymentIntentId: payment.stripe_payment_intent_id,
    amountMinor: refundAmountPence,
    reason: 'requested_by_customer',
    metadata: { table_booking_id: tableBookingId, refund_tier: tier },
    idempotencyKey: `tbl-refund-${payment.id}-${tier}`,
  })

  await supabase
    .from('payments')
    .update({
      status: tier === 'full' ? 'refunded' : 'partial_refund',
      refund_amount: refundAmountPence / 100,
      updated_at: new Date().toISOString(),
    })
    .eq('id', payment.id)

  return { refunded: true, amountPence: refundAmountPence, refundId: stripeRefund.id, tier }
}
```

**Step 4: Add cancellation SMS to bookings.ts**

In `src/lib/table-bookings/bookings.ts`, add:

```typescript
export async function sendTableBookingCancelledSmsIfAllowed(params: {
  customerId: string
  bookingReference: string
  bookingDate: string  // YYYY-MM-DD
  refundResult: RefundResult
}): Promise<void> {
  // Look up customer mobile from DB
  // Build message:
  //   - refunded full: "Your [date] booking (ref [ref]) has been cancelled. A full refund of £X will appear within 5-10 days."
  //   - refunded half: "Your [date] booking (ref [ref]) has been cancelled. A 50% refund of £X will appear within 5-10 days."
  //   - zero tier:     "Your [date] booking (ref [ref]) has been cancelled. As this is within 3 days of your booking, your deposit is non-refundable."
  //   - no deposit:    "Your [date] booking (ref [ref]) has been cancelled."
  // Use existing sendSms infrastructure
}
```

Implement following the same pattern as `sendTableBookingConfirmedAfterDepositSmsIfAllowed`.

**Step 5: Wire into the DELETE endpoint**

In `src/app/api/boh/table-bookings/[id]/route.ts`, after the soft-delete succeeds, add:

```typescript
import { refundTableBookingDeposit } from '@/lib/table-bookings/refunds'
import { sendTableBookingCancelledSmsIfAllowed } from '@/lib/table-bookings/bookings'

// After soft-delete update:
try {
  const bookingDate = new Date(existingBooking.booking_date)
  const refundResult = await refundTableBookingDeposit(existingBooking.id, bookingDate)
  await sendTableBookingCancelledSmsIfAllowed({
    customerId: existingBooking.customer_id,
    bookingReference: existingBooking.booking_reference,
    bookingDate: existingBooking.booking_date,
    refundResult,
  })
} catch (err) {
  console.error('[table-booking-delete] refund/SMS error:', err)
  // Do not fail the delete — log and continue
}
```

**Step 6: Wire into the cancellation status handler**

Apply identical logic when `action === 'cancelled'`.

**Step 7: Build check**

```bash
npm run build 2>&1 | head -60
```

**Step 8: Commit**

```bash
git add src/lib/table-bookings/refunds.ts \
        src/lib/table-bookings/bookings.ts \
        src/app/api/boh/table-bookings/
git commit -m "feat: tiered deposit refund (100%/50%/0%) and cancellation SMS on booking cancel or delete"
```

---

## Task 7: Auto-cancel cron — cancel pending deposits 24h before booking

**Context:** Bookings in `pending_payment` status where the deposit is not paid should be automatically cancelled 24 hours before the booking. A cancellation SMS is sent to the customer (no refund needed as no deposit was paid).

**Files:**
- Create: `src/app/api/cron/table-booking-deposit-timeout/route.ts`
- Modify: `vercel.json`

**Step 1: Read vercel.json to understand existing cron format**

**Step 2: Create the cron handler**

```typescript
// src/app/api/cron/table-booking-deposit-timeout/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/admin'
import { sendTableBookingCancelledSmsIfAllowed } from '@/lib/table-bookings/bookings'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient()
  const now = new Date()

  // Find pending_payment bookings where the booking is within 24h
  const { data: candidates, error } = await supabase
    .from('table_bookings')
    .select('id, customer_id, booking_reference, booking_date, booking_time')
    .eq('status', 'pending_payment')
    .lte('booking_date', new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString().split('T')[0])

  if (error) {
    console.error('[deposit-timeout] fetch error:', error)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  let cancelled = 0
  for (const booking of candidates ?? []) {
    const bookingDateTime = new Date(`${booking.booking_date}T${booking.booking_time}`)
    if (bookingDateTime.getTime() - now.getTime() > 24 * 60 * 60 * 1000) continue

    const { error: updateErr } = await supabase
      .from('table_bookings')
      .update({
        status: 'cancelled',
        cancelled_at: now.toISOString(),
        cancelled_by: 'system',
        cancellation_reason: 'deposit_not_paid_within_24h',
        updated_at: now.toISOString(),
      })
      .eq('id', booking.id)

    if (updateErr) {
      console.error('[deposit-timeout] update error for', booking.id, updateErr)
      continue
    }

    try {
      await sendTableBookingCancelledSmsIfAllowed({
        customerId: booking.customer_id,
        bookingReference: booking.booking_reference,
        bookingDate: booking.booking_date,
        refundResult: { refunded: false, reason: 'no_deposit' },
      })
    } catch (err) {
      console.error('[deposit-timeout] SMS error for', booking.id, err)
    }

    cancelled++
  }

  console.log(`[deposit-timeout] cancelled ${cancelled} bookings`)
  return NextResponse.json({ cancelled })
}
```

**Step 3: Add to vercel.json crons array**

```json
{
  "path": "/api/cron/table-booking-deposit-timeout",
  "schedule": "0 * * * *"
}
```

Runs every hour. Checks at execution time whether any pending booking is within 24h.

**Step 4: Build check**

```bash
npm run build 2>&1 | head -30
```

**Step 5: Commit**

```bash
git add src/app/api/cron/table-booking-deposit-timeout/route.ts vercel.json
git commit -m "feat: hourly cron to auto-cancel unpaid deposit bookings 24h before booking time"
```

---

## Task 8: Fix manager booking creation to enforce deposit rules

**Context:** Manager-created bookings via the FOH interface must follow the same deposit rules as guest-initiated bookings. A manager must not be able to confirm a 7+ person booking without the deposit being collected.

**Files:**
- Find: the FOH booking creation action/handler

**Step 1: Find the manager booking creation path**

```bash
grep -rn "create.*booking\|booking.*create\|foh" \
  src/app/actions/ src/app/api/ --include="*.ts" -l
grep -rn "party_size\|partySize" \
  src/app/actions/ --include="*.ts" | grep -i "creat\|insert"
```

Read every identified file before making changes.

**Step 2: Identify where status is set on creation**

Look for where `status` is assigned during booking creation. If `status = 'confirmed'` is set unconditionally regardless of party size, that is the bug.

**Step 3: Apply the rule**

When party_size >= 7 (or Sunday lunch):
- Set `status = 'pending_payment'` (not `confirmed`)
- Generate deposit payment link (follow the same pattern as the guest booking path)
- Return the deposit link to the UI so the manager can copy/send it

When party_size < 7:
- Set `status = 'confirmed'` as normal

**Step 4: Update the FOH UI if needed**

If the FOH booking creation form shows a "Booking confirmed" success message, update it to show a "Deposit required — send this link to the customer" state for group bookings.

**Step 5: Build and lint**

```bash
npm run lint && npm run build 2>&1 | head -40
```

**Step 6: Commit**

```bash
git add <files changed>
git commit -m "fix: manager FOH booking creation now enforces deposit rules — 7+ person bookings require deposit before confirmation"
```

---

## Task 9: Trigger deposit request when party size amendment crosses threshold

**Context:** If a booking is amended to increase party size from <7 to ≥7, the deposit requirement is triggered but the system currently does nothing. The booking must move to `pending_payment` and a deposit link sent to the customer.

**Files:**
- Find: the party size amendment handler

**Step 1: Find the amendment handler**

```bash
grep -rn "party_size\|partySize\|update.*booking\|amend" \
  src/app/api/boh/ src/app/actions/ --include="*.ts" | grep -iv "create"
```

Read the identified file(s).

**Step 2: Add threshold check**

After the party_size update succeeds, add:

```typescript
const wasDepositRequired = previousPartySize >= 7
const isDepositNowRequired = newPartySize >= 7
const depositAlreadyPaid = existingBooking.payment_status === 'completed'

if (!wasDepositRequired && isDepositNowRequired && !depositAlreadyPaid) {
  // Set booking to pending_payment
  await supabase
    .from('table_bookings')
    .update({ status: 'pending_payment', payment_status: 'pending', updated_at: new Date().toISOString() })
    .eq('id', bookingId)

  // Generate deposit payment token and send SMS to customer
  // (follow the same pattern used in create_table_booking_v05_core for deposit link generation)
}
```

**Step 3: Commit**

```bash
git add <files changed>
git commit -m "feat: trigger deposit request when party size increase crosses the 7-person threshold"
```

---

## Task 10: Add SMS error capture and audit logging

**Context:** SMS send failures are silently swallowed. Customers may not receive confirmations and staff have no visibility. All SMS calls in `src/lib/table-bookings/bookings.ts` must log failures to the audit trail.

**Files:**
- Modify: `src/lib/table-bookings/bookings.ts`

**Step 1: Read the file and find all SMS send call sites**

Find every call to `sendSms` or equivalent within the table-booking SMS functions.

**Step 2: Wrap each in try/catch with structured logging**

```typescript
try {
  await sendSms({ to: mobileNumber, body: message })
} catch (err) {
  console.error('[table-booking-sms] send failed', { bookingId, template: 'confirmation', error: String(err) })
  // If an audit_logs table is available, insert a failure record:
  // await supabaseAdmin.from('audit_logs').insert({
  //   operation_type: 'sms_send_failed',
  //   resource_type: 'table_booking',
  //   resource_id: bookingId,
  //   metadata: { template, error: String(err) },
  // })
}
```

Do not re-throw. SMS failure must never fail the primary booking operation.

**Step 3: Commit**

```bash
git add src/lib/table-bookings/bookings.ts
git commit -m "fix: capture and log SMS send failures for table booking notifications"
```

---

## Task 11: Fix atomic capacity check (race condition)

**Context:** The DB capacity check and booking insert are not atomic. Under concurrent load, two requests can both pass the check then both insert — overselling a slot. Fix using a Postgres advisory lock.

**Files:**
- Find: `create_table_booking_v05_core` or equivalent RPC in supabase/migrations/
- Create: `supabase/migrations/20260508000002_fix_atomic_capacity_check.sql`

**Step 1: Find the relevant RPC**

```bash
grep -l "create_table_booking_v05\|capacity\|max_covers\|available" \
  supabase/migrations/*.sql
```

Read the migration containing the booking creation RPC.

**Step 2: Identify the capacity check location**

Find where the RPC checks capacity before inserting. Note the exact SQL.

**Step 3: Add advisory lock**

At the top of the RPC body (before the capacity check), add:

```sql
-- Acquire exclusive lock for this date/time slot to prevent concurrent inserts
PERFORM pg_advisory_xact_lock(
  ('x' || substr(md5(p_booking_date::text || p_booking_time::text), 1, 16))::bit(64)::bigint
);
```

This lock is released automatically when the transaction commits or rolls back.

**Step 4: Write and apply migration**

```sql
-- supabase/migrations/20260508000002_fix_atomic_capacity_check.sql
-- Add advisory lock to booking creation RPC to prevent concurrent oversell

CREATE OR REPLACE FUNCTION create_table_booking_v05_core(...)
-- (full RPC body with advisory lock added at start)
```

```bash
npx supabase db push
```

**Step 5: Commit**

```bash
git add supabase/migrations/20260508000002_fix_atomic_capacity_check.sql
git commit -m "fix: add advisory lock to booking creation RPC to prevent concurrent slot oversell"
```

---

## Task 12: Remove card capture DB infrastructure

**Pre-condition:** Tasks 2, 3, 4, 5 must be complete and deployed. Verify no application code references card_captures before running this.

**Files:**
- Create: `supabase/migrations/20260508000003_remove_card_capture_infrastructure.sql`

**Step 1: Confirm no remaining application code references**

```bash
grep -r "card_capture\|card_captures\|CardCapture" src/ --include="*.ts" --include="*.tsx"
```

Expected: zero results. If any remain, fix them first.

**Step 2: Write the migration**

```sql
-- supabase/migrations/20260508000003_remove_card_capture_infrastructure.sql
-- Remove legacy card capture tables now that all application code is removed

BEGIN;

-- Update booking_holds constraint to remove card_capture_hold type
ALTER TABLE booking_holds DROP CONSTRAINT IF EXISTS booking_holds_hold_type_check;
ALTER TABLE booking_holds ADD CONSTRAINT booking_holds_hold_type_check
  CHECK (hold_type IN ('payment_hold', 'waitlist_hold'));

-- Drop card_captures table
DROP TABLE IF EXISTS public.card_captures CASCADE;

-- Remove card capture columns from table_bookings if they exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'table_bookings' AND column_name = 'card_capture_id'
  ) THEN
    ALTER TABLE table_bookings DROP COLUMN card_capture_id;
  END IF;
END $$;

COMMIT;
```

**Step 3: Apply**

```bash
npx supabase db push
```

**Step 4: Verify**

```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'card_captures';
-- Expected: 0 rows
```

**Step 5: Commit**

```bash
git add supabase/migrations/20260508000003_remove_card_capture_infrastructure.sql
git commit -m "fix: remove legacy card_captures table and card_capture_hold type — card capture system fully retired"
```

---

## Task 13: Final verification sweep

**Step 1: Lint**

```bash
npm run lint
```

Expected: zero warnings, zero errors.

**Step 2: Build**

```bash
npm run build
```

Expected: clean build.

**Step 3: Search for any remaining legacy references**

```bash
grep -r "pending_card_capture\|card_capture\|cardCapture\|CardCapture\|setup_intent\|SetupIntent" \
  src/ --include="*.ts" --include="*.tsx"
```

Expected: zero results. Migration files may still contain these for historical record — that is acceptable.

**Step 4: Production DB verification**

```sql
-- No pending_payment past bookings
SELECT COUNT(*) FROM table_bookings WHERE status = 'pending_payment' AND booking_date < CURRENT_DATE;
-- Expected: 0

-- No stale payment_status on non-deposit bookings
SELECT COUNT(*) FROM table_bookings
WHERE status = 'confirmed' AND payment_status = 'pending' AND party_size < 7
AND EXTRACT(DOW FROM booking_date) != 0;
-- Expected: 0

-- card_captures table is gone
SELECT table_name FROM information_schema.tables WHERE table_name = 'card_captures';
-- Expected: 0 rows

-- Future confirmed group bookings with pending deposit ARE visible/trackable
SELECT id, booking_date, party_size, payment_status FROM table_bookings
WHERE status = 'confirmed' AND payment_status = 'pending' AND party_size >= 7
AND booking_date >= CURRENT_DATE
ORDER BY booking_date;
-- These should be visible in the BOH UI
```

---

## Execution Order

| Task | Dependency | Risk |
|---|---|---|
| 1 — Data cleanup migration | None | Low — DB only, reversible |
| 2 — Remove TypeScript types | None | Low |
| 3 — BOH UI fix | None | Low |
| 4 — Webhook cleanup | Task 2 | Low |
| 5 — Card capture guest page | Task 2 | Low |
| 6 — Refund logic | None | Medium — Stripe calls |
| 7 — Auto-cancel cron | Task 6 (uses SMS function) | Low |
| 8 — Manager booking fix | None | Medium — requires investigation |
| 9 — Party size amendment | None | Medium — requires investigation |
| 10 — SMS error logging | None | Low |
| 11 — Atomic capacity fix | None | Medium — RPC rewrite |
| 12 — Remove card capture DB | Tasks 2, 4, 5 complete | Low |
| 13 — Final verification | All | N/A |

Tasks 1–5, 6, 7, 8, 9, 10 have no dependencies between them and can be worked on in parallel by separate agents.
