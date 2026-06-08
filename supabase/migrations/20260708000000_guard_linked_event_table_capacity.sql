-- Prevent linked event/table booking seat updates from leaving a booking assigned
-- to tables with insufficient physical capacity.

CREATE OR REPLACE FUNCTION public.table_booking_assigned_capacity_v01(
  p_table_booking_id uuid
)
RETURNS TABLE (
  assignment_count integer,
  assigned_capacity integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(bta.table_id)::integer AS assignment_count,
    COALESCE(SUM(GREATEST(COALESCE(t.capacity, 0), 0)), 0)::integer AS assigned_capacity
  FROM public.booking_table_assignments bta
  LEFT JOIN public.tables t ON t.id = bta.table_id
  WHERE bta.table_booking_id = p_table_booking_id;
$$;

CREATE OR REPLACE FUNCTION public.table_booking_assignment_capacity_ok_v01(
  p_table_booking_id uuid,
  p_party_size integer
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_capacity RECORD;
BEGIN
  IF p_table_booking_id IS NULL OR p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN false;
  END IF;

  SELECT tb.id, tb.status
  INTO v_booking
  FROM public.table_bookings tb
  WHERE tb.id = p_table_booking_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_booking.status::text IN ('cancelled', 'no_show', 'completed') THEN
    RETURN true;
  END IF;

  SELECT *
  INTO v_capacity
  FROM public.table_booking_assigned_capacity_v01(p_table_booking_id);

  -- Unassigned active bookings are handled by the unassigned workflow. This
  -- guard only prevents assigned bookings from becoming over-capacity.
  IF COALESCE(v_capacity.assignment_count, 0) = 0 THEN
    RETURN true;
  END IF;

  RETURN COALESCE(v_capacity.assigned_capacity, 0) >= p_party_size;
END;
$$;

CREATE OR REPLACE FUNCTION public.event_booking_table_capacity_ok_v01(
  p_event_booking_id uuid,
  p_party_size integer
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table_booking RECORD;
BEGIN
  IF p_event_booking_id IS NULL OR p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN false;
  END IF;

  FOR v_table_booking IN
    SELECT tb.id
    FROM public.table_bookings tb
    WHERE tb.event_booking_id = p_event_booking_id
      AND tb.status::text NOT IN ('cancelled', 'no_show', 'completed')
  LOOP
    IF NOT public.table_booking_assignment_capacity_ok_v01(v_table_booking.id, p_party_size) THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_table_booking_assignment_capacity_v01()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_capacity RECORD;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status::text IN ('cancelled', 'no_show', 'completed') THEN
    RETURN NEW;
  END IF;

  IF NEW.party_size IS NOT DISTINCT FROM OLD.party_size
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_capacity
  FROM public.table_booking_assigned_capacity_v01(NEW.id);

  IF COALESCE(v_capacity.assignment_count, 0) > 0
     AND COALESCE(v_capacity.assigned_capacity, 0) < COALESCE(NEW.party_size, 0) THEN
    RAISE EXCEPTION 'table_booking_assigned_capacity_insufficient'
      USING
        ERRCODE = '23514',
        DETAIL = format(
          'table_booking_id=%s party_size=%s assigned_capacity=%s',
          NEW.id,
          NEW.party_size,
          COALESCE(v_capacity.assigned_capacity, 0)
        );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_table_booking_assignment_capacity_v01 ON public.table_bookings;
CREATE TRIGGER trg_enforce_table_booking_assignment_capacity_v01
  BEFORE UPDATE OF party_size, status ON public.table_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_table_booking_assignment_capacity_v01();

CREATE OR REPLACE FUNCTION public.update_event_booking_seats_v05(
  p_hashed_token text,
  p_new_seats integer,
  p_actor text DEFAULT 'guest'
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
  v_delta integer;
  v_capacity_snapshot RECORD;
BEGIN
  IF p_new_seats IS NULL OR p_new_seats < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_seats');
  END IF;

  SELECT
    gt.customer_id,
    gt.event_booking_id,
    gt.expires_at
  INTO v_token
  FROM public.guest_tokens gt
  WHERE gt.hashed_token = p_hashed_token
    AND gt.action_type = 'manage'
  FOR UPDATE;

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
    b.hold_expires_at
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = v_token.event_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  IF v_booking.customer_id <> v_token.customer_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_customer_mismatch');
  END IF;

  IF v_booking.status NOT IN ('confirmed', 'pending_payment') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'status_not_changeable');
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
  WHERE e.id = v_booking.event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    ((v_event.date::text || ' ' || v_event.time)::timestamp AT TIME ZONE 'Europe/London')
  );

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

    IF COALESCE(v_capacity_snapshot.seats_remaining, 0) < v_delta THEN
      RETURN jsonb_build_object(
        'state', 'blocked',
        'reason', 'insufficient_capacity',
        'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0),
        'requested_increase', v_delta
      );
    END IF;

    IF NOT public.event_booking_table_capacity_ok_v01(v_booking.id, p_new_seats) THEN
      RETURN jsonb_build_object(
        'state', 'blocked',
        'reason', 'table_capacity_insufficient',
        'requested_seats', p_new_seats
      );
    END IF;
  END IF;

  UPDATE public.bookings
  SET
    seats = p_new_seats,
    updated_at = v_now
  WHERE id = v_booking.id;

  IF v_booking.status = 'pending_payment' THEN
    UPDATE public.booking_holds
    SET
      seats_or_covers_held = p_new_seats,
      updated_at = v_now
    WHERE event_booking_id = v_booking.id
      AND hold_type = 'payment_hold'
      AND status = 'active';
  END IF;

  UPDATE public.table_bookings
  SET
    party_size = p_new_seats,
    committed_party_size = p_new_seats,
    hold_expires_at = CASE
      WHEN v_booking.status = 'pending_payment' THEN v_booking.hold_expires_at
      ELSE NULL
    END,
    updated_at = v_now
  WHERE event_booking_id = v_booking.id
    AND status <> 'cancelled'::public.table_booking_status;

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
    'old_seats', COALESCE(v_booking.seats, 1),
    'new_seats', p_new_seats,
    'delta', v_delta,
    'actor', COALESCE(NULLIF(TRIM(p_actor), ''), 'guest')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_event_booking_seats_staff_v05(
  p_booking_id uuid,
  p_new_seats integer,
  p_actor text DEFAULT 'staff'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_event RECORD;
  v_event_start timestamptz;
  v_now timestamptz := NOW();
  v_delta integer;
  v_capacity_snapshot RECORD;
BEGIN
  IF p_booking_id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_booking_id');
  END IF;

  IF p_new_seats IS NULL OR p_new_seats < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_seats');
  END IF;

  SELECT
    b.id,
    b.customer_id,
    b.event_id,
    b.seats,
    b.status,
    b.hold_expires_at
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

  SELECT
    e.id,
    e.name,
    e.capacity,
    e.payment_mode,
    e.price_per_seat,
    e.price,
    e.start_datetime,
    e.date,
    e.time
  INTO v_event
  FROM public.events e
  WHERE e.id = v_booking.event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    ((v_event.date::text || ' ' || v_event.time)::timestamp AT TIME ZONE 'Europe/London')
  );

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

    IF v_event.capacity IS NOT NULL
       AND (v_capacity_snapshot.seats_remaining IS NULL OR v_capacity_snapshot.seats_remaining < v_delta) THEN
      RETURN jsonb_build_object(
        'state', 'blocked',
        'reason', 'insufficient_capacity',
        'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0),
        'requested_increase', v_delta
      );
    END IF;

    IF NOT public.event_booking_table_capacity_ok_v01(v_booking.id, p_new_seats) THEN
      RETURN jsonb_build_object(
        'state', 'blocked',
        'reason', 'table_capacity_insufficient',
        'requested_seats', p_new_seats
      );
    END IF;
  END IF;

  UPDATE public.bookings
  SET
    seats = p_new_seats,
    updated_at = v_now
  WHERE id = v_booking.id;

  IF v_booking.status = 'pending_payment' THEN
    UPDATE public.booking_holds
    SET
      seats_or_covers_held = p_new_seats,
      updated_at = v_now
    WHERE event_booking_id = v_booking.id
      AND hold_type = 'payment_hold'
      AND status = 'active';
  END IF;

  UPDATE public.table_bookings
  SET
    party_size = p_new_seats,
    committed_party_size = p_new_seats,
    hold_expires_at = CASE
      WHEN v_booking.status = 'pending_payment' THEN v_booking.hold_expires_at
      ELSE NULL
    END,
    updated_at = v_now
  WHERE event_booking_id = v_booking.id
    AND status <> 'cancelled'::public.table_booking_status;

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
    'old_seats', COALESCE(v_booking.seats, 1),
    'new_seats', p_new_seats,
    'delta', v_delta,
    'actor', COALESCE(NULLIF(TRIM(p_actor), ''), 'staff')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.table_booking_assigned_capacity_v01(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.table_booking_assigned_capacity_v01(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.table_booking_assignment_capacity_ok_v01(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.table_booking_assignment_capacity_ok_v01(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.event_booking_table_capacity_ok_v01(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_booking_table_capacity_ok_v01(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.enforce_table_booking_assignment_capacity_v01() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.update_event_booking_seats_v05(text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_event_booking_seats_v05(text, integer, text) TO service_role;

REVOKE ALL ON FUNCTION public.update_event_booking_seats_staff_v05(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_event_booking_seats_staff_v05(uuid, integer, text) TO service_role;
