-- Private-booking due-date consistency (discovery 2026-07-08, Paula's 5th-vs-12th):
-- 1. Today-clamp the NULL-fill trigger so a refill can never stamp a past date.
-- 2. DB-level audit of every balance_due_date change — the 2026-07-05 backfill
--    rewrote customer deadlines with no audit row because it bypassed the app.
-- 3. Allow the new 'balance_due_date_changed' corrective SMS trigger type.
-- 4. Mark the dormant private_booking_sms_reminders view as legacy (no consumer;
--    dropping it needs explicit approval, so comment-only here).

-- 1. NULL-fill trigger gains the today-clamp, mirroring the app's
--    computeBalanceDueDateIso (src/services/private-bookings/types.ts):
--    14 days before the event, never in the past.
--    Uses the London-local date, not CURRENT_DATE (the DB runs in UTC, so
--    between midnight and 01:00 BST the two disagree by a day). Also clamped
--    with LEAST(event_date, ...) so a booking created for a past/today event
--    can never get a deadline that falls after its own event date.
CREATE OR REPLACE FUNCTION public.calculate_balance_due_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  today_london date := (now() AT TIME ZONE 'Europe/London')::date;
BEGIN
  IF NEW.date_tbd = true THEN
    NEW.balance_due_date := NULL;
    RETURN NEW;
  END IF;
  IF NEW.event_date IS NOT NULL AND NEW.balance_due_date IS NULL THEN
    NEW.balance_due_date := LEAST(
      NEW.event_date::date,
      GREATEST((NEW.event_date - INTERVAL '14 days')::date, today_london)
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- 2. Audit every balance_due_date change at the DB level so migrations and
--    manual SQL are captured too. App edits also write their own attributed
--    'field_updated' row; this row is distinguishable by its action name.
--    SECURITY DEFINER because private_booking_audit is RLS-enabled with a
--    SELECT-only policy — without it, staff booking updates (authenticated
--    role) would fail on the trigger's INSERT.
CREATE OR REPLACE FUNCTION public.audit_balance_due_date_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  INSERT INTO public.private_booking_audit (
    booking_id, action, field_name, old_value, new_value, performed_by, metadata
  ) VALUES (
    NEW.id,
    'balance_due_date_changed',
    'balance_due_date',
    COALESCE(OLD.balance_due_date::text, ''),
    COALESCE(NEW.balance_due_date::text, ''),
    NULL,
    jsonb_build_object('source', 'db_trigger')
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS audit_balance_due_date_change ON public.private_bookings;
CREATE TRIGGER audit_balance_due_date_change
  AFTER UPDATE ON public.private_bookings
  FOR EACH ROW
  WHEN (OLD.balance_due_date IS DISTINCT FROM NEW.balance_due_date)
  EXECUTE FUNCTION public.audit_balance_due_date_change();

-- 3. Corrective SMS trigger type. The full current prod list, plus
--    'balance_due_date_changed' (verified against live pg_constraint 2026-07-08).
ALTER TABLE public.private_booking_sms_queue
  DROP CONSTRAINT IF EXISTS private_booking_sms_queue_trigger_type_check;
ALTER TABLE public.private_booking_sms_queue
  ADD CONSTRAINT private_booking_sms_queue_trigger_type_check
  CHECK ((trigger_type = ANY (ARRAY[
    'status_change'::text,
    'deposit_received'::text,
    'payment_received'::text,
    'final_payment_received'::text,
    'reminder'::text,
    'payment_due'::text,
    'urgent'::text,
    'manual'::text,
    'booking_created'::text,
    'date_changed'::text,
    'balance_due_date_changed'::text,
    'booking_cancelled'::text,
    'booking_cancelled_hold'::text,
    'booking_cancelled_refundable'::text,
    'booking_cancelled_partial_refund'::text,
    'booking_cancelled_non_refundable'::text,
    'booking_cancelled_manual_review'::text,
    'booking_cancelled_retention'::text,
    'booking_cancelled_review_pending'::text,
    'booking_confirmed'::text,
    'booking_expired'::text,
    'booking_completed'::text,
    'hold_extended'::text,
    'deposit_reminder_7day'::text,
    'deposit_reminder_3day'::text,
    'deposit_reminder_1day'::text,
    'balance_reminder_21day'::text,
    'balance_reminder_16day'::text,
    'balance_reminder_15day'::text,
    'balance_reminder_due'::text,
    'balance_reminder_14day'::text,
    'balance_reminder_7day'::text,
    'balance_reminder_1day'::text,
    'event_reminder_14d'::text,
    'event_reminder_1d'::text,
    'setup_reminder'::text,
    'post_event_followup'::text,
    'review_request'::text
  ])));

-- 4. The reminders view has no consumer, uses a legacy 'tentative' status and a
--    due−3-day offset that matches no live reminder schedule. Flag it; removal
--    is a separate, explicitly-approved change.
COMMENT ON VIEW public.private_booking_sms_reminders IS
  'LEGACY / DORMANT (2026-07-08): no code consumes this view; offsets and statuses predate the SOP 14-day due-date rules. Do not build on it — candidate for removal.';
