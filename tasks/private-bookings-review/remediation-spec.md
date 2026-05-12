# Private Bookings — Remediation Specification

**Date:** 2026-05-11
**Source:** [defect-report.md](defect-report.md) (24 defects across 4 priority levels)
**Scope:** All code changes needed to resolve every defect. No database schema changes unless explicitly noted.

---

## Implementation Groups

Defects are grouped by logical area to minimise file touches. Within each group, fixes are ordered by dependency. Groups themselves are ordered so that foundational fixes (data model, status guards) land before downstream consumers (SMS, contract, revalidation).

| Group | Theme | Defects | Key Files |
|-------|-------|---------|-----------|
| A | Status guards & editing constraints | D4, D12, D13 | `mutations.ts`, `payments.ts`, `edit/page.tsx` |
| B | Date-TBD lifecycle | D1 | `mutations.ts`, `new/page.tsx`, `types.ts`, expire-holds cron |
| C | Deposit amount enforcement | D3 | `payments.ts`, `PrivateBookingDetailClient.tsx` |
| D | Revalidation & stale data | D2, D8 | `privateBookingActions.ts`, `payments.ts`, `scheduled-sms.ts` |
| E | Contract template | D5 | `contract-template.ts` |
| F | SMS & notifications | D6, D10, D11 | `mutations.ts`, cron, `sms.ts`, `messages/page.tsx` |
| G | Permission model | D7 | `permission.ts`, various pages |
| H | Discount bounds | D9 | `mutations.ts`, migration |
| I | Query/display | D14 | `queries.ts`, `CalendarView.tsx` |
| J | Transaction safety | D15, D16, D17 | `mutations.ts`, `payments.ts` |
| K | Structural cleanup | D18, D19, D20 | API routes, migration |
| L | Tech debt | D21, D22, D23, D24 | Various |

---

## Group A — Status Guards & Editing Constraints

### D4: Edit page bypasses status-transition validation

**Problem:** The edit page posts a free-choice status dropdown through `updateBooking()` (mutations.ts:390), which applies the status directly. The validated `updateBookingStatus()` (mutations.ts:891) with `ALLOWED_TRANSITIONS` is never called from the edit flow.

**Root cause:** `updateBooking()` at line 506 spreads `input` (including `status`) straight into the update payload with no transition check.

**Fix:**

1. **`mutations.ts` — `updateBooking()` (line ~505):** Before building `updatePayload`, if `input.status` is present and differs from `currentBooking.status`, validate against `ALLOWED_TRANSITIONS`:

```typescript
// After line 404 (currentBooking fetched)
if (input.status && input.status !== currentBooking.status) {
  const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
    draft:     ['confirmed', 'cancelled'],
    confirmed: ['completed', 'cancelled'],
    completed: [],
    cancelled: ['draft'],
  };
  const currentStatus = currentBooking.status as BookingStatus;
  const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(input.status as BookingStatus)) {
    throw new Error(
      `Cannot transition booking from '${currentStatus}' to '${input.status}'`
    );
  }
}
```

2. **`edit/page.tsx` (lines 301-311):** Filter the status dropdown to only show valid transitions from the current status. Pass `booking.status` to a helper that returns the allowed options:

```typescript
const STATUS_OPTIONS: Record<BookingStatus, { value: string; label: string }[]> = {
  draft:     [
    { value: 'draft', label: 'Draft' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
  confirmed: [
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
  completed: [
    { value: 'completed', label: 'Completed' },
  ],
  cancelled: [
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'draft', label: 'Draft' },
  ],
};
```

Replace the hardcoded 4-option array with `STATUS_OPTIONS[booking.status]`.

3. **Remove the duplicate `ALLOWED_TRANSITIONS`** from `updateBookingStatus()` (line 901). Extract to a shared constant in `types.ts` and import in both functions.

4. **`mutations.ts` — `updateBooking()` (around line 766):** When transitioning to `cancelled` via this path, also set `cancellation_reason` and `cancelled_at` metadata so the record matches what `cancelBooking()` would produce:

```typescript
// In the updatePayload build section, when status changes to cancelled:
if (input.status === 'cancelled' && currentBooking.status !== 'cancelled') {
  updatePayload.cancellation_reason = 'Cancelled via edit form';
  updatePayload.cancelled_at = new Date().toISOString();
}
```

**Note:** `updateBooking()` already handles SMS side effects for status changes (cancellation SMS at line 766, completion SMS at line 800, calendar cleanup at line 830). These do NOT need to be added — they are already there. The only gap is the cancellation metadata fields and pending SMS cleanup (addressed in D10).

**Acceptance criteria:**
- Edit form for a draft booking shows only Draft, Confirmed, Cancelled
- Completed/cancelled bookings redirect from the edit page to the detail page (per D12)
- Server rejects `{ status: 'completed' }` on a draft booking with a clear error message
- `updateBookingStatus()` continues to work identically (uses same constant)
- Cancelling via the edit form sets `cancellation_reason` and `cancelled_at`

---

### D12: Cancelled/completed bookings can be freely edited

**Problem:** No status guard in `edit/page.tsx` or `updateBooking()`. Staff can modify any field on a cancelled or completed booking.

**Fix:**

1. **`mutations.ts` — `updateBooking()` (after line 404):** Add a guard before any mutation logic:

```typescript
const immutableStatuses: BookingStatus[] = ['completed', 'cancelled'];
if (immutableStatuses.includes(currentBooking.status as BookingStatus)) {
  // Only allow status transitions (handled by ALLOWED_TRANSITIONS above)
  // Filter out undefined values and unchanged fields before checking
  const changedNonStatusKeys = Object.keys(input).filter(k =>
    k !== 'status' &&
    input[k] !== undefined &&
    input[k] !== currentBooking[k]
  );
  if (changedNonStatusKeys.length > 0) {
    throw new Error(
      `Cannot edit a ${currentBooking.status} booking. Only status changes are allowed.`
    );
  }
}
```

2. **`edit/page.tsx`:** At the top of the server component, after fetching the booking, redirect or show a read-only notice if status is `completed` or `cancelled`:

```typescript
if (booking.status === 'completed' || booking.status === 'cancelled') {
  redirect(`/private-bookings/${id}`);
}
```

**Acceptance criteria:**
- Navigating to `/private-bookings/{id}/edit` for a cancelled booking redirects to the detail page
- Server action rejects field edits on completed bookings with a clear error
- Status transitions on cancelled bookings (cancelled → draft) still work via the detail page's status action

---

### D13: Deposit can be recorded on completed bookings

**Problem:** `finalizeDepositPaymentWithClient()` (payments.ts:324) only blocks `cancelled`, not `completed`.

**Fix:** Change the status guard at line 324:

```typescript
if (booking.status === 'cancelled' || booking.status === 'completed') {
  throw new Error('Cannot record a deposit on a cancelled or completed booking');
}
```

