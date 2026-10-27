-- The guest manage link stops offering a seat change that always fails for named guests (BK-022,
-- customer bookings review of 24 October 2026).
--
-- Every paid website booking now carries a named guest per ticket. The manage page still offered
-- "Change seats", and a reduction ran update_event_booking_seats_staff_v05, which changes
-- bookings.seats alone, so guard_booking_attendee_count raised attendee_count_mismatch and the
-- guest saw "This booking cannot be changed using this link" with the form still on screen. The
-- staff and FOH party-size screens reach the same function and failed the same way.
--
--   * get_event_booking_manage_preview_v05 returns can_change_seats false for a booking with
--     named guests, and says why: has_named_guests true, seat_change_blocked_reason
--     'guest_details_locked'. Every other key is unchanged.
--   * update_event_booking_seats_staff_v05 returns {state: blocked, reason: guest_details_locked}
--     for a change in size on such a booking, instead of raising. Same seats still returns
--     'unchanged'; bookings without named guests behave exactly as before. The guest wrapper
--     update_event_booking_seats_v05 calls it and passes the answer through, so it needs no
--     change.
--
-- Both bodies are production's text (get_event_booking_manage_preview_v05 md5
-- f1a56670b57988f4e6655b39dd88524e, the text in 20260420000007; update_event_booking_seats_staff_v05
-- md5 1bef4dd8c32ab580a717809d744d6ef2, the text in 20260921074304; both checked 26 October 2026)
-- with only those changes. Their headers, SECURITY DEFINER, search_path and grants (service_role
-- only) are restated as production holds them.
--
-- Deploy order: this migration first, then the app. The app handles both the old raise and the
-- new answer, so it works on either side of the migration.
-- Rollback: tasks/event-guest-manage-link/rollback.sql. Tested by
-- scripts/testing/event-guest-manage-link-postgres.py.

