-- Mileage driver cutover (Release 3, part B). Every trip must have a driver, the 10,000-mile running
-- total is kept per driver and tax year, OJ Projects mileage fails without an OJ Projects driver,
-- the v01 save functions refuse old app builds, and headline totals come from one query.
--
-- Spec: tasks/spec-2026-09-15-mileage-section-design.md sections 4.4, 5 and 7.3; release order in
-- section 8.1 (apply only after the driver backfill).
--
-- Refuses to run, changing nothing, while:
--   any trip has no driver (MILEAGE_DRIVER_CUTOVER_NULL_DRIVERS);
--   OJ Projects trips exist without exactly one active OJ Projects driver (MILEAGE_DRIVER_CUTOVER_OJ_DRIVER);
--   repricing every driver and tax year would change any stored figure (MILEAGE_DRIVER_CUTOVER_CHANGED_AMOUNTS).
-- No stored amount changes: nobody shares a tax year with another driver near 10,000 miles.

BEGIN;

-- Hold trip and driver writes still while the checks run, rather than queueing behind a long
-- transaction and blocking the mileage pages.
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.mileage_trips IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.mileage_drivers IN SHARE MODE;

DO $$
DECLARE
  v_missing integer;
BEGIN
  SELECT count(*) INTO v_missing FROM public.mileage_trips WHERE driver_id IS NULL;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'MILEAGE_DRIVER_CUTOVER_NULL_DRIVERS: % trip(s) have no driver; run the backfill first', v_missing;
  END IF;
  IF EXISTS (SELECT 1 FROM public.mileage_trips WHERE source = 'oj_projects')
     AND (SELECT count(*) FROM public.mileage_drivers WHERE drives_oj_projects AND is_active) <> 1 THEN
    RAISE EXCEPTION 'MILEAGE_DRIVER_CUTOVER_OJ_DRIVER: OJ Projects trips exist, so exactly one active OJ Projects driver is required';
  END IF;
END $$;

-- Figures as stored before anything changes, for the no-change proof at the end.
CREATE TEMP TABLE mileage_amounts_before_cutover ON COMMIT DROP AS
SELECT id, miles_at_standard_rate, miles_at_reduced_rate, amount_due FROM public.mileage_trips;

ALTER TABLE public.mileage_trips
  ALTER COLUMN driver_id SET NOT NULL,
  ALTER COLUMN driver_basis SET NOT NULL;