**Acceptance criteria:**
- Manual deposit recording on a completed booking returns an error
- PayPal deposit capture on a completed booking returns an error
- Deposit on draft/confirmed bookings continues to work

---

## Group B — Date-TBD Lifecycle

### D1: Date-TBD bookings are not truly TBD

**Problem:** When `date_tbd=true`, the form omits the date field. `createBooking()` falls back to `toLocalIsoDate(new Date())` (line 217). Hold expiry is then calculated from this fake "today" date, SMS references it, and the expire-holds cron can cancel the booking immediately since the hold is already "past".

**Root cause:** The fallback `input.event_date || toLocalIsoDate(new Date())` at line 217 runs unconditionally, even for TBD bookings.

**Important context:** `date_tbd` is **not a persisted DB column**. The existing convention (see `src/lib/private-bookings/tbd-detection.ts`) uses `internal_notes.includes(DATE_TBD_NOTE)` via the `isBookingDateTbd()` helper. All TBD detection must use this helper, not a column check.

Additionally, a DB trigger `calculate_balance_due_date` (squashed.sql:4342) fires on INSERT and UPDATE OF `event_date`. It sets `balance_due_date = event_date - 7 days` when `balance_due_date IS NULL`. This means setting `balance_due_date = null` in application code will be overwritten by the trigger. The fix must account for this.

**Fix:**

1. **`mutations.ts` — `createBooking()` (lines 217-268):** When `input.date_tbd` is true:
   - Still store a date (required by DB constraints and downstream code) but set `hold_expiry` to `null` so the cron ignores it
   - Set `balance_due_date` to a far-future sentinel value (e.g. `'9999-12-31'`) rather than null, because the DB trigger will overwrite null with `event_date - 7 days`

```typescript
const finalEventDate = input.event_date || toLocalIsoDate(new Date());
const finalStartTime = input.start_time || DEFAULT_TBD_TIME;

let balanceDueDate = input.balance_due_date;
let holdExpiryIso: string | null = null;

if (input.date_tbd) {
  // TBD: no hold expiry (cron will skip)
  // Set balance_due_date to a sentinel — null would be overwritten by the
  // calculate_balance_due_date trigger (fires on INSERT/UPDATE of event_date)
  holdExpiryIso = null;
  balanceDueDate = '9999-12-31';
} else {
  if (!balanceDueDate && finalEventDate) {
    const d = new Date(finalEventDate);
    d.setDate(d.getDate() - 7);
    balanceDueDate = toLocalIsoDate(d);
  }
  // ... existing hold expiry calculation (lines 237-268) ...
}
```

**Alternative (preferred if scope allows):** Add a real `date_tbd boolean DEFAULT false` column to `private_bookings`, then modify the trigger to skip calculation when `date_tbd = true`:

```sql
ALTER TABLE private_bookings ADD COLUMN date_tbd boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION calculate_balance_due_date() RETURNS trigger AS $$
BEGIN
  IF NEW.date_tbd = true THEN
    NEW.balance_due_date := NULL;
    RETURN NEW;
  END IF;
  IF NEW.event_date IS NOT NULL AND NEW.balance_due_date IS NULL THEN
    NEW.balance_due_date := NEW.event_date - INTERVAL '7 days';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

This is the cleaner long-term fix. It also allows retiring the `internal_notes` convention and using `isBookingDateTbd()` as a bridge that checks both the column and the notes.

2. **`mutations.ts` — `sendCreationSms()` (line 54):** Use the existing `isBookingDateTbd()` helper (from `tbd-detection.ts`) rather than a field check:

```typescript
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection';

const isTbd = isBookingDateTbd(booking);
const eventDateReadable = isTbd
  ? 'Date to be confirmed'
  : new Date(booking.event_date).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
```

3. **`messages.ts` — `privateBookingCreatedMessage()`:** Handle the TBD case in the message template. When `eventDate` is "Date to be confirmed", omit the hold expiry language about the date.

4. **Expire-holds cron (route.ts):** Already safe — it filters on `hold_expiry IS NOT NULL` and `hold_expiry < now`. Since we now set `hold_expiry = null` for TBD bookings, the cron will skip them. No change needed.

5. **`mutations.ts` — `updateBooking()` (lines 428-436):** Two transitions to handle:
   - **TBD → real date:** When `isBookingDateTbd(currentBooking)` is true and `input.date_tbd === false`, calculate `hold_expiry` and let the trigger recalculate `balance_due_date` (by setting it to `null` so the trigger fills it).
   - **Real date → TBD:** When `input.date_tbd === true` and the booking was not previously TBD, set `hold_expiry = null` and `balance_due_date` to the sentinel (or null if the column approach is used).

```typescript
if (input.date_tbd === false && isBookingDateTbd(currentBooking)) {
  // TBD → real date: compute hold expiry, let trigger handle balance_due_date
  const currentDateTime = new Date();
  const newEventDate = new Date(finalEventDate);
  holdExpiryIso = computeHoldExpiry(newEventDate, currentDateTime).toISOString();
  updatePayload.balance_due_date = null; // trigger will recalculate
}

