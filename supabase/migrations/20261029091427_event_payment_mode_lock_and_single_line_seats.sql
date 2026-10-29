-- Event edits, cancellations and postponements, part 1: confirmations and locks (release 16 of the
-- customer bookings review of 24 October 2026: BK-027, BK-036, BK-143; owner decision D9).
--
--   * BK-027, BK-036, D9. Once an event has bookings its payment method is locked: guests who
--     booked a free night stay free, and guests who booked to pay at the door are not suddenly
--     treated as having paid online (or the other way round). The app refuses the change on every
--     screen, but the payment method also moves silently inside the database: setting every ticket
--     type to £0 makes sync_event_ticket_price_v01 mark the event free, and pricing a free night
--     makes normalize_event_pricing_v01 switch it to pay at the door. So the rule lives on the
--     events table itself. guard_event_payment_mode_locked_v01 runs BEFORE UPDATE on events,
--     after trg_normalize_event_pricing_v01 (triggers of one kind run in name order, and this one
--     is named zz_ so it sees the final row), and raises 'event_payment_mode_locked' when
--     payment_mode changes while the event has a confirmed or awaiting-payment booking that is not
--     a reminder. Price changes are not blocked: they apply to new sales only.
--   * BK-143. Taking the first ticket type off sale makes the next type the event's default. A
--     booking with one line on the old type then changed size on the booking row only:
--     sync_booking_default_item_v01 returned early for any booking with a line on a non-default
--     type, so the line kept the old quantity and the door list, charge and seat count disagreed.
--     A booking with exactly one line now has that line's quantity follow its seats, whatever its
--     type. Bookings with two or more lines are left alone, as before.
--
-- Live data this changes: none. No row is written; the trigger only refuses future updates.
-- Checked on 28 October 2026: no upcoming event has a NULL payment_mode, so no edit trips the lock
-- by normalising a missing value.
--
-- sync_booking_default_item_v01 is patched in place, as 20261027193656_table_availability_rules_agree
-- did: the live definition is read with pg_get_functiondef, the old passage is replaced, and the
-- result is executed. The block refuses to run unless the old passage appears exactly once, so a
-- definition that has moved on fails loudly instead of being half patched; a second run is a no-op.
-- CREATE OR REPLACE keeps owner, grants, SECURITY DEFINER and search_path; the grants are restated
-- at the end anyway. Body checked against production on 28 October 2026, md5(prosrc):
-- sync_booking_default_item_v01 f9bbd300f1758a817beb29bccd90ead7. The new trigger function is
-- SECURITY DEFINER so it counts every booking whoever runs the update, and nobody may call it.
--
-- Rollback: tasks/event-edits-cancel-postpone/rollback.sql. Tested by
-- scripts/testing/event-edits-cancel-postpone-postgres.py.

CREATE FUNCTION public.guard_event_payment_mode_locked_v01()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_active integer;
BEGIN
  IF NEW.payment_mode IS NOT DISTINCT FROM OLD.payment_mode THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_active
    FROM public.bookings b
   WHERE b.event_id = OLD.id
     AND b.status IN ('confirmed', 'pending_payment')
     AND COALESCE(b.is_reminder_only, false) = false;

  IF v_active > 0 THEN
    -- Owner decision D9: once tickets are sold the payment method is locked, so every guest keeps
    -- the terms they booked under. Price changes still apply, to new sales only.
    RAISE EXCEPTION 'event_payment_mode_locked'
      USING ERRCODE = 'P0001',
            DETAIL = format('event %s has %s active bookings; payment_mode %s cannot become %s', OLD.id, v_active, OLD.payment_mode, NEW.payment_mode);
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.guard_event_payment_mode_locked_v01() IS
  'Refuses a change to events.payment_mode while the event has active bookings (owner decision D9, BK-027, BK-036).';

REVOKE ALL ON FUNCTION public.guard_event_payment_mode_locked_v01() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER zz_guard_event_payment_mode_locked
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_event_payment_mode_locked_v01();

DO $patch$
DECLARE
  v_oid oid;
  v_def text;
  v_old text := $old$  if v_nondefault > 0 then return; end if;
$old$;
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
  v_old_hits integer;
  v_new_hits integer;
BEGIN
  v_oid := to_regprocedure('public.sync_booking_default_item_v01(uuid)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'event_payment_mode_lock_and_single_line_seats: sync_booking_default_item_v01(uuid) is missing';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  v_old_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  v_new_hits := (length(v_def) - length(replace(v_def, v_new, ''))) / length(v_new);

  IF v_new_hits = 1 AND v_old_hits = 0 THEN
    RAISE NOTICE 'event_payment_mode_lock_and_single_line_seats: sync_booking_default_item_v01 already patched, skipped';
  ELSIF v_old_hits <> 1 OR v_new_hits <> 0 THEN
    RAISE EXCEPTION 'event_payment_mode_lock_and_single_line_seats: sync_booking_default_item_v01 found % old and % new passages, expected 1 and 0',
      v_old_hits, v_new_hits;
  ELSE
    EXECUTE replace(v_def, v_old, v_new);
    RAISE NOTICE 'event_payment_mode_lock_and_single_line_seats: sync_booking_default_item_v01 patched';
  END IF;
END
$patch$;

-- Production's grants on 28 October 2026, restated.
REVOKE ALL ON FUNCTION public.sync_booking_default_item_v01(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_booking_default_item_v01(uuid) TO service_role;
