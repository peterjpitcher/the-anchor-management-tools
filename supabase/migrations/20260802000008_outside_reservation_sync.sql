-- Outside seating: make the held outside table follow the booking, and close the high-chair grants.
--
-- WHAT WAS WRONG
--
-- `outside_reservations` is the only record that an outside booking occupies anything. It was
-- written in exactly one place, `create_table_booking_core_v06`, and nowhere else. Every other
-- write path that can create or re-window an outside booking left it behind:
--
--   1. The FOH walk-in / management-override path inserts into `table_bookings` directly and
--      never calls the RPC, so an outside walk-in held NOTHING. The garden could be handed out
--      an unlimited number of times and availability would keep saying yes.
--   2. `move_table_booking_time_v05` re-windows `booking_table_assignments` and re-grants high
--      chairs, but not the outside reservation. A moved outside booking went on occupying the
--      time it had left and occupied nothing at the time it had moved to.
--   3. The BOH edit route re-windows the booking and its assignments, same omission.
--   4. The guest amend path changes `party_size` without re-costing `tables_reserved`, so a
--      party of 8 growing to 16 still held one outside table instead of two.
--
-- High chairs were never the problem: they are a single venue-wide pool of physical objects,
-- counted across every overlapping booking whether it sits inside or out, granted atomically
-- under one global lock, and reported per slot by availability. That half already worked. What
-- did not work was the SEAT the chair was supposed to stand next to.
--
-- THE FIX
--
-- One reconciler, `sync_outside_reservation`, derives the reservation row from the booking's own
-- current state, and a trigger runs it whenever a booking's outside flag, window or party size
-- changes. The four paths above stop needing to remember, and so does the fifth one nobody has
-- written yet. Only a raw INSERT still needs an explicit call, because of the ordering note below.
--
-- Additive. No column is dropped, no existing function signature changes, and a booking that
-- already has a correct reservation row is left exactly as it is.

BEGIN;

-- ---------------------------------------------------------------------------
-- One definition of liveness.
--
-- `count_high_chairs_in_window` predates `is_booking_live` and inlined its own copy of the
-- rule. Two copies of "does this booking still hold its resources" is how the paid-but-expired
-- hold defect got in the first time. Same behaviour, one source.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.count_high_chairs_in_window(
  p_start timestamptz, p_end timestamptz, p_exclude uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(tb.high_chair_count), 0)::integer
  FROM public.table_bookings tb
  WHERE tb.high_chair_count > 0
    AND tb.start_datetime < p_end
    AND tb.end_datetime   > p_start
    AND (p_exclude IS NULL OR tb.id <> p_exclude)
    AND public.is_booking_live(tb.status, tb.left_at, tb.hold_expires_at, tb.payment_status);
$$;

COMMENT ON FUNCTION public.count_high_chairs_in_window IS
  'High chairs granted across every live booking whose window overlaps. Deliberately blind to is_outside_seating: there are two physical chairs and they can be carried into the garden, so inside and outside draw on the same pool.';

