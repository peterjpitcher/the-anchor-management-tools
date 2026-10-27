-- Rollback for 20261027133100_event_guest_manage_link.sql: restores get_event_booking_manage_preview_v05
-- (md5(prosrc) f1a56670b57988f4e6655b39dd88524e) and update_event_booking_seats_staff_v05 (md5(prosrc)
-- 1bef4dd8c32ab580a717809d744d6ef2) exactly as production held them on 26 October 2026: SECURITY
-- DEFINER, search_path public, service_role only. After it, a seat change on a booking with named
-- guests raises attendee_count_mismatch again.

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
    b.status
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
    'can_change_seats', (v_booking.status IN ('confirmed', 'pending_payment') AND v_event_start > v_now)
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

  SELECT b.id, b.customer_id, b.event_id, b.seats, b.status, b.hold_expires_at, b.event_seating_type
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
