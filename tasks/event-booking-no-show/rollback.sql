-- Rollback for supabase/migrations/20261027133352_event_booking_no_show.sql.
-- Restores both constraints exactly as production printed them on 26 October 2026.
-- It refuses while any row still uses a new value: a no-show booking or a check-in ticked from the
-- staff list would break the narrower check. Decide those rows first (for example, set no-show
-- bookings back to 'confirmed' and staff-list check-ins to 'manual'), then run this.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bookings WHERE status = 'no_show') THEN
    RAISE EXCEPTION 'Rollback refused: some event bookings are marked no_show. Move them back first.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_check_ins WHERE check_in_method = 'staff_list') THEN
    RAISE EXCEPTION 'Rollback refused: some check-ins were ticked from the staff list. Move them back first.';
  END IF;
END $$;

ALTER TABLE public.bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check
  CHECK ((status = ANY (ARRAY['pending_payment'::text, 'confirmed'::text, 'cancelled'::text, 'expired'::text, 'visited_waiting_for_review'::text, 'review_clicked'::text, 'completed'::text])));

ALTER TABLE public.event_check_ins DROP CONSTRAINT event_check_ins_check_in_method_check;
ALTER TABLE public.event_check_ins ADD CONSTRAINT event_check_ins_check_in_method_check
  CHECK (((check_in_method)::text = ANY (ARRAY[('qr'::character varying)::text, ('manual'::character varying)::text, ('auto'::character varying)::text])));