CREATE OR REPLACE FUNCTION public.get_event_booking_manage_preview_v05(
  p_hashed_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token RECORD;
  v_booking RECORD;
  v_event RECORD;
  v_event_start timestamptz;
  v_now timestamptz := NOW();
BEGIN
  SELECT
    gt.customer_id,
    gt.event_booking_id,
    gt.expires_at,
    gt.consumed_at
  INTO v_token
  FROM public.guest_tokens gt
  WHERE gt.hashed_token = p_hashed_token
    AND gt.action_type = 'manage'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_token');
  END IF;

  IF v_token.expires_at <= v_now THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_expired');
  END IF;

  IF v_token.event_booking_id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  SELECT
    b.id,
    b.customer_id,
    b.event_id,
    b.seats,
    b.status,
    -- BK-022: a booking whose tickets carry named guests cannot change size here.
    (jsonb_array_length(COALESCE(b.attendees, '[]'::jsonb)) > 0) AS has_named_guests
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = v_token.event_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  IF v_booking.customer_id <> v_token.customer_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_customer_mismatch');
  END IF;

  SELECT
    e.id,
    e.name,
    e.payment_mode,
    e.price_per_seat,
    e.price,
    e.start_datetime,
    e.date,
    e.time
  INTO v_event
  FROM public.events e
  WHERE e.id = v_booking.event_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    ((v_event.date::text || ' ' || v_event.time)::timestamp AT TIME ZONE 'Europe/London')
  );

  RETURN jsonb_build_object(
    'state', 'ready',
    'booking_id', v_booking.id,
    'customer_id', v_booking.customer_id,
    'event_id', v_event.id,
    'event_name', v_event.name,
    'event_start_datetime', v_event_start,
    'status', v_booking.status,
    'seats', COALESCE(v_booking.seats, 1),
    'payment_mode', COALESCE(v_event.payment_mode, 'free'),
    'price_per_seat', COALESCE(v_event.price_per_seat, v_event.price, 0),
    'can_cancel', (v_booking.status IN ('confirmed', 'pending_payment') AND v_event_start > v_now),
    'can_change_seats', (v_booking.status IN ('confirmed', 'pending_payment') AND v_event_start > v_now AND NOT v_booking.has_named_guests),
    'has_named_guests', v_booking.has_named_guests,
    'seat_change_blocked_reason', CASE WHEN v_booking.has_named_guests THEN 'guest_details_locked' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_event_booking_seats_staff_v05(p_booking_id uuid, p_new_seats integer, p_actor text DEFAULT 'staff'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking RECORD;
  v_event RECORD;
  v_event_start timestamptz;
  v_now timestamptz := now();
  v_delta integer;
  v_capacity_snapshot RECORD;
  v_allocated_current integer;
  v_allocation jsonb;
BEGIN
  IF p_booking_id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_booking_id');
  END IF;

  IF p_new_seats IS NULL OR p_new_seats < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_seats');
  END IF;

  -- Match creation's event-before-booking lock order.
  PERFORM 1 FROM public.events e
  WHERE e.id = (SELECT b.event_id FROM public.bookings b WHERE b.id = p_booking_id) FOR UPDATE;

  SELECT b.id, b.customer_id, b.event_id, b.seats, b.status, b.hold_expires_at, b.event_seating_type,
    jsonb_array_length(COALESCE(b.attendees, '[]'::jsonb)) AS named_guests
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  IF v_booking.status NOT IN ('confirmed', 'pending_payment') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'status_not_changeable');
  END IF;

  -- BK-022: each ticket on this booking carries a named guest, so its size changes guest by
  -- guest, not here. guard_booking_attendee_count used to raise attendee_count_mismatch, which
  -- every caller showed as an internal error.
  IF v_booking.named_guests > 0 AND p_new_seats IS DISTINCT FROM COALESCE(v_booking.seats, 1) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'guest_details_locked');
  END IF;

  SELECT e.id, e.name, e.capacity, e.booking_mode, e.payment_mode, e.price_per_seat, e.price, e.start_datetime, e.date, e.time
  INTO v_event
  FROM public.events e
  WHERE e.id = v_booking.event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  v_event_start := COALESCE(v_event.start_datetime, ((v_event.date::text || ' ' || v_event.time)::timestamp AT TIME ZONE 'Europe/London'));

  IF v_event_start IS NULL OR v_event_start <= v_now THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
  END IF;

  v_delta := p_new_seats - COALESCE(v_booking.seats, 1);

  IF v_delta = 0 THEN
    RETURN jsonb_build_object(
      'state', 'unchanged',
      'booking_id', v_booking.id,
      'customer_id', v_booking.customer_id,
      'event_id', v_event.id,
      'event_name', v_event.name,
      'event_start_datetime', v_event_start,
      'status', v_booking.status,
      'payment_mode', COALESCE(v_event.payment_mode, 'free'),
      'price_per_seat', COALESCE(v_event.price_per_seat, v_event.price, 0),
      'event_seating_type', v_booking.event_seating_type,
      'old_seats', COALESCE(v_booking.seats, 1),
      'new_seats', COALESCE(v_booking.seats, 1),
      'delta', 0
    );
  END IF;

  IF v_delta > 0 THEN
    SELECT *
    INTO v_capacity_snapshot
    FROM public.get_event_capacity_snapshot_v05(ARRAY[v_event.id]::uuid[])
    LIMIT 1;

    IF COALESCE(v_event.booking_mode, 'table') = 'communal' THEN
      IF COALESCE(v_capacity_snapshot.total_remaining, 0) < v_delta THEN
        RETURN jsonb_build_object('state', 'blocked', 'reason', 'insufficient_capacity', 'seats_remaining', COALESCE(v_capacity_snapshot.total_remaining, 0), 'requested_increase', v_delta);
      END IF;

      IF v_booking.event_seating_type = 'standing' AND COALESCE(v_capacity_snapshot.standing_capacity, 0) <= 0 THEN
        RETURN jsonb_build_object('state', 'blocked', 'reason', 'standing_capacity_not_configured');
      END IF;

      IF v_booking.event_seating_type = 'standing' AND COALESCE(v_capacity_snapshot.standing_remaining, 0) < v_delta THEN
        RETURN jsonb_build_object('state', 'blocked', 'reason', 'insufficient_standing_capacity', 'standing_remaining', COALESCE(v_capacity_snapshot.standing_remaining, 0), 'requested_increase', v_delta);
      END IF;

      IF v_booking.event_seating_type = 'seated' AND COALESCE(v_capacity_snapshot.seated_remaining, 0) < v_delta THEN
        RETURN jsonb_build_object('state', 'blocked', 'reason', 'insufficient_seated_capacity', 'seated_remaining', COALESCE(v_capacity_snapshot.seated_remaining, 0), 'requested_increase', v_delta);
      END IF;
    ELSIF COALESCE(v_event.booking_mode, 'table') IN ('table', 'mixed') THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.table_bookings tb
        JOIN public.booking_table_assignments a ON a.table_booking_id = tb.id
        WHERE tb.event_booking_id = v_booking.id
          AND public.is_booking_live(tb.status, tb.left_at, tb.hold_expires_at, tb.payment_status)
      ) OR NOT public.event_booking_table_capacity_ok_v01(v_booking.id, p_new_seats) THEN
        RETURN jsonb_build_object('state', 'blocked', 'reason', 'table_capacity_insufficient');
      END IF;
    ELSIF v_event.capacity IS NOT NULL
       AND (v_capacity_snapshot.seats_remaining IS NULL OR v_capacity_snapshot.seats_remaining < v_delta) THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'insufficient_capacity', 'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0), 'requested_increase', v_delta);
    END IF;
  END IF;

  UPDATE public.bookings
  SET seats = p_new_seats, updated_at = v_now
  WHERE id = v_booking.id;

  IF COALESCE(v_event.booking_mode, 'table') = 'communal' THEN
    v_allocation := public.reallocate_event_communal_booking_v01(v_booking.id, p_new_seats);
    IF COALESCE(v_allocation->>'state', 'blocked') <> 'confirmed' THEN
      RAISE EXCEPTION USING ERRCODE = 'P2003',
        MESSAGE = COALESCE(v_allocation->>'reason', 'insufficient_seated_capacity');
    END IF;
  ELSE
    UPDATE public.table_bookings
    SET party_size = p_new_seats,
        committed_party_size = p_new_seats,
        hold_expires_at = CASE WHEN v_booking.status = 'pending_payment' THEN v_booking.hold_expires_at ELSE NULL END,
        updated_at = v_now
    WHERE event_booking_id = v_booking.id
      AND status <> 'cancelled'::public.table_booking_status;
  END IF;

  IF v_booking.status = 'pending_payment' THEN
    UPDATE public.booking_holds
    SET seats_or_covers_held = p_new_seats, updated_at = v_now
    WHERE event_booking_id = v_booking.id
      AND hold_type = 'payment_hold'
      AND status = 'active';
  END IF;

  RETURN jsonb_build_object(
    'state', 'updated',
    'booking_id', v_booking.id,
    'customer_id', v_booking.customer_id,
    'event_id', v_event.id,
    'event_name', v_event.name,
    'event_start_datetime', v_event_start,
    'status', v_booking.status,
    'payment_mode', COALESCE(v_event.payment_mode, 'free'),
    'price_per_seat', COALESCE(v_event.price_per_seat, v_event.price, 0),
    'event_seating_type', v_booking.event_seating_type,
    'old_seats', COALESCE(v_booking.seats, 1),
    'new_seats', p_new_seats,
    'delta', v_delta,
    'actor', COALESCE(NULLIF(TRIM(p_actor), ''), 'staff')
  );
EXCEPTION WHEN SQLSTATE 'P2003' THEN
  RETURN jsonb_build_object('state', 'blocked', 'reason', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_booking_manage_preview_v05(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_booking_manage_preview_v05(text) TO service_role;
REVOKE ALL ON FUNCTION public.update_event_booking_seats_staff_v05(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_event_booking_seats_staff_v05(uuid, integer, text) TO service_role;

-- Prove it: both still SECURITY DEFINER with search_path public, and service_role only.
DO $$
DECLARE
  v_fn regprocedure;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.get_event_booking_manage_preview_v05(text)'::regprocedure, 'public.update_event_booking_seats_staff_v05(uuid, integer, text)'::regprocedure]
  LOOP
    IF NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc WHERE oid = v_fn) THEN
      RAISE EXCEPTION '% lost SECURITY DEFINER or its search_path', v_fn;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% is executable by anon or authenticated', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% is not executable by service_role', v_fn;
    END IF;
  END LOOP;
END;
$$;