-- Recalculate one driver's tax year. p_tax_year_start may be any date in that tax year.
CREATE OR REPLACE FUNCTION public.recalculate_mileage_driver_tax_year_v01(p_driver_id uuid, p_tax_year_start date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_start date;
  v_end date;
  v_trip record;
  v_rates record;
  v_cumulative_tenths integer := 0;
  v_trip_tenths integer;
  v_standard_tenths integer;
  v_reduced_tenths integer;
  v_amount_pence integer;
BEGIN
  IF p_driver_id IS NULL OR p_tax_year_start IS NULL THEN
    RAISE EXCEPTION 'Driver and tax year are required';
  END IF;

  v_start := public.mileage_tax_year_start_v01(p_tax_year_start);
  v_end := (v_start + INTERVAL '1 year' - INTERVAL '1 day')::date;

  -- One lock per driver and tax year serialises concurrent recalculation of that group.
  PERFORM pg_advisory_xact_lock(hashtext('mileage_recalculation:' || p_driver_id::text), EXTRACT(YEAR FROM v_start)::int);

  FOR v_trip IN
    SELECT id, trip_date, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due
    FROM public.mileage_trips
    WHERE driver_id = p_driver_id AND trip_date BETWEEN v_start AND v_end
    ORDER BY trip_date ASC, created_at ASC, id ASC
    FOR UPDATE
  LOOP
    SELECT * INTO v_rates FROM public.mileage_amap_rates_v01(v_trip.trip_date);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'MILEAGE_RATE_MISSING: no mileage allowance rate for %', v_trip.trip_date;
    END IF;

    v_trip_tenths := ROUND(v_trip.total_miles * 10)::integer;
    v_standard_tenths := GREATEST(0, LEAST(v_trip_tenths, v_rates.threshold_miles * 10 - v_cumulative_tenths));
    v_reduced_tenths := v_trip_tenths - v_standard_tenths;
    v_amount_pence := (v_standard_tenths * v_rates.standard_pence + v_reduced_tenths * v_rates.reduced_pence + 5) / 10;

    -- Only changed rows are written, so untouched trips keep their updated_at for stale-edit checks.
    IF (v_trip.miles_at_standard_rate, v_trip.miles_at_reduced_rate, v_trip.amount_due)
       IS DISTINCT FROM (v_standard_tenths / 10.0, v_reduced_tenths / 10.0, v_amount_pence / 100.0) THEN
      UPDATE public.mileage_trips
      SET miles_at_standard_rate = v_standard_tenths / 10.0,
          miles_at_reduced_rate = v_reduced_tenths / 10.0,
          amount_due = v_amount_pence / 100.0
      WHERE id = v_trip.id;
    END IF;

    v_cumulative_tenths := v_cumulative_tenths + v_trip_tenths;
  END LOOP;
END;
$function$;

-- Same signature, owner and security settings as the live function. Kept for any caller that
-- passes a date: it now recalculates every driver with trips in that tax year, in driver order.
CREATE OR REPLACE FUNCTION public.recalculate_mileage_tax_year_v01(p_trip_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_start date;
  v_driver uuid;
BEGIN
  IF p_trip_date IS NULL THEN
    RAISE EXCEPTION 'Trip date is required';
  END IF;

  v_start := public.mileage_tax_year_start_v01(p_trip_date);
  FOR v_driver IN
    SELECT DISTINCT driver_id
    FROM public.mileage_trips
    WHERE trip_date BETWEEN v_start AND (v_start + INTERVAL '1 year' - INTERVAL '1 day')::date
    ORDER BY driver_id
  LOOP
    PERFORM public.recalculate_mileage_driver_tax_year_v01(v_driver, v_start);
  END LOOP;
END;
$function$;

-- Recalculate the driver and tax year groups a trip change leaves or joins, inside the transaction
-- that changed it. The recalculation writes only the three figure columns, which are not in the
-- trigger's UPDATE OF list, so it does not fire itself.
CREATE OR REPLACE FUNCTION public.fn_mileage_trips_recalculate_v02()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_drivers uuid[] := ARRAY[]::uuid[];
  v_starts date[] := ARRAY[]::date[];
  v_group record;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_drivers := v_drivers || OLD.driver_id;
    v_starts := v_starts || public.mileage_tax_year_start_v01(OLD.trip_date);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_drivers := v_drivers || NEW.driver_id;
    v_starts := v_starts || public.mileage_tax_year_start_v01(NEW.trip_date);
  END IF;

  -- Distinct groups in a fixed order (driver, then tax year), so two groups are always locked the
  -- same way round.
  FOR v_group IN
    SELECT DISTINCT g.driver_id, g.tax_year_start
    FROM unnest(v_drivers, v_starts) AS g(driver_id, tax_year_start)
    ORDER BY g.driver_id, g.tax_year_start
  LOOP
    PERFORM public.recalculate_mileage_driver_tax_year_v01(v_group.driver_id, v_group.tax_year_start);
  END LOOP;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_mileage_trips_recalculate ON public.mileage_trips;
CREATE TRIGGER trg_mileage_trips_recalculate
AFTER INSERT OR DELETE OR UPDATE OF trip_date, total_miles, driver_id ON public.mileage_trips
FOR EACH ROW EXECUTE FUNCTION public.fn_mileage_trips_recalculate_v02();

-- OJ Projects sync: as migration A, except new OJ Projects mileage with no active OJ Projects driver
-- fails instead of creating a driverless trip. Edits never change the driver. Same signature,
-- owner, SECURITY DEFINER and search_path as the live function.
CREATE OR REPLACE FUNCTION public.fn_sync_oj_mileage_to_trips()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_miles numeric(8,1);
  v_description text;
  v_driver_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.entry_type = 'mileage' THEN
      v_total_miles := COALESCE(NEW.miles, 0)::numeric(8,1);
      v_description := COALESCE(NEW.description, 'OJ Projects mileage');
      SELECT id INTO v_driver_id FROM public.mileage_drivers WHERE drives_oj_projects AND is_active;
      IF v_driver_id IS NULL THEN
        RAISE EXCEPTION 'MILEAGE_OJ_DRIVER_MISSING';
      END IF;
      INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, oj_entry_id, created_by, driver_id, driver_basis)
      VALUES (NEW.entry_date, v_description, v_total_miles, v_total_miles, 0, 0, 'oj_projects', NEW.id, auth.uid(), v_driver_id, 'oj_projects');
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.entry_type = 'mileage' AND NEW.entry_type = 'mileage' THEN
      v_total_miles := COALESCE(NEW.miles, 0)::numeric(8,1);
      v_description := COALESCE(NEW.description, 'OJ Projects mileage');
      UPDATE public.mileage_trips
      SET trip_date = NEW.entry_date,
          description = v_description,
          total_miles = v_total_miles,
          miles_at_standard_rate = v_total_miles,
          miles_at_reduced_rate = 0,
          amount_due = 0
      WHERE oj_entry_id = OLD.id;
    ELSIF OLD.entry_type <> 'mileage' AND NEW.entry_type = 'mileage' THEN
      v_total_miles := COALESCE(NEW.miles, 0)::numeric(8,1);
      v_description := COALESCE(NEW.description, 'OJ Projects mileage');
      SELECT id INTO v_driver_id FROM public.mileage_drivers WHERE drives_oj_projects AND is_active;
      IF v_driver_id IS NULL THEN
        RAISE EXCEPTION 'MILEAGE_OJ_DRIVER_MISSING';
      END IF;
      INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, oj_entry_id, created_by, driver_id, driver_basis)
      VALUES (NEW.entry_date, v_description, v_total_miles, v_total_miles, 0, 0, 'oj_projects', NEW.id, auth.uid(), v_driver_id, 'oj_projects');
    ELSIF OLD.entry_type = 'mileage' AND NEW.entry_type <> 'mileage' THEN
      DELETE FROM public.mileage_trips WHERE oj_entry_id = OLD.id;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- The cascading foreign key (Release 1) has already removed the trip.
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$function$;

