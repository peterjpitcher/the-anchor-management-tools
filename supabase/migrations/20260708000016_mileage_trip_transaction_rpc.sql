BEGIN;

CREATE OR REPLACE FUNCTION public.recalculate_mileage_tax_year_v01(p_trip_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year integer;
  v_start date;
  v_end date;
  v_cumulative numeric := 0;
  v_standard_miles numeric;
  v_reduced_miles numeric;
  v_standard_rate numeric;
  v_trip record;
BEGIN
  IF p_trip_date IS NULL THEN
    RAISE EXCEPTION 'Trip date is required';
  END IF;

  v_year := EXTRACT(YEAR FROM p_trip_date)::integer;
  IF EXTRACT(MONTH FROM p_trip_date)::integer > 4
     OR (EXTRACT(MONTH FROM p_trip_date)::integer = 4 AND EXTRACT(DAY FROM p_trip_date)::integer >= 6) THEN
    v_start := make_date(v_year, 4, 6);
  ELSE
    v_start := make_date(v_year - 1, 4, 6);
  END IF;
  v_end := (v_start + INTERVAL '1 year' - INTERVAL '1 day')::date;

  FOR v_trip IN
    SELECT id, trip_date, total_miles
    FROM public.mileage_trips
    WHERE trip_date BETWEEN v_start AND v_end
    ORDER BY trip_date ASC, created_at ASC, id ASC
    FOR UPDATE
  LOOP
    IF v_cumulative >= 10000 THEN
      v_standard_miles := 0;
      v_reduced_miles := v_trip.total_miles;
    ELSIF v_cumulative + v_trip.total_miles <= 10000 THEN
      v_standard_miles := v_trip.total_miles;
      v_reduced_miles := 0;
    ELSE
      v_standard_miles := 10000 - v_cumulative;
      v_reduced_miles := v_trip.total_miles - v_standard_miles;
    END IF;

    v_standard_rate := CASE WHEN v_trip.trip_date < DATE '2026-04-01' THEN 0.45 ELSE 0.55 END;

    UPDATE public.mileage_trips
    SET
      miles_at_standard_rate = ROUND(v_standard_miles, 1),
      miles_at_reduced_rate = ROUND(v_reduced_miles, 1),
      amount_due = ROUND((v_standard_miles * v_standard_rate) + (v_reduced_miles * 0.25), 2)
    WHERE id = v_trip.id;

    v_cumulative := v_cumulative + v_trip.total_miles;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_mileage_trip_legs_v01(
  p_trip_id uuid,
  p_legs jsonb,
  p_order_offset integer DEFAULT 0
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_leg jsonb;
  v_order integer := 0;
  v_total numeric := 0;
  v_from uuid;
  v_to uuid;
  v_miles numeric;
BEGIN
  IF p_trip_id IS NULL THEN
    RAISE EXCEPTION 'Trip id is required';
  END IF;

  IF p_legs IS NULL OR jsonb_typeof(p_legs) <> 'array' OR jsonb_array_length(p_legs) = 0 THEN
    RAISE EXCEPTION 'At least one mileage leg is required';
  END IF;

  IF jsonb_array_length(p_legs) > 2000 THEN
    RAISE EXCEPTION 'Too many mileage legs';
  END IF;

  FOR v_leg IN SELECT value FROM jsonb_array_elements(p_legs)
  LOOP
    v_order := v_order + 1;
    IF p_order_offset + v_order > 32767 THEN
      RAISE EXCEPTION 'Too many mileage legs';
    END IF;

    v_from := COALESCE(v_leg->>'from_destination_id', v_leg->>'fromDestinationId')::uuid;
    v_to := COALESCE(v_leg->>'to_destination_id', v_leg->>'toDestinationId')::uuid;
    v_miles := (v_leg->>'miles')::numeric;

    IF v_from IS NULL OR v_to IS NULL THEN
      RAISE EXCEPTION 'Mileage leg destinations are required';
    END IF;
    IF v_miles IS NULL OR v_miles <= 0 THEN
      RAISE EXCEPTION 'Mileage leg miles must be greater than zero';
    END IF;

    INSERT INTO public.mileage_trip_legs (
      trip_id,
      leg_order,
      from_destination_id,
      to_destination_id,
      miles
    )
    VALUES (
      p_trip_id,
      p_order_offset + v_order,
      v_from,
      v_to,
      ROUND(v_miles, 1)
    );

    v_total := v_total + ROUND(v_miles, 1);
  END LOOP;

  RETURN ROUND(v_total, 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_manual_mileage_trip_v01(
  p_trip_date date,
  p_description text,
  p_total_miles numeric,
  p_created_by uuid,
  p_legs jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip_id uuid;
  v_inserted_total numeric;
  v_standard_rate numeric;
BEGIN
  IF p_trip_date IS NULL THEN
    RAISE EXCEPTION 'Trip date is required';
  END IF;
  IF p_total_miles IS NULL OR p_total_miles <= 0 THEN
    RAISE EXCEPTION 'Total miles must be greater than zero';
  END IF;

  v_standard_rate := CASE WHEN p_trip_date < DATE '2026-04-01' THEN 0.45 ELSE 0.55 END;

  INSERT INTO public.mileage_trips (
    trip_date,
    description,
    total_miles,
    miles_at_standard_rate,
    miles_at_reduced_rate,
    amount_due,
    source,
    created_by
  )
  VALUES (
    p_trip_date,
    NULLIF(BTRIM(p_description), ''),
    ROUND(p_total_miles, 1),
    ROUND(p_total_miles, 1),
    0,
    ROUND(p_total_miles * v_standard_rate, 2),
    'manual',
    p_created_by
  )
  RETURNING id INTO v_trip_id;

  v_inserted_total := public.insert_mileage_trip_legs_v01(v_trip_id, p_legs, 0);
  IF ABS(v_inserted_total - ROUND(p_total_miles, 1)) > 0.05 THEN
    RAISE EXCEPTION 'Mileage leg total does not match trip total';
  END IF;

  PERFORM public.recalculate_mileage_tax_year_v01(p_trip_date);

  RETURN v_trip_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_manual_mileage_trip_v01(
  p_trip_id uuid,
  p_trip_date date,
  p_description text,
  p_total_miles numeric,
  p_legs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing record;
  v_inserted_total numeric;
  v_standard_rate numeric;
  v_order_offset integer := 30000;
BEGIN
  IF p_trip_id IS NULL THEN
    RAISE EXCEPTION 'Trip id is required';
  END IF;
  IF p_trip_date IS NULL THEN
    RAISE EXCEPTION 'Trip date is required';
  END IF;
  IF p_total_miles IS NULL OR p_total_miles <= 0 THEN
    RAISE EXCEPTION 'Total miles must be greater than zero';
  END IF;

  SELECT id, source, trip_date, total_miles
  INTO v_existing
  FROM public.mileage_trips
  WHERE id = p_trip_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip not found';
  END IF;
  IF v_existing.source = 'oj_projects' THEN
    RAISE EXCEPTION 'Cannot edit OJ Projects synced trips';
  END IF;

  v_standard_rate := CASE WHEN p_trip_date < DATE '2026-04-01' THEN 0.45 ELSE 0.55 END;

  v_inserted_total := public.insert_mileage_trip_legs_v01(p_trip_id, p_legs, v_order_offset);
  IF ABS(v_inserted_total - ROUND(p_total_miles, 1)) > 0.05 THEN
    RAISE EXCEPTION 'Mileage leg total does not match trip total';
  END IF;

  UPDATE public.mileage_trips
  SET
    trip_date = p_trip_date,
    description = NULLIF(BTRIM(p_description), ''),
    total_miles = ROUND(p_total_miles, 1),
    miles_at_standard_rate = ROUND(p_total_miles, 1),
    miles_at_reduced_rate = 0,
    amount_due = ROUND(p_total_miles * v_standard_rate, 2)
  WHERE id = p_trip_id;

  DELETE FROM public.mileage_trip_legs
  WHERE trip_id = p_trip_id
    AND leg_order < v_order_offset;

  UPDATE public.mileage_trip_legs
  SET leg_order = leg_order - v_order_offset
  WHERE trip_id = p_trip_id
    AND leg_order >= v_order_offset;

  PERFORM public.recalculate_mileage_tax_year_v01(p_trip_date);
  IF v_existing.trip_date <> p_trip_date THEN
    PERFORM public.recalculate_mileage_tax_year_v01(v_existing.trip_date);
  END IF;

  RETURN jsonb_build_object(
    'id', p_trip_id,
    'old_trip_date', v_existing.trip_date,
    'old_total_miles', v_existing.total_miles
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_mileage_tax_year_v01(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_mileage_trip_legs_v01(uuid, jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_manual_mileage_trip_v01(date, text, numeric, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_manual_mileage_trip_v01(uuid, date, text, numeric, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.recalculate_mileage_tax_year_v01(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.insert_mileage_trip_legs_v01(uuid, jsonb, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_manual_mileage_trip_v01(date, text, numeric, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_manual_mileage_trip_v01(uuid, date, text, numeric, jsonb) TO service_role;

COMMIT;
