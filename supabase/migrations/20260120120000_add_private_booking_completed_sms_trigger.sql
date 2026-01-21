-- Allow post-event thank-you SMS trigger for private bookings
ALTER TABLE "public"."private_booking_sms_queue" DROP CONSTRAINT IF EXISTS "private_booking_sms_queue_trigger_type_check";

ALTER TABLE "public"."private_booking_sms_queue"
ADD CONSTRAINT "private_booking_sms_queue_trigger_type_check"
CHECK (("trigger_type" = ANY (ARRAY[
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
  'booking_cancelled'::text,
  'booking_confirmed'::text,
  'booking_expired'::text,
  'event_reminder_14d'::text,
  'event_reminder_1d'::text,
  'balance_reminder'::text,
  'setup_reminder'::text,
  'deposit_reminder_7day'::text,
  'deposit_reminder_1day'::text,
  'balance_reminder_14day'::text,
  'booking_completed'::text
])));