if (input.date_tbd === true && !isBookingDateTbd(currentBooking)) {
  // Real date → TBD: clear hold expiry, set sentinel balance_due_date
  holdExpiryIso = null;
  updatePayload.balance_due_date = '9999-12-31'; // sentinel (or null with column approach)
}
```

6. **event_date consumer audit:** The following consumers of `event_date` must handle TBD bookings using `isBookingDateTbd()`:

| Consumer | File | TBD handling needed? |
|----------|------|---------------------|
| Creation SMS | `mutations.ts:sendCreationSms()` | Yes — fixed above |
| Cancellation SMS | `mutations.ts:766` | Yes — check `isBookingDateTbd` before formatting |
| Completion SMS | `mutations.ts:800` | No — TBD bookings shouldn't reach completed |
| Contract template | `contract-template.ts` | Yes — show "Date TBD" in event date field |
| Deposit email | `payments.ts:168` | Yes — pass TBD-aware date string |
| Balance paid email | `payments.ts:635` | Yes — pass TBD-aware date string |
| Booking portal | `booking-portal/[token]/page.tsx:139,169` | Yes — show "TBD" and skip balance calc |
| Scheduled SMS preview | `scheduled-sms.ts` | Already safe — returns `[]` for cancelled/TBD |
| Calendar sync | `mutations.ts:826-849` | Already safe — removes calendar for TBD |
| Detail page display | `PrivateBookingDetailClient.tsx` | Yes — show "TBD" badge instead of date |
| List page display | `PrivateBookingsClient.tsx` | Yes — show "TBD" instead of date |
| Balance reminder cron | `private-booking-monitor` | Already safe — skips TBD via `isBookingDateTbd()` |

**Acceptance criteria:**
- Creating a TBD booking stores `hold_expiry = null` and `balance_due_date` is not `event_date - 7`
- TBD booking creation SMS says "Date to be confirmed" not today's date
- Expire-holds cron does not cancel TBD bookings
- Editing a TBD booking to set a real date calculates hold_expiry and recalculates balance_due_date
- Editing a real-date booking back to TBD clears hold_expiry and prevents balance reminders
- Contract for a TBD booking shows "Date to be confirmed" in the event date field
- Payment emails for TBD bookings do not show today's date as the event date
- Booking portal for a TBD booking shows "Date to be confirmed"

---

## Group C — Deposit Amount Enforcement

### D3: Manual deposit recording accepts any amount + payment history shows wrong amount

**Problem:** Two issues:
1. The deposit modal in `PrivateBookingDetailClient.tsx` accepts any positive number. `finalizeDepositPaymentWithClient()` (payments.ts:332-341) only enforces amount matching when `requireAmountMatch=true`, which is only set for the PayPal path.
2. `getBookingPaymentHistory()` (payments.ts:702-706) shows `booking.deposit_amount` (the configured/required amount) in the payment history, not the actual amount paid. If a deposit of £300 is recorded against a £250 requirement, the history still shows £250.

**Root cause:** The system stores the configured deposit amount on the booking record but never records the actual amount paid as a deposit. Payment history reads from the booking config, not from a payment transaction.

**Fix:**

1. **`payments.ts` — `finalizeDepositPaymentWithClient()` (line 332):** Enforce exact amount match for all paths. The deposit is a security bond with a specific required amount — overpayment creates a discrepancy between what was paid and what the system records:

```typescript
// Enforce exact amount for all paths (manual and PayPal)
if (Math.abs(amount - requiredDepositAmount) > 0.01) {
  throw new Error(
    `Deposit amount must be exactly £${requiredDepositAmount.toFixed(2)}, received £${amount.toFixed(2)}`
  );
}
```

Remove the `requireAmountMatch` flag entirely — all paths now enforce exact match.

2. **`PrivateBookingDetailClient.tsx` — deposit modal:** Pre-fill the amount field with the booking's `deposit_amount` and make it read-only or hidden (since exact match is required, there's no reason to let the user type a different amount). Show the required amount as a label.

3. **`payments.ts` — `getBookingPaymentHistory()` (line 702-706):** The payment history already works correctly IF the deposit is exact-match. With fix #1 above, `booking.deposit_amount` will always equal the amount actually paid. No change needed here after fix #1 lands.

**Alternative (if overpayment must be allowed):** Add an `actual_deposit_paid numeric(10,2)` column to `private_bookings`, populated by `finalizeDepositPaymentWithClient()` when the deposit is recorded. Then `getBookingPaymentHistory()` reads `actual_deposit_paid` instead of `deposit_amount`. This is more complex and only needed if the business allows paying a different amount than the configured deposit.

**Acceptance criteria:**
- Manual deposit of £1 on a £250 requirement is rejected with a clear error
- Manual deposit of £250 on a £250 requirement succeeds
- Manual deposit of £300 on a £250 requirement is rejected (exact match required)
- PayPal deposit with exact amount match still works
- PayPal deposit with amount mismatch still fails (existing behaviour)
- Payment history shows the correct deposit amount actually paid
- Deposit modal shows the required amount and does not allow free-form entry

---

## Group D — Revalidation & Stale Data

### D2: List page totals/status go stale after item and payment changes

**Problem:** Several mutations only revalidate the detail page, not the list page. Confirmed by grep:
- Line 443: `recordDepositPayment` — only `revalidatePath(/private-bookings/{id})` + dashboard
- Lines 953, 1017: payment mutations — only detail + dashboard
- Lines 1483, 1510, 1529, 1548: item mutations — only detail + items + dashboard
- Line 2099: `editPayment` — only detail + dashboard (missing list)
- Line 2151: `deletePayment` — only detail + dashboard (missing list)

The list page at `/private-bookings` displays `calculated_total`, `balance_remaining`, and `payment_status` from the view, which becomes stale.

**Fix:** Add `revalidatePath('/private-bookings')` to every mutation that changes financial data:

1. **`privateBookingActions.ts`:**
   - After line 443 (deposit recording): add `revalidatePath('/private-bookings')`
   - After line 953 (balance payment): add `revalidatePath('/private-bookings')`
   - After line 1017 (final payment): add `revalidatePath('/private-bookings')`
   - After lines 1483, 1510, 1529, 1548 (item CRUD): add `revalidatePath('/private-bookings')`
   - After line 1142 (apply discount): add `revalidatePath('/private-bookings')`
   - After line 2099 (edit payment): add `revalidatePath('/private-bookings')`
   - After line 2151 (delete payment): add `revalidatePath('/private-bookings')`

2. **`PrivateBookingsClient.tsx` (line 41):** Remove the client-side cache entirely. The 30-second TTL serves no purpose — it only delays stale data from being replaced by fresh data after server-side revalidation. The `revalidatePath` calls above already handle freshness; the client cache just fights them:

```typescript
// Remove CACHE_TTL_MS and associated caching logic entirely.
// Rely on Next.js server-side revalidation instead.
```

**Acceptance criteria:**
- Adding an item to a booking, then navigating to the list, shows the updated total
- Recording a payment, then navigating to the list, shows the updated balance and payment status
- Editing or deleting a payment, then navigating to the list, shows the updated balance
- No unnecessary full-page reloads — only the affected paths are revalidated
- No client-side cache delay — list always shows server-fresh data

---

### D8: Customer-facing totals use stale `total_amount` instead of `calculated_total`

**Problem:** Emails and scheduled SMS read `booking.total_amount` (a legacy static column) instead of deriving the total from items.

**Affected locations:**
- `payments.ts:177` — deposit received email passes `total_amount`
- `payments.ts:637` — balance paid email passes `total_amount`
- `scheduled-sms.ts:68-70` — selects from `private_bookings` table (not the view), where `calculated_total` doesn't exist
- `booking-portal/[token]/page.tsx:136,169` — selects `total_amount` from `private_bookings` table and uses it to compute `balanceRemaining = total_amount - balancePaymentsTotal`

**Fix:**

1. **`payments.ts` — deposit flow (around line 167-177):** The booking is fetched from `private_bookings` table at line 318. After fetching, also fetch the calculated total from the view:

```typescript
// After fetching booking at line 316-320
const { data: viewData } = await db
  .from('private_bookings_with_details')
  .select('calculated_total')
  .eq('id', bookingId)
  .single();

const displayTotal = viewData?.calculated_total ?? booking.total_amount;
```

Then use `displayTotal` in the email at line 177 instead of `booking.total_amount`.

2. **`payments.ts` — balance paid email (line 637):** Same pattern. The booking is already fetched; supplement with the view's `calculated_total`:

```typescript
total_amount: displayTotal,  // was booking.total_amount
```

3. **`scheduled-sms.ts` (line 68-70):** Change the query from `private_bookings` to `private_bookings_with_details`:

```typescript
const { data: booking, error: bookingError } = await db
  .from('private_bookings_with_details')  // was 'private_bookings'
  .select('*')
  .eq('id', bookingId)
  .single()
