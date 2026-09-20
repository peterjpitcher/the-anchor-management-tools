-- Draft only. Production application requires approval of this exact SQL.
SET lock_timeout = '5s';

-- Only hashes and IDs are kept in a transaction-local table; no customer data is emitted.
CREATE TEMP TABLE event_capacity_preserved_rows(source text, id uuid, fingerprint text) ON COMMIT DROP;
DO $preserve$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bookings','table_bookings','booking_table_assignments',
    'event_communal_seat_allocations','booking_holds','booking_items','payments'] LOOP
    EXECUTE format('INSERT INTO event_capacity_preserved_rows SELECT %L, id, md5(to_jsonb(r)::text) FROM public.%I r', t, t);
  END LOOP;
END;
$preserve$;
-- Existing future communal events retain the standing allowance observed before this change.
-- No booking, payment, hold or seat-allocation row is backfilled.
DO $freeze$
DECLARE r record; v_current integer;
BEGIN
  FOR r IN SELECT * FROM (VALUES
('d81512e7-5e99-48fd-a153-3400c2f6f009'::uuid, 11),
('5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65'::uuid, 0),
('b9334958-76b4-4504-a64a-0d47145bd75e'::uuid, 11),
('6e761f65-8b17-4bc9-8a01-d032b77f6a66'::uuid, 11),
('c3ac7e18-e562-4ef8-bea7-cae29f6e96ac'::uuid, 11),
('c3e9fbbd-df4a-41f2-a1c6-8194a5979735'::uuid, 11),
('9b8f85f8-c5cc-4956-ad1f-72f569e7fc4a'::uuid, 11),
('e9e84ee8-c59b-4f93-80f6-7e7961a03240'::uuid, 11)
  ) AS frozen(id, standing) LOOP
    PERFORM 1 FROM public.events WHERE id = r.id AND booking_mode = 'communal'
      AND standing_capacity IS NULL FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'event_capacity_freeze_changed: %', r.id;
    END IF;
    SELECT s.standing_capacity INTO v_current
      FROM public.get_event_capacity_snapshot_v05(ARRAY[r.id]) s;
    IF v_current IS DISTINCT FROM r.standing THEN
      RAISE EXCEPTION 'event_capacity_freeze_changed: % expected % got %', r.id, r.standing, v_current;
    END IF;
    UPDATE public.events SET standing_capacity = r.standing WHERE id = r.id;
  END LOOP;
END;
$freeze$;

CREATE OR REPLACE FUNCTION public.event_seating_inventory_v01(
  p_start timestamptz, p_end timestamptz, p_communal boolean
) RETURNS TABLE(table_id uuid, free_seats integer)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT t.id,
    CASE WHEN NOT p_communal AND occupied.seats > 0 THEN 0
      ELSE GREATEST(t.capacity - occupied.seats, 0)::integer END
  FROM public.tables t
  CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(a.seats), 0)::integer AS seats
    FROM public.event_communal_seat_allocations a
    JOIN public.bookings b ON b.id = a.event_booking_id
    WHERE a.table_id = t.id AND a.start_datetime < p_end AND a.end_datetime > p_start
      AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
  ) occupied
  WHERE p_start IS NOT NULL AND p_end > p_start
    AND COALESCE(t.is_bookable, true) AND t.capacity > 0
    AND NOT public.is_table_blocked_by_private_booking_v05(t.id, p_start, p_end, NULL)
    AND NOT public.table_is_held(t.id, p_start, p_end, 'event', 0, true)
    AND NOT EXISTS (
      SELECT 1 FROM public.booking_table_assignments a
      JOIN public.table_bookings b ON b.id = a.table_booking_id
      WHERE a.table_id = t.id AND a.start_datetime < p_end AND a.end_datetime > p_start
        AND public.is_booking_live(b.status, b.left_at, b.hold_expires_at, b.payment_status)
    );
