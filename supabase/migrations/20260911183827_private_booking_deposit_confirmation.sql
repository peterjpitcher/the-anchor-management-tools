-- Private booking deposits confirmed by staff (owner decision, 11 September 2026).
--
-- Production target: tfcasgxopxegwrabvwat. Draft only until separately approved.
--
-- Order: apply this BEFORE switching on the messaging flag private_booking_deposit_confirmation.
-- The application reads these columns only while that flag is on, so deploying the code first is
-- safe; switching the flag on first is not (the reminder and expiry crons would fail closed and
-- the Confirm deposit action would refuse, both with a logged error).
--
-- What it changes:
--   A. private_bookings.deposit_confirmed_at / deposit_confirmed_by: when, and by whom, the
--      deposit amount was confirmed to the guest. NULL means "deposit to be confirmed": the guest
--      has not been told a deposit, so no deposit reminder, automatic hold expiry or hold-lapsed
--      message may go.
--   B. private_booking_sms_queue.trigger_type accepts 'deposit_request', the one message the
--      Confirm deposit action sends, for the text version used when the guest has no usable
--      email address.
--
-- No new table, view or function: nothing changes for the anon role, and no view reads these
-- columns (private_bookings_with_details keeps its explicit column list).

SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- A. Deposit confirmation columns
-- ---------------------------------------------------------------------------

-- Every booking that exists when this runs counts as confirmed, so each one carries on exactly as
-- it does today (its guest was told the deposit when it was created, under the old rules). Adding
-- the column with a non-volatile default stores that value for the existing rows without an
-- UPDATE: no table rewrite, and no row trigger fires (update_private_bookings_updated_at would
-- otherwise move updated_at on every booking). Dropping the default straight after means every
-- row inserted from now on starts as NULL, "to be confirmed", until the application records a
-- confirmation. The existing rows keep the time of this migration and no confirmer.
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS deposit_confirmed_at timestamptz DEFAULT now();
ALTER TABLE public.private_bookings
  ALTER COLUMN deposit_confirmed_at DROP DEFAULT;

ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS deposit_confirmed_by uuid;

COMMENT ON COLUMN public.private_bookings.deposit_confirmed_at IS
  'When staff confirmed the deposit amount and the deposit request went to the guest. NULL = deposit to be confirmed: no deposit reminders, no automatic hold expiry, no hold-lapsed message (read only while messaging flag private_booking_deposit_confirmation is on). Rows that existed on 2026-09-11 carry the migration time and no confirmer.';
COMMENT ON COLUMN public.private_bookings.deposit_confirmed_by IS
  'The staff user who confirmed the deposit (auth user id). NULL for bookings confirmed before 2026-09-11, and for bookings created through the API while the flag was off.';

-- ---------------------------------------------------------------------------
-- B. Text queue trigger type for the deposit request
-- ---------------------------------------------------------------------------

-- The list is the one in 20260709094302_pb_due_date_consistency.sql (verified then against the
-- live pg_constraint) plus 'deposit_request'. Before applying, compare it with
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'private_booking_sms_queue_trigger_type_check';
-- on production: a value live but missing here would make the ADD CONSTRAINT fail, which aborts
-- the whole migration and leaves the table as it was.
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
    'deposit_request'::text,
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