```

4. **`booking-portal/[token]/page.tsx` (lines 136-139, 169):** The portal fetches from `private_bookings` and uses `total_amount` for the balance calculation. Change to fetch from the view or supplement with `calculated_total`:

```typescript
// Line 136-139: change query to use view
const { data: b } = await supabase
  .from('private_bookings_with_details')  // was 'private_bookings'
  .select('*, calculated_total')
  .eq('booking_token', token)
  .single();

// Line 169: use calculated_total for balance
const balanceRemaining = (b.calculated_total ?? b.total_amount) - balancePaymentsTotal;
```

**Acceptance criteria:**
- Deposit received email shows the item-derived total, not the legacy `total_amount`
- Balance paid email shows the item-derived total
- Scheduled SMS preview shows correct amounts from the view
- Booking portal shows the correct total and balance remaining derived from items
- Customer-facing balance calculation in the portal matches the admin view

---

## Group E — Contract Template

### D5: Contract contains legally incorrect deposit terms

**Problem:** Four issues in `contract-template.ts`:
1. Line 712: "deposit must be paid in cash" — PayPal deposits are operational
2. Line 736: "pay a refundable security deposit of [amount] in cash" — cash-only language
3. Line 763: "All event bookings require a £250 cash deposit" — hardcoded amount and cash-only
4. Line 770: "deposit becomes non-refundable" — contradicts the refundable cancellation SMS variant

**Fix:** Replace the four sections. The deposit is a refundable security bond, payable by any accepted method. The amount is dynamic (from the booking record). Cancellation policy should match what the business actually does.

1. **Line 712 (deposit information paragraph):** Replace "The deposit must be paid in cash" with language that accepts any payment method:

```
"To secure your booking, a deposit is required. This deposit serves as both a date reservation fee and a security bond to cover any significant damages during your event. The deposit can be paid by cash, card, or PayPal."
```

Remove "in cash" — it appears twice in this paragraph.

2. **Line 736 (agreement section):** Replace "in cash" with dynamic method:

```
"To secure this booking, I will pay a refundable security deposit of <strong>${formatCurrency(depositAmount)}</strong>."
```

Remove the "in cash" qualifier entirely.

3. **Line 763 (T&C — Reservation and Deposit):** Replace the hardcoded line:

```
"All event bookings require a deposit (as specified in the booking details above) to secure the desired date and time."
```

Remove "£250" and "cash".

4. **Line 770 (T&C — Cancellation Policy):** Replace with language that matches the actual cancellation outcomes:

```
"If an event is cancelled, the refundability of the deposit will be assessed on a case-by-case basis depending on the notice period given and any costs already incurred."
```

This is deliberately flexible because the code already has four cancellation variants (hold, refundable, non-refundable, manual review), and the contract shouldn't promise something that contradicts any of them.

**Acceptance criteria:**
- No instance of "in cash" remains in the contract template
- No hardcoded "£250" in the contract (amount comes from `depositAmount` variable)
- Cancellation policy doesn't make absolute promises that contradict the refundable SMS variant
- Contract still renders correctly in PDF generation

---

## Group F — SMS & Notifications

### D10: Cancellation doesn't cancel pending scheduled SMS

**Problem:** `cancelBooking()` (mutations.ts:998-1117) updates status, cleans up calendar, and sends a cancellation SMS — but never cancels existing pending/approved SMS queue entries. Previously scheduled reminders will still fire.

**Fix:** After the status update (line 1027) and before sending the cancellation SMS (line 1078), cancel all pending/approved SMS for this booking:

```typescript
// Cancel pending/approved SMS — they're now stale
try {
  const admin = createAdminClient();
  await admin
    .from('private_booking_sms_queue')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('booking_id', id)
    .in('status', ['pending', 'approved']);
} catch (smsCleanupError) {
  logger.error('Failed to cancel pending SMS during booking cancellation:', {
    error: smsCleanupError instanceof Error ? smsCleanupError : new Error(String(smsCleanupError)),
    metadata: { bookingId: id },
  });
  // Non-blocking: cancellation SMS will still be sent below
}
```

2. **`mutations.ts` — `updateBooking()` (around line 766):** The same pending SMS cancellation must also apply when status transitions to `cancelled` via the edit form / `updateBookingStatus()` path. Add the same cleanup block before the cancellation SMS is sent at line 766:

```typescript
// Before the cancellation SMS at line 766
if (updatedBooking.status === 'cancelled' && currentBooking.status !== 'cancelled') {
  try {
    const admin = createAdminClient();
    await admin
      .from('private_booking_sms_queue')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('booking_id', id)
      .in('status', ['pending', 'approved']);
  } catch (smsCleanupError) {
    logger.error('Failed to cancel pending SMS during status change:', {
      error: smsCleanupError instanceof Error ? smsCleanupError : new Error(String(smsCleanupError)),
      metadata: { bookingId: id },
    });
  }
}
```

**Acceptance criteria:**
- Cancelling a booking via `cancelBooking()` with pending balance reminders marks those SMS as cancelled
- Cancelling a booking via the edit form / status change also cancels pending SMS
- The new cancellation SMS is still sent after cleanup in both paths
- If SMS cleanup fails, the cancellation still proceeds (non-blocking)

---

### D11: Hold expiry cron cancels bookings without customer notification or calendar cleanup

**Problem:** The expire-holds cron (route.ts) does a direct DB update to `status='cancelled'` without:
1. Sending any SMS or email — the customer's booking silently vanishes
2. Cleaning up calendar events — orphaned events remain in the calendar
3. Confirming which rows were actually updated — the current code updates in bulk then separately queries for IDs, creating a race window

**Fix:** Rewrite the expiry logic to use `.update().select()` for atomicity, then send notifications and clean up only for confirmed-updated rows:

```typescript
// Replace the current bulk update (line 44-51) with:
const { data: expiredBookings, error: updateError } = await supabase
  .from('private_bookings')
  .update({
    status: 'cancelled',
    cancellation_reason: 'Deposit hold expired',
    cancelled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  .lte('hold_expiry', now)
  .eq('status', 'draft')
  .gt('deposit_amount', 0)
  .select('id, customer_first_name, customer_name, contact_phone, customer_id, event_date, calendar_event_id');

if (updateError) {
  throw new Error(`Failed to expire holds: ${updateError.message}`);
}

if (!expiredBookings || expiredBookings.length === 0) {
  return NextResponse.json({ expired: 0 });
}

const expiredIds = expiredBookings.map(b => b.id);

// Cancel pending/approved SMS for expired bookings (D10 pattern)
await supabase
  .from('private_booking_sms_queue')
  .update({ status: 'cancelled', updated_at: new Date().toISOString() })
  .in('booking_id', expiredIds)
  .in('status', ['pending', 'approved']);

// Send expiry notifications and clean up calendar for each confirmed-expired booking
for (const booking of expiredBookings) {
  // Calendar cleanup
  if (booking.calendar_event_id && isCalendarConfigured()) {
    try {
      await deleteCalendarEvent(booking.calendar_event_id);
    } catch (calError) {
      logger.error('private-bookings-expire-holds: calendar cleanup failed', {
        error: calError instanceof Error ? calError : new Error(String(calError)),
        metadata: { bookingId: booking.id, calendarEventId: booking.calendar_event_id },
      });
    }
  }

  // SMS notification
  try {
    if (booking.contact_phone || booking.customer_id) {
      const eventDate = isBookingDateTbd(booking)
        ? 'Date to be confirmed'
        : new Date(booking.event_date).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'long', year: 'numeric'
          });
      const firstName = booking.customer_first_name || 'there';

      await SmsQueueService.queueAndSend({
        booking_id: booking.id,
        trigger_type: 'booking_expired',
        template_key: 'private_booking_expired',
        message_body: bookingExpiredMessage({
          customerFirstName: firstName,
          eventDate: eventDate,
        }),
        customer_phone: booking.contact_phone,
        customer_name: booking.customer_name,
        customer_id: booking.customer_id,
        priority: 3,
        metadata: { template: 'private_booking_expired' },
      });
    }
  } catch (smsError) {
    logger.error('private-bookings-expire-holds: failed to send expiry SMS', {
      error: smsError instanceof Error ? smsError : new Error(String(smsError)),
      metadata: { bookingId: booking.id },
    });
    // Continue to next booking — don't block the batch
  }
}
```

**Key changes from original cron:**
- Uses `.update().select()` to atomically get the rows that were actually updated — no separate query, no race window
- Adds `cancellation_reason` and `cancelled_at` metadata (matching `cancelBooking()` convention)
- Only sends SMS to rows confirmed as updated by the `.select()` return
- Cleans up calendar events for expired bookings
- Handles TBD bookings in the date formatting

**Acceptance criteria:**
- Customer receives an SMS when their hold expires
- Calendar events are cleaned up for expired bookings
- Previously scheduled SMS (reminders, etc.) are cancelled
- Only bookings confirmed as updated by the DB receive notifications (no double-send on race)
- Expired bookings have `cancellation_reason` and `cancelled_at` set
- If one SMS or calendar cleanup fails, other bookings still get processed
- Cron still completes within Vercel's timeout

---

### D6: Manual private-booking SMS uses wrong permission and wrong queue

**Problem:** Two issues:
1. The messages page (messages/page.tsx:31) checks `private_bookings` permissions (`send` or `manage`), but the shared SMS send action (sms.ts:248) requires `messages:send` — a different module entirely.
2. The shared SMS send action writes to the general SMS queue, not the private-booking-specific `private_booking_sms_queue`. This means manually sent SMS for private bookings don't appear in the booking's SMS history (which reads from `private_booking_sms_queue` at queries.ts:515-519) and lack booking-specific metadata (booking_id association).

**Root cause:** The private-bookings messages page reuses the shared messages infrastructure, which was designed for general SMS, not booking-specific SMS.

**Fix:** Create a dedicated private-booking SMS send action that uses `SmsQueueService` (which writes to `private_booking_sms_queue`) instead of routing through the shared SMS action:

1. **`privateBookingActions.ts` — new `sendPrivateBookingSms()` action:**

```typescript
export async function sendPrivateBookingSms(
  bookingId: string,
  messageBody: string
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };

  const actions = await getUserPermissionActions('private_bookings', user.id);
  if (!actions.has('send') && !actions.has('manage')) {
    return { error: 'Permission denied' };
  }

  // Fetch booking contact details
  const { data: booking } = await supabase
    .from('private_bookings')
    .select('id, customer_first_name, customer_name, contact_phone, customer_id')
    .eq('id', bookingId)
    .single();

  if (!booking) return { error: 'Booking not found' };
  if (!booking.contact_phone && !booking.customer_id) {
    return { error: 'No contact phone number for this booking' };
  }

  await SmsQueueService.queueAndSend({
    booking_id: booking.id,
    trigger_type: 'manual',
    template_key: 'private_booking_manual',
    message_body: messageBody,
    customer_phone: booking.contact_phone,
    customer_name: booking.customer_name,
    customer_id: booking.customer_id,
    priority: 2,
    metadata: {
      template: 'private_booking_manual',
      sent_by: user.id,
    },
  });

  revalidatePath(`/private-bookings/${bookingId}`);
  return { success: true };
}
```

2. **`messages/page.tsx`:** Update the SMS send handler to call `sendPrivateBookingSms()` instead of the shared SMS action. The permission check moves into the server action (above), so the page only needs to check view access.

3. **Remove dependency on `messages:send` permission** for private-booking SMS. The `private_bookings:send` (or `private_bookings:manage`) permission is the correct gate.

**Acceptance criteria:**
- A user with `private_bookings:send` permission can send SMS from the booking messages page
- A user with only `private_bookings:view` cannot send SMS
- Manually sent SMS appears in the booking's SMS history (reads from `private_booking_sms_queue`)
- SMS metadata includes the booking_id and sending user
- The shared SMS action is not modified (no cross-domain coupling)

---

## Group G — Permission Model

### D7: Permission model inconsistencies

**Problem:** Pages use `actions.has('view') || actions.has('manage')` for access, but `checkUserPermission` does exact string matching (`p.module_name === moduleName && p.action === action` at permission.ts:109) — there's no inheritance where `manage` implies `view`. Additionally, server actions in `privateBookingActions.ts` also do exact permission checks, so both the UI layer and the server layer are inconsistent.

View-only users can also see item add/edit/delete UI in the detail page.

**Fix:** This is a structural issue that affects the entire permission system, not just private bookings. The safest fix within scope:

1. **Create a helper in the private-bookings section** that centralises the "manage implies view" check:

```typescript
function hasPermission(actions: Set<string>, required: string): boolean {
  return actions.has(required) || actions.has('manage');
}
```

2. **Use it consistently across all private-booking pages:**
   - Detail page: `hasPermission(actions, 'view')`
   - Edit page: `hasPermission(actions, 'edit')`
   - Items UI: gate add/edit/delete buttons behind `hasPermission(actions, 'edit')`

3. **Use it consistently in server actions (`privateBookingActions.ts`):** Every action that calls `checkUserPermission` or `getUserPermissionActions` must also apply the same inheritance logic. For example, item mutation actions that check for `edit` permission must also accept `manage`.

4. **Gate item mutation UI** in `PrivateBookingDetailClient.tsx`: check permissions before rendering add/edit/delete buttons on items. Currently these buttons render for all users with view access.

**Acceptance criteria:**
- A user with `manage` permission can access all pages AND execute all server actions
- A user with `view` permission can see the detail page but not edit/delete buttons
- A user with `edit` permission can edit items but not manage deposits
- The pattern is consistent across all private-booking pages AND server actions
- Server actions reject requests from users without the required permission (including inheritance)

**Note:** A system-wide fix to `checkUserPermission` adding inheritance (manage→edit→view) is recommended as a separate project. This fix is scoped to private bookings only — both the page-level and server-action-level permission checks.

---

## Group H — Discount Bounds

### D9: Item discounts can create negative line totals

**Problem:** The DB generated column for `line_total` (squashed migration line 2876) subtracts discounts without clamping to zero. Neither `addBookingItem()` nor `updateBookingItem()` validates discount bounds.

**Additional complication for partial updates:** `updateBookingItem()` (line 1566) accepts partial payloads — the incoming data may only contain `discount_value` without `quantity` or `unit_price`. The current fetch at line 1575 only selects `booking_id`, which is insufficient to validate whether the discount exceeds the line value. The full current item must be fetched first, then the incoming partial data merged with existing values before validation.

**Fix:**

1. **`mutations.ts` — `addBookingItem()` (line 1502):** Add server-side validation before the insert. For new items, all fields are present in the input:

```typescript
// Validate discount bounds
if (data.discount_value !== undefined && data.discount_value !== null) {
  if (data.discount_value < 0) {
    throw new Error('Discount value cannot be negative');
  }
  if (data.discount_type === 'percent' && data.discount_value > 100) {
    throw new Error('Percentage discount cannot exceed 100%');
  }
  if (data.discount_type === 'fixed') {
    const lineValue = (data.quantity ?? 1) * (data.unit_price ?? 0);
    if (data.discount_value > lineValue) {
      throw new Error('Fixed discount cannot exceed the line value');
    }
  }
}
```

2. **`mutations.ts` — `updateBookingItem()` (line 1566):** Fetch the full current item first, then merge with the incoming partial data before validating:

```typescript
// Change the fetch at line 1575 to select all fields needed for validation
const { data: currentItem, error: fetchError } = await db
  .from('private_booking_items')
  .select('booking_id, quantity, unit_price, discount_type, discount_value')
  .eq('id', itemId)
  .single();

