# Events Domain Remediation Spec

**Date:** 2026-04-13
**Revised:** 2026-04-13 (adversarial review applied)
**Trigger:** Admin changed event date through UI but `start_datetime` didn't sync (now fixed with DB trigger). Full audit revealed 19 defects across event lifecycle operations.
**Scope:** Event CRUD lifecycle, booking cascades, customer notifications, admin form completeness, and structural debt.

---

## Defect Registry

| ID | Severity | Problem | Tier |
|----|----------|---------|------|
| D06 | Critical | Capacity and payment_mode actively erased on every event edit (hardcoded null in action and form) | 0 |
| D01 | Critical | Event cancellation doesn't cascade to bookings | 1 |
| D02 | Critical | Event deletion hard-deletes bookings via CASCADE — no notification or refunds | 1 |
| D03 | Critical | No customer notification when event date/time changes | 1 |
| D04 | High | No UI warning when changing date/status on events with existing bookings | 2 |
| D05 | High | Admin manual booking reimplements entire flow with divergences | 2 |
| D07 | High | `payment_mode` not editable in UI; missing from hand-written type | 2 |
| D08 | High | No customer notification when payment hold expires | 2 |
| D09 | Medium | Hold expiry cron can race with Stripe payment | 2 |
| D10 | Medium | `hold_expires_at` not recalculated when event date changes | 3 |
| D11 | Medium | Past-date Zod refine always returns true; existing DB trigger error not surfaced | 3 |
| D12 | Medium | 7-day booking reminder not implemented | 3 |
| D13 | Medium | 24-hour reminders disabled in production by default | 3 |
| D14 | Medium | SMS missing event date in pending-payment and payment-confirmed templates | 3 |
| D15 | Medium | Publish validation missing capacity/payment_mode/booking_mode checks; returns flat string array | 3 |
| D16 | Low | `console.error` instead of structured logger in EventService | 3 |
| D17 | Low | Duplicated rollback functions across service and admin action | 3 |
| D18 | Low | Marketing link generation failures silently dropped | 3 |
| D19 | Low | `booking_holds` status changes not audit-logged (SEC-7) | 3 |

---

## Tier 0: Emergency Hotfix — Active Data Corruption

### D06-HOTFIX: Stop Erasing Capacity and Payment Mode on Every Event Edit

**Problem:** `prepareEventDataFromFormData()` at `src/app/actions/events.ts:142` hardcodes `capacity: null`. The SEO preview payload at `EventFormGrouped.tsx:329` also hardcodes `capacity: null`. Every time an admin edits any event field (title, description, etc.), the save action overwrites `capacity` and `payment_mode` with null — even though the form has no fields for these values. This is actively erasing data on 29+ live events that have capacity set via direct DB edits, and 17 events with `cash_only` payment mode.

**Root cause:** The form doesn't expose capacity or payment_mode fields, but the action includes them in the update payload with hardcoded null values. The `capacity` field is already present in `CreateEventInput` — the bug is the UI/action layer forcing null.

**Fix (3-file change):**

1. **`src/app/actions/events.ts:142`** — Remove `capacity: null` from `prepareEventDataFromFormData()`. Only include `capacity` in the update payload if the form actually sends a capacity value.

2. **`src/components/features/events/EventFormGrouped.tsx:329`** — Remove `capacity: null` from the SEO preview payload.

3. **Both files** — Strip any field from the update payload that the form doesn't expose (`capacity`, `payment_mode`, `booking_mode`) to prevent silent overwrites. Use a pattern like:
   ```typescript
   // Only include fields the form actually exposes
   const payload = { ...formFields };
   // Do NOT include capacity, payment_mode, booking_mode unless the form has inputs for them
   ```

**Verification:** After fix, edit an event with known capacity/payment_mode values. Confirm those values survive the edit unchanged.

**Files affected:**
- `src/app/actions/events.ts` — remove hardcoded `capacity: null` from `prepareEventDataFromFormData()`
- `src/components/features/events/EventFormGrouped.tsx` — remove `capacity: null` from SEO preview payload
- `src/app/actions/events.ts` — strip unexposed fields from update payload

---

## Tier 1: Critical — Actively Causing Harm

### D03: Event Reschedule Notification

**Problem:** When an admin changes an event's date or time, customers with confirmed or pending-payment bookings receive no notification. They show up on the wrong date or miss the event entirely.

