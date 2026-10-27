-- Event bookings can be marked as a no-show, and staff can record who came from a list after the
-- night (BK-130, customer bookings review of 24 October 2026; owner decision D13).
--
-- Today an event booking has no way to say the guest did not come: bookings_status_check has no
-- 'no_show' value, so a guest who never turned up stays 'confirmed', is sent the review text and
-- counts as a visit in the promotion audience. Staff will now tick who came from a list on the
-- event page, on the night or the morning after:
--   * 'Came' writes an event_check_ins row with the new method 'staff_list', so it can be told
--     apart from a check-in made at the door (the kiosk writes 'manual') and undone if mis-ticked.
--   * 'Did not come' sets the booking to the new status 'no_show'.
-- Nothing is marked automatically. A booking nobody ticks stays as it is and reads as
-- 'not recorded', never as a no-show.
--
-- What a no_show booking gets, with no other function changed (each read from production on
-- 26 October 2026):
--   * The review cron loads only 'confirmed' bookings, so a no-show is sent no review text.
--   * get_cross_promo_audience counts confirmed, completed, visited_waiting_for_review and
--     review_clicked bookings as visits, so a no-show no longer counts as one.
--   * is_active_event_booking_for_capacity_v01 holds seats only for confirmed bookings and live
--     pending_payment holds. The app sets 'no_show' only once the event has started.
--
-- Both constraints are rebuilt in the form production prints them. Adding a value cannot fail on
-- existing rows: every row already satisfies the narrower check.
--
-- Deploy: apply before the code that writes 'no_show' or 'staff_list'. The code before it never
-- writes either value, so applying early is safe. Rollback: tasks/event-booking-no-show/rollback.sql
-- (it refuses while any row still uses a new value). Tested by
-- scripts/testing/event-booking-no-show-postgres.py.

ALTER TABLE public.bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check
  CHECK ((status = ANY (ARRAY['pending_payment'::text, 'confirmed'::text, 'cancelled'::text, 'expired'::text, 'visited_waiting_for_review'::text, 'review_clicked'::text, 'completed'::text, 'no_show'::text])));

ALTER TABLE public.event_check_ins DROP CONSTRAINT event_check_ins_check_in_method_check;
ALTER TABLE public.event_check_ins ADD CONSTRAINT event_check_ins_check_in_method_check
  CHECK (((check_in_method)::text = ANY (ARRAY[('qr'::character varying)::text, ('manual'::character varying)::text, ('auto'::character varying)::text, ('staff_list'::character varying)::text])));
