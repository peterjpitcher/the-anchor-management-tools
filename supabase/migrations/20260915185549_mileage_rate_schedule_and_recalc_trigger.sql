-- Mileage: HMRC rate schedule, whole-number recalculation, a trigger that recalculates in the
-- same transaction as every trip change, and OJ Projects deletes that remove their trip.
--
-- Spec: tasks/spec-2026-09-15-mileage-section-design.md, sections 3.3 and 4.2 to 4.4.
-- Live data change: trips dated 4 and 5 April 2026 move from 55p to 45p (GBP 1.70 in total).
-- Each changed trip gets an audit_logs row tagged mileage_amap_55p_from_2026_04_06.

BEGIN;

-- Stop before changing anything if an orphaned OJ Projects trip exists: the owner decides.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.mileage_trips WHERE source = 'oj_projects' AND oj_entry_id IS NULL) THEN
    RAISE EXCEPTION 'MILEAGE_OJ_ORPHAN_TRIPS: an OJ Projects trip has no OJ entry; resolve it before applying this migration';
  END IF;
END $$;

-- 1. Tax year start (6 April) for a date.
CREATE OR REPLACE FUNCTION public.mileage_tax_year_start_v01(p_date date)
RETURNS date
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN (EXTRACT(MONTH FROM p_date)::int, EXTRACT(DAY FROM p_date)::int) >= (4, 6)
      THEN make_date(EXTRACT(YEAR FROM p_date)::int, 4, 6)
    ELSE make_date(EXTRACT(YEAR FROM p_date)::int - 1, 4, 6)
  END;
$$;

-- 2. AMAP schedule. Append-only: add a row for a new HMRC rate and never edit an old one.
--    Mirrors AMAP_RATE_PERIODS in src/lib/mileage/hmrcRates.ts.
CREATE OR REPLACE FUNCTION public.mileage_amap_rates_v01(p_trip_date date)
RETURNS TABLE (standard_pence integer, reduced_pence integer, threshold_miles integer)
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path TO 'public'
AS $$
  SELECT r.standard_pence, r.reduced_pence, r.threshold_miles
  FROM (VALUES
    (DATE '2023-04-06', 45, 25, 10000),
    (DATE '2026-04-06', 55, 25, 10000)
  ) AS r(valid_from, standard_pence, reduced_pence, threshold_miles)
  WHERE r.valid_from <= p_trip_date
  ORDER BY r.valid_from DESC
  LIMIT 1;
$$;

-- 3. Recalculate one tax year. Same signature, owner and security settings as the live function;
--    the body now uses the schedule and whole tenths and pence, and writes only changed rows.
CREATE OR REPLACE FUNCTION public.recalculate_mileage_tax_year_v01(p_trip_date date)
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
  IF p_trip_date IS NULL THEN
    RAISE EXCEPTION 'Trip date is required';
  END IF;

  v_start := public.mileage_tax_year_start_v01(p_trip_date);
  v_end := (v_start + INTERVAL '1 year' - INTERVAL '1 day')::date;

  -- One lock per tax year serialises concurrent recalculation of the same group.
  PERFORM pg_advisory_xact_lock(hashtext('mileage_recalculation'), EXTRACT(YEAR FROM v_start)::int);

  FOR v_trip IN
    SELECT id, trip_date, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due
    FROM public.mileage_trips
    WHERE trip_date BETWEEN v_start AND v_end
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

-- 4. Recalculate the tax years a trip change touches, inside the transaction that changed it.
--    The recalculation writes only the three figure columns, which are not in this trigger's
--    UPDATE OF list, so it does not fire itself.
CREATE OR REPLACE FUNCTION public.fn_mileage_trips_recalculate_v01()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_start date;
  v_new_start date;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old_start := public.mileage_tax_year_start_v01(OLD.trip_date);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new_start := public.mileage_tax_year_start_v01(NEW.trip_date);
  END IF;

  IF v_old_start IS NOT NULL AND v_new_start IS NOT NULL AND v_old_start <> v_new_start THEN
    -- Fixed lock order across the two tax years: earlier first.
    PERFORM public.recalculate_mileage_tax_year_v01(LEAST(v_old_start, v_new_start));
    PERFORM public.recalculate_mileage_tax_year_v01(GREATEST(v_old_start, v_new_start));
  ELSE
    PERFORM public.recalculate_mileage_tax_year_v01(COALESCE(v_new_start, v_old_start));
  END IF;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_mileage_trips_recalculate ON public.mileage_trips;