-- The v01 saves cannot record a driver, so an app build still calling them is refused with a code
-- the app maps to "refresh the page". Same signatures, results and security settings as live.
CREATE OR REPLACE FUNCTION public.create_manual_mileage_trip_v01(p_trip_date date, p_description text, p_total_miles numeric, p_created_by uuid, p_legs jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'MILEAGE_APP_OUTDATED';
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_manual_mileage_trip_v01(p_trip_id uuid, p_trip_date date, p_description text, p_total_miles numeric, p_legs jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'MILEAGE_APP_OUTDATED';
END;
$function$;

-- Headline totals for the trips page (spec 7.1): this quarter, this financial year (January to
-- December), this tax year, and each active driver's miles and miles left at the standard rate in
-- this tax year. Whole tenths of a mile and whole pence. Never filtered.
CREATE OR REPLACE FUNCTION public.mileage_headline_totals_v01(p_today date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  WITH bounds AS (
    SELECT
      date_trunc('quarter', p_today::timestamp)::date AS quarter_start,
      (date_trunc('quarter', p_today::timestamp) + INTERVAL '3 months' - INTERVAL '1 day')::date AS quarter_end,
      make_date(EXTRACT(YEAR FROM p_today)::int, 1, 1) AS year_start,
      make_date(EXTRACT(YEAR FROM p_today)::int, 12, 31) AS year_end,
      public.mileage_tax_year_start_v01(p_today) AS tax_start,
      (public.mileage_tax_year_start_v01(p_today) + INTERVAL '1 year' - INTERVAL '1 day')::date AS tax_end,
      -- 10,000 miles has applied throughout the schedule; used if the date is before it.
      COALESCE((SELECT r.threshold_miles FROM public.mileage_amap_rates_v01(p_today) r), 10000) * 10 AS threshold_tenths
  ),
  totals AS (
    SELECT
      b.quarter_start, b.quarter_end, b.year_start, b.year_end, b.tax_start, b.tax_end, b.threshold_tenths,
      count(t.id) FILTER (WHERE t.trip_date BETWEEN b.quarter_start AND b.quarter_end) AS quarter_trips,
      COALESCE(sum(ROUND(t.total_miles * 10)) FILTER (WHERE t.trip_date BETWEEN b.quarter_start AND b.quarter_end), 0)::bigint AS quarter_tenths,
      COALESCE(sum(ROUND(t.amount_due * 100)) FILTER (WHERE t.trip_date BETWEEN b.quarter_start AND b.quarter_end), 0)::bigint AS quarter_pence,
      count(t.id) FILTER (WHERE t.trip_date BETWEEN b.year_start AND b.year_end) AS year_trips,
      COALESCE(sum(ROUND(t.total_miles * 10)) FILTER (WHERE t.trip_date BETWEEN b.year_start AND b.year_end), 0)::bigint AS year_tenths,
      COALESCE(sum(ROUND(t.amount_due * 100)) FILTER (WHERE t.trip_date BETWEEN b.year_start AND b.year_end), 0)::bigint AS year_pence,
      count(t.id) FILTER (WHERE t.trip_date BETWEEN b.tax_start AND b.tax_end) AS tax_trips,
      COALESCE(sum(ROUND(t.total_miles * 10)) FILTER (WHERE t.trip_date BETWEEN b.tax_start AND b.tax_end), 0)::bigint AS tax_tenths,
      COALESCE(sum(ROUND(t.amount_due * 100)) FILTER (WHERE t.trip_date BETWEEN b.tax_start AND b.tax_end), 0)::bigint AS tax_pence
    FROM bounds b
    LEFT JOIN public.mileage_trips t
      ON t.trip_date BETWEEN LEAST(b.quarter_start, b.year_start, b.tax_start) AND GREATEST(b.quarter_end, b.year_end, b.tax_end)
    GROUP BY b.quarter_start, b.quarter_end, b.year_start, b.year_end, b.tax_start, b.tax_end, b.threshold_tenths
  )
  SELECT jsonb_build_object(
    'quarter', jsonb_build_object('from', totals.quarter_start, 'to', totals.quarter_end, 'trips', totals.quarter_trips, 'miles_tenths', totals.quarter_tenths, 'amount_pence', totals.quarter_pence),
    'financial_year', jsonb_build_object('from', totals.year_start, 'to', totals.year_end, 'trips', totals.year_trips, 'miles_tenths', totals.year_tenths, 'amount_pence', totals.year_pence),
    'tax_year', jsonb_build_object('from', totals.tax_start, 'to', totals.tax_end, 'trips', totals.tax_trips, 'miles_tenths', totals.tax_tenths, 'amount_pence', totals.tax_pence),
    'drivers', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'driver_id', d.id,
          'display_name', d.display_name,
          'tax_year_miles_tenths', COALESCE(driver_miles.tenths, 0),
          'standard_miles_left_tenths', GREATEST(0, totals.threshold_tenths - COALESCE(driver_miles.tenths, 0))
        )
        ORDER BY d.display_name, d.id
      )
      FROM public.mileage_drivers d
      LEFT JOIN LATERAL (
        SELECT sum(ROUND(t2.total_miles * 10))::bigint AS tenths
        FROM public.mileage_trips t2
        WHERE t2.driver_id = d.id AND t2.trip_date BETWEEN totals.tax_start AND totals.tax_end
      ) driver_miles ON true
      WHERE d.is_active
    ), '[]'::jsonb)
  )
  FROM totals;