if (!currentItem) {
  throw new Error('Item not found');
}

// Merge incoming partial data with current values for validation
const effectiveQuantity = data.quantity ?? currentItem.quantity;
const effectiveUnitPrice = data.unit_price ?? currentItem.unit_price;
const effectiveDiscountType = data.discount_type ?? currentItem.discount_type;
const effectiveDiscountValue = data.discount_value ?? currentItem.discount_value;

// Validate discount bounds against effective (merged) values
if (effectiveDiscountValue !== undefined && effectiveDiscountValue !== null) {
  if (effectiveDiscountValue < 0) {
    throw new Error('Discount value cannot be negative');
  }
  if (effectiveDiscountType === 'percent' && effectiveDiscountValue > 100) {
    throw new Error('Percentage discount cannot exceed 100%');
  }
  if (effectiveDiscountType === 'fixed') {
    const lineValue = effectiveQuantity * effectiveUnitPrice;
    if (effectiveDiscountValue > lineValue) {
      throw new Error('Fixed discount cannot exceed the line value');
    }
  }
}
```

3. **Migration:** Add a `GREATEST(0, ...)` clamp to the generated column. This is a safety net — the application validation above is the primary guard:

```sql
ALTER TABLE private_booking_items
  DROP COLUMN line_total;

ALTER TABLE private_booking_items
  ADD COLUMN line_total numeric(10,2) GENERATED ALWAYS AS (
    GREATEST(0,
      CASE
        WHEN discount_type = 'percent' THEN
          (quantity * unit_price) * (1 - COALESCE(discount_value, 0) / 100)
        WHEN discount_type = 'fixed' THEN
          (quantity * unit_price) - COALESCE(discount_value, 0)
        ELSE
          quantity * unit_price
      END
    )
  ) STORED;
