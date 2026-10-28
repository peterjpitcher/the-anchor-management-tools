-- Rollback for release 16 of the customer bookings review (event edits, cancellations and
-- postponements). Restores production as it stood on 28 October 2026. Every part is safe to run
-- whether or not its migration was applied, and a second run is a no-op.
--
-- Parts, newest first, so run this file top to bottom:
--   3. 20261028125329_event_date_move_and_slug_history
--   2. 20261028125238_event_bookable_rules
--   1. 20261028125127_event_payment_mode_lock_and_single_line_seats
--
-- Data: part 3 drops event_slug_history and the old addresses it recorded. Nothing else here
-- touches a row. Bookings moved to a new night by move_event_seated_bookings_v01 stay where they
-- were moved; rolling back does not move them again.

-- ── Part 1 ──────────────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS zz_guard_event_payment_mode_locked ON public.events;
DROP FUNCTION IF EXISTS public.guard_event_payment_mode_locked_v01();

DO $rollback$
DECLARE
  v_oid oid;
  v_def text;
  v_new text := $new$  if v_nondefault > 0 then
    -- BK-143: a booking with one line keeps its own ticket type when the event's default type
    -- changes, and that line's quantity still follows the booking's seats.
    if (select count(*) from public.booking_items where booking_id = p_booking_id) = 1 then
      update public.booking_items
         set quantity = v_seats
       where booking_id = p_booking_id
         and quantity is distinct from v_seats;
    end if;
    return;
  end if;
$new$;
  v_old text := $old$  if v_nondefault > 0 then return; end if;
$old$;
BEGIN
  v_oid := to_regprocedure('public.sync_booking_default_item_v01(uuid)');
  IF v_oid IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position(v_new IN v_def) > 0 THEN
    EXECUTE replace(v_def, v_new, v_old);
  END IF;
END
$rollback$;

REVOKE ALL ON FUNCTION public.sync_booking_default_item_v01(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_booking_default_item_v01(uuid) TO service_role;