-- ---------------------------------------------------------------------------
-- The reconciler.
--
-- Idempotent, and it NEVER blocks. A staff member re-windowing a booking into a garden that is
-- already full must not have the edit refused: the cap exists so the kitchen can pace itself and
-- so the next customer is told the truth, not to police a decision staff have already taken.
-- Recording the occupancy is what makes availability honest; refusing the edit would not.
--
-- `capacity_basis` is preserved on an existing row on purpose. It is the per-table capacity the
-- booking was taken under, and re-costing a promised booking from a later setting is exactly the
-- silent oversubscription that put the column there (review finding F-09).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_outside_reservation(p_table_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_booking      record;
  v_basis        integer;
  v_turnaround   integer;
  v_needed       integer;
BEGIN
  IF p_table_booking_id IS NULL THEN
    RETURN;
  END IF;

  SELECT tb.id, tb.is_outside_seating, tb.party_size, tb.start_datetime, tb.end_datetime
    INTO v_booking
    FROM public.table_bookings tb
   WHERE tb.id = p_table_booking_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Not outside any more, or no window to hold. An inside booking must not keep an outside
  -- table, and a row with no window cannot be costed.
  IF NOT COALESCE(v_booking.is_outside_seating, false)
     OR v_booking.start_datetime IS NULL
     OR v_booking.end_datetime IS NULL THEN
    DELETE FROM public.outside_reservations WHERE table_booking_id = p_table_booking_id;
    RETURN;
  END IF;

  SELECT r.capacity_basis INTO v_basis
    FROM public.outside_reservations r
   WHERE r.table_booking_id = p_table_booking_id;

  -- A new row is costed at today's capacity; an existing one keeps the capacity it was promised.
  v_basis := GREATEST(1, COALESCE(v_basis, public.get_setting_int('outside_table_capacity', 8)));

  -- Same derivation as create: the gap lengthens the hold, never the time quoted to the guest,
  -- and it is zero when turn times are off.
  v_turnaround := CASE
    WHEN public.get_setting_bool('turn_times_enabled', false)
      THEN GREATEST(0, public.get_setting_int('turnaround_gap_minutes', 15))
    ELSE 0
  END;

  v_needed := GREATEST(1, CEIL(GREATEST(1, COALESCE(v_booking.party_size, 1))::numeric / v_basis)::integer);

  INSERT INTO public.outside_reservations
    (table_booking_id, tables_reserved, capacity_basis, starts_at, ends_at)
  VALUES
    (p_table_booking_id, v_needed, v_basis,
     v_booking.start_datetime,
     v_booking.end_datetime + make_interval(mins => v_turnaround))
  ON CONFLICT (table_booking_id) DO UPDATE
    SET tables_reserved = EXCLUDED.tables_reserved,
        starts_at       = EXCLUDED.starts_at,
        ends_at         = EXCLUDED.ends_at,
        updated_at      = now();
END;
$$;

COMMENT ON FUNCTION public.sync_outside_reservation IS
  'Reconciles an outside booking''s held outside table from the booking row itself. Idempotent and never blocks: it records occupancy so availability tells the truth, it does not police a decision staff have already taken. Keeps the capacity_basis an existing booking was promised under.';

-- ---------------------------------------------------------------------------
-- Run it automatically.
--
-- UPDATE only, and that is deliberate. `create_table_booking_core_v06` inserts the booking and
-- then inserts the reservation row itself, with the capacity it has just checked the cap
-- against. An INSERT trigger would get there first and the RPC's own INSERT would then fail on
-- the one-row-per-booking constraint. Do not add INSERT here without changing that function too.
--
-- A raw INSERT that is not the RPC (the FOH walk-in override) therefore calls
-- `sync_outside_reservation` explicitly, exactly as it already calls `reserve_high_chairs`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_sync_outside_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.sync_outside_reservation(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS table_bookings_sync_outside_reservation ON public.table_bookings;
CREATE TRIGGER table_bookings_sync_outside_reservation
  AFTER UPDATE OF is_outside_seating, start_datetime, end_datetime, party_size
  ON public.table_bookings
  FOR EACH ROW
  WHEN (
    OLD.is_outside_seating IS DISTINCT FROM NEW.is_outside_seating
    OR OLD.start_datetime  IS DISTINCT FROM NEW.start_datetime
    OR OLD.end_datetime    IS DISTINCT FROM NEW.end_datetime
    OR OLD.party_size      IS DISTINCT FROM NEW.party_size
  )
  EXECUTE FUNCTION public.trg_sync_outside_reservation();

-- ---------------------------------------------------------------------------
-- Repair anything the gap already created.
--
-- At the time of writing production had five live future outside bookings and all five had a
-- correct reservation row, because the walk-in and edit paths simply had not been exercised
-- since v06 went on. That will not stay true between now and this migration being applied, so
-- the repair runs anyway.
--
-- MISSING rows only. Existing rows are left untouched, including the four backfilled at the
-- release with no turnaround gap: those bookings keep the promise they were made under, which
-- is the same decision 20260801000300 took.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id      uuid;
  v_repaired integer := 0;
BEGIN
  FOR v_id IN
    SELECT tb.id
      FROM public.table_bookings tb
      LEFT JOIN public.outside_reservations r ON r.table_booking_id = tb.id
     WHERE tb.is_outside_seating = true
       AND tb.booking_date >= CURRENT_DATE
       AND tb.status NOT IN ('cancelled', 'no_show')
       AND tb.start_datetime IS NOT NULL
       AND tb.end_datetime IS NOT NULL
       AND r.id IS NULL
  LOOP
    PERFORM public.sync_outside_reservation(v_id);
    v_repaired := v_repaired + 1;
  END LOOP;

  RAISE NOTICE 'outside reservation repair: % booking(s) were holding no outside table and now do', v_repaired;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants.
--
-- Supabase grants EXECUTE on a new function in `public` to `anon` and `authenticated` BY NAME.
-- `REVOKE ALL FROM PUBLIC` does not remove a grant made to a named role, which is how twenty
-- functions reached production wide open in 20260801001300.
--
-- `reserve_high_chairs` and `count_high_chairs_in_window` were created before that clean-up and
-- were not in its list, so they are still open in production today. `reserve_high_chairs` writes
-- to `table_bookings`. It is not SECURITY DEFINER, so RLS has been holding the door shut, but
-- the door should not have been reachable at all.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.sync_outside_reservation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_outside_reservation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.count_high_chairs_in_window(timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_high_chairs(uuid, integer, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sync_outside_reservation(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.count_high_chairs_in_window(timestamptz, timestamptz, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_high_chairs(uuid, integer, timestamptz, timestamptz) TO service_role;

-- A trigger function needs no EXECUTE grant: PostgreSQL checks that privilege when the trigger
-- is created, not when it fires.

-- ---------------------------------------------------------------------------
-- Prove it, rather than report success on a half-closed door.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_leaky text;
BEGIN
  SELECT string_agg(p.proname, ', ')
    INTO v_leaky
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('sync_outside_reservation', 'trg_sync_outside_reservation',
                      'count_high_chairs_in_window', 'reserve_high_chairs')
    AND array_to_string(p.proacl::text[], ' ') ~ '(anon|authenticated)=X';

  IF v_leaky IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'These functions are still executable by anon or authenticated.',
      DETAIL  = v_leaky,
      HINT    = 'REVOKE ALL FROM PUBLIC does not remove a grant made to a named role. Revoke from anon and authenticated explicitly.';
  END IF;
END;
$$;

COMMIT;
