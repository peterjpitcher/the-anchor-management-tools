-- Add communal event seating with standing ticket support.

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_booking_mode_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_booking_mode_check
  CHECK (booking_mode IN ('table', 'general', 'mixed', 'communal'));

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS seated_capacity integer,
  ADD COLUMN IF NOT EXISTS standing_capacity integer;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_seated_capacity_check,
  DROP CONSTRAINT IF EXISTS events_standing_capacity_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_seated_capacity_check
  CHECK (seated_capacity IS NULL OR seated_capacity >= 0),
  ADD CONSTRAINT events_standing_capacity_check
  CHECK (standing_capacity IS NULL OR standing_capacity >= 0);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS event_seating_type text NOT NULL DEFAULT 'seated';

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_event_seating_type_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_event_seating_type_check
  CHECK (event_seating_type IN ('seated', 'standing'));

CREATE TABLE IF NOT EXISTS public.event_communal_seat_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  event_booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  table_booking_id uuid REFERENCES public.table_bookings(id) ON DELETE SET NULL,
  table_id uuid NOT NULL REFERENCES public.tables(id),
  seats integer NOT NULL CHECK (seats > 0),
  start_datetime timestamptz NOT NULL,
  end_datetime timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_communal_allocations_window_check CHECK (end_datetime > start_datetime)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_communal_alloc_booking_table
  ON public.event_communal_seat_allocations(event_booking_id, table_id);

CREATE INDEX IF NOT EXISTS idx_event_communal_alloc_event_window
  ON public.event_communal_seat_allocations(event_id, start_datetime, end_datetime);

CREATE INDEX IF NOT EXISTS idx_event_communal_alloc_table_window
  ON public.event_communal_seat_allocations(table_id, start_datetime, end_datetime);

CREATE OR REPLACE FUNCTION public.is_active_event_booking_for_capacity_v01(
  p_status text,
  p_hold_expires_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    p_status = 'confirmed'
    OR (
      p_status = 'pending_payment'
      AND (p_hold_expires_at IS NULL OR p_hold_expires_at > now())
    );
$$;

CREATE OR REPLACE FUNCTION public.event_communal_window_v01(
  p_event_id uuid,
  OUT start_datetime timestamptz,
  OUT end_datetime timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
BEGIN
  SELECT e.start_datetime, e.date, e.time, e.end_time, e.duration_minutes
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id;

  start_datetime := COALESCE(
    v_event.start_datetime,
    CASE
      WHEN v_event.date IS NOT NULL AND v_event.time IS NOT NULL
        THEN ((v_event.date::text || ' ' || v_event.time::text)::timestamp AT TIME ZONE 'Europe/London')
      ELSE NULL
    END
  );

  IF start_datetime IS NULL THEN
    end_datetime := NULL;
    RETURN;
  END IF;

  end_datetime := COALESCE(
    CASE
      WHEN v_event.date IS NOT NULL AND v_event.end_time IS NOT NULL
        THEN ((v_event.date::text || ' ' || v_event.end_time::text)::timestamp AT TIME ZONE 'Europe/London')
      ELSE NULL
    END,
    start_datetime + make_interval(mins => GREATEST(COALESCE(v_event.duration_minutes, 180), 30))
  );

  IF end_datetime <= start_datetime THEN
    end_datetime := end_datetime + INTERVAL '1 day';
  END IF;

  start_datetime := CASE
    WHEN start_datetime - INTERVAL '15 minutes' <= now() THEN start_datetime
    ELSE start_datetime - INTERVAL '15 minutes'
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_event_communal_seat_allocation_v01()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      AND tb.status NOT IN ('cancelled'::public.table_booking_status, 'no_show'::public.table_booking_status)
      AND tb.left_at IS NULL
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
$$;

DROP TRIGGER IF EXISTS trg_enforce_event_communal_seat_allocation_v01 ON public.event_communal_seat_allocations;
CREATE TRIGGER trg_enforce_event_communal_seat_allocation_v01
  BEFORE INSERT OR UPDATE ON public.event_communal_seat_allocations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_event_communal_seat_allocation_v01();

CREATE OR REPLACE FUNCTION public.enforce_booking_table_assignment_integrity_v05()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.tables t
    WHERE t.id = NEW.table_id
  ) INTO v_table_exists;

  IF NOT v_table_exists THEN
    RAISE EXCEPTION 'table_not_found'
      USING ERRCODE = '23503';
  END IF;

  PERFORM 1
  FROM public.tables t
  WHERE t.id = NEW.table_id
  FOR UPDATE;

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
      AND tb.status NOT IN ('cancelled'::public.table_booking_status, 'no_show'::public.table_booking_status)
      AND tb.left_at IS NULL
      AND bta.start_datetime < NEW.end_datetime
      AND bta.end_datetime > NEW.start_datetime
      AND (TG_OP <> 'UPDATE' OR bta.id <> NEW.id)
  ) THEN
    RAISE EXCEPTION 'table_assignment_overlap'
      USING ERRCODE = '23P01',
            DETAIL = 'table already has an overlapping active assignment';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.event_communal_seat_allocations ecsa
    JOIN public.bookings b ON b.id = ecsa.event_booking_id
    WHERE ecsa.table_id = NEW.table_id
      AND ecsa.start_datetime < NEW.end_datetime
      AND ecsa.end_datetime > NEW.start_datetime
      AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
  ) THEN
    RAISE EXCEPTION 'table_assignment_communal_overlap'
      USING ERRCODE = '23P01',
            DETAIL = 'table already has communal seated guests for this window';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_booking_table_assignment_integrity_v05 ON public.booking_table_assignments;