```

**Note:** Dropping and re-adding a generated column requires checking if any views reference `line_total`. The `private_bookings_with_details` view aggregates `line_total` — it must be dropped and recreated in the same migration.

**Acceptance criteria:**
- Adding an item with a 150% discount is rejected
- Adding an item with a fixed discount exceeding the line value is rejected
- Updating only `discount_value` on an existing item validates against the item's current `quantity * unit_price`
- Updating only `quantity` downward validates that the existing discount doesn't now exceed the new line value
- Existing items with valid discounts are unaffected
- The `calculated_total` in the view is always >= 0

---

## Group I — Query/Display

### D14: "Today" appears in both past and upcoming on the list

**Problem:** Upcoming uses `gte('event_date', todayIso)` (line 184) and past uses `lte('event_date', todayIso)` (line 190). Today's bookings appear in both.

**Fix:** Make upcoming inclusive and past exclusive:

```typescript
if (options.dateFilter === 'upcoming') {
  query = query.gte('event_date', todayIso);  // today and future (unchanged)
} else if (options.dateFilter === 'past') {
  query = query.lt('event_date', todayIso);   // was lte, now lt (exclusive)
}
```

Also align `CalendarView.tsx` (line 94) to use the same boundary — it already uses `< today` (exclusive), so it's already correct. No change needed there.

**Acceptance criteria:**
- Today's bookings appear only in "Upcoming", not in "Past"
- Yesterday's bookings appear in "Past"
- Calendar view is consistent with the list

---

## Group J — Transaction Safety

### D16: Delete flow — calendar deleted before DB delete

**Problem:** `deletePrivateBooking()` (mutations.ts:1428-1453) deletes the calendar event first, then attempts the DB delete. If the DB trigger rejects the delete, the calendar event is gone with no rollback.

**Fix:** Reverse the order — attempt the DB delete first, then clean up the calendar:

```typescript
// 1. Attempt DB delete first (may be rejected by trigger)
const { data, error } = await supabase
  .from('private_bookings')
  .delete()
  .eq('id', id)
  .select()
  .maybeSingle();

if (error) {
  throw new Error(error.message || 'Failed to delete private booking');
}

// 2. Calendar cleanup (only if DB delete succeeded)
if (data?.calendar_event_id && isCalendarConfigured()) {
  try {
    await deleteCalendarEvent(data.calendar_event_id);
  } catch (calError) {
    logger.error('Calendar cleanup failed after booking deletion:', {
      error: calError instanceof Error ? calError : new Error(String(calError)),
      metadata: { bookingId: id, calendarEventId: data.calendar_event_id },
    });
    // Non-blocking: booking is already deleted, calendar event is orphaned
    // but this is better than a deleted calendar event with an existing booking
  }
}
```

**Acceptance criteria:**
- If the DB trigger rejects the delete, the calendar event is preserved
- If the DB delete succeeds but calendar delete fails, the booking is still deleted (orphaned calendar event is acceptable)
- Successful delete removes both DB record and calendar event

---

### D17: `recordFinalPayment` has no row-level lock

**Problem:** Unlike `recordBalancePayment` (which uses `FOR UPDATE` via the RPC), `recordFinalPayment` does a direct update. Concurrent calls could double-stamp `final_payment_date`.

**Fix:** Add an idempotency check — if `final_payment_date` is already set, return early:

```typescript
// In recordFinalPayment, after fetching booking
if (booking.final_payment_date) {
  return { success: true, alreadyRecorded: true };
}
```

And use an optimistic lock on the update:

```typescript
const { data: updatedBooking, error } = await supabase
  .from('private_bookings')
  .update({
    final_payment_date: new Date().toISOString(),
    final_payment_method: method,
    updated_at: new Date().toISOString(),
  })
  .eq('id', bookingId)
  .is('final_payment_date', null)  // optimistic lock
  .select()
  .maybeSingle();

