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
      ELSIF COALESCE(p_source, '') NOT IN ('admin', 'foh', 'walk-in')
         AND (COALESCE(v_capacity_snapshot.seated_remaining, 0) > 0
              OR COALESCE(v_capacity_snapshot.standing_remaining, 0) > 0) THEN
        -- The guest must review standing tickets before making a new request.
        RETURN jsonb_build_object(
          'state', 'blocked', 'reason', 'seated_capacity_changed',
          'seated_remaining', v_capacity_snapshot.seated_remaining,
          'standing_remaining', v_capacity_snapshot.standing_remaining,
          'total_remaining', v_capacity_snapshot.total_remaining
        );
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
$function$;

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

  RETURN jsonb_set(v_result, '{hold_expires_at}', to_jsonb(v_hold_expires_at), true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_event_booking_v07(p_event_id uuid, p_customer_id uuid, p_source text, p_seating_preference text, p_payment_hold_minutes integer, p_ticket_selections jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total integer;
  v_result jsonb;
  v_booking_id uuid;
  v_sel jsonb;
  v_type_id uuid; v_base numeric; v_cap integer;
  v_disc_type text; v_disc_val numeric; v_pmode text;
  v_unit numeric(10,2);
  v_names text[]; v_all_names text[] := '{}';
  v_remaining integer;
begin
  if p_ticket_selections is null or jsonb_typeof(p_ticket_selections) <> 'array'
     or jsonb_array_length(p_ticket_selections) = 0 then
    return jsonb_build_object('state', 'blocked', 'reason', 'no_ticket_selections');
  end if;

  select coalesce(sum((s->>'quantity')::int), 0) into v_total
  from jsonb_array_elements(p_ticket_selections) s;
  if v_total < 1 then
    return jsonb_build_object('state', 'blocked', 'reason', 'invalid_seats');
  end if;

  select online_discount_type, online_discount_value, payment_mode
    into v_disc_type, v_disc_val, v_pmode
  from public.events where id = p_event_id;
  if coalesce(v_pmode, 'free') <> 'prepaid' then v_disc_type := null; v_disc_val := null; end if;

  perform set_config('ams.skip_default_item', 'on', true);
  v_result := public.create_event_booking_v06(
    p_event_id, p_customer_id, v_total, p_source, p_seating_preference, p_payment_hold_minutes
  );
  perform set_config('ams.skip_default_item', '', true);

  v_booking_id := (v_result->>'booking_id')::uuid;

  -- Only proceed when v05/v06 actually CREATED a booking. Blocked responses can
  -- still carry a booking_id (state='blocked', reason='customer_conflict' returns
  -- the customer's EXISTING active booking) , mutating that booking's lines here
  -- corrupted live bookings and made every retry-with-active-hold fail hard.
  if v_booking_id is null
     or (v_result->>'state') not in ('pending_payment', 'confirmed') then
    return v_result;
  end if;

  -- Defensive: the new basket defines this booking's lines in full.
  delete from public.booking_items where booking_id = v_booking_id;

  for v_sel in select value from jsonb_array_elements(p_ticket_selections) loop
    select id, coalesce(base_price, 0), capacity into v_type_id, v_base, v_cap
    from public.event_ticket_types
    where id = (v_sel->>'ticket_type_id')::uuid and event_id = p_event_id and is_active;
    if v_type_id is null then
      raise exception 'invalid_ticket_type % for event %', v_sel->>'ticket_type_id', p_event_id;
    end if;

    if v_cap is not null then
      select remaining into v_remaining
      from public.get_event_ticket_type_capacity_v01(p_event_id)
      where ticket_type_id = v_type_id;
      if coalesce(v_remaining, 0) < (v_sel->>'quantity')::int then
        raise exception 'ticket_type_capacity_exceeded:%', v_type_id;
      end if;
    end if;

    v_unit := public.event_ticket_type_unit_price(v_base, v_disc_type, v_disc_val);
    v_names := coalesce(
      (select array_agg(x) from jsonb_array_elements_text(coalesce(v_sel->'attendee_names', '[]'::jsonb)) x),
      '{}');

    insert into public.booking_items (booking_id, ticket_type_id, quantity, unit_price, attendee_names)
    values (v_booking_id, v_type_id, (v_sel->>'quantity')::int, v_unit, v_names);

    v_all_names := v_all_names || v_names;
  end loop;

  update public.bookings
  set attendee_names = case when cardinality(v_all_names) > 0 then v_all_names else null end
  where id = v_booking_id;

  return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.sync_booking_default_item_v01(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_event_id uuid; v_seats integer; v_reminder boolean;
  v_type_id uuid; v_base numeric; v_disc_type text; v_disc_val numeric; v_pmode text;
  v_unit numeric(10,2); v_nondefault integer;
begin
  if coalesce(current_setting('ams.skip_default_item', true), '') = 'on' then
    return;
  end if;

  select event_id, seats, is_reminder_only
    into v_event_id, v_seats, v_reminder
  from public.bookings where id = p_booking_id;
  if not found then return; end if;

  if coalesce(v_reminder, false) or v_seats is null or v_seats < 1 then
    delete from public.booking_items where booking_id = p_booking_id;
    return;
  end if;

  select id into v_type_id
  from public.event_ticket_types
  where event_id = v_event_id and is_active
  order by sort_order, created_at
  limit 1;

  if v_type_id is null then
    select coalesce(nullif(price_per_seat, 0), nullif(price, 0), 0) into v_base
    from public.events where id = v_event_id;
    insert into public.event_ticket_types (event_id, name, base_price, sort_order, is_active)
    values (v_event_id, 'Standard', coalesce(v_base, 0), 0, true)
    returning id into v_type_id;
  end if;

  select count(*) into v_nondefault
  from public.booking_items
  where booking_id = p_booking_id and ticket_type_id <> v_type_id;
  if v_nondefault > 0 then return; end if;

  select coalesce(nullif(price_per_seat, 0), nullif(price, 0), 0),
         online_discount_type, online_discount_value, payment_mode
    into v_base, v_disc_type, v_disc_val, v_pmode
  from public.events where id = v_event_id;
  if coalesce(v_pmode, 'free') <> 'prepaid' then v_disc_type := null; v_disc_val := null; end if;
  v_unit := public.event_ticket_type_unit_price(coalesce(v_base, 0), v_disc_type, v_disc_val);

  insert into public.booking_items (booking_id, ticket_type_id, quantity, unit_price)
  values (p_booking_id, v_type_id, v_seats, v_unit)
  on conflict (booking_id, ticket_type_id)
    do update set quantity = excluded.quantity;
end $function$;