CREATE TRIGGER trg_enforce_booking_table_assignment_integrity_v05
  BEFORE INSERT OR UPDATE ON public.booking_table_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_booking_table_assignment_integrity_v05();

CREATE OR REPLACE FUNCTION public.allocate_event_communal_seats_v01(
  p_event_id uuid,
  p_event_booking_id uuid,
  p_seats integer,
  p_start_datetime timestamptz,
  p_end_datetime timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining integer := p_seats;
  v_take integer;
  v_table RECORD;
  v_table_names text[] := ARRAY[]::text[];
  v_table_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_seats IS NULL OR p_seats < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_seats');
  END IF;

  DELETE FROM public.event_communal_seat_allocations
  WHERE event_booking_id = p_event_booking_id;

  FOR v_table IN
    SELECT
      t.id,
      COALESCE(t.name, t.table_number) AS table_name,
      GREATEST(
        COALESCE(t.capacity, 0)
        - CASE WHEN EXISTS (
            SELECT 1
            FROM public.booking_table_assignments bta
            JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
            WHERE bta.table_id = t.id
              AND tb.status NOT IN ('cancelled'::public.table_booking_status, 'no_show'::public.table_booking_status)
              AND tb.left_at IS NULL
              AND bta.start_datetime < p_end_datetime
              AND bta.end_datetime > p_start_datetime
          ) THEN COALESCE(t.capacity, 0) ELSE 0 END
        - COALESCE((
            SELECT SUM(ecsa.seats)
            FROM public.event_communal_seat_allocations ecsa
            JOIN public.bookings b ON b.id = ecsa.event_booking_id
            WHERE ecsa.table_id = t.id
              AND ecsa.start_datetime < p_end_datetime
              AND ecsa.end_datetime > p_start_datetime
              AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
          ), 0),
        0
      )::integer AS free_seats
    FROM public.tables t
    WHERE COALESCE(t.is_bookable, true) = true
      AND COALESCE(t.capacity, 0) > 0
      AND NOT public.is_table_blocked_by_private_booking_v05(t.id, p_start_datetime, p_end_datetime, NULL)
    ORDER BY t.capacity ASC, COALESCE(t.table_number, t.name) ASC
    FOR UPDATE OF t
  LOOP
    EXIT WHEN v_remaining <= 0;
    IF v_table.free_seats <= 0 THEN
      CONTINUE;
    END IF;

    v_take := LEAST(v_table.free_seats, v_remaining);

    INSERT INTO public.event_communal_seat_allocations (
      event_id,
      event_booking_id,
      table_id,
      seats,
      start_datetime,
      end_datetime
    ) VALUES (
      p_event_id,
      p_event_booking_id,
      v_table.id,
      v_take,
      p_start_datetime,
      p_end_datetime
    );

    v_table_names := array_append(v_table_names, v_table.table_name);
    v_table_ids := array_append(v_table_ids, v_table.id);
    v_remaining := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0 THEN
    DELETE FROM public.event_communal_seat_allocations
    WHERE event_booking_id = p_event_booking_id;

    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'insufficient_seated_capacity',
      'unallocated_seats', v_remaining
    );
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
END;
$$;

