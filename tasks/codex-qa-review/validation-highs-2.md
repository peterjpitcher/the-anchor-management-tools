# QA Validation: HIGH-005 through HIGH-008

## HIGH-005: Concurrent clock-ins create duplicate open sessions + public timeclock has no auth

**Verdict: CONFIRMED**

### Race condition on clock-in

File: `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/timeclock.ts`

Lines 84-94 perform a classic check-then-act pattern with no atomicity guarantee:

```typescript
// Line 85-90: SELECT to check for open session
const { data: openSession } = await supabase
  .from('timeclock_sessions')
  .select('id')
  .eq('employee_id', employeeId)
  .is('clock_out_at', null)
  .single();

// Line 92-94: If no open session found, proceed
if (openSession) {
  return { success: false, error: 'Already clocked in. Please clock out first.' };
}

// Line 99-107: INSERT new session (no lock held between check and insert)
```

The migration at `supabase/migrations/20260228100000_rota_system.sql:158` creates only a non-unique INDEX:

```sql
CREATE INDEX idx_timeclock_sessions_open ON public.timeclock_sessions(employee_id) WHERE clock_out_at IS NULL;
```

This is a performance index, not a uniqueness constraint. Two concurrent clock-in requests for the same employee can both pass the check at line 85 and both succeed at line 99, creating duplicate open sessions.

**Fix needed:** Add a unique partial index: `CREATE UNIQUE INDEX ... ON timeclock_sessions(employee_id) WHERE clock_out_at IS NULL;`

### No auth on timeclock page

File: `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(timeclock)/timeclock/page.tsx`

The page is intentionally public (line 11 comment: "public page, no auth session"). It uses `createAdminClient()` (line 9) to fetch data and renders a kiosk UI. There is no PIN, passcode, kiosk secret, or any form of authentication. Any person who can reach the URL can clock in/out any active employee by selecting their name from the list.

The CLAUDE.md project doc explicitly lists `/timeclock` as a public path prefix, confirming this is by design. However, the lack of even a basic kiosk PIN means anyone with URL access can manipulate clock records for any employee -- this is a legitimate security concern for a payroll-affecting feature.

---

## HIGH-006: Booking APIs create pending_payment holds with no payment link

**Verdict: CONFIRMED**

### Table bookings

File: `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/table-bookings/route.ts`

Lines 234-255: When the booking state is `pending_payment`, the code attempts to create a payment token (line 240). If `createTablePaymentToken` throws, the error is caught at line 247 and only logged as a warning (line 248). `nextStepUrl` remains `null` (initialized at line 230). Execution continues to the success response path at lines 257+, returning the booking as successful with `next_step_url: null`.

The customer receives a booking in `pending_payment` state with no way to pay. The hold will eventually expire via the cron, cancelling a booking the customer thought was confirmed.

### Event bookings

File: `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/event-bookings/route.ts`

Lines 489-510: Identical pattern. `createEventPaymentToken` failure is caught (line 502), logged as a warning (line 503), and `nextStepUrl` stays `null`. The booking is returned as successful regardless.

Both endpoints swallow token-creation failures silently. The customer gets a booking confirmation with no payment link, and the hold timer is ticking.

---

## HIGH-007: Hold-expiry cron can cancel recently confirmed bookings

**Verdict: DISPUTED**

File: `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/private-bookings-expire-holds/route.ts`

The claim states the cron "snapshots expired draft IDs, then cancels by ID only without re-checking status." Let me trace the actual code:

- **Line 18-23 (fetch):** Selects IDs where `status = 'draft'` AND `hold_expiry < now`.
- **Line 40-46 (update):** Updates those IDs using `.in('id', ids)`.

The claim is that between the fetch and the update, a booking could be confirmed, and the update would cancel it. However, this concern is **overstated** for the following reason:

The update at line 40-46 does NOT re-filter by `status = 'draft'` -- it updates all rows matching the ID list regardless of current status. So technically, if a booking transitions from `draft` to `confirmed` between the SELECT (line 18) and the UPDATE (line 40), it would indeed be cancelled.

**Revised verdict: PARTIALLY CONFIRMED**

The race window exists: the UPDATE at line 46 uses `.in('id', ids)` without re-checking `.eq('status', 'draft')`. If a booking is confirmed between the SELECT and UPDATE, it would be wrongly cancelled. However, this is a narrow window (the two queries execute within milliseconds in the same request), and the cron runs once daily at 06:00 UTC -- a time when manual confirmations are unlikely.

**Fix needed (low effort):** Add `.eq('status', 'draft')` to the UPDATE query at line 42 to make it idempotent-safe:

```typescript
.update({ status: 'cancelled', cancellation_reason: 'Hold expired automatically' })
.eq('status', 'draft')  // <-- add this guard
.in('id', ids);
```

---

## HIGH-008: Recurring invoice schedules permanently wedged after partial success

**Verdict: PARTIALLY CONFIRMED**

File: `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/recurring-invoices/route.ts`

The claim says "if invoice creation succeeds but `next_invoice_date` advance fails, idempotency seals and future runs skip." Let me trace the actual flow:

1. **Line 127:** Idempotency key is claimed (`claimHeld = true` at line 145).
2. **Line 164-173:** Invoice is created. `createdInvoiceId` is set (line 174).
3. **Line 182-198:** `next_invoice_date` is advanced. If this fails, it throws at line 194.
4. **Line 475 (catch block):** On error, when `claimHeld && createdInvoiceId` (line 477), it calls `persistIdempotencyResponse` with `state: 'processed_with_error'` (line 484).

On the next cron run, `claimIdempotencyKey` at line 127 will find this key. The `claim.state` will be either `'in_progress'` or `'replay'` (line 138), causing it to skip with "already processing/processed."

So the finding is correct that the schedule gets wedged: the invoice was created (no duplicate is desired), but `next_invoice_date` was never advanced. Future runs will skip this recurring invoice forever because the idempotency key for this specific `(recurring_invoice_id, scheduled_date)` is sealed.

**However**, the severity is somewhat mitigated by:
- The idempotency key includes the `scheduledInvoiceDate` (line 90), so only that specific date's generation is blocked. Once the date changes and `next_invoice_date` still matches, a new cron run with a new date won't hit the same key... except `next_invoice_date` was never advanced, so the same date keeps matching, and the same idempotency key keeps being hit.
- The `persistIdempotencyResponse` records `state: 'processed_with_error'` which at least makes the problem discoverable in the idempotency table.

**Net result:** The schedule IS permanently wedged as claimed. The recurring invoice will never fire again until someone manually advances `next_invoice_date` in the database. The idempotency key has a 90-day TTL (line 490: `24 * 90`), so after 90 days it would self-heal -- but that means 90 days of missed invoices.

**Fix needed:** If the `next_invoice_date` update fails after invoice creation, either (a) attempt to delete the just-created invoice and release the idempotency claim, or (b) retry the date advance, or (c) advance the date in the same transaction as invoice creation.
