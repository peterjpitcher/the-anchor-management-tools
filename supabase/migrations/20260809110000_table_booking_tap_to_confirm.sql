-- Tap-to-confirm for table bookings.
--
-- WHY: 21% of table bookings in the last ninety days never happened. 52 cancelled and
-- 12 no-shows out of 308, and every single no-show originated on the website. Nothing
-- currently chases them. A guest who taps "yes, we'll be there" the day before is a
-- guest who turns up; a guest who does not tap is a name on a call list for the pub to
-- ring, which is how The Anchor already handles an incomplete pre-order.
--
-- THIS MIGRATION DOES NOT CANCEL ANYTHING. There is deliberately no auto-release here.
-- Twelve no-shows in ninety days is not worth wrongly cancelling one real booking, so
-- the confirm SMS ships first and runs long enough to show a tap rate. Auto-release is
-- a separate decision the owner has not been asked to make yet.

BEGIN;

-- 1. The guest's answer, recorded on the booking itself.
--
-- Three states, and the third is the point: confirmed (tapped yes), declined (tapped
-- no, which is a cancellation the guest can make without ringing), and NULL meaning
-- "asked, no answer". NULL plus a sent reminder is the call list.
ALTER TABLE public.table_bookings
  ADD COLUMN IF NOT EXISTS guest_confirmed_at timestamptz;

COMMENT ON COLUMN public.table_bookings.guest_confirmed_at IS
  'When the guest tapped the confirm link in the 24h reminder. NULL after a reminder was sent means no answer: that booking belongs on the staff call list, not in an automatic cancellation.';

-- 2. The ledger, which IS the idempotency.
--
-- Same shape and the same reasoning as booking_preorder_reminders: the row is claimed
-- BEFORE anything is sent, so two crons racing or one cron running twice both lose at
-- the database and send nothing. One reminder per booking, ever. A claimed row is never
-- rolled back on a failed send, because deleting it to retry turns an ambiguous failure
-- (SMS delivered, log write did not) into a second text to the guest.
CREATE TABLE IF NOT EXISTS public.table_booking_confirm_reminders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_booking_id uuid NOT NULL REFERENCES public.table_bookings(id) ON DELETE CASCADE,
  sent_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT table_booking_confirm_reminders_once UNIQUE (table_booking_id)
);

ALTER TABLE public.table_booking_confirm_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.table_booking_confirm_reminders FROM anon, authenticated;
GRANT ALL ON public.table_booking_confirm_reminders TO service_role;

-- 3. The token action type.
--
-- Rebuilt from the LIVE constraint rather than from any migration, because
-- 20260508000007 deliberately left 'card_capture' in place for two live rows while
-- removing the feature, so a definition reconstructed from the feature history would
-- silently drop it and fail on those rows.
ALTER TABLE public.guest_tokens DROP CONSTRAINT IF EXISTS guest_tokens_action_type_check;
ALTER TABLE public.guest_tokens ADD CONSTRAINT guest_tokens_action_type_check CHECK (
  action_type = ANY (ARRAY[
    'manage'::text,
    'sunday_preorder'::text,
    'card_capture'::text,
    'payment'::text,
    'review_redirect'::text,
    'charge_approval'::text,
    'waitlist_offer'::text,
    'private_feedback'::text,
    'private_booking_outcome'::text,
    'booking_confirm'::text
  ])
);

-- 4. The staff call list.
--
-- A view rather than a query in the UI, so "who has not answered" has exactly one
-- definition and the dashboard and any future report cannot drift apart. Bookings are
-- listed once the reminder has gone out and the guest has neither confirmed nor
-- cancelled, for bookings still in the future.
CREATE OR REPLACE VIEW public.table_bookings_awaiting_confirmation AS
SELECT
  tb.id,
  tb.booking_reference,
  tb.booking_date,
  tb.booking_time,
  tb.party_size,
  tb.customer_id,
  r.sent_at AS reminder_sent_at
FROM public.table_bookings tb
JOIN public.table_booking_confirm_reminders r ON r.table_booking_id = tb.id
WHERE tb.status = 'confirmed'
  AND tb.guest_confirmed_at IS NULL
  AND (tb.booking_date + COALESCE(tb.booking_time, '00:00'::time)) >= now() AT TIME ZONE 'Europe/London';

COMMENT ON VIEW public.table_bookings_awaiting_confirmation IS
  'Bookings that were sent a 24h confirm reminder and have not answered. This is a call list for staff. It is NOT a cancellation queue: nothing in the system acts on this view automatically.';

COMMIT;