DROP FUNCTION IF EXISTS public.get_event_capacity_snapshot_v05(uuid[]);

CREATE OR REPLACE FUNCTION public.get_event_capacity_snapshot_v05(p_event_ids uuid[] DEFAULT NULL)
RETURNS TABLE (
  event_id uuid,
  capacity integer,
  confirmed_seats integer,
  held_seats integer,
  seats_remaining integer,
  is_full boolean,
  seated_remaining integer,
  standing_remaining integer,
  total_remaining integer,
  communal_seated_capacity integer,
  communal_seated_reserved integer,
  standing_capacity integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
        SELECT COALESCE(SUM(free_seats), 0)::integer
        INTO v_raw_seated_remaining
        FROM (
          SELECT
            GREATEST(
              COALESCE(t.capacity, 0)
              - CASE WHEN EXISTS (
                  SELECT 1
                  FROM public.booking_table_assignments bta
                  JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
                  WHERE bta.table_id = t.id
                    AND tb.status NOT IN ('cancelled'::public.table_booking_status, 'no_show'::public.table_booking_status)
                    AND tb.left_at IS NULL
                    AND bta.start_datetime < v_end
                    AND bta.end_datetime > v_start
                ) THEN COALESCE(t.capacity, 0) ELSE 0 END
              - COALESCE((
                  SELECT SUM(ecsa.seats)
                  FROM public.event_communal_seat_allocations ecsa
                  JOIN public.bookings b ON b.id = ecsa.event_booking_id
                  WHERE ecsa.table_id = t.id
                    AND ecsa.start_datetime < v_end
                    AND ecsa.end_datetime > v_start
                    AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
                ), 0),
              0
            )::integer AS free_seats
          FROM public.tables t
          WHERE COALESCE(t.is_bookable, true) = true
            AND COALESCE(t.capacity, 0) > 0
            AND NOT public.is_table_blocked_by_private_booking_v05(t.id, v_start, v_end, NULL)
        ) availability;
      END IF;

      v_physical_seated_capacity := COALESCE(v_raw_seated_remaining, 0) + v_reserved_seated;
      v_effective_seated_capacity := CASE
        WHEN v_event.seated_capacity IS NULL THEN v_physical_seated_capacity
        ELSE LEAST(GREATEST(v_event.seated_capacity, 0), v_physical_seated_capacity)
      END;
      v_effective_standing_capacity := CASE
        WHEN v_event.standing_capacity IS NULL THEN
          CASE
            WHEN v_event.capacity IS NULL THEN 0
            ELSE GREATEST(v_event.capacity - v_effective_seated_capacity, 0)
          END
        ELSE GREATEST(v_event.standing_capacity, 0)
      END;
      v_effective_total_capacity := CASE
        WHEN v_event.seated_capacity IS NOT NULL OR v_event.standing_capacity IS NOT NULL THEN
          v_effective_seated_capacity + v_effective_standing_capacity
        ELSE v_event.capacity
      END;
      v_total_remaining := CASE
        WHEN v_effective_total_capacity IS NULL THEN NULL
        ELSE GREATEST(v_effective_total_capacity - v_reserved_total - v_waitlist_held, 0)
      END;

      seated_remaining := CASE
        WHEN v_total_remaining IS NULL THEN GREATEST(v_effective_seated_capacity - v_reserved_seated, 0)
        ELSE LEAST(GREATEST(v_effective_seated_capacity - v_reserved_seated, 0), v_total_remaining)
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
$$;

DROP FUNCTION IF EXISTS public.create_event_booking_v05(uuid, uuid, integer, text);

CREATE OR REPLACE FUNCTION public.create_event_booking_v05(
  p_event_id uuid,
  p_customer_id uuid,
  p_seats integer,
  p_source text DEFAULT 'brand_site',
  p_seating_preference text DEFAULT 'seated'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      ELSIF COALESCE(v_capacity_snapshot.standing_remaining, 0) >= p_seats THEN
        v_effective_seating := 'standing';
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
    'table_name', v_allocation->>'table_name',
    'table_names', COALESCE(v_allocation->'table_names', '[]'::jsonb),
    'table_ids', COALESCE(v_allocation->'table_ids', '[]'::jsonb)
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'customer_conflict');
END;
$$;

CREATE OR REPLACE FUNCTION public.reallocate_event_communal_booking_v01(
  p_booking_id uuid,
  p_target_seats integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  SELECT b.id, b.event_id, b.event_seating_type
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  IF v_booking.event_seating_type = 'standing' THEN
    DELETE FROM public.event_communal_seat_allocations
    WHERE event_booking_id = p_booking_id;

    RETURN jsonb_build_object('state', 'confirmed', 'event_seating_type', 'standing');
  END IF;

  SELECT start_datetime, end_datetime
  INTO v_start, v_end
  FROM public.event_communal_window_v01(v_booking.event_id);

  RETURN public.allocate_event_communal_seats_v01(
    v_booking.event_id,
    p_booking_id,
    p_target_seats,
    v_start,
    v_end
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
      IF v_event.capacity IS NOT NULL AND COALESCE(v_capacity_snapshot.total_remaining, 0) < v_delta THEN
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
      UPDATE public.bookings SET seats = v_booking.seats, updated_at = v_now WHERE id = v_booking.id;
      PERFORM public.reallocate_event_communal_booking_v01(v_booking.id, COALESCE(v_booking.seats, 1));
      RETURN jsonb_build_object('state', 'blocked', 'reason', COALESCE(v_allocation->>'reason', 'insufficient_seated_capacity'));
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
END;
$$;

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
  v_result jsonb;
BEGIN
  SELECT gt.event_booking_id
  INTO v_token
  FROM public.guest_tokens gt
  WHERE gt.hashed_token = p_hashed_token
    AND gt.action_type = 'manage'
    AND gt.expires_at > now()
  FOR UPDATE;

  IF NOT FOUND OR v_token.event_booking_id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_token');
  END IF;

  v_result := public.update_event_booking_seats_staff_v05(v_token.event_booking_id, p_new_seats, COALESCE(NULLIF(TRIM(p_actor), ''), 'guest'));
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_event_seat_increase_payment_v05(
  p_event_booking_id uuid,
  p_target_seats integer,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_amount numeric,
  p_currency text DEFAULT 'GBP'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_event RECORD;
  v_result jsonb;
  v_payment_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT b.id, b.customer_id, b.event_id, b.seats, b.status
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_event_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  IF v_booking.status <> 'confirmed' THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_confirmed', 'booking_id', v_booking.id, 'customer_id', v_booking.customer_id, 'event_id', v_booking.event_id);
  END IF;

  IF p_target_seats IS NULL OR p_target_seats <= COALESCE(v_booking.seats, 1) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_target_seats', 'booking_id', v_booking.id, 'customer_id', v_booking.customer_id, 'event_id', v_booking.event_id);
  END IF;

  SELECT e.id, e.name
  INTO v_event
  FROM public.events e
  WHERE e.id = v_booking.event_id;

  v_result := public.update_event_booking_seats_staff_v05(p_event_booking_id, p_target_seats, 'stripe_webhook');

  IF COALESCE(v_result->>'state', 'blocked') <> 'updated' THEN
    RETURN v_result || jsonb_build_object('booking_id', v_booking.id, 'customer_id', v_booking.customer_id, 'event_id', v_booking.event_id);
  END IF;

  UPDATE public.payments
  SET status = 'succeeded',
      stripe_payment_intent_id = COALESCE(NULLIF(TRIM(p_payment_intent_id), ''), stripe_payment_intent_id),
      amount = COALESCE(p_amount, amount),
      currency = COALESCE(NULLIF(TRIM(p_currency), ''), currency),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'target_seats_applied', p_target_seats,
        'delta_applied', p_target_seats - COALESCE(v_booking.seats, 1),
        'applied_at', v_now
      )
  WHERE event_booking_id = p_event_booking_id
    AND charge_type = 'seat_increase'
    AND stripe_checkout_session_id = p_checkout_session_id
  RETURNING id INTO v_payment_id;

  IF NOT FOUND THEN
    INSERT INTO public.payments (
      event_booking_id,
      charge_type,
      stripe_payment_intent_id,
      stripe_checkout_session_id,
      amount,
      currency,
      status,
      metadata,
      created_at
    ) VALUES (
      p_event_booking_id,
      'seat_increase',
      NULLIF(TRIM(p_payment_intent_id), ''),
      p_checkout_session_id,
      COALESCE(p_amount, 0),
      COALESCE(NULLIF(TRIM(p_currency), ''), 'GBP'),
      'succeeded',
      jsonb_build_object(
        'target_seats_applied', p_target_seats,
        'delta_applied', p_target_seats - COALESCE(v_booking.seats, 1),
        'source', 'stripe_webhook'
      ),
      v_now
    )
    RETURNING id INTO v_payment_id;
  END IF;

  RETURN v_result || jsonb_build_object(
    'payment_id', v_payment_id,
    'event_name', v_event.name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.convert_event_table_bookings_to_communal_v01(
  p_event_id uuid,
  p_actor text DEFAULT 'admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_event_start timestamptz;
  v_event_end timestamptz;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_active_count integer := 0;
  v_missing_link_count integer := 0;
  v_cancelled_table_booking_count integer := 0;
  v_allocation_count integer := 0;
  v_allocated_seats integer := 0;
  v_table_booking_ids uuid[] := ARRAY[]::uuid[];
  v_booking RECORD;
  v_assignment RECORD;
  v_remaining integer;
  v_take integer;
  v_now timestamptz := now();
  v_snapshot jsonb := '{}'::jsonb;
BEGIN
  IF p_event_id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_event_id');
  END IF;

  SELECT
    e.id,
    e.name,
    COALESCE(e.booking_mode, 'table') AS booking_mode,
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

  IF v_event.booking_mode = 'communal' THEN
    SELECT to_jsonb(snapshot)
    INTO v_snapshot
    FROM public.get_event_capacity_snapshot_v05(ARRAY[p_event_id]::uuid[]) snapshot
    LIMIT 1;

    RETURN jsonb_build_object(
      'state', 'already_communal',
      'event_id', p_event_id,
      'event_name', v_event.name,
      'capacity_snapshot', COALESCE(v_snapshot, '{}'::jsonb)
    );
  END IF;

  IF v_event.booking_mode = 'general' THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'general_events_have_no_table_bookings_to_convert');
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

  IF v_event_start <= v_now THEN
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

  SELECT start_datetime, end_datetime
  INTO v_window_start, v_window_end
  FROM public.event_communal_window_v01(p_event_id);

  v_window_start := COALESCE(v_window_start, v_event_start - INTERVAL '15 minutes');
  v_window_end := COALESCE(v_window_end, v_event_end);

  SELECT COUNT(*)::integer
  INTO v_active_count
  FROM public.bookings b
  WHERE b.event_id = p_event_id
    AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at);

  IF v_active_count = 0 THEN
    UPDATE public.events
    SET booking_mode = 'communal'
    WHERE id = p_event_id;

    SELECT to_jsonb(snapshot)
    INTO v_snapshot
    FROM public.get_event_capacity_snapshot_v05(ARRAY[p_event_id]::uuid[]) snapshot
    LIMIT 1;

    RETURN jsonb_build_object(
      'state', 'converted',
      'event_id', p_event_id,
      'event_name', v_event.name,
      'active_event_bookings', 0,
      'converted_event_bookings', 0,
      'cancelled_table_bookings', 0,
      'allocations_created', 0,
      'seated_seats_allocated', 0,
      'capacity_snapshot', COALESCE(v_snapshot, '{}'::jsonb)
    );
  END IF;

  SELECT COUNT(*)::integer
  INTO v_missing_link_count
  FROM public.bookings b
  WHERE b.event_id = p_event_id
    AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
    AND NOT EXISTS (
      SELECT 1
      FROM public.table_bookings tb
      JOIN public.booking_table_assignments bta ON bta.table_booking_id = tb.id
      WHERE tb.event_booking_id = b.id
        AND tb.event_id = p_event_id
        AND tb.status NOT IN ('cancelled'::public.table_booking_status, 'no_show'::public.table_booking_status)
        AND tb.left_at IS NULL
    );

  IF v_missing_link_count > 0 THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'active_bookings_missing_linked_table_reservations',
      'missing_count', v_missing_link_count
    );
  END IF;

  SELECT COALESCE(array_agg(DISTINCT tb.id), ARRAY[]::uuid[])
  INTO v_table_booking_ids
  FROM public.bookings b
  JOIN public.table_bookings tb ON tb.event_booking_id = b.id
  WHERE b.event_id = p_event_id
    AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
    AND tb.event_id = p_event_id
    AND tb.status NOT IN ('cancelled'::public.table_booking_status, 'no_show'::public.table_booking_status)
    AND tb.left_at IS NULL;

  PERFORM 1
  FROM public.table_bookings tb
  WHERE tb.id = ANY(v_table_booking_ids)
  FOR UPDATE;

  PERFORM 1
  FROM public.booking_table_assignments bta
  WHERE bta.table_booking_id = ANY(v_table_booking_ids)
  FOR UPDATE;

  DELETE FROM public.event_communal_seat_allocations
  WHERE event_id = p_event_id;

  UPDATE public.bookings b
  SET event_seating_type = 'seated',
      updated_at = v_now
  WHERE b.event_id = p_event_id
    AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at);

  UPDATE public.table_bookings tb
  SET status = 'cancelled'::public.table_booking_status,
      cancellation_reason = 'converted_to_communal_seating',
      cancelled_at = v_now,
      cancelled_by = COALESCE(NULLIF(TRIM(p_actor), ''), 'admin'),
      hold_expires_at = NULL,
      updated_at = v_now
  WHERE tb.id = ANY(v_table_booking_ids);

  GET DIAGNOSTICS v_cancelled_table_booking_count = ROW_COUNT;

  UPDATE public.booking_holds bh
  SET status = 'released',
      released_at = v_now,
      updated_at = v_now
  WHERE bh.table_booking_id = ANY(v_table_booking_ids)
    AND bh.status = 'active';

  IF to_regclass('public.card_captures') IS NOT NULL THEN
    UPDATE public.card_captures cc
    SET status = 'expired',
        expires_at = v_now,
        updated_at = v_now
    WHERE cc.table_booking_id = ANY(v_table_booking_ids)
      AND cc.status = 'pending';
  END IF;

  FOR v_booking IN
    SELECT b.id, COALESCE(b.seats, 1)::integer AS seats
    FROM public.bookings b
    WHERE b.event_id = p_event_id
      AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
    ORDER BY b.created_at, b.id
  LOOP
    v_remaining := GREATEST(v_booking.seats, 1);

    FOR v_assignment IN
      SELECT
        tb.id AS table_booking_id,
        bta.table_id,
        COALESCE(t.capacity, 0)::integer AS table_capacity,
        COALESCE(t.name, t.table_number) AS table_name
      FROM public.table_bookings tb
      JOIN public.booking_table_assignments bta ON bta.table_booking_id = tb.id
      JOIN public.tables t ON t.id = bta.table_id
      WHERE tb.event_booking_id = v_booking.id
        AND tb.id = ANY(v_table_booking_ids)
      ORDER BY COALESCE(t.capacity, 0), COALESCE(t.table_number, t.name), bta.id
    LOOP
      EXIT WHEN v_remaining <= 0;

      IF v_assignment.table_capacity <= 0 THEN
        CONTINUE;
      END IF;

      v_take := LEAST(v_remaining, v_assignment.table_capacity);

      INSERT INTO public.event_communal_seat_allocations (
        event_id,
        event_booking_id,
        table_booking_id,
        table_id,
        seats,
        start_datetime,
        end_datetime
      ) VALUES (
        p_event_id,
        v_booking.id,
        v_assignment.table_booking_id,
        v_assignment.table_id,
        v_take,
        v_window_start,
        v_window_end
      );

      v_remaining := v_remaining - v_take;
      v_allocation_count := v_allocation_count + 1;
      v_allocated_seats := v_allocated_seats + v_take;
    END LOOP;

    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'linked_table_capacity_too_low'
        USING DETAIL = format('booking_id=%s unallocated_seats=%s', v_booking.id, v_remaining);
    END IF;
  END LOOP;

  UPDATE public.events
  SET booking_mode = 'communal'
  WHERE id = p_event_id;

  SELECT to_jsonb(snapshot)
  INTO v_snapshot
  FROM public.get_event_capacity_snapshot_v05(ARRAY[p_event_id]::uuid[]) snapshot
  LIMIT 1;

  RETURN jsonb_build_object(
    'state', 'converted',
    'event_id', p_event_id,
    'event_name', v_event.name,
    'active_event_bookings', v_active_count,
    'converted_event_bookings', v_active_count,
    'cancelled_table_bookings', v_cancelled_table_booking_count,
    'allocations_created', v_allocation_count,
    'seated_seats_allocated', v_allocated_seats,
    'capacity_snapshot', COALESCE(v_snapshot, '{}'::jsonb)
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', SQLERRM,
      'sqlstate', SQLSTATE
    );
END;
$$;

REVOKE ALL ON FUNCTION public.is_active_event_booking_for_capacity_v01(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_communal_window_v01(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_event_communal_seat_allocation_v01() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_event_communal_seats_v01(uuid, uuid, integer, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_event_capacity_snapshot_v05(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_event_booking_v05(uuid, uuid, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reallocate_event_communal_booking_v01(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_event_booking_seats_staff_v05(uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_event_booking_seats_v05(text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_event_seat_increase_payment_v05(uuid, integer, text, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convert_event_table_bookings_to_communal_v01(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_active_event_booking_for_capacity_v01(text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.event_communal_window_v01(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_event_communal_seat_allocation_v01() TO service_role;
GRANT EXECUTE ON FUNCTION public.allocate_event_communal_seats_v01(uuid, uuid, integer, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_event_capacity_snapshot_v05(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_event_booking_v05(uuid, uuid, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reallocate_event_communal_booking_v01(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_event_booking_seats_staff_v05(uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_event_booking_seats_v05(text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_event_seat_increase_payment_v05(uuid, integer, text, text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.convert_event_table_bookings_to_communal_v01(uuid, text) TO service_role;
