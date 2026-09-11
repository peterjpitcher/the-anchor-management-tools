-- Rollback for 20260911180000_private_booking_deposit_confirmation.sql
--
-- First switch the messaging flag private_booking_deposit_confirmation OFF: the application reads
-- these columns only while it is on, and with it off every booking behaves as it did before.
--
-- This DROPS two columns, which loses the record of who confirmed each deposit and when. It needs
-- the owner's explicit go-ahead like any column drop. No view or function reads them.
--
-- The trigger type list goes back to the one in 20260709094302 without 'deposit_request'. It is
-- re-added NOT VALID so any deposit request rows already written stay as history, while new rows
-- are checked against the old list.

SET lock_timeout = '5s';

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
  ]))) NOT VALID;

ALTER TABLE public.private_bookings
  DROP COLUMN IF EXISTS deposit_confirmed_by;
ALTER TABLE public.private_bookings
  DROP COLUMN IF EXISTS deposit_confirmed_at;