CREATE TRIGGER trg_mileage_trips_recalculate
AFTER INSERT OR DELETE OR UPDATE OF trip_date, total_miles ON public.mileage_trips
FOR EACH ROW EXECUTE FUNCTION public.fn_mileage_trips_recalculate_v01();

-- 5. Deleting an OJ Projects entry deletes its trip. ON DELETE SET NULL fired before
--    trg_sync_oj_mileage (triggers fire in name order), so the sync trigger's delete found
--    nothing and the trip stayed claimable.
ALTER TABLE public.mileage_trips DROP CONSTRAINT mileage_trips_oj_entry_id_fkey;
ALTER TABLE public.mileage_trips ADD CONSTRAINT mileage_trips_oj_entry_id_fkey
  FOREIGN KEY (oj_entry_id) REFERENCES public.oj_entries(id) ON DELETE CASCADE;

-- 6. Grants: execution stays with the service role, as for the live mileage functions.
REVOKE ALL ON FUNCTION public.mileage_tax_year_start_v01(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mileage_amap_rates_v01(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_mileage_tax_year_v01(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_mileage_trips_recalculate_v01() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mileage_tax_year_start_v01(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.mileage_amap_rates_v01(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_mileage_tax_year_v01(date) TO service_role;

-- 7. Reprice every tax year that has trips, keeping a before image for the audit trail.
CREATE TEMP TABLE mileage_amounts_before ON COMMIT DROP AS
SELECT id, trip_date, miles_at_standard_rate, miles_at_reduced_rate, amount_due
FROM public.mileage_trips;

DO $$
DECLARE
  v_start date;
BEGIN
  FOR v_start IN
    SELECT DISTINCT public.mileage_tax_year_start_v01(trip_date) FROM public.mileage_trips ORDER BY 1
  LOOP
    PERFORM public.recalculate_mileage_tax_year_v01(v_start);
  END LOOP;
END $$;

-- Only trips dated 1 to 5 April 2026 may change. Anything else means the new arithmetic disagrees
-- with what production stored, and the whole migration must stop.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.mileage_trips t
    JOIN mileage_amounts_before b ON b.id = t.id
    WHERE (t.miles_at_standard_rate, t.miles_at_reduced_rate, t.amount_due)
          IS DISTINCT FROM (b.miles_at_standard_rate, b.miles_at_reduced_rate, b.amount_due)
      AND t.trip_date NOT BETWEEN DATE '2026-04-01' AND DATE '2026-04-05'
  ) THEN
    RAISE EXCEPTION 'MILEAGE_RECALC_UNEXPECTED_CHANGE: a trip outside 1 to 5 April 2026 changed amount';
  END IF;
END $$;

INSERT INTO public.audit_logs (operation_type, resource_type, resource_id, operation_status, old_values, new_values, additional_info)
SELECT 'update', 'mileage_trip', t.id::text, 'success',
  jsonb_build_object('amount_due', b.amount_due, 'miles_at_standard_rate', b.miles_at_standard_rate, 'miles_at_reduced_rate', b.miles_at_reduced_rate),
  jsonb_build_object('amount_due', t.amount_due, 'miles_at_standard_rate', t.miles_at_standard_rate, 'miles_at_reduced_rate', t.miles_at_reduced_rate),
  jsonb_build_object('change', 'mileage_amap_55p_from_2026_04_06', 'trip_date', t.trip_date, 'reason', 'HMRC 55p applies from 6 April 2026')
FROM public.mileage_trips t
JOIN mileage_amounts_before b ON b.id = t.id
WHERE (t.miles_at_standard_rate, t.miles_at_reduced_rate, t.amount_due)
      IS DISTINCT FROM (b.miles_at_standard_rate, b.miles_at_reduced_rate, b.amount_due);

COMMIT;
