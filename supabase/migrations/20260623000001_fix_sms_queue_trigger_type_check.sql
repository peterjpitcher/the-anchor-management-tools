-- Fix CHECK constraint on private_booking_sms_queue.trigger_type
--
-- The constraint was missing several trigger types added after the original
-- migration: hold_extended, balance_reminder_7day, balance_reminder_1day,
-- post_event_followup, review_request, and the four cancellation variants.
-- This caused silent insert failures for those SMS types.

BEGIN;

ALTER TABLE private_booking_sms_queue
  DROP CONSTRAINT private_booking_sms_queue_trigger_type_check;

ALTER TABLE private_booking_sms_queue
  ADD CONSTRAINT private_booking_sms_queue_trigger_type_check
  CHECK (trigger_type = ANY (ARRAY[
    'status_change',
    'deposit_received',
    'payment_received',
    'final_payment_received',
    'reminder',
    'payment_due',
    'urgent',
    'manual',
    'booking_created',
    'date_changed',
    'booking_cancelled',
    'booking_cancelled_hold',
    'booking_cancelled_refundable',
    'booking_cancelled_non_refundable',
    'booking_cancelled_manual_review',
    'booking_confirmed',
    'booking_expired',
    'booking_completed',
    'hold_extended',
    'deposit_reminder_7day',
    'deposit_reminder_1day',
    'balance_reminder_14day',
    'balance_reminder_7day',
    'balance_reminder_1day',
    'event_reminder_14d',
    'event_reminder_1d',
    'setup_reminder',
    'post_event_followup',
    'review_request'
  ]));

COMMIT;