**Current behaviour:** `updateEvent()` in `src/app/actions/events.ts:259-309` calls `EventService.updateEvent()` in `src/services/events.ts:398-506`. The event row is updated (date, time, start_datetime via trigger). Marketing links are regenerated. Nothing else happens. No booking query, no SMS, no notification of any kind.

**Required behaviour:**

1. **Detect date/time change.** In `updateEvent()`, before calling the service, load the current event's `date` and `time` fields. After the update succeeds, compare old vs new values.

2. **Query affected bookings.** If date or time changed, query `bookings` for all rows where:
   - `event_id = <this event>`
   - `status IN ('confirmed', 'pending_payment')`

   Join to `customers` to get `first_name`, `mobile_number`, `sms_status`.

3. **Send reschedule SMS (async).** SMS dispatch MUST be async — use `waitUntil` (Next.js/Vercel) or a background dispatch pattern. The save action must return immediately to the admin; SMS sending happens in the background.

   **Deduplication:** If the event date is changed twice within 5 minutes, only send the SMS for the latest change. Track via idempotency key that includes the new date value.

   **Batch throttling:** Maximum 20 SMS per second to avoid Twilio rate limits. Use `Promise.allSettled` in batches of 20 with a 1-second delay between batches, inside the async context.

   For each affected customer with `sms_status = 'active'`, send:
   ```
   The Anchor: Hi {firstName}, heads up — {eventName} has moved to {newDate}. Your booking for {seats} {seatWord} is still confirmed. {manageLink}
   ```
   Use `getSmartFirstName()` for the greeting. Use `formatLondonDateTime()` for the new date.

4. **Generate fresh manage-booking tokens.** Each reschedule SMS MUST include a freshly generated manage-booking token. Do NOT reuse existing tokens — they may have expired. Generate a new token per booking and include the manage link.

5. **Recalculate hold_expires_at.** For pending-payment bookings, update BOTH tables:
   ```sql
   -- Update bookings table
   UPDATE bookings
   SET hold_expires_at = LEAST(new_start_datetime, hold_expires_at)
   WHERE event_id = <event_id> AND status = 'pending_payment';

   -- Update booking_holds table
   UPDATE booking_holds
   SET expires_at = LEAST(new_start_datetime, created_at + INTERVAL '24 hours')
   WHERE event_booking_id IN (
     SELECT id FROM bookings WHERE event_id = <event_id> AND status = 'pending_payment'
   )
   AND status = 'active';
   ```
   Also flag that payment guest tokens may need their expiry adjusted if it diverges from the new hold deadline. (See also D10.)

6. **Log the reschedule.** Record an audit log entry with `operation_type: 'reschedule'` including old and new dates.

**SMS metadata:**
```typescript
{
  template_key: 'event_rescheduled',
  event_id: eventId,
  event_booking_id: booking.id,
  old_date: oldDate,
  new_date: newDate
}
```

