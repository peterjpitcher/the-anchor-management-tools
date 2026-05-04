-- Harden OJ Projects mileage -> mileage claim sync.
--
-- OJ Projects keeps a fast total-miles entry flow, while /mileage receives a
-- read-only summary claim row keyed by oj_entry_id. This migration makes the
-- trigger idempotent and backfills any historical mileage entries missing a
-- corresponding mileage_trips row.

CREATE OR REPLACE FUNCTION public.fn_sync_oj_mileage_to_trips()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_miles NUMERIC(8,1);
  v_description TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.entry_type = 'mileage' THEN
      DELETE FROM public.mileage_trips
      WHERE oj_entry_id = OLD.id;
    END IF;

    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.entry_type = 'mileage' AND NEW.entry_type <> 'mileage' THEN
    DELETE FROM public.mileage_trips
    WHERE oj_entry_id = OLD.id;

    RETURN NEW;
  END IF;

  IF NEW.entry_type <> 'mileage' THEN
    RETURN NEW;
  END IF;

  v_total_miles := ROUND(COALESCE(NEW.miles, 0)::NUMERIC, 1)::NUMERIC(8,1);
  IF v_total_miles <= 0 THEN
    RAISE EXCEPTION 'OJ Projects mileage must be at least 0.1 miles';
  END IF;

  v_description := COALESCE(NULLIF(BTRIM(NEW.description), ''), 'OJ Projects mileage');

  INSERT INTO public.mileage_trips (
    trip_date,
    description,
    total_miles,
    miles_at_standard_rate,
    miles_at_reduced_rate,
    amount_due,
    source,
    oj_entry_id,
    created_by
  ) VALUES (
    NEW.entry_date,
    v_description,
    v_total_miles,
    v_total_miles,
    0,
    ROUND(v_total_miles * 0.45, 2),
    'oj_projects',
    NEW.id,
    auth.uid()
  )
  ON CONFLICT (oj_entry_id) DO UPDATE
  SET
    trip_date = EXCLUDED.trip_date,
    description = EXCLUDED.description,
    total_miles = EXCLUDED.total_miles,
    miles_at_standard_rate = EXCLUDED.miles_at_standard_rate,
    miles_at_reduced_rate = EXCLUDED.miles_at_reduced_rate,
    amount_due = EXCLUDED.amount_due,
    source = 'oj_projects',
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_oj_mileage ON public.oj_entries;

CREATE TRIGGER trg_sync_oj_mileage
  AFTER INSERT OR UPDATE OR DELETE
  ON public.oj_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_oj_mileage_to_trips();

INSERT INTO public.mileage_trips (
  trip_date,
  description,
  total_miles,
  miles_at_standard_rate,
  miles_at_reduced_rate,
  amount_due,
  source,
  oj_entry_id,
  created_by
)
SELECT
  e.entry_date,
  COALESCE(NULLIF(BTRIM(e.description), ''), 'OJ Projects mileage'),
  ROUND(e.miles::NUMERIC, 1)::NUMERIC(8,1),
  ROUND(e.miles::NUMERIC, 1)::NUMERIC(8,1),
  0,
  ROUND(ROUND(e.miles::NUMERIC, 1) * 0.45, 2),
  'oj_projects',
  e.id,
  NULL
FROM public.oj_entries e
WHERE e.entry_type = 'mileage'
  AND e.miles IS NOT NULL
  AND ROUND(e.miles::NUMERIC, 1) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.mileage_trips mt
    WHERE mt.oj_entry_id = e.id
  )
ON CONFLICT (oj_entry_id) DO NOTHING;

WITH ordered_trips AS (
  SELECT
    id,
    total_miles,
    COALESCE(
      SUM(total_miles) OVER (
        PARTITION BY
          CASE
            WHEN trip_date >= MAKE_DATE(EXTRACT(YEAR FROM trip_date)::INTEGER, 4, 6)
              THEN MAKE_DATE(EXTRACT(YEAR FROM trip_date)::INTEGER, 4, 6)
            ELSE MAKE_DATE(EXTRACT(YEAR FROM trip_date)::INTEGER - 1, 4, 6)
          END
        ORDER BY trip_date ASC, created_at ASC, id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ),
      0
    ) AS prior_miles
  FROM public.mileage_trips
),
split_trips AS (
  SELECT
    id,
    CASE
      WHEN prior_miles >= 10000 THEN 0
      WHEN prior_miles + total_miles <= 10000 THEN total_miles
      ELSE 10000 - prior_miles
    END::NUMERIC(8,1) AS standard_miles,
    CASE
      WHEN prior_miles >= 10000 THEN total_miles
      WHEN prior_miles + total_miles <= 10000 THEN 0
      ELSE total_miles - (10000 - prior_miles)
    END::NUMERIC(8,1) AS reduced_miles
  FROM ordered_trips
)
UPDATE public.mileage_trips mt
SET
  miles_at_standard_rate = split_trips.standard_miles,
  miles_at_reduced_rate = split_trips.reduced_miles,
  amount_due = ROUND(split_trips.standard_miles * 0.45 + split_trips.reduced_miles * 0.25, 2),
  updated_at = now()
FROM split_trips
WHERE mt.id = split_trips.id;