$function$;
REVOKE ALL ON FUNCTION public.event_seating_inventory_v01(timestamptz,timestamptz,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_seating_inventory_v01(timestamptz,timestamptz,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.get_event_capacity_snapshot_v05(p_event_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(event_id uuid, capacity integer, confirmed_seats integer, held_seats integer, seats_remaining integer, is_full boolean, seated_remaining integer, standing_remaining integer, total_remaining integer, communal_seated_capacity integer, communal_seated_reserved integer, standing_capacity integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event RECORD;
  v_start timestamptz;
  v_end timestamptz;
  v_reserved_total integer;
  v_reserved_seated integer;
  v_reserved_standing integer;
  v_waitlist_held integer;
  v_total_remaining integer;
  v_raw_seated_remaining integer;
  v_physical_seated_capacity integer;
  v_effective_seated_capacity integer;
  v_effective_standing_capacity integer;
  v_effective_total_capacity integer;
BEGIN
  FOR v_event IN
    SELECT
      e.id,
      e.capacity,
      e.seated_capacity,
      e.standing_capacity,
      COALESCE(e.booking_mode, 'table') AS booking_mode
    FROM public.events e
    WHERE p_event_ids IS NULL OR e.id = ANY(p_event_ids)
  LOOP
    SELECT
      COALESCE(SUM(COALESCE(b.seats, 0)), 0)::integer,
      COALESCE(SUM(CASE WHEN b.event_seating_type = 'standing' THEN 0 ELSE COALESCE(b.seats, 0) END), 0)::integer,
      COALESCE(SUM(CASE WHEN b.event_seating_type = 'standing' THEN COALESCE(b.seats, 0) ELSE 0 END), 0)::integer
    INTO v_reserved_total, v_reserved_seated, v_reserved_standing
    FROM public.bookings b
    WHERE b.event_id = v_event.id
      AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at);

    SELECT COALESCE(SUM(bh.seats_or_covers_held), 0)::integer
    INTO v_waitlist_held
    FROM public.booking_holds bh
    JOIN public.waitlist_offers wo ON wo.id = bh.waitlist_offer_id
    WHERE wo.event_id = v_event.id
      AND bh.status = 'active'
      AND bh.hold_type = 'waitlist_hold'
      AND bh.expires_at > now();

    v_raw_seated_remaining := NULL;
    v_physical_seated_capacity := NULL;
    v_effective_seated_capacity := NULL;
    v_effective_standing_capacity := 0;
    v_effective_total_capacity := v_event.capacity;

    IF v_event.booking_mode = 'communal' THEN
      SELECT start_datetime, end_datetime
      INTO v_start, v_end
      FROM public.event_communal_window_v01(v_event.id);

      IF v_start IS NULL OR v_end IS NULL THEN
        v_raw_seated_remaining := 0;
      ELSE
        SELECT COALESCE(SUM(i.free_seats), 0)::integer INTO v_raw_seated_remaining
        FROM public.event_seating_inventory_v01(v_start, v_end, true) i;
      END IF;

      v_physical_seated_capacity := COALESCE(v_raw_seated_remaining, 0) + v_reserved_seated;
      v_effective_seated_capacity := CASE
        WHEN v_event.seated_capacity IS NULL THEN v_physical_seated_capacity
        ELSE LEAST(GREATEST(v_event.seated_capacity, 0), v_physical_seated_capacity)
      END;
      v_effective_standing_capacity := GREATEST(COALESCE(v_event.standing_capacity, 0), 0);
      v_effective_total_capacity := v_effective_seated_capacity + v_effective_standing_capacity;
      v_total_remaining := CASE
        WHEN v_effective_total_capacity IS NULL THEN NULL
        ELSE GREATEST(v_effective_total_capacity - v_reserved_total - v_waitlist_held, 0)
      END;

      seated_remaining := CASE
        WHEN v_total_remaining IS NULL THEN GREATEST(v_effective_seated_capacity - v_reserved_seated - v_waitlist_held, 0)
        ELSE LEAST(GREATEST(v_effective_seated_capacity - v_reserved_seated - v_waitlist_held, 0), v_total_remaining)
      END;
      standing_remaining := CASE
        WHEN v_total_remaining IS NULL THEN GREATEST(v_effective_standing_capacity - v_reserved_standing, 0)
        ELSE LEAST(GREATEST(v_effective_standing_capacity - v_reserved_standing, 0), v_total_remaining)
      END;
      total_remaining := CASE
        WHEN v_total_remaining IS NULL THEN seated_remaining + standing_remaining
        ELSE v_total_remaining
      END;
      seats_remaining := total_remaining;
      communal_seated_capacity := v_effective_seated_capacity;
      communal_seated_reserved := v_reserved_seated;
      standing_capacity := v_effective_standing_capacity;
    ELSIF v_event.booking_mode IN ('table', 'mixed') THEN
      SELECT start_datetime, end_datetime INTO v_start, v_end
        FROM public.event_communal_window_v01(v_event.id);
      SELECT COALESCE(SUM(i.free_seats), 0)::integer INTO v_raw_seated_remaining
        FROM public.event_seating_inventory_v01(v_start, v_end, false) i;
      -- Whole-table bookings consume their entire table. Unused seats on an assigned
      -- table cannot be sold to another party, even when that event has spare covers.
      v_effective_total_capacity := v_reserved_total + v_raw_seated_remaining;
      seats_remaining := GREATEST(v_raw_seated_remaining - v_waitlist_held, 0);
      seated_remaining := seats_remaining;
      standing_remaining := 0;
      total_remaining := seats_remaining;
      communal_seated_capacity := NULL;
      communal_seated_reserved := 0;
      standing_capacity := 0;
    ELSE
      v_total_remaining := CASE
        WHEN v_event.capacity IS NULL THEN NULL
        ELSE GREATEST(v_event.capacity - v_reserved_total - v_waitlist_held, 0)
      END;
      seated_remaining := CASE
        WHEN v_event.capacity IS NULL THEN NULL
        ELSE v_total_remaining
      END;
      standing_remaining := 0;
      total_remaining := v_total_remaining;
      seats_remaining := v_total_remaining;
      communal_seated_capacity := NULL;
      communal_seated_reserved := 0;
      standing_capacity := 0;
    END IF;

    event_id := v_event.id;
    capacity := v_effective_total_capacity;
    confirmed_seats := v_reserved_total;
    held_seats := v_waitlist_held;
    is_full := CASE
      WHEN seats_remaining IS NULL THEN false
      ELSE seats_remaining <= 0
    END;

    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_capacity_snapshot_v05(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_capacity_snapshot_v05(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.allocate_event_communal_seats_v01(p_event_id uuid, p_event_booking_id uuid, p_seats integer, p_start_datetime timestamp with time zone, p_end_datetime timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_remaining   integer := p_seats;
  v_take integer;
  v_free integer;
  v_table       RECORD;
  v_table_names text[] := ARRAY[]::text[];
  v_table_ids   uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_seats IS NULL OR p_seats < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_seats');
  END IF;

  DELETE FROM public.event_communal_seat_allocations
  WHERE event_booking_id = p_event_booking_id;

  FOR v_table IN
    SELECT t.id, COALESCE(t.name, t.table_number) AS table_name
    FROM public.tables t
    WHERE COALESCE(t.is_bookable, true) AND t.capacity > 0
    ORDER BY t.bar_priority ASC, t.capacity ASC,
      COALESCE(NULLIF(regexp_replace(t.table_number, '\D', '', 'g'), '')::integer, 9999), t.id
    FOR UPDATE OF t
  LOOP
    EXIT WHEN v_remaining <= 0;
    -- Re-read inventory after obtaining the physical table lock.
    SELECT COALESCE(MAX(i.free_seats), 0)::integer INTO v_free
    FROM public.event_seating_inventory_v01(p_start_datetime, p_end_datetime, true) i
    WHERE i.table_id = v_table.id;
    IF v_free <= 0 THEN
      CONTINUE;
    END IF;

    v_take := LEAST(v_free, v_remaining);

    INSERT INTO public.event_communal_seat_allocations (
      event_id, event_booking_id, table_id, seats, start_datetime, end_datetime
    ) VALUES (
      p_event_id, p_event_booking_id, v_table.id, v_take, p_start_datetime, p_end_datetime
    );

    v_table_names := array_append(v_table_names, v_table.table_name);
    v_table_ids   := array_append(v_table_ids, v_table.id);
    v_remaining   := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P2001', MESSAGE = 'insufficient_seated_capacity';
  END IF;

  RETURN jsonb_build_object(
    'state', 'confirmed',
    'table_name', CASE
      WHEN cardinality(v_table_names) = 0 THEN NULL
      ELSE array_to_string(v_table_names, ' + ')
    END,
    'table_names', to_jsonb(v_table_names),
    'table_ids', to_jsonb(v_table_ids)
  );
EXCEPTION WHEN SQLSTATE 'P2001' THEN
  RETURN jsonb_build_object('state', 'blocked', 'reason', 'insufficient_seated_capacity');
END;
$function$;

REVOKE ALL ON FUNCTION public.allocate_event_communal_seats_v01(uuid,uuid,integer,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_event_communal_seats_v01(uuid,uuid,integer,timestamptz,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_event_communal_seat_allocation_v01()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking RECORD;
  v_table_capacity integer;
  v_allocated integer;
BEGIN
  IF NEW.seats < 1 THEN
    RAISE EXCEPTION 'invalid_communal_seats' USING ERRCODE = '23514';
  END IF;

  SELECT b.id, b.event_id, b.status, b.hold_expires_at, b.event_seating_type
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = NEW.event_booking_id;

  IF NOT FOUND OR v_booking.event_id IS DISTINCT FROM NEW.event_id THEN
    RAISE EXCEPTION 'event_booking_mismatch' USING ERRCODE = '23503';
  END IF;

  IF v_booking.event_seating_type <> 'seated' THEN
    RAISE EXCEPTION 'communal_allocation_requires_seated_booking' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(t.capacity, 0)
  INTO v_table_capacity
  FROM public.tables t
  WHERE t.id = NEW.table_id
    AND COALESCE(t.is_bookable, true) = true
  FOR UPDATE;

  IF NOT FOUND OR v_table_capacity < 1 THEN
    RAISE EXCEPTION 'table_not_bookable' USING ERRCODE = '23503';
  END IF;

  IF public.is_table_blocked_by_private_booking_v05(
    NEW.table_id,
    NEW.start_datetime,
    NEW.end_datetime,
    NULL
  ) THEN
    RAISE EXCEPTION 'table_assignment_private_blocked'
      USING ERRCODE = '23P01',
            DETAIL = 'table is blocked by an overlapping private booking window';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_table_assignments bta
    JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
    WHERE bta.table_id = NEW.table_id
      AND public.is_booking_live(tb.status, tb.left_at, tb.hold_expires_at, tb.payment_status)
      AND bta.start_datetime < NEW.end_datetime
      AND bta.end_datetime > NEW.start_datetime
  ) THEN
    RAISE EXCEPTION 'table_assignment_overlap'
      USING ERRCODE = '23P01',
            DETAIL = 'table already has an overlapping exclusive assignment';
  END IF;

  SELECT COALESCE(SUM(ecsa.seats), 0)::integer
  INTO v_allocated
  FROM public.event_communal_seat_allocations ecsa
  JOIN public.bookings b ON b.id = ecsa.event_booking_id
  WHERE ecsa.table_id = NEW.table_id
    AND ecsa.start_datetime < NEW.end_datetime
    AND ecsa.end_datetime > NEW.start_datetime
    AND (TG_OP <> 'UPDATE' OR ecsa.id <> NEW.id)
    AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at);

  IF v_allocated + NEW.seats > v_table_capacity THEN
    RAISE EXCEPTION 'communal_table_capacity_exceeded'
      USING ERRCODE = '23514',
            DETAIL = 'communal allocations exceed table capacity';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_event_communal_seat_allocation_v01() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_event_communal_seat_allocation_v01() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_event_booking_v05(p_event_id uuid, p_customer_id uuid, p_seats integer, p_source text DEFAULT 'brand_site'::text, p_seating_preference text DEFAULT 'seated'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event RECORD;
  v_capacity_snapshot RECORD;
  v_after_snapshot RECORD;
  v_existing_active RECORD;
  v_status text;
  v_booking_id uuid;
  v_hold_expires_at timestamptz;
  v_event_start timestamptz;
  v_event_end timestamptz;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_requested_seating text := CASE WHEN p_seating_preference = 'standing' THEN 'standing' ELSE 'seated' END;
  v_effective_seating text := 'seated';
  v_allocation jsonb := '{}'::jsonb;
BEGIN
  IF p_seats IS NULL OR p_seats < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_seats');
  END IF;

  SELECT
    e.id,
    e.name,
    e.capacity,
    e.payment_mode,
    e.booking_mode,
    e.booking_open,
    e.event_status,
    e.start_datetime,
    e.date,
    e.time,
    e.end_time,
    e.duration_minutes
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    CASE
      WHEN v_event.date IS NOT NULL AND v_event.time IS NOT NULL
        THEN ((v_event.date::text || ' ' || v_event.time::text)::timestamp AT TIME ZONE 'Europe/London')
      ELSE NULL
    END
  );

  IF v_event_start IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_datetime_missing');
  END IF;

  v_event_end := COALESCE(
    CASE
      WHEN v_event.date IS NOT NULL AND v_event.end_time IS NOT NULL
        THEN ((v_event.date::text || ' ' || v_event.end_time::text)::timestamp AT TIME ZONE 'Europe/London')
      ELSE NULL
    END,
    v_event_start + make_interval(mins => GREATEST(COALESCE(v_event.duration_minutes, 180), 30))
  );

  IF v_event_end <= v_event_start THEN
    v_event_end := v_event_end + INTERVAL '1 day';
  END IF;

  SELECT start_datetime, end_datetime
  INTO v_window_start, v_window_end
  FROM public.event_communal_window_v01(p_event_id);

  IF v_window_start IS NULL OR v_window_end IS NULL THEN
    v_window_start := v_event_start;
    v_window_end := v_event_end;
  END IF;

  IF v_event_start <= now() THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
  END IF;

  IF COALESCE(v_event.booking_open, true) = false THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_closed');
  END IF;

  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'not_bookable');
  END IF;

  SELECT b.id, b.status
  INTO v_existing_active
  FROM public.bookings b
  WHERE b.event_id = p_event_id
    AND b.customer_id = p_customer_id
    AND b.status IN ('pending_payment', 'confirmed')
  ORDER BY b.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'customer_conflict',
      'booking_id', v_existing_active.id,
      'status', v_existing_active.status
    );
  END IF;

  SELECT *
  INTO v_capacity_snapshot
  FROM public.get_event_capacity_snapshot_v05(ARRAY[p_event_id]::uuid[])
  LIMIT 1;

  IF COALESCE(v_event.booking_mode, 'table') = 'communal' THEN
    IF v_requested_seating = 'standing' THEN
      -- Only staff may choose standing while seated places remain.
      IF COALESCE(p_source, '') NOT IN ('admin', 'foh', 'walk-in')
         AND v_capacity_snapshot.seated_remaining IS DISTINCT FROM 0 THEN
        RETURN jsonb_build_object(
          'state', 'blocked', 'reason', 'standing_not_available_until_seated_full',
          'seated_remaining', v_capacity_snapshot.seated_remaining,
          'standing_remaining', v_capacity_snapshot.standing_remaining,
          'total_remaining', v_capacity_snapshot.total_remaining
        );
      END IF;

      IF COALESCE(v_capacity_snapshot.standing_capacity, 0) <= 0 THEN
        RETURN jsonb_build_object('state', 'blocked', 'reason', 'standing_capacity_not_configured');
      END IF;

      IF COALESCE(v_capacity_snapshot.standing_remaining, 0) < p_seats THEN
        RETURN jsonb_build_object(
          'state', 'full_with_waitlist_option',
          'reason', 'insufficient_capacity',
          'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0),
          'seated_remaining', COALESCE(v_capacity_snapshot.seated_remaining, 0),
          'standing_remaining', COALESCE(v_capacity_snapshot.standing_remaining, 0),
          'total_remaining', COALESCE(v_capacity_snapshot.total_remaining, 0)
        );
      END IF;

      v_effective_seating := 'standing';
    ELSE
      IF COALESCE(v_capacity_snapshot.seated_remaining, 0) >= p_seats THEN
        v_effective_seating := 'seated';
      ELSIF (COALESCE(v_capacity_snapshot.seated_remaining, 0) > 0
              OR COALESCE(v_capacity_snapshot.standing_remaining, 0) > 0) THEN
        -- The guest must review standing tickets before making a new request.
        RETURN jsonb_build_object(
          'state', 'blocked', 'reason', 'seated_capacity_changed',
          'seated_remaining', v_capacity_snapshot.seated_remaining,
          'standing_remaining', v_capacity_snapshot.standing_remaining,
          'total_remaining', v_capacity_snapshot.total_remaining
        );
      ELSE
        RETURN jsonb_build_object(
          'state', 'full_with_waitlist_option',
          'reason', 'insufficient_capacity',
          'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0),
          'seated_remaining', COALESCE(v_capacity_snapshot.seated_remaining, 0),
          'standing_remaining', COALESCE(v_capacity_snapshot.standing_remaining, 0),
          'total_remaining', COALESCE(v_capacity_snapshot.total_remaining, 0)
        );
      END IF;
    END IF;
  ELSE
    IF v_capacity_snapshot.capacity IS NOT NULL
       AND (v_capacity_snapshot.seats_remaining IS NULL OR v_capacity_snapshot.seats_remaining < p_seats) THEN
      RETURN jsonb_build_object(
        'state', 'full_with_waitlist_option',
        'reason', 'insufficient_capacity',
        'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0)
      );
    END IF;
  END IF;

  v_status := CASE
    WHEN COALESCE(v_event.payment_mode, 'free') = 'prepaid' THEN 'pending_payment'
    ELSE 'confirmed'
  END;

  IF v_status = 'pending_payment' THEN
    v_hold_expires_at := LEAST(v_event_start, now() + INTERVAL '24 hours');
    IF v_hold_expires_at <= now() THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
    END IF;
  END IF;

  INSERT INTO public.bookings (
    customer_id,
    event_id,
    seats,
    status,
    source,
    event_seating_type,
    hold_expires_at,
    created_at,
    updated_at
  ) VALUES (
    p_customer_id,
    p_event_id,
    p_seats,
    v_status,
    COALESCE(NULLIF(TRIM(p_source), ''), 'brand_site'),
    v_effective_seating,
    v_hold_expires_at,
    now(),
    now()
  )
  RETURNING id INTO v_booking_id;

  IF v_status = 'pending_payment' THEN
    INSERT INTO public.booking_holds (
      hold_type,
      event_booking_id,
      seats_or_covers_held,
      status,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      'payment_hold',
      v_booking_id,
      p_seats,
      'active',
      v_hold_expires_at,
      now(),
      now()
    );
  END IF;

  IF COALESCE(v_event.booking_mode, 'table') = 'communal' AND v_effective_seating = 'seated' THEN
    v_allocation := public.allocate_event_communal_seats_v01(
      p_event_id,
      v_booking_id,
      p_seats,
      v_window_start,
      v_window_end
    );

    IF COALESCE(v_allocation->>'state', 'blocked') <> 'confirmed' THEN
      DELETE FROM public.booking_holds WHERE event_booking_id = v_booking_id;
      DELETE FROM public.bookings WHERE id = v_booking_id;
      RETURN jsonb_build_object(
        'state', 'full_with_waitlist_option',
        'reason', COALESCE(v_allocation->>'reason', 'insufficient_seated_capacity'),
        'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0),
        'seated_remaining', COALESCE(v_capacity_snapshot.seated_remaining, 0),
        'standing_remaining', COALESCE(v_capacity_snapshot.standing_remaining, 0),
        'total_remaining', COALESCE(v_capacity_snapshot.total_remaining, 0)
      );
    END IF;
  END IF;

  IF COALESCE(v_event.booking_mode, 'table') IN ('table', 'mixed') THEN
    v_allocation := public.create_event_table_reservation_v05(
      p_event_id, v_booking_id, p_customer_id, p_seats, p_source,
      'Event booking ' || v_booking_id::text
    );
    IF COALESCE(v_allocation->>'state', 'blocked') <> 'confirmed' THEN
      RAISE EXCEPTION USING ERRCODE = 'P2002',
        MESSAGE = COALESCE(v_allocation->>'reason', 'no_table');
    END IF;
  END IF;

  SELECT *
  INTO v_after_snapshot
  FROM public.get_event_capacity_snapshot_v05(ARRAY[p_event_id]::uuid[])
  LIMIT 1;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_status = 'pending_payment' THEN 'pending_payment' ELSE 'confirmed' END,
    'booking_id', v_booking_id,
    'status', v_status,
    'payment_mode', COALESCE(v_event.payment_mode, 'free'),
    'event_id', v_event.id,
    'event_name', v_event.name,
    'event_start_datetime', v_event_start,
    'hold_expires_at', v_hold_expires_at,
    'event_seating_type', v_effective_seating,
    'seats_remaining', v_after_snapshot.seats_remaining,
    'seated_remaining', v_after_snapshot.seated_remaining,
    'standing_remaining', v_after_snapshot.standing_remaining,
    'total_remaining', v_after_snapshot.total_remaining,
    'table_booking_id', v_allocation->>'table_booking_id',
    'table_name', v_allocation->>'table_name',
    'table_names', COALESCE(v_allocation->'table_names', '[]'::jsonb),
    'table_ids', COALESCE(v_allocation->'table_ids', '[]'::jsonb)
  );
EXCEPTION
  WHEN SQLSTATE 'P2002' THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', SQLERRM);
  WHEN unique_violation THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'customer_conflict');
END;
$function$;

REVOKE ALL ON FUNCTION public.create_event_booking_v05(uuid,uuid,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_booking_v05(uuid,uuid,integer,text,text) TO service_role;

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

REVOKE ALL ON FUNCTION public.update_event_booking_seats_staff_v05(uuid,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_event_booking_seats_staff_v05(uuid,integer,text) TO service_role;

CREATE OR REPLACE FUNCTION public.create_event_transaction(p_event_data jsonb, p_faqs jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_event_id UUID;
  v_event_record JSONB;
BEGIN
  INSERT INTO events (
    name,
    date,
    time,
    capacity,
    seated_capacity,
    standing_capacity,
    category_id,
    short_description,
    long_description,
    brief,
    highlights,
    keywords,
    slug,
    meta_title,
    meta_description,
    end_time,
    duration_minutes,
    doors_time,
    last_entry_time,
    event_status,
    booking_mode,
    booking_open,
    booking_url,
    event_type,
    performer_name,
    performer_type,
    price,
    price_per_seat,
    is_free,
    payment_mode,
    start_datetime,
    hero_image_url,
    thumbnail_image_url,
    poster_image_url,
    promo_video_url,
    highlight_video_urls,
    gallery_image_urls,
    facebook_event_name,
    facebook_event_description,
    gbp_event_title,
    gbp_event_description,
    opentable_experience_title,
    opentable_experience_description,
    primary_keywords,
    secondary_keywords,
    local_seo_keywords,
    image_alt_text,
    social_copy_whatsapp,
    previous_event_summary,
    attendance_note,
    cancellation_policy,
    accessibility_notes,
    promo_sms_enabled,
    bookings_enabled
  ) VALUES (
    p_event_data->>'name',
    (p_event_data->>'date')::DATE,
    COALESCE(p_event_data->>'time', '00:00'),
    (p_event_data->>'capacity')::INTEGER,
    (p_event_data->>'seated_capacity')::INTEGER,
    (p_event_data->>'standing_capacity')::INTEGER,
    (p_event_data->>'category_id')::UUID,
    p_event_data->>'short_description',
    p_event_data->>'long_description',
    p_event_data->>'brief',
    COALESCE(p_event_data->'highlights', '[]'::JSONB),
    COALESCE(p_event_data->'keywords', '[]'::JSONB),
    p_event_data->>'slug',
    p_event_data->>'meta_title',
    p_event_data->>'meta_description',
    (p_event_data->>'end_time')::TIME,
    (p_event_data->>'duration_minutes')::INTEGER,
    (p_event_data->>'doors_time')::TIME,
    (p_event_data->>'last_entry_time')::TIME,
    COALESCE(p_event_data->>'event_status', 'scheduled'),
    COALESCE(NULLIF(p_event_data->>'booking_mode', ''), 'table'),
    COALESCE((p_event_data->>'booking_open')::BOOLEAN, true),
    p_event_data->>'booking_url',
    NULLIF(TRIM(p_event_data->>'event_type'), ''),
    p_event_data->>'performer_name',
    p_event_data->>'performer_type',
    COALESCE((p_event_data->>'price')::DECIMAL, 0),
    (p_event_data->>'price_per_seat')::NUMERIC(10,2),
    COALESCE((p_event_data->>'is_free')::BOOLEAN, false),
    COALESCE(NULLIF(p_event_data->>'payment_mode', ''), 'free'),
    (p_event_data->>'start_datetime')::TIMESTAMPTZ,
    p_event_data->>'hero_image_url',
    p_event_data->>'thumbnail_image_url',
    p_event_data->>'poster_image_url',
    p_event_data->>'promo_video_url',
    COALESCE(p_event_data->'highlight_video_urls', '[]'::JSONB),
    COALESCE(p_event_data->'gallery_image_urls', '[]'::JSONB),
    p_event_data->>'facebook_event_name',
    p_event_data->>'facebook_event_description',
    p_event_data->>'gbp_event_title',
    p_event_data->>'gbp_event_description',
    p_event_data->>'opentable_experience_title',
    p_event_data->>'opentable_experience_description',
    COALESCE(p_event_data->'primary_keywords', '[]'::JSONB),
    COALESCE(p_event_data->'secondary_keywords', '[]'::JSONB),
    COALESCE(p_event_data->'local_seo_keywords', '[]'::JSONB),
    p_event_data->>'image_alt_text',
    p_event_data->>'social_copy_whatsapp',
    p_event_data->>'previous_event_summary',
    p_event_data->>'attendance_note',
    p_event_data->>'cancellation_policy',
    p_event_data->>'accessibility_notes',
    COALESCE((p_event_data->>'promo_sms_enabled')::BOOLEAN, true),
    COALESCE((p_event_data->>'bookings_enabled')::BOOLEAN, true)
  )
  RETURNING id INTO v_event_id;

  -- Insert FAQs if provided
  IF p_faqs IS NOT NULL AND jsonb_array_length(p_faqs) > 0 THEN
    INSERT INTO event_faqs (
      event_id,
      question,
      answer,
      sort_order
    )
    SELECT
      v_event_id,
      item->>'question',
      item->>'answer',
      COALESCE((item->>'sort_order')::INTEGER, 0)
    FROM jsonb_array_elements(p_faqs) AS item;
  END IF;

  SELECT to_jsonb(e) INTO v_event_record
  FROM events e
  WHERE e.id = v_event_id;

  RETURN v_event_record;
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_event_transaction(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_transaction(jsonb,jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_event_transaction(p_event_id uuid, p_event_data jsonb, p_faqs jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_event_record JSONB;
BEGIN
  UPDATE events SET
    seated_capacity = CASE WHEN p_event_data ? 'seated_capacity' THEN (p_event_data->>'seated_capacity')::integer ELSE seated_capacity END,
    standing_capacity = CASE WHEN p_event_data ? 'standing_capacity' THEN (p_event_data->>'standing_capacity')::integer ELSE standing_capacity END,
    name              = CASE WHEN p_event_data ? 'name'              THEN COALESCE(p_event_data->>'name', name) ELSE name END,
    date              = CASE WHEN p_event_data ? 'date'              THEN COALESCE((p_event_data->>'date')::DATE, date) ELSE date END,
    time              = CASE WHEN p_event_data ? 'time'              THEN COALESCE(p_event_data->>'time', time) ELSE time END,
    capacity          = CASE WHEN p_event_data ? 'capacity'          THEN (p_event_data->>'capacity')::INTEGER ELSE capacity END,
    category_id       = CASE WHEN p_event_data ? 'category_id'       THEN (p_event_data->>'category_id')::UUID ELSE category_id END,
    short_description = CASE WHEN p_event_data ? 'short_description' THEN p_event_data->>'short_description' ELSE short_description END,
    long_description  = CASE WHEN p_event_data ? 'long_description'  THEN p_event_data->>'long_description' ELSE long_description END,
    brief             = CASE WHEN p_event_data ? 'brief'             THEN p_event_data->>'brief' ELSE brief END,
    highlights        = CASE WHEN p_event_data ? 'highlights'        THEN COALESCE(p_event_data->'highlights', highlights) ELSE highlights END,
    keywords          = CASE WHEN p_event_data ? 'keywords'          THEN COALESCE(p_event_data->'keywords', keywords) ELSE keywords END,
    slug              = CASE WHEN p_event_data ? 'slug'              THEN COALESCE(p_event_data->>'slug', slug) ELSE slug END,
    meta_title        = CASE WHEN p_event_data ? 'meta_title'        THEN p_event_data->>'meta_title' ELSE meta_title END,
    meta_description  = CASE WHEN p_event_data ? 'meta_description'  THEN p_event_data->>'meta_description' ELSE meta_description END,
    end_time          = CASE WHEN p_event_data ? 'end_time'          THEN (p_event_data->>'end_time')::TIME ELSE end_time END,
    duration_minutes  = CASE WHEN p_event_data ? 'duration_minutes'  THEN (p_event_data->>'duration_minutes')::INTEGER ELSE duration_minutes END,
    doors_time        = CASE WHEN p_event_data ? 'doors_time'        THEN (p_event_data->>'doors_time')::TIME ELSE doors_time END,
    last_entry_time   = CASE WHEN p_event_data ? 'last_entry_time'   THEN (p_event_data->>'last_entry_time')::TIME ELSE last_entry_time END,
    event_status      = CASE WHEN p_event_data ? 'event_status'      THEN COALESCE(p_event_data->>'event_status', event_status) ELSE event_status END,
    booking_mode      = CASE WHEN p_event_data ? 'booking_mode'      THEN COALESCE(NULLIF(p_event_data->>'booking_mode', ''), booking_mode) ELSE booking_mode END,
    booking_open      = CASE WHEN p_event_data ? 'booking_open'      THEN COALESCE((p_event_data->>'booking_open')::BOOLEAN, booking_open) ELSE booking_open END,
    booking_url       = CASE WHEN p_event_data ? 'booking_url'       THEN p_event_data->>'booking_url' ELSE booking_url END,
    event_type        = CASE WHEN p_event_data ? 'event_type'        THEN NULLIF(TRIM(p_event_data->>'event_type'), '') ELSE event_type END,
    performer_name    = CASE WHEN p_event_data ? 'performer_name'    THEN p_event_data->>'performer_name' ELSE performer_name END,
    performer_type    = CASE WHEN p_event_data ? 'performer_type'    THEN p_event_data->>'performer_type' ELSE performer_type END,
    price             = CASE WHEN p_event_data ? 'price'             THEN COALESCE((p_event_data->>'price')::DECIMAL, price) ELSE price END,
    price_per_seat    = CASE WHEN p_event_data ? 'price_per_seat'    THEN (p_event_data->>'price_per_seat')::NUMERIC(10,2) ELSE price_per_seat END,
    is_free           = CASE WHEN p_event_data ? 'is_free'           THEN COALESCE((p_event_data->>'is_free')::BOOLEAN, is_free) ELSE is_free END,
    payment_mode      = CASE WHEN p_event_data ? 'payment_mode'      THEN COALESCE(NULLIF(p_event_data->>'payment_mode', ''), payment_mode) ELSE payment_mode END,
    start_datetime    = CASE WHEN p_event_data ? 'start_datetime'    THEN (p_event_data->>'start_datetime')::TIMESTAMPTZ ELSE start_datetime END,
    hero_image_url    = CASE WHEN p_event_data ? 'hero_image_url'    THEN p_event_data->>'hero_image_url' ELSE hero_image_url END,
    thumbnail_image_url = CASE WHEN p_event_data ? 'thumbnail_image_url' THEN p_event_data->>'thumbnail_image_url' ELSE thumbnail_image_url END,
    poster_image_url  = CASE WHEN p_event_data ? 'poster_image_url'  THEN p_event_data->>'poster_image_url' ELSE poster_image_url END,
    promo_video_url   = CASE WHEN p_event_data ? 'promo_video_url'   THEN p_event_data->>'promo_video_url' ELSE promo_video_url END,
    highlight_video_urls = CASE WHEN p_event_data ? 'highlight_video_urls' THEN COALESCE(p_event_data->'highlight_video_urls', highlight_video_urls) ELSE highlight_video_urls END,
    gallery_image_urls   = CASE WHEN p_event_data ? 'gallery_image_urls'   THEN COALESCE(p_event_data->'gallery_image_urls', gallery_image_urls) ELSE gallery_image_urls END,
    facebook_event_name        = CASE WHEN p_event_data ? 'facebook_event_name'        THEN p_event_data->>'facebook_event_name' ELSE facebook_event_name END,
    facebook_event_description = CASE WHEN p_event_data ? 'facebook_event_description' THEN p_event_data->>'facebook_event_description' ELSE facebook_event_description END,
    gbp_event_title            = CASE WHEN p_event_data ? 'gbp_event_title'            THEN p_event_data->>'gbp_event_title' ELSE gbp_event_title END,
    gbp_event_description      = CASE WHEN p_event_data ? 'gbp_event_description'      THEN p_event_data->>'gbp_event_description' ELSE gbp_event_description END,
    opentable_experience_title       = CASE WHEN p_event_data ? 'opentable_experience_title'       THEN p_event_data->>'opentable_experience_title' ELSE opentable_experience_title END,
    opentable_experience_description = CASE WHEN p_event_data ? 'opentable_experience_description' THEN p_event_data->>'opentable_experience_description' ELSE opentable_experience_description END,
    primary_keywords   = CASE WHEN p_event_data ? 'primary_keywords'   THEN COALESCE(p_event_data->'primary_keywords', primary_keywords) ELSE primary_keywords END,
    secondary_keywords = CASE WHEN p_event_data ? 'secondary_keywords' THEN COALESCE(p_event_data->'secondary_keywords', secondary_keywords) ELSE secondary_keywords END,
    local_seo_keywords = CASE WHEN p_event_data ? 'local_seo_keywords' THEN COALESCE(p_event_data->'local_seo_keywords', local_seo_keywords) ELSE local_seo_keywords END,
    image_alt_text     = CASE WHEN p_event_data ? 'image_alt_text'     THEN p_event_data->>'image_alt_text' ELSE image_alt_text END,
    social_copy_whatsapp    = CASE WHEN p_event_data ? 'social_copy_whatsapp'    THEN p_event_data->>'social_copy_whatsapp' ELSE social_copy_whatsapp END,
    previous_event_summary  = CASE WHEN p_event_data ? 'previous_event_summary'  THEN p_event_data->>'previous_event_summary' ELSE previous_event_summary END,
    attendance_note         = CASE WHEN p_event_data ? 'attendance_note'         THEN p_event_data->>'attendance_note' ELSE attendance_note END,
    cancellation_policy     = CASE WHEN p_event_data ? 'cancellation_policy'     THEN p_event_data->>'cancellation_policy' ELSE cancellation_policy END,
    accessibility_notes     = CASE WHEN p_event_data ? 'accessibility_notes'     THEN p_event_data->>'accessibility_notes' ELSE accessibility_notes END,
    promo_sms_enabled       = CASE WHEN p_event_data ? 'promo_sms_enabled'       THEN (p_event_data->>'promo_sms_enabled')::BOOLEAN ELSE promo_sms_enabled END,
    bookings_enabled        = CASE WHEN p_event_data ? 'bookings_enabled'        THEN (p_event_data->>'bookings_enabled')::BOOLEAN ELSE bookings_enabled END
  WHERE id = p_event_id;

  -- Only touch FAQs when p_faqs IS NOT NULL (preserves existing FAQs on partial updates)
  IF p_faqs IS NOT NULL THEN
    DELETE FROM event_faqs WHERE event_id = p_event_id;

    IF jsonb_array_length(p_faqs) > 0 THEN
      INSERT INTO event_faqs (
        event_id,
        question,
        answer,
        sort_order
      )
      SELECT
        p_event_id,
        item->>'question',
        item->>'answer',
        COALESCE((item->>'sort_order')::INTEGER, 0)
      FROM jsonb_array_elements(p_faqs) AS item;
    END IF;
  END IF;

  SELECT to_jsonb(e) INTO v_event_record
  FROM events e
  WHERE e.id = p_event_id;

  RETURN v_event_record;
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_event_transaction(uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_event_transaction(uuid,jsonb,jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_event_booking_v06(p_event_id uuid, p_customer_id uuid, p_seats integer, p_source text DEFAULT 'brand_site'::text, p_seating_preference text DEFAULT 'seated'::text, p_payment_hold_minutes integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_booking_id uuid;
  v_event_start timestamptz;
  v_hold_expires_at timestamptz;
  v_minutes integer;
BEGIN
  v_result := public.create_event_booking_v05(
    p_event_id,
    p_customer_id,
    p_seats,
    p_source,
    p_seating_preference
  );

  IF COALESCE(v_result->>'state', '') <> 'pending_payment' THEN
    RETURN v_result;
  END IF;

  v_booking_id := NULLIF(v_result->>'booking_id', '')::uuid;
  v_minutes := GREATEST(1, COALESCE(p_payment_hold_minutes, 24 * 60));

  SELECT COALESCE(
    e.start_datetime,
    CASE
      WHEN e.date IS NOT NULL AND e.time IS NOT NULL
        THEN ((e.date::text || ' ' || e.time::text)::timestamp AT TIME ZONE 'Europe/London')
      ELSE NULL
    END
  )
  INTO v_event_start
  FROM public.events e
  WHERE e.id = p_event_id;

  v_hold_expires_at := LEAST(
    COALESCE(v_event_start, now() + make_interval(mins => v_minutes)),
    now() + make_interval(mins => v_minutes)
  );

  UPDATE public.bookings
  SET hold_expires_at = v_hold_expires_at, updated_at = now()
  WHERE id = v_booking_id
    AND status = 'pending_payment';

  UPDATE public.booking_holds
  SET expires_at = v_hold_expires_at, updated_at = now()
  WHERE event_booking_id = v_booking_id
    AND hold_type = 'payment_hold'
    AND status = 'active';

  UPDATE public.table_bookings SET hold_expires_at = v_hold_expires_at
  WHERE event_booking_id = v_booking_id AND status = 'pending_payment';

  RETURN jsonb_set(v_result, '{hold_expires_at}', to_jsonb(v_hold_expires_at), true);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_event_booking_v06(uuid,uuid,integer,text,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_booking_v06(uuid,uuid,integer,text,text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.create_event_booking_v08(p_event_id uuid, p_customer_id uuid, p_seats integer, p_source text, p_seating_preference text, p_payment_hold_minutes integer, p_ticket_selections jsonb, p_attendees jsonb, p_expected_total numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
 v_event record; v_attendee jsonb; v_question jsonb; v_value text; v_answers jsonb;
 v_saved jsonb := '[]'; v_names text[] := '{}'; v_result jsonb; v_booking_id uuid;
 v_type_id uuid; v_id uuid; v_ids uuid[] := '{}'; v_total integer; v_selection jsonb;
 v_required boolean; v_has_selections boolean; v_default uuid; v_total_price numeric;
BEGIN
 SELECT payment_mode,price,price_per_seat,booking_questions INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','blocked','reason','event_not_found'); END IF;
 IF p_seats IS NULL OR p_seats < 1 THEN RETURN jsonb_build_object('state','blocked','reason','invalid_seats'); END IF;
 v_has_selections := p_ticket_selections IS NOT NULL AND p_ticket_selections <> '[]'::jsonb;
 IF v_has_selections THEN
   IF jsonb_typeof(p_ticket_selections) <> 'array' THEN RAISE EXCEPTION 'invalid_ticket_selections'; END IF;
   SELECT sum((s->>'quantity')::integer) INTO v_total FROM jsonb_array_elements(p_ticket_selections) s;
   IF v_total IS DISTINCT FROM p_seats THEN RAISE EXCEPTION 'attendee_quantity_mismatch'; END IF;
   IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_ticket_selections) s WHERE coalesce((s->>'quantity')::integer,0)<1)
     OR (SELECT count(DISTINCT s->>'ticket_type_id') FROM jsonb_array_elements(p_ticket_selections) s) <> jsonb_array_length(p_ticket_selections)
   THEN RAISE EXCEPTION 'invalid_ticket_selections'; END IF;
 END IF;
 SELECT id INTO v_default FROM public.event_ticket_types WHERE event_id=p_event_id AND is_active ORDER BY sort_order,created_at,id LIMIT 1;
 v_required := coalesce(nullif(trim(p_source),''),'brand_site')='brand_site'
   AND (v_event.payment_mode='prepaid' OR jsonb_array_length(v_event.booking_questions)>0)
   AND (coalesce(v_event.price_per_seat,v_event.price,0)>0 OR EXISTS (SELECT 1 FROM public.event_ticket_types WHERE event_id=p_event_id AND is_active AND base_price>0));
 p_attendees := coalesce(p_attendees,'[]'::jsonb);
 IF jsonb_typeof(p_attendees)<>'array' THEN RAISE EXCEPTION 'invalid_attendees'; END IF;
 IF (v_required OR jsonb_array_length(p_attendees)>0) AND jsonb_array_length(p_attendees)<>p_seats THEN RAISE EXCEPTION 'attendee_count_mismatch'; END IF;
 FOR v_attendee IN SELECT value FROM jsonb_array_elements(p_attendees) LOOP
   v_id := (v_attendee->>'id')::uuid;
   IF v_id IS NULL OR v_id=ANY(v_ids) THEN RAISE EXCEPTION 'invalid_attendee_id'; END IF;
   v_ids := array_append(v_ids,v_id);
   IF length(trim(coalesce(v_attendee->>'name',''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'attendee_name_required'; END IF;
   v_type_id := coalesce(nullif(v_attendee->>'ticket_type_id','')::uuid,v_default);
   IF v_type_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.event_ticket_types WHERE id=v_type_id AND event_id=p_event_id AND is_active) THEN RAISE EXCEPTION 'invalid_attendee_ticket_type'; END IF;
   IF NOT v_has_selections AND v_type_id<>v_default THEN RAISE EXCEPTION 'invalid_attendee_ticket_type'; END IF;
   IF jsonb_typeof(coalesce(v_attendee->'answers','{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'invalid_attendee_answers'; END IF;
   IF EXISTS (SELECT 1 FROM jsonb_object_keys(coalesce(v_attendee->'answers','{}'::jsonb)) k WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_event.booking_questions) q WHERE q->>'id'=k)) THEN RAISE EXCEPTION 'unknown_attendee_question'; END IF;
   v_answers := '[]'::jsonb;
   FOR v_question IN SELECT value FROM jsonb_array_elements(v_event.booking_questions) LOOP
     v_value := trim(coalesce(v_attendee->'answers'->>(v_question->>'id'),''));
     IF length(v_value)>2000 THEN RAISE EXCEPTION 'attendee_answer_too_long'; END IF;
     IF coalesce((v_question->>'required')::boolean,false) AND v_value='' THEN RAISE EXCEPTION 'attendee_answer_required'; END IF;
     IF v_value<>'' AND v_question->>'type'='yes_no' AND v_value NOT IN ('yes','no') THEN RAISE EXCEPTION 'invalid_attendee_answer'; END IF;
     IF v_value<>'' AND v_question->>'type'='choice' AND NOT coalesce((v_question->'options') ? v_value,false) THEN RAISE EXCEPTION 'invalid_attendee_answer'; END IF;
     v_answers := v_answers || jsonb_build_array(jsonb_build_object('question_id',v_question->>'id','label',v_question->>'label','type',v_question->>'type','required',coalesce((v_question->>'required')::boolean,false),'options',coalesce(v_question->'options','[]'::jsonb),'value',v_value));
   END LOOP;
   v_saved := v_saved || jsonb_build_array(jsonb_build_object('id',v_id,'name',trim(v_attendee->>'name'),'ticket_type_id',v_type_id,'answers',v_answers));
   v_names := array_append(v_names,trim(v_attendee->>'name'));
 END LOOP;
 IF v_has_selections THEN
   IF jsonb_array_length(v_saved)>0 THEN
     FOR v_selection IN SELECT value FROM jsonb_array_elements(p_ticket_selections) LOOP
       IF (SELECT count(*) FROM jsonb_array_elements(v_saved) a WHERE a->>'ticket_type_id'=v_selection->>'ticket_type_id') <> (v_selection->>'quantity')::integer THEN RAISE EXCEPTION 'attendee_ticket_quantity_mismatch'; END IF;
     END LOOP;
   END IF;
   v_result := public.create_event_booking_v07(p_event_id,p_customer_id,p_source,p_seating_preference,p_payment_hold_minutes,p_ticket_selections);
 ELSE
   v_result := public.create_event_booking_v06(p_event_id,p_customer_id,p_seats,p_source,p_seating_preference,p_payment_hold_minutes);
 END IF;
 IF coalesce(v_result->>'state','') NOT IN ('confirmed','pending_payment') THEN RETURN v_result; END IF;
 v_booking_id := (v_result->>'booking_id')::uuid;
 IF v_booking_id IS NULL THEN RAISE EXCEPTION 'booking_creation_missing_id'; END IF;
 SELECT sum(quantity*unit_price) INTO v_total_price FROM public.booking_items WHERE booking_id=v_booking_id;
 IF p_expected_total IS NOT NULL AND v_total_price IS DISTINCT FROM p_expected_total THEN RAISE EXCEPTION 'price_changed'; END IF;
 IF v_total_price IS NULL THEN RAISE EXCEPTION 'booking_price_missing'; END IF;
 -- An explicitly free ticket basket needs no PayPal order, even when other
 -- ticket types on this event are prepaid.
 IF v_total_price=0 AND v_result->>'state'='pending_payment' THEN
   UPDATE public.bookings SET status='confirmed',hold_expires_at=NULL,updated_at=now() WHERE id=v_booking_id;
   UPDATE public.booking_holds SET status='consumed',consumed_at=now(),updated_at=now()
   WHERE event_booking_id=v_booking_id AND hold_type='payment_hold' AND status='active';
   UPDATE public.table_bookings SET status='confirmed',hold_expires_at=NULL,confirmed_at=coalesce(confirmed_at,now()),updated_at=now()
   WHERE event_booking_id=v_booking_id AND status='pending_payment';
   v_result := v_result || jsonb_build_object('state','confirmed','hold_expires_at',NULL);
 END IF;
 IF jsonb_array_length(v_saved)>0 THEN
   UPDATE public.bookings SET attendees=v_saved,attendee_names=v_names WHERE id=v_booking_id;
   UPDATE public.booking_items bi SET attendee_names=(SELECT array_agg(a->>'name') FROM jsonb_array_elements(v_saved) a WHERE (a->>'ticket_type_id')::uuid=bi.ticket_type_id) WHERE bi.booking_id=v_booking_id;
 END IF;
 RETURN v_result;
END $function$;

REVOKE ALL ON FUNCTION public.create_event_booking_v08(uuid,uuid,integer,text,text,integer,jsonb,jsonb,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_booking_v08(uuid,uuid,integer,text,text,integer,jsonb,jsonb,numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.create_event_table_reservation_v05(p_event_id uuid, p_event_booking_id uuid, p_customer_id uuid, p_party_size integer, p_source text DEFAULT 'admin'::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_full_candidate record;
  v_event RECORD;
  v_booking RECORD;

  v_event_start timestamptz;
  v_event_end timestamptz;
  v_reservation_start timestamptz;
  v_reservation_start_local timestamp without time zone;
  v_reservation_date date;
  v_reservation_time time without time zone;

  v_table_result jsonb := '{}'::jsonb;
  v_table_state text;
  v_table_booking_id uuid;

  v_current_assignment_end timestamptz;
  v_conflict_exists boolean := false;

  v_duration_minutes integer;
  v_booking_reference text;
  v_table_names text[];
  v_table_ids uuid[];

  v_note_text text;
  v_source text := COALESCE(NULLIF(TRIM(COALESCE(p_source, '')), ''), 'admin');

  v_target_status public.table_booking_status;
  v_target_hold_expires_at timestamptz;
BEGIN
  IF p_event_id IS NULL
     OR p_event_booking_id IS NULL
     OR p_customer_id IS NULL
     OR p_party_size IS NULL
     OR p_party_size < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_request');
  END IF;

  IF p_party_size > 20 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'too_large_party');
  END IF;

  SELECT
    b.id, b.customer_id, b.event_id, b.status, b.seats, b.hold_expires_at
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_event_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  IF v_booking.event_id IS DISTINCT FROM p_event_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_mismatch');
  END IF;

  IF v_booking.customer_id IS DISTINCT FROM p_customer_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'customer_mismatch');
  END IF;

  IF v_booking.status NOT IN ('confirmed', 'pending_payment') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_active');
  END IF;

  SELECT
    e.id, e.name, e.booking_mode, e.booking_open, e.event_status,
    e.start_datetime, e.date, e.time, e.end_time, e.duration_minutes
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  IF COALESCE(v_event.booking_open, true) = false THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_closed');
  END IF;

  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'not_bookable');
  END IF;

  IF COALESCE(v_event.booking_mode, 'table') = 'general' THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_general_entry_only');
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    CASE
      WHEN v_event.date IS NOT NULL AND v_event.time IS NOT NULL
        THEN ((v_event.date::text || ' ' || v_event.time::text)::timestamp AT TIME ZONE 'Europe/London')
      ELSE NULL
    END
  );

  IF v_event_start IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_datetime_missing');
  END IF;

  IF v_event_start <= NOW() THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
  END IF;

  v_event_end := COALESCE(
    CASE
      WHEN v_event.date IS NOT NULL AND v_event.end_time IS NOT NULL
        THEN ((v_event.date::text || ' ' || v_event.end_time::text)::timestamp AT TIME ZONE 'Europe/London')
      ELSE NULL
    END,
    v_event_start + make_interval(mins => GREATEST(COALESCE(v_event.duration_minutes, 180), 30))
  );

  IF v_event_end <= v_event_start THEN
    v_event_end := v_event_end + INTERVAL '1 day';
  END IF;

  v_reservation_start := v_event_start - INTERVAL '15 minutes';
  IF v_reservation_start <= NOW() THEN
    v_reservation_start := v_event_start;
  END IF;

  v_reservation_start_local := v_reservation_start AT TIME ZONE 'Europe/London';
  v_reservation_date := v_reservation_start_local::date;
  v_reservation_time := v_reservation_start_local::time without time zone;

  v_note_text := concat_ws(
    ' · ',
    CASE WHEN COALESCE(v_event.name, '') = '' THEN NULL ELSE 'Event: ' || v_event.name END,
    NULLIF(TRIM(COALESCE(p_notes, '')), '')
  );

  IF v_booking.status = 'pending_payment' THEN
    v_target_status := 'pending_payment'::public.table_booking_status;
    v_target_hold_expires_at := v_booking.hold_expires_at;
  ELSE
    v_target_status := 'confirmed'::public.table_booking_status;
    v_target_hold_expires_at := NULL;
  END IF;

  SELECT tb.id
  INTO v_table_booking_id
  FROM public.table_bookings tb
  WHERE tb.event_booking_id = p_event_booking_id
    AND tb.status <> 'cancelled'::public.table_booking_status
  ORDER BY tb.created_at DESC NULLS LAST
  LIMIT 1
  FOR UPDATE;

  IF v_table_booking_id IS NOT NULL THEN
    UPDATE public.table_bookings
    SET
      party_size = p_party_size,
      committed_party_size = p_party_size,
      status = CASE
        WHEN tb.status IN ('no_show'::public.table_booking_status, 'completed'::public.table_booking_status)
          THEN tb.status
        ELSE v_target_status
      END,
      confirmed_at = CASE
        WHEN v_target_status = 'confirmed'::public.table_booking_status
          THEN COALESCE(tb.confirmed_at, NOW())
        WHEN tb.status IN ('no_show'::public.table_booking_status, 'completed'::public.table_booking_status)
          THEN tb.confirmed_at
        ELSE NULL
      END,
      hold_expires_at = CASE
        WHEN tb.status IN ('no_show'::public.table_booking_status, 'completed'::public.table_booking_status)
          THEN tb.hold_expires_at
        ELSE v_target_hold_expires_at
      END,
      source = v_source,
      booking_type = 'regular'::public.table_booking_type,
      booking_purpose = 'drinks',
      special_requirements = COALESCE(v_note_text, tb.special_requirements),
      event_id = p_event_id,
      event_booking_id = p_event_booking_id,
      updated_at = NOW()
    FROM public.table_bookings tb
    WHERE public.table_bookings.id = v_table_booking_id
      AND tb.id = v_table_booking_id;

    IF v_target_status = 'confirmed'::public.table_booking_status AND p_party_size < 15 THEN
      PERFORM public.neutralise_under10_table_deposit_state_v01(
        v_table_booking_id,
        'event_table_reservation_confirmed_under10_existing'
      );
    END IF;

    SELECT tb.booking_reference, tb.start_datetime, tb.end_datetime
    INTO v_booking_reference, v_reservation_start, v_event_end
    FROM public.table_bookings tb
    WHERE tb.id = v_table_booking_id;

    SELECT
      array_agg(COALESCE(t.name, t.table_number) ORDER BY COALESCE(t.table_number, t.name)),
      array_agg(t.id ORDER BY COALESCE(t.table_number, t.name))
    INTO v_table_names, v_table_ids
    FROM public.booking_table_assignments bta
    JOIN public.tables t ON t.id = bta.table_id
    WHERE bta.table_booking_id = v_table_booking_id;

    RETURN jsonb_build_object(
      'state', 'confirmed',
      'table_booking_id', v_table_booking_id,
      'booking_reference', v_booking_reference,
      'table_name', CASE
        WHEN v_table_names IS NULL OR cardinality(v_table_names) = 0 THEN NULL
        ELSE array_to_string(v_table_names, ' + ')
      END,
      'table_names', to_jsonb(COALESCE(v_table_names, ARRAY[]::text[])),
      'table_ids', to_jsonb(COALESCE(v_table_ids, ARRAY[]::uuid[])),
      'start_datetime', v_reservation_start,
      'end_datetime', v_event_end,
      'table_booking_status', (SELECT status::text FROM public.table_bookings WHERE id = v_table_booking_id),
      'hold_expires_at', (SELECT hold_expires_at FROM public.table_bookings WHERE id = v_table_booking_id)
    );
  END IF;

  BEGIN
    IF to_regprocedure('public.create_table_booking_v05_core(uuid,date,time without time zone,integer,text,text,boolean,text)') IS NOT NULL THEN
      v_table_result := public.create_table_booking_v05_core(
        p_customer_id, v_reservation_date, v_reservation_time,
        p_party_size, 'drinks', v_note_text, false, v_source
      );
    ELSE
      v_table_result := public.create_table_booking_v05(
        p_customer_id, v_reservation_date, v_reservation_time,
        p_party_size, 'drinks', v_note_text, false, v_source
      );
    END IF;

    v_table_state := COALESCE(v_table_result->>'state', 'blocked');
    IF v_table_state NOT IN ('confirmed', 'pending_payment') THEN
      RETURN jsonb_build_object(
        'state', 'blocked',
        'reason', COALESCE(v_table_result->>'reason', 'no_table')
      );
    END IF;

    v_table_booking_id := NULLIF(v_table_result->>'table_booking_id', '')::uuid;
    IF v_table_booking_id IS NULL THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_table');
    END IF;

    -- The ordinary core reserves its standard duration. Re-select against the full
    -- event window before committing, excluding only this newly-created booking.
    SELECT c.* INTO v_full_candidate
    FROM public.find_table_allocation_candidates(
      v_reservation_start, v_event_end, p_party_size, 'drinks', 0, false,
      NULL, 'event', v_table_booking_id
    ) c WHERE c.reason_code IS NULL ORDER BY c.rank LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no_table' USING ERRCODE = 'P2004';
    END IF;
    DELETE FROM public.booking_table_assignments WHERE table_booking_id = v_table_booking_id;
    INSERT INTO public.booking_table_assignments(table_booking_id, table_id, start_datetime, end_datetime)
    SELECT v_table_booking_id, chosen.id, v_reservation_start, v_event_end
      FROM unnest(v_full_candidate.table_ids) AS chosen(id) ORDER BY chosen.id;

    UPDATE public.booking_holds
    SET status = 'released',
        released_at = NOW(),
        updated_at = NOW()
    WHERE table_booking_id = v_table_booking_id
      AND hold_type = 'payment_hold'
      AND status = 'active';

    UPDATE public.table_bookings
    SET status = v_target_status,
        confirmed_at = CASE
          WHEN v_target_status = 'confirmed'::public.table_booking_status THEN COALESCE(confirmed_at, NOW())
          ELSE NULL
        END,
        hold_expires_at = v_target_hold_expires_at,
        source = v_source,
        booking_type = 'regular'::public.table_booking_type,
        booking_purpose = 'drinks',
        special_requirements = COALESCE(v_note_text, special_requirements),
        event_id = p_event_id,
        event_booking_id = p_event_booking_id,
        party_size = p_party_size,
        committed_party_size = p_party_size,
        updated_at = NOW()
    WHERE id = v_table_booking_id;

    SELECT MAX(end_datetime)
    INTO v_current_assignment_end
    FROM public.booking_table_assignments
    WHERE table_booking_id = v_table_booking_id;

    IF v_current_assignment_end IS NULL THEN
      v_current_assignment_end := v_reservation_start;
    END IF;

    IF v_event_end > v_current_assignment_end THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.booking_table_assignments current_bta
        JOIN public.booking_table_assignments other_bta
          ON other_bta.table_id = current_bta.table_id
        JOIN public.table_bookings other_tb
          ON other_tb.id = other_bta.table_booking_id
        WHERE current_bta.table_booking_id = v_table_booking_id
          AND other_bta.table_booking_id <> v_table_booking_id
          AND other_tb.status NOT IN ('cancelled'::public.table_booking_status, 'no_show'::public.table_booking_status)
          AND other_tb.left_at IS NULL
          AND other_bta.start_datetime < v_event_end
          AND other_bta.end_datetime > v_current_assignment_end
      ) INTO v_conflict_exists;

      IF v_conflict_exists THEN
        DELETE FROM public.table_bookings WHERE id = v_table_booking_id;
        RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_table');
      END IF;
    END IF;

    v_duration_minutes := GREATEST(
      30,
      CEIL(EXTRACT(EPOCH FROM (v_event_end - v_reservation_start)) / 60.0)::integer
    );

    UPDATE public.booking_table_assignments
    SET start_datetime = v_reservation_start,
        end_datetime = v_event_end
    WHERE table_booking_id = v_table_booking_id;

    UPDATE public.table_bookings
    SET booking_date = v_reservation_date,
        booking_time = v_reservation_time,
        start_datetime = v_reservation_start,
        end_datetime = v_event_end,
        duration_minutes = v_duration_minutes,
        updated_at = NOW()
    WHERE id = v_table_booking_id;

    IF v_target_status = 'confirmed'::public.table_booking_status AND p_party_size < 15 THEN
      PERFORM public.neutralise_under10_table_deposit_state_v01(
        v_table_booking_id,
        'event_table_reservation_confirmed_under10_new'
      );
    END IF;

    SELECT booking_reference INTO v_booking_reference
    FROM public.table_bookings WHERE id = v_table_booking_id;

    SELECT
      array_agg(COALESCE(t.name, t.table_number) ORDER BY COALESCE(t.table_number, t.name)),
      array_agg(t.id ORDER BY COALESCE(t.table_number, t.name))
    INTO v_table_names, v_table_ids
    FROM public.booking_table_assignments bta
    JOIN public.tables t ON t.id = bta.table_id
    WHERE bta.table_booking_id = v_table_booking_id;

    RETURN jsonb_build_object(
      'state', 'confirmed',
      'table_booking_id', v_table_booking_id,
      'booking_reference', v_booking_reference,
      'table_name', CASE
        WHEN v_table_names IS NULL OR cardinality(v_table_names) = 0 THEN NULL
        ELSE array_to_string(v_table_names, ' + ')
      END,
      'table_names', to_jsonb(COALESCE(v_table_names, ARRAY[]::text[])),
      'table_ids', to_jsonb(COALESCE(v_table_ids, ARRAY[]::uuid[])),
      'start_datetime', v_reservation_start,
      'end_datetime', v_event_end,
      'table_booking_status', (SELECT status::text FROM public.table_bookings WHERE id = v_table_booking_id),
      'hold_expires_at', (SELECT hold_expires_at FROM public.table_bookings WHERE id = v_table_booking_id)
    );
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_table');
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_event_table_reservation_v05(uuid,uuid,uuid,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_table_reservation_v05(uuid,uuid,uuid,integer,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.accept_waitlist_offer_v05(p_hashed_token text, p_source text DEFAULT 'brand_site'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_token RECORD;
  v_offer RECORD;
  v_event RECORD;
  v_capacity_snapshot RECORD;
  v_booking_id uuid;
  v_booking_status text;
  v_hold_expires_at timestamptz;
  v_event_start timestamptz;
  v_table_result jsonb := '{}'::jsonb;
  v_table_state text := 'blocked';
BEGIN
  SELECT
    gt.id,
    gt.customer_id,
    gt.waitlist_offer_id,
    gt.expires_at,
    gt.consumed_at
  INTO v_token
  FROM public.guest_tokens gt
  WHERE gt.hashed_token = p_hashed_token
    AND gt.action_type = 'waitlist_offer'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_token');
  END IF;

  IF v_token.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_used');
  END IF;

  IF v_token.expires_at <= NOW() THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_expired');
  END IF;

  SELECT
    wo.id,
    wo.event_id,
    wo.customer_id,
    wo.seats_held,
    wo.status,
    wo.expires_at
  INTO v_offer
  FROM public.waitlist_offers wo
  WHERE wo.id = v_token.waitlist_offer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'offer_not_found');
  END IF;

  IF v_offer.customer_id <> v_token.customer_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_customer_mismatch');
  END IF;

  IF v_offer.status <> 'sent' THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'offer_unavailable');
  END IF;

  IF v_offer.expires_at <= NOW() THEN
    UPDATE public.waitlist_offers
    SET status = 'expired', expired_at = NOW()
    WHERE id = v_offer.id;

    UPDATE public.booking_holds
    SET status = 'expired', released_at = NOW(), updated_at = NOW()
    WHERE waitlist_offer_id = v_offer.id
      AND status = 'active';

    UPDATE public.waitlist_entries
    SET status = 'expired', expired_at = NOW(), updated_at = NOW()
    WHERE id = (SELECT waitlist_entry_id FROM public.waitlist_offers WHERE id = v_offer.id)
      AND status = 'offered';

    RETURN jsonb_build_object('state', 'blocked', 'reason', 'offer_expired');
  END IF;

  SELECT
    e.id,
    e.name,
    e.payment_mode,
    e.start_datetime,
    e.date,
    e.time,
    e.booking_open,
    e.event_status,
    e.booking_mode
  INTO v_event
  FROM public.events e
  WHERE e.id = v_offer.event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    ((v_event.date::text || ' ' || v_event.time)::timestamp AT TIME ZONE 'Europe/London')
  );

  IF v_event_start IS NULL OR v_event_start <= NOW() THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
  END IF;

  IF COALESCE(v_event.booking_open, true) = false THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_closed');
  END IF;

  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'not_bookable');
  END IF;

  -- Convert this offer's own hold before checking availability. The enclosing
  -- exception block restores it byte for byte if physical booking creation fails.
  UPDATE public.booking_holds SET status = 'consumed', consumed_at = now(), updated_at = now()
  WHERE waitlist_offer_id = v_offer.id AND status = 'active';
  v_result := public.create_event_booking_v06(
    v_offer.event_id, v_offer.customer_id, v_offer.seats_held,
    COALESCE(NULLIF(TRIM(p_source), ''), 'brand_site'), 'seated', NULL
  );
  IF COALESCE(v_result->>'state', 'blocked') NOT IN ('confirmed', 'pending_payment') THEN
    RAISE EXCEPTION USING ERRCODE = 'P2005',
      MESSAGE = COALESCE(v_result->>'reason', 'capacity_unavailable');
  END IF;
  v_booking_id := (v_result->>'booking_id')::uuid;
  v_booking_status := v_result->>'status';
  v_hold_expires_at := (v_result->>'hold_expires_at')::timestamptz;

  UPDATE public.waitlist_offers
  SET status = 'accepted', accepted_at = NOW()
  WHERE id = v_offer.id;

  UPDATE public.waitlist_entries
  SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
  WHERE id = (SELECT waitlist_entry_id FROM public.waitlist_offers WHERE id = v_offer.id);

  UPDATE public.booking_holds
  SET status = 'consumed', consumed_at = NOW(), updated_at = NOW()
  WHERE waitlist_offer_id = v_offer.id
    AND status = 'active';

  UPDATE public.guest_tokens
  SET consumed_at = NOW()
  WHERE id = v_token.id;

  RETURN v_result;
EXCEPTION WHEN SQLSTATE 'P2005' THEN
  RETURN jsonb_build_object('state', 'blocked', 'reason', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_waitlist_offer_v05(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_waitlist_offer_v05(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.create_next_waitlist_offer_v05(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_available integer;
  v_start timestamptz;
  v_end timestamptz;
  v_event RECORD;
  v_capacity_snapshot RECORD;
  v_entry RECORD;
  v_offer_id uuid;
  v_hold_id uuid;
  v_scheduled_sms_send_time timestamptz := NOW();
  v_expires_at timestamptz;
  v_event_start timestamptz;
BEGIN
  SELECT
    e.id,
    e.capacity,
    e.booking_mode,
    e.start_datetime,
    e.date,
    e.time,
    e.booking_open,
    e.event_status
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    ((v_event.date::text || ' ' || v_event.time)::timestamp AT TIME ZONE 'Europe/London')
  );

  IF v_event_start IS NULL OR v_event_start <= NOW() THEN
    RETURN jsonb_build_object('state', 'none', 'reason', 'event_started');
  END IF;

  IF COALESCE(v_event.booking_open, true) = false THEN
    RETURN jsonb_build_object('state', 'none', 'reason', 'booking_closed');
  END IF;

  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft') THEN
    RETURN jsonb_build_object('state', 'none', 'reason', 'not_bookable');
  END IF;

  SELECT *
  INTO v_capacity_snapshot
  FROM public.get_event_capacity_snapshot_v05(ARRAY[p_event_id]::uuid[])
  LIMIT 1;

  v_available := CASE WHEN v_event.booking_mode = 'communal'
    THEN COALESCE(v_capacity_snapshot.seated_remaining, 0)
    ELSE COALESCE(v_capacity_snapshot.seats_remaining, 2147483647) END;
  SELECT start_datetime, end_datetime INTO v_start, v_end
    FROM public.event_communal_window_v01(p_event_id);
  IF v_available < 1 THEN
    RETURN jsonb_build_object('state', 'none', 'reason', 'no_capacity');
  END IF;

  SELECT
    we.id,
    we.customer_id,
    we.requested_seats
  INTO v_entry
  FROM public.waitlist_entries we
  WHERE we.event_id = p_event_id
    AND we.status = 'queued'
    AND we.requested_seats <= v_available
    AND (COALESCE(v_event.booking_mode, 'table') NOT IN ('table', 'mixed') OR EXISTS (
      SELECT 1 FROM public.find_table_allocation_candidates(
        v_start, v_end, we.requested_seats, 'drinks', 0, false, NULL, 'event'
      ) c WHERE c.reason_code IS NULL
    ))
  ORDER BY we.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'none', 'reason', 'no_eligible_waitlist_entry');
  END IF;

  v_expires_at := LEAST(v_event_start, v_scheduled_sms_send_time + INTERVAL '24 hours');

  INSERT INTO public.waitlist_offers (
    waitlist_entry_id,
    event_id,
    customer_id,
    seats_held,
    status,
    scheduled_sms_send_time,
    expires_at,
    created_at
  ) VALUES (
    v_entry.id,
    p_event_id,
    v_entry.customer_id,
    v_entry.requested_seats,
    'sent',
    v_scheduled_sms_send_time,
    v_expires_at,
    NOW()
  )
  RETURNING id INTO v_offer_id;

  INSERT INTO public.booking_holds (
    hold_type,
    waitlist_offer_id,
    seats_or_covers_held,
    status,
    scheduled_sms_send_time,
    expires_at,
    created_at,
    updated_at
  ) VALUES (
    'waitlist_hold',
    v_offer_id,
    v_entry.requested_seats,
    'active',
    v_scheduled_sms_send_time,
    v_expires_at,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_hold_id;

  UPDATE public.waitlist_entries
  SET
    status = 'offered',
    offered_at = NOW(),
    updated_at = NOW()
  WHERE id = v_entry.id;

  RETURN jsonb_build_object(
    'state', 'offered',
    'waitlist_offer_id', v_offer_id,
    'waitlist_entry_id', v_entry.id,
    'hold_id', v_hold_id,
    'event_id', p_event_id,
    'customer_id', v_entry.customer_id,
    'requested_seats', v_entry.requested_seats,
    'scheduled_sms_send_time', v_scheduled_sms_send_time,
    'expires_at', v_expires_at,
    'event_start_datetime', v_event_start
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_next_waitlist_offer_v05(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_next_waitlist_offer_v05(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_event_physical_capacity_v01()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_standing integer;
BEGIN
  IF COALESCE(NEW.booking_mode, 'table') IS DISTINCT FROM COALESCE(OLD.booking_mode, 'table')
    AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.event_id = OLD.id
      AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)) THEN
    RAISE EXCEPTION 'event_mode_has_active_bookings' USING ERRCODE = '23514';
  END IF;
  IF NEW.standing_capacity IS DISTINCT FROM OLD.standing_capacity THEN
    SELECT COALESCE(SUM(b.seats), 0)::integer INTO v_standing FROM public.bookings b
    WHERE b.event_id = OLD.id AND b.event_seating_type = 'standing'
      AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at);
    IF COALESCE(NEW.standing_capacity, 0) < v_standing THEN
      RAISE EXCEPTION 'standing_capacity_below_bookings' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_event_physical_capacity_v01() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_event_physical_capacity_v01() TO service_role;
CREATE TRIGGER guard_event_physical_capacity
BEFORE UPDATE OF booking_mode, standing_capacity ON public.events
FOR EACH ROW EXECUTE FUNCTION public.guard_event_physical_capacity_v01();
-- A concurrent edit also aborts safely. Newly created rows are deliberately ignored.
DO $preserve$
DECLARE t text; changed boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['bookings','table_bookings','booking_table_assignments',
    'event_communal_seat_allocations','booking_holds','booking_items','payments'] LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM event_capacity_preserved_rows old LEFT JOIN public.%I r ON r.id=old.id WHERE old.source=%L AND (r.id IS NULL OR old.fingerprint IS DISTINCT FROM md5(to_jsonb(r)::text)))', t, t)
      INTO changed;
    IF changed THEN RAISE EXCEPTION 'event_capacity_existing_rows_changed: %', t; END IF;
  END LOOP;
END;
$preserve$;