Include `old_date` and `new_date` in the idempotency context so that a date-change-then-revert does NOT suppress the corrective SMS (since the new_date differs from the previous SMS's new_date).

**Prerequisite:** `src/lib/sms/templates.ts` must be created first — this file does not currently exist. It will house `buildEventRescheduledSms()` and `buildEventCancelledSms()` templates (used by D03 and D01).

**Files affected:**
- `src/lib/sms/templates.ts` — **create** this file; add `buildEventRescheduledSms()` template
- `src/app/actions/events.ts` — add date change detection and async reschedule dispatch after `EventService.updateEvent()`
- `src/services/events.ts` — return old event data from `updateEvent()` so the action can compare
- `src/lib/events/manage-booking.ts` — generate fresh manage-booking tokens for reschedule SMS

---

### D01: Event Cancellation Cascade

**Problem:** Setting `event_status = 'cancelled'` via `updateEvent()` only changes the event's status field. Existing bookings remain in `confirmed` or `pending_payment` status. Customers are not notified. Payments are not refunded. Holds are not released.

**Current behaviour:** `updateEvent()` calls `update_event_transaction` RPC which sets the `event_status` field. No other tables are touched. The booking RPC blocks new bookings for cancelled events (`IF event_status IN ('cancelled', 'draft') THEN blocked`), but existing bookings are orphaned.

**Required behaviour:**

1. **Require confirmation.** The cancel action MUST require the admin to confirm the operation. This is satisfied by D04's confirmation dialog (which must ship before or alongside D01 — see SEC-2). If D04 is not yet shipped, add a standalone confirmation parameter (e.g., `confirmCancellation: true`) that the action validates before proceeding. The action must reject calls without explicit confirmation.

2. **Detect cancellation.** In `updateEvent()`, if the new `event_status` is `'cancelled'` and the old status was NOT `'cancelled'`, trigger the cancellation cascade.

3. **Fetch all active bookings.** Query `bookings` where `event_id = <this event>` and `status IN ('confirmed', 'pending_payment')`. Join to `customers` for notification data and to `payments` for refund data.

4. **Cancel each booking.** For each booking:
   - Update `bookings.status = 'cancelled'`, `cancelled_at = NOW()`, `cancelled_by = <admin user id>`
   - Release any active `booking_holds` (set `status = 'released'`, `released_at = NOW()`)
   - Cancel any associated `table_bookings` (set `status = 'cancelled'`, `cancelled_at = NOW()`)
   - Leave `booking_table_assignments` intact — they should remain for historical reference (assignments reference the cancelled table_bookings)

5. **Process refunds (multi-charge aware).** For each prepaid booking with completed payments:
   - Query ALL `payments` rows where `event_booking_id = booking.id` AND `status = 'succeeded'` — not just the latest charge. Bookings may have multiple charges (e.g., original booking + seat increase).
   - Refund EACH payment individually via Stripe/PayPal. All charges are auto-refunded on event cancellation (full refund).
   - Use refund reason `'event_cancelled'`
   - Handle refund failures gracefully — log and continue to next payment/booking

   **DB uniqueness constraint:** Add a uniqueness constraint on refund rows keyed by source payment ID to prevent duplicate local refund records from concurrent cancel attempts:
   ```sql
   ALTER TABLE payment_refunds
   ADD CONSTRAINT uq_payment_refunds_source_payment
   UNIQUE (source_payment_id);
   ```

6. **Send cancellation SMS.** For each customer with `sms_status = 'active'`:
   ```
   The Anchor: Hi {firstName}, unfortunately {eventName} on {eventDate} has been cancelled. {refundNote} We're sorry for the inconvenience.
   ```
   Where `{refundNote}` is:
   - Prepaid + refund succeeded: `"Your payment of £{amount} will be refunded within 5-10 business days."`
   - Prepaid + refund failed: `"Please contact us about your refund."`
   - Free/cash_only: omit

7. **Release waitlist entries.** Cancel all `waitlist_entries` and `waitlist_offers` for this event:
   - `waitlist_entries`: set `status = 'cancelled'`, `cancelled_at = NOW()`
   - `waitlist_offers`: set `status = 'cancelled'`, `expired_at = NOW()`

8. **Set `booking_open = false`.** Prevent any new bookings via the API.

9. **Audit logging.** Log the event cancellation with count of affected bookings, refunds processed, and SMS sent.

**Error handling:** The cascade should be wrapped in a try/catch that processes as many bookings as possible even if individual operations fail. Return a summary to the admin: `"Event cancelled. X bookings cancelled, Y refunds processed (Z failed), W customers notified."`

**Prerequisite:** `src/lib/sms/templates.ts` must exist (created as part of D03) for the `buildEventCancelledSms()` template.

**Files affected:**
- `src/app/actions/events.ts` — add `cancelEvent()` action (new function) or add cascade logic to `updateEvent()` when status -> cancelled
- `src/services/events.ts` — add `EventService.cancelEvent()` method
- `src/lib/sms/templates.ts` — add `buildEventCancelledSms()` template
- `src/lib/events/manage-booking.ts` — multi-charge refund logic in `processEventRefund()`
- New migration — add uniqueness constraint on `payment_refunds.source_payment_id`

---

### D02: Event Deletion Safeguards

**Problem:** `EventService.deleteEvent()` at `src/services/events.ts:508-539` performs a hard `DELETE` from the events table. The FK `bookings_event_id_fkey` has `ON DELETE CASCADE`, which permanently destroys all booking records, payment records, and audit trails. No customer notification, no refunds.

**Current behaviour:** The admin clicks "Delete" -> server action calls `EventService.deleteEvent()` -> hard `DELETE FROM events WHERE id = ?` -> all bookings CASCADE-deleted -> all booking-related rows (holds, payments, messages, analytics) CASCADE-deleted or orphaned.

**Cascade shape (verified):**
- CASCADE from bookings: `payments`, `booking_holds`, `guest_tokens`, `feedback`
- SET NULL from bookings: `messages`, `analytics_events`, `table_bookings`
- CASCADE from events directly: `waitlist_entries`, `waitlist_offers`, `event_images`, `event_message_templates`

**Required behaviour:**

1. **App-level pre-delete check.** Before deleting, query:
   ```sql
   SELECT COUNT(*) as active_bookings,
          COUNT(*) FILTER (WHERE status IN ('confirmed', 'pending_payment')) as live_bookings,
          SUM(CASE WHEN p.amount > 0 THEN 1 ELSE 0 END) as paid_bookings
   FROM bookings b
   LEFT JOIN payments p ON p.event_booking_id = b.id AND p.status = 'succeeded'
   WHERE b.event_id = <this event>
   ```

2. **Block deletion if active bookings exist.** If `live_bookings > 0`, return an error:
   ```
   "Cannot delete this event — it has {N} active bookings. Cancel the event first to notify customers and process refunds, then delete."
   ```

3. **DB-level deletion safeguard.** Add a database trigger (in addition to app-level check) that prevents deletion of events with active bookings. This is necessary because RLS grants `DELETE` to authenticated users with `events:delete` permission, so app-only safeguards are bypassable:
   ```sql
   CREATE OR REPLACE FUNCTION prevent_event_delete_with_active_bookings()
   RETURNS TRIGGER AS $$
   BEGIN
     IF EXISTS (
       SELECT 1 FROM bookings
       WHERE event_id = OLD.id
       AND status IN ('confirmed', 'pending_payment')
     ) THEN
       RAISE EXCEPTION 'Cannot delete event with active bookings. Cancel the event first.';
     END IF;
     RETURN OLD;
   END;
   $$ LANGUAGE plpgsql;

   CREATE TRIGGER trg_prevent_event_delete_with_active_bookings
   BEFORE DELETE ON events
   FOR EACH ROW
   EXECUTE FUNCTION prevent_event_delete_with_active_bookings();
   ```

4. **Allow deletion only for events with no active bookings.** Events with only `completed`, `cancelled`, or `expired` bookings can be deleted (the historical records will be lost, which is acceptable for cleanup).

5. **Soft-delete option (future enhancement).** Consider adding a `deleted_at` field to events for soft-delete, preserving historical data. This is an enhancement, not a blocker — the immediate fix is the pre-delete check + DB trigger.

**Files affected:**
- `src/services/events.ts` — add booking count check in `deleteEvent()`
- `src/app/actions/events.ts` — surface the error message to the admin
- New migration — add `prevent_event_delete_with_active_bookings` trigger

---

## Tier 2: Structural — Will Break Under Edge Cases

### D04: UI Warning for Events With Existing Bookings

**Problem:** Admin can change date, time, or status of an event with 50 confirmed bookings with no warning or confirmation prompt. Per SEC-2 finding, this must ship before or alongside D01 (cancellation cascade) to prevent accidental mass-cancellation.

**Required behaviour:**

1. **New data loader on edit page.** Add booking count to the server component data fetch on the edit page, following the existing detail page pattern. Fetch the count of active bookings (confirmed + pending_payment) and pass to the form component.

2. **Confirmation dialog on date/time/status change.** If the event has active bookings AND the admin changes `date`, `time`, or `event_status`:
   - Show a confirmation dialog: `"This event has {N} active bookings. Changing the {field} will trigger notifications to all booked customers. Continue?"`
   - For status -> cancelled: `"This will cancel all {N} bookings and notify customers. Refunds will be processed for prepaid bookings. Continue?"`

3. **Visual indicator.** Show a badge or count on the edit form header: `"47 active bookings"` so the admin is always aware.

**Files affected:**
- `src/app/(authenticated)/events/[id]/edit/page.tsx` — add booking count to server component data fetch (new data loader)
- `src/app/(authenticated)/events/[id]/edit/EditEventClient.tsx` — pass count to form
- `src/components/features/events/EventFormGrouped.tsx` — add confirmation dialog, booking count display

---

### D05: Admin Manual Booking Consolidation (Phased)

**Problem:** `createEventManualBooking()` in `src/app/actions/events.ts:519-826` reimplements the entire 5-phase booking flow instead of calling `EventBookingService.createBooking()`. This creates divergences:

| Issue | Service layer | Admin action |
|-------|--------------|--------------|
| Phase ordering | RPC -> table -> payment -> manage -> SMS | RPC -> manage -> payment -> table -> SMS |
| Payment link failure | Returns error (HTTP 500) | Logs warning, returns success |
| SMS opt-out check | Checks `sms_status = 'active'` | No check — sends to any phone |
| SMS builder | `buildEventBookingSms()` | `buildEventBookingCreatedSms()` (different copy) |
| Rollback function | `cancelBookingAfterTableReservationFailure()` | `rollbackEventBookingForTableFailure()` (duplicate) |

**Required behaviour (4-phase approach, each independently shippable):**

**Phase 1: Align SMS behaviour.** Update admin action to use the same SMS template as the service layer (`buildEventBookingSms()`). Add `sms_status = 'active'` check to admin action. This is the highest-risk divergence (customers getting different messages or getting SMS after opting out).

**Phase 2: Align token creation order.** Reorder admin action phases to match service layer: RPC -> table -> payment -> manage -> SMS. Ensure rollback handles the new order correctly.

**Phase 3: Align error handling.** Make admin action treat payment link failures the same way as the service layer (return error, not log-and-continue). Surface all errors consistently.

**Phase 4: Delegate to service.** Refactor `createEventManualBooking()` to call `EventBookingService.createBooking()` with `source: 'admin'`. Admin-specific behaviour (like the `customer_conflict` duplicate-key check) handled as a pre-check before calling the service. Delete the duplicated phases and the duplicated rollback function `rollbackEventBookingForTableFailure()`.

**Files affected:**
- `src/app/actions/events.ts` — phased changes to `createEventManualBooking()`
- `src/services/event-bookings.ts` — may need minor adjustments to support admin-specific params in Phase 4

---

### D06: Capacity Field in UI (Full Fix)

**Note:** The emergency hotfix (Tier 0) stops the data corruption. This item adds the actual UI field so admins can set capacity through the form. The `capacity` field is already in `CreateEventInput` — no type change needed for the service layer.

**Required behaviour:**

1. **Add capacity field to form.** In `EventFormGrouped.tsx`, add a number input for capacity in the "Event Details" section:
   - Label: "Capacity"
   - Placeholder: "Leave blank for unlimited"
   - Type: number, min 1, max 10000
   - Optional — blank means NULL (unlimited)

2. **Wire through to data prep.** In `prepareEventDataFromFormData()`, read the capacity field from form data. Convert to `number | null`. (The hardcoded null is already removed in the Tier 0 hotfix.)

3. **Display remaining capacity on event detail page.** Show "X / Y seats booked" or "X seats booked (unlimited)" on the event detail page.

**Files affected:**
- `src/components/features/events/EventFormGrouped.tsx` — add capacity input
- `src/app/actions/events.ts` — wire capacity from form data in `prepareEventDataFromFormData()`
- `src/app/(authenticated)/events/[id]/EventDetailClient.tsx` — show capacity info

---

### D07: Payment Mode in UI

**Problem:** `payment_mode` is not editable through the admin form. It can only be set by direct database edits. This controls whether events are free, cash-on-arrival, or prepaid (with deposit/hold flow).

**Required behaviour:**

1. **Add `payment_mode` to the hand-written `Event` type.** In `src/types/database.ts`, add `payment_mode` as a required field on the `Event` type with the correct union type.

2. **Add Zod enum validation.** In the form data preparation, add Zod validation for `payment_mode` values:
   ```typescript
   const paymentModeSchema = z.enum(['free', 'cash_only', 'prepaid']);
   ```

3. **Add payment_mode field to form.** In `EventFormGrouped.tsx`, add a select/radio group in the "Pricing" section:
   - Options: "Free" (`free`), "Cash on arrival" (`cash_only`), "Prepaid" (`prepaid`)
   - Default: "Free"
   - When "Prepaid" is selected, show the price field as required
   - When "Free" is selected, hide/disable the price field

4. **Wire through to data prep.** In `prepareEventDataFromFormData()`, read `payment_mode` from form data and validate with the Zod enum.

5. **Add to publish validation.** In `getPublishValidationIssues()`, add check: if `payment_mode = 'prepaid'` and `price` is null/zero, flag as issue.

**Files affected:**
- `src/types/database.ts` — add `payment_mode` to hand-written `Event` type
- `src/components/features/events/EventFormGrouped.tsx` — add payment_mode select
- `src/app/actions/events.ts` — extract and validate `payment_mode` from form data
- `src/services/events.ts` — add `payment_mode` to input types, add publish validation check

---

### D08: Hold Expiry Customer Notification

**Problem:** When a payment hold expires, the booking is silently set to `expired`. The customer receives no notification that their seats have been released.

**Current behaviour:** The cron at `src/app/api/cron/event-booking-holds/route.ts` updates booking status to `expired`, releases holds, and cancels table bookings. No SMS sent.

**Required behaviour:**

After expiring each booking, send an SMS to the customer:
```
The Anchor: Hi {firstName}, your held seats for {eventName} on {eventDate} have been released as payment wasn't completed in time. If you'd still like to attend, please rebook at {bookingUrl}.
```

**Implementation:**
1. When the cron expires a booking, load the customer and event details.
2. Send SMS via `sendSMS()` with `template_key: 'event_hold_expired'`.
3. Use `getSmartFirstName()` for greeting.
4. Include the event's public booking URL if available.

**Batching:** The cron already processes in batches. Add SMS dispatch to each batch iteration.

**Files affected:**
- `src/app/api/cron/event-booking-holds/route.ts` — add SMS dispatch after hold expiry

---

### D09: Payment vs Hold Expiry Race Condition

**Problem:** A customer can pay at 23:59:59, hold expires at 00:00:00, and the cron runs at 00:00:01. If the cron expires the booking before the Stripe webhook confirms payment, the booking is `expired` but the customer has been charged.

**Current behaviour:** The `confirm_event_payment_v05` RPC checks if `status = 'pending_payment'`. If the cron already set it to `expired`, the RPC returns `blocked: booking_not_pending_payment`. The payment is recorded but the booking stays expired.

**Required behaviour:**

In the `confirm_event_payment_v05` RPC, add recovery logic:

```sql
-- If booking was recently expired, check if we can recover
-- The cron writes expired_at (NOT cancelled_at)
IF v_booking.status = 'expired'
   AND v_booking.expired_at IS NOT NULL
   AND v_booking.expired_at > NOW() - INTERVAL '10 minutes'
THEN
  -- Abuse protection: don't auto-recover if checkout session was created
  -- more than 30 minutes before hold expiry
  IF v_checkout_created_at < (v_booking.hold_expires_at - INTERVAL '30 minutes') THEN
    -- Reject: stale checkout session
    RETURN jsonb_build_object('status', 'blocked', 'reason', 'stale_checkout_session');
  END IF;

  -- Capacity check: verify seats are still available before recovering
  SELECT capacity, (SELECT COUNT(*) FROM bookings WHERE event_id = v_event_id AND status = 'confirmed') as confirmed_count
  INTO v_capacity_check
  FROM events WHERE id = v_event_id;

  IF v_capacity_check.capacity IS NOT NULL
     AND (v_capacity_check.confirmed_count + v_booking.seats) > v_capacity_check.capacity
  THEN
    -- No capacity: mark for manual review and auto-refund
    UPDATE bookings SET status = 'requires_manual_review' WHERE id = v_booking_id;
    RETURN jsonb_build_object('status', 'blocked', 'reason', 'capacity_exceeded_after_recovery', 'action', 'auto_refund');
  END IF;

  -- Recover: set status back to pending_payment, then continue with confirmation
  UPDATE bookings SET status = 'pending_payment', expired_at = NULL WHERE id = v_booking_id;
  -- Continue with normal confirmation logic...
END IF;
```

The calling code must handle the `capacity_exceeded_after_recovery` response by triggering an automatic Stripe refund and notifying the customer.

**Files affected:**
- New migration — update `confirm_event_payment_v05` to handle expired bookings with capacity check
- `src/lib/events/event-payments.ts` — handle `capacity_exceeded_after_recovery` response with auto-refund

---

## Tier 3: Enhancements

### D10: Hold Recalculation on Date Change

**Problem:** When an event date changes, `hold_expires_at` on existing pending-payment bookings is not recalculated.

**Fix:** As part of D03 (reschedule notification), after updating the event, also update holds on BOTH tables:
```sql
-- bookings table
UPDATE bookings
SET hold_expires_at = LEAST(new_start_datetime, hold_expires_at)
WHERE event_id = <event_id> AND status = 'pending_payment';

-- booking_holds table
UPDATE booking_holds
SET expires_at = LEAST(new_start_datetime, created_at + INTERVAL '24 hours')
WHERE event_booking_id IN (
  SELECT id FROM bookings WHERE event_id = <event_id> AND status = 'pending_payment'
)
AND status = 'active';
```

**Files affected:** Same as D03 — add to the reschedule cascade.

---

### D11: Past-Date Validation

**Problem:** The Zod schema's date `.refine()` always returns `true` (line 178 of `src/services/events.ts`). No past-date validation at the app layer.

**Note:** A DB trigger `check_event_date_not_past()` already exists and blocks past-date inserts at the database level. The fix is:
1. Fix the Zod refine to actually validate (so errors surface at the form level, not as an opaque DB error)
2. Surface the DB trigger's error properly in the action's error handling

**Fix:**

```typescript
date: z.string().min(1).refine((val) => {
  const eventDate = new Date(val + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return eventDate >= today
}, { message: 'Event date cannot be in the past' })
```

Note: This should only apply to new events and date changes, not to loading existing events with past dates (which is valid for viewing history). The validation should be in the create/update action, not in the schema used for reads.

**Files affected:**
- `src/services/events.ts` — fix the `.refine()` callback
- `src/app/actions/events.ts` — add past-date check in create/update actions; handle DB trigger error gracefully

---

### D12: 7-Day Booking Reminder

**Problem:** Only 24-hour reminders exist. The business rules specify 7-day and 24-hour reminders.

**Fix:** Add a `TEMPLATE_REMINDER_7D` constant and processing logic to the event guest engagement cron. Template:
```
The Anchor: Hi {firstName}, just a reminder — {eventName} is coming up on {eventDate}. See you there! {manageLink}
```

**Files affected:**
- `src/app/api/cron/event-guest-engagement/route.ts` — add 7-day window check and SMS dispatch

---

### D13: 24-Hour Reminders Production Enable

**Problem:** `EVENT_ENGAGEMENT_UPCOMING_SMS_ENABLED` defaults to `false` in production (line 41-44 of the cron).

**Decision needed:** Is this intentionally disabled or was it never enabled after rollout? If it should be on:

**Fix:** Either change the default to `true` in production, or add the env var to the Vercel project settings.

**Files affected:**
- `src/app/api/cron/event-guest-engagement/route.ts` — change default, OR
- Vercel environment variables — add `EVENT_ENGAGEMENT_UPCOMING_SMS_ENABLED=true`

---

### D14: SMS Missing Event Date

**Problem:** Pending-payment SMS says "X seats held for Event Name — nice one!" with no date. Payment-confirmed SMS also omits the date.

**Fix:** Add `on {eventDate}` to both templates:
- Pending payment: `"X seats held for Event Name on {eventDate} — nice one!"`
- Payment confirmed: `"Payment received — you're confirmed for Event Name on {eventDate} ({seats} seats)."`

**Files affected:**
- `src/services/event-bookings.ts` — update pending-payment template
- `src/lib/events/event-payments.ts` — update payment-confirmed template

---

### D15: Publish Validation Completeness

**Problem:** `getPublishValidationIssues()` doesn't check for `payment_mode` or `booking_mode`. Returns a flat `string[]` which conflates blocking errors with informational warnings.

**Fix:**

1. **Change return type** from `string[]` to `{ errors: string[], warnings: string[] }`:
   ```typescript
   interface PublishValidationResult {
     errors: string[];    // Blocking — must fix before publish
     warnings: string[];  // Non-blocking — informational
   }
   ```

2. **Add validation checks:**
   - If `payment_mode = 'prepaid'` and no `price` set -> **error**
   - If `booking_mode` is missing -> **warning**
   - Do NOT warn on `capacity` being NULL — NULL means unlimited by design (per D06 fix)

3. **Update all callers** of `getPublishValidationIssues()` to handle the new return shape.

**Files affected:**
- `src/services/events.ts` — change return type and add checks to `getPublishValidationIssues()`
- All callers of `getPublishValidationIssues()` — update to handle `{ errors, warnings }` shape

---

### D16: Structured Logger in EventService

**Problem:** `console.error` used instead of `logger.error` throughout `src/services/events.ts`.

**Fix:** Replace all `console.error` calls with `logger.error` or `logger.warn`. Import `logger` from `@/lib/logger`.

**Files affected:**
- `src/services/events.ts` — ~9 instances to replace

---

### D17: Deduplicate Rollback Function

**Problem:** `cancelBookingAfterTableReservationFailure()` in `src/services/event-bookings.ts:279-347` and `rollbackEventBookingForTableFailure()` in `src/app/actions/events.ts:443-510` are functionally identical.

**Fix:** If D05 Phase 4 (admin booking delegation) is implemented, the admin action's copy is deleted automatically. If D05 Phase 4 is deferred, extract to a shared location in `src/services/event-bookings.ts` and have the admin action import it.

**Files affected:** Resolved by D05 Phase 4.

---

### D18: Marketing Link Failure Handling

**Problem:** `generateEventMarketingLinks()` failures are silently caught and logged to console.

**Fix:** Replace `console.error` with `logger.warn` and add a `marketing_links_failed` flag to the update response so the admin UI can show a non-blocking warning.

**Files affected:**
- `src/services/events.ts` — improve error handling in marketing link generation

---

### D19: Audit Logging for Booking Hold Status Changes (SEC-7)

**Problem:** `booking_holds` status changes (created, released, expired) are not audit-logged. This creates a gap in the audit trail for payment-related state transitions — especially important for dispute resolution and debugging hold expiry race conditions (D09).

**Fix:** Add `logAuditEvent()` calls for all `booking_holds` status transitions:
- Hold created (status: `active`)
- Hold released (status: `released`)
- Hold expired (status: `expired`)

Include `booking_hold_id`, `event_booking_id`, `old_status`, and `new_status` in the audit metadata.

**Files affected:**
- `src/app/api/cron/event-booking-holds/route.ts` — add audit logging for expiry
- `src/services/event-bookings.ts` — add audit logging for hold creation
- `src/app/actions/events.ts` — add audit logging for hold release during cancellation

---

## Implementation Priority

### Tier 0: Emergency Hotfix (D06-HOTFIX)
Stop active data corruption immediately. This is a 3-file fix with no dependencies.

1. **D06-HOTFIX** — Stop erasing capacity and payment_mode on every event edit

### Phase 1: Stop the Bleeding (D04, D03, D01, D02)
These are actively causing harm — customers showing up on wrong dates, events cancelled without notification, bookings destroyed without refunds. D04 ships first/alongside to provide the confirmation safety net required by SEC-2.

2. **D04** — UI warning for events with bookings (confirmation dialog — safety gate for D01)
3. **D03** — Event reschedule notification (highest priority after safety gate — this is what the user reported)
4. **D01** — Event cancellation cascade (requires D04 confirmation dialog)
5. **D02** — Event deletion safeguards

### Phase 2: Close Structural Gaps (D06, D07, D05, D08, D09)
These will break under edge cases or are blocking admin functionality.

6. **D06 + D07** — Capacity and payment_mode in UI (unblocks admin event configuration)
7. **D05** — Admin booking consolidation (phased — Phase 1 first)
8. **D08** — Hold expiry notification
9. **D09** — Payment race condition fix

### Phase 3: Polish (D10-D19)
Lower priority enhancements.

10. **D14** — SMS date in pending-payment/confirmed templates
11. **D15** — Publish validation completeness (new return type)
12. **D11** — Past-date validation (surface existing DB trigger + fix Zod)
13. **D12 + D13** — 7-day reminders + enable 24h reminders
14. **D16 + D17 + D18** — Logging, dedup, error handling
15. **D19** — Audit logging for booking hold status changes (SEC-7)

---

## Assumptions Requiring Human Decision

| # | Question | Impact |
|---|----------|--------|
| ASM-1 | Should event cancellation auto-refund all prepaid bookings (all charges), or should admin choose per-booking? Recommendation: auto-refund all charges. | D01 refund flow design |
| ASM-2 | Should 24-hour reminders be enabled in production? Is `EVENT_ENGAGEMENT_UPCOMING_SMS_ENABLED=false` intentional? | D13 — may just need an env var change |
| ASM-3 | Should event deletion be permanently blocked when bookings exist, or should it be allowed with a confirmation? | D02 deletion policy |
| ASM-4 | For D03 reschedule SMS — should it fire automatically on date save, or should there be a "Notify customers" button the admin clicks after confirming the change? | D03 UX design — auto vs manual notification |
| ASM-5 | For capacity (D06) — should NULL capacity mean "unlimited" or should it require the admin to explicitly set a value? 29 events currently have capacity set — verify these values are still correct before adding the UI field. | D06 form behaviour |

## Out of Scope

- Brand site event selection logic (separate codebase)
- Table booking date/time sync (separate domain, different table)
- Private booking date management (different flow)
- SMS template management via DB `message_templates` table (these are hardcoded templates)
- Historical data cleanup for past events with stale `start_datetime` (backfill migration already ran)
- Event recurring series management (event cloning/templating is a separate feature)