$$;

-- Grants: nothing for PUBLIC, anon or authenticated; the service role runs everything.
REVOKE ALL ON FUNCTION public.recalculate_mileage_driver_tax_year_v01(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_mileage_tax_year_v01(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_mileage_trips_recalculate_v02() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sync_oj_mileage_to_trips() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_manual_mileage_trip_v01(date, text, numeric, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_manual_mileage_trip_v01(uuid, date, text, numeric, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mileage_headline_totals_v01(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_mileage_driver_tax_year_v01(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_mileage_tax_year_v01(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_mileage_trips_recalculate_v02() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_sync_oj_mileage_to_trips() TO service_role;
GRANT EXECUTE ON FUNCTION public.create_manual_mileage_trip_v01(date, text, numeric, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_manual_mileage_trip_v01(uuid, date, text, numeric, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mileage_headline_totals_v01(date) TO service_role;

-- Reprice every driver and tax year, and stop if any stored figure moved.
DO $$
DECLARE
  v_group record;
  v_changed integer;
BEGIN
  FOR v_group IN
    SELECT DISTINCT driver_id, public.mileage_tax_year_start_v01(trip_date) AS tax_year_start
    FROM public.mileage_trips
    ORDER BY 1, 2
  LOOP
    PERFORM public.recalculate_mileage_driver_tax_year_v01(v_group.driver_id, v_group.tax_year_start);
  END LOOP;

  SELECT count(*) INTO v_changed
  FROM public.mileage_trips t
  FULL JOIN mileage_amounts_before_cutover b ON b.id = t.id
  WHERE t.id IS NULL
     OR b.id IS NULL
     OR (t.miles_at_standard_rate, t.miles_at_reduced_rate, t.amount_due)
        IS DISTINCT FROM (b.miles_at_standard_rate, b.miles_at_reduced_rate, b.amount_due);
  IF v_changed > 0 THEN
    RAISE EXCEPTION 'MILEAGE_DRIVER_CUTOVER_CHANGED_AMOUNTS: counting the 10,000-mile limit per driver changed % trip(s); nothing was applied', v_changed;
  END IF;
END $$;

COMMIT;