if (!updatedBooking) {
  // Another request beat us — treat as already recorded
  return { success: true, alreadyRecorded: true };
}
```

**Acceptance criteria:**
- Two concurrent final payment requests don't both send SMS
- The first request succeeds; the second returns `alreadyRecorded: true`
- No duplicate completion SMS

---

### D15: PayPal capture-to-DB gap

**Problem:** If PayPal capture succeeds but `finalizeDepositPayment()` fails (timeout, DB error), money is captured with no local record.

**Fix:** This is already partially mitigated by the PayPal reconciliation system. Additional mitigation:

1. **Add a `paypal_capture_pending` column or status flag** that's set before the capture attempt and cleared after successful DB finalization. On the next cron run or manual check, any pending captures can be reconciled.

2. **Alternative (simpler):** Log the capture ID to a separate audit table before calling `finalizeDepositPayment()`, so there's always a record of the capture even if the main flow fails:

```typescript
// Before finalizeDepositPayment
await admin.from('private_booking_audit').insert({
  booking_id: bookingId,
  action: 'paypal_capture_attempted',
  metadata: { captureId, amount },
  performed_by: 'system',
});
```

**Note:** Full two-phase commit is out of scope. This adds observability for the failure window.

**Acceptance criteria:**
- Every PayPal capture attempt is logged in the audit trail
- If finalization fails after capture, the audit trail shows the capture ID for manual reconciliation

---

## Group K — Structural Cleanup

### D18: Two overlapping public enquiry endpoints — ALREADY ADDRESSED

**Problem:** Both `/api/public/private-booking/route.ts` and `/api/private-booking-enquiry/route.ts` create draft bookings from external submissions.

**Status:** Already addressed. The older endpoint (`/api/public/private-booking/route.ts`) already has:
- Deprecation headers pointing to `/api/private-booking-enquiry` (lines 60-63)
- Rate limiting via `createRateLimiter` (lines 66-70)
- Turnstile verification

**No changes needed.** The deprecation is in progress. If external forms still reference the old URL, they will continue to work and will see the deprecation headers. A redirect can be added when monitoring confirms no traffic to the old endpoint.

---

### D19: Duplicate hold expiry logic across two crons

**Problem:** Both `private-booking-monitor` (Pass 2) and `private-bookings-expire-holds` cancel expired holds. The monitor cron handles additional logic (reminders, feedback), but the expiry logic overlaps.

**Fix:** Remove the hold expiry logic from `private-booking-monitor` and let the dedicated `private-bookings-expire-holds` cron own that responsibility. Add a comment to both files explaining the division of responsibility.

---

### D20: Missing UPDATE/DELETE RLS on `private_booking_payments`

**Problem:** Only SELECT and INSERT RLS policies exist. Edits and deletes go through the admin client, bypassing RLS entirely.

**Root cause:** There is no `user_permissions` table — the permission system uses the `public.user_has_permission(user_uuid, module_name, action_name)` function (squashed.sql:1629). RLS policies must call this function, not subquery a non-existent table.

**Fix:** Add UPDATE and DELETE policies using the existing `user_has_permission()` function. Also add GRANT statements so the auth role can execute the function:

```sql
-- Ensure the auth role can call the permission function
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid, text, text) TO authenticated;

CREATE POLICY "private_booking_payments_update"
  ON private_booking_payments
  FOR UPDATE
  USING (
    public.user_has_permission(auth.uid(), 'private_bookings', 'manage')
  );

CREATE POLICY "private_booking_payments_delete"
  ON private_booking_payments
  FOR DELETE
  USING (
    public.user_has_permission(auth.uid(), 'private_bookings', 'manage')
  );
```

**Note:** The permission checked is `private_bookings:manage` (not `manage_deposits`, which doesn't exist in the permission system). Verify that existing payment modification code uses the admin client (service role). If any code path uses the auth client for payment edits/deletes, these policies are needed. If all paths use admin, this is a defence-in-depth measure. The GRANT statement is required because RLS policies execute in the context of the authenticated user, who needs permission to call the function.

---

## Group L — Tech Debt (P4)

### D21: Feedback system is 470 lines of dead code

**File:** `src/lib/private-bookings/feedback.ts`

**Fix:** Delete `feedback.ts` and remove all imports referencing it. The function `createPrivateBookingFeedbackToken` returns null (retired).

---

### D22: `PrivateBookingDetailClient.tsx` is 2,979 lines

**Fix:** Extract into sub-components:
- `DepositModal.tsx` — deposit recording form
- `PaymentModal.tsx` — balance payment form
- `StatusTransitionPanel.tsx` — status change UI
- `ItemsManager.tsx` — drag-and-drop items list
- `AuditTrail.tsx` — activity log display

This is a refactoring task with no functional change. Defer to a separate PR.

---

### D23: `privateBookingActions.ts` is 2,217 lines

**Fix:** Split by subdomain:
- `privateBookingCrudActions.ts` — create, read, update, delete
- `privateBookingPaymentActions.ts` — deposits, balance payments, final payments
- `privateBookingItemActions.ts` — item CRUD, reordering
- `privateBookingVendorActions.ts` — vendor CRUD
- `privateBookingSmsActions.ts` — SMS queue management

Defer to a separate PR.

---

### D24: No rate limiting on public booking endpoint — ALREADY ADDRESSED

**Status:** Already addressed. The endpoint (`/api/public/private-booking/route.ts`) already has:
- Rate limiting via `createRateLimiter` (lines 66-70) — using the project's existing rate limiter, not Upstash
- Turnstile verification for bot protection

**No changes needed.** Do not add a second rate limiting layer (Upstash) — the existing `createRateLimiter` is sufficient and avoids adding an unnecessary dependency.

---

## Implementation Order

Dependencies determine the sequence. Each step can be a separate PR.

```
PR 1: Group A (status guards)
  └── D4, D12, D13
  └── Foundational — all other groups assume status guards exist

PR 2: Group B (Date-TBD)
  └── D1
  └── Depends on: PR 1 (status guard in updateBooking)

PR 3: Group C (deposit enforcement)
  └── D3
  └── Independent of PR 1-2

PR 4: Group D (revalidation + stale totals)
  └── D2, D8
  └── Independent — can run in parallel with PR 2-3

PR 5: Group E (contract template)
  └── D5
  └── Independent — no code dependencies

PR 6: Group F (SMS & notifications)
  └── D6, D10, D11
  └── Depends on: PR 1 (status guards needed before cron changes)

PR 7: Group H (discount bounds)
  └── D9
  └── Includes migration — must be tested with db push

PR 8: Group I (query fix)
  └── D14
  └── Independent — one-line change

PR 9: Group J (transaction safety)
  └── D15, D16, D17
  └── Independent

PR 10: Group G (permissions)
  └── D7
  └── Defer until after PR 1-6 land — lowest risk of the non-P4 items

PR 11: Group K (structural)
  └── D19, D20 (D18 already addressed — no changes needed)
  └── Defer — D20 RLS migration needs testing

PR 12: Group L (tech debt)
  └── D21, D22, D23 (D24 already addressed — no changes needed)
  └── Defer — no functional impact
```

**Parallel tracks:** PRs 3, 4, 5, 8 can all run in parallel with each other and with PR 2. PR 6 should wait for PR 1.

---

## Files Modified Per Group

| Group | Files | Type |
|-------|-------|------|
| A | `mutations.ts`, `payments.ts`, `edit/page.tsx`, `types.ts` | Logic |
| B | `mutations.ts`, `new/page.tsx`, `messages.ts`, `types.ts` | Logic |
| C | `payments.ts`, `PrivateBookingDetailClient.tsx` | Logic + UI |
| D | `privateBookingActions.ts`, `payments.ts`, `scheduled-sms.ts`, `PrivateBookingsClient.tsx` | Revalidation |
| E | `contract-template.ts` | Template |
| F | `mutations.ts`, `expire-holds/route.ts`, `messages/page.tsx`, `privateBookingActions.ts` | Logic + cron |
| G | Various pages, possible shared helper | Permission |
| H | `mutations.ts`, new migration | Logic + DB |
| I | `queries.ts` | Query |
| J | `mutations.ts`, `payments.ts` | Transaction safety |
| K | API routes (D18 already addressed), new migration (D20) | Structural |
| L | Various | Cleanup |

---

## Risk Assessment

| PR | Risk | Mitigation |
|----|------|------------|
| 1 (status guards) | Medium — changes core update path | Test all status transitions manually; verify edit form shows correct options per status |
| 2 (Date-TBD) | Medium — changes booking creation | Test TBD creation, TBD→real date conversion, verify cron skips TBD |
| 5 (contract) | Low — text-only changes | Visual review of generated PDF |
| 6 (SMS) | Medium — cron changes | Test in staging; verify no SMS is lost during cancellation |
| 7 (discounts) | High — migration changes generated column | Test with `db push --dry-run`; verify view recreation; check existing data |
| 9 (transaction safety) | Medium — changes delete order | Test delete with SMS gate trigger; verify calendar cleanup |

---

## Appendix: Codex Adversarial Review Amendments

This spec was reviewed by 5 Codex reviewers (Assumption Breaker, Integration & Architecture, Workflow & Failure-Path, Security & Data Risk, Spec Trace Auditor) on 2026-05-11. The following amendments were applied based on their findings:

| Finding | Amendment | Section |
|---------|-----------|---------|
| CR-1 (WF-001, SEC-002) | Verified that `updateBooking()` already handles SMS side effects for cancellation/completion. Added `cancellation_reason` and `cancelled_at` metadata setting for edit-form cancellations. | D4 |
| CR-2 (WF-002, SPEC-003) | Changed TBD SMS detection to use `isBookingDateTbd()` helper from `tbd-detection.ts` (the canonical convention). `date_tbd` is not a persisted column. | D1 |
| CR-3 (SPEC-002, AB-002) | Removed contradictory D4 acceptance criterion about completed edit form. D12's redirect is canonical. | D4 |
| ID-1 (WF-003, SPEC-004) | Changed TBD `balanceDueDate` from `|| null` to unconditional `null`. | D1 |
| ID-2 (AB-006, SPEC-005) | Updated immutable guard to filter `undefined` values and unchanged fields before rejecting. | D12 |
| ID-3 (AB-004, ARCH-002) | Added event_date consumer audit table listing all downstream consumers needing TBD handling. | D1 |
| D10 cross-path | Added pending SMS cancellation to `updateBooking()` path as well as `cancelBooking()`. | D10 |

Dismissed findings:
- CR-1 "missing side effects" core claim — **invalid**, `updateBooking()` already has SMS/calendar side effects at lines 766-849
- ARCH-001 "ALLOWED_TRANSITIONS in types.ts" — `types.ts` already contains domain constants, matches convention
- AB-001, ARCH-005, SPEC-001 "no diff in pack" — expected for a pre-implementation spec review

Full review: `tasks/codex-qa-review/2026-05-11-pb-remediation-spec-adversarial-review.md`

## Appendix: User Corrections (2026-05-11)

Ten corrections applied based on the user's deeper codebase knowledge:

| # | Defect | Correction | Section |
|---|--------|-----------|---------|
| 1 | D1 | Full rewrite: `date_tbd` is not a persisted column — use `isBookingDateTbd()` from `tbd-detection.ts`. DB trigger `calculate_balance_due_date` overwrites null `balance_due_date` — use sentinel value. Added TBD→real date and real date→TBD transitions. | B |
| 2 | D3 | Added payment history problem: `getBookingPaymentHistory()` shows configured amount, not actual paid. Changed to require exact deposit match (eliminates the discrepancy). | C |
| 3 | D2 | Added missing revalidation paths: `editPayment` (line 2099) and `deletePayment` (line 2151). Changed client cache from "reduce to 5s" to "remove entirely". | D |
| 4 | D8 | Added `booking-portal/[token]/page.tsx` (lines 136, 169) as a stale `total_amount` consumer — portal computes balance from legacy column. | D |
| 5 | D11 | Full rewrite: use `.update().select()` for atomicity, add calendar event cleanup, only send SMS to confirmed-updated rows, add `cancellation_reason`/`cancelled_at` metadata. | F |
| 6 | D6 | Replaced permission-only fix with dedicated `sendPrivateBookingSms()` action using `SmsQueueService`. Fixes both the permission problem and the wrong-queue problem (SMS wasn't appearing in booking history). | F |
| 7 | D7 | Added that server actions in `privateBookingActions.ts` also need the permission inheritance fix, not just pages. | G |
| 8 | D9 | Fixed partial update validation: `updateBookingItem()` must fetch full current item before validating discount bounds, because partial updates may omit `quantity`/`unit_price`. | H |
| 9 | D18/D24 | Marked as already addressed: endpoint already has deprecation headers, `createRateLimiter`, and Turnstile. Removed Upstash proposal. | K/L |
| 10 | D20 | Fixed RLS SQL: replaced non-existent `user_permissions` table with `public.user_has_permission()` function (squashed.sql:1629). Added GRANT statement for authenticated role. | K |
