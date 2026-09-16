-- Mileage report dataset: one JSON document per export, so its rows and totals share one snapshot
-- (spec 6.1). Read-only; no data changes.
--
-- Spec: tasks/spec-2026-09-15-mileage-section-design.md section 6.1.
-- Must sort after the Release 3 cutover, but works before it: a trip with no driver is kept in the
-- trip rows view (driver fields null) and makes the dataset refuse, so no report is ever built
-- with a trip silently left out of a person's claim or tax year position.

BEGIN;

-- One row per trip in the shape the report and the Release 5 trips list share.
CREATE VIEW public.mileage_trip_rows_v01
WITH (security_invoker = true)
AS
SELECT
  t.id,
  t.trip_date,
  t.created_at,
  t.source,
  t.driver_id,
  t.description,
  ROUND(t.total_miles * 10)::integer AS total_miles_tenths,
  ROUND(t.amount_due * 100)::integer AS amount_pence,
  jsonb_build_object(
    'id', t.id,
    'trip_date', t.trip_date,
    'created_at', t.created_at,
    'description', t.description,
    'total_miles_tenths', ROUND(t.total_miles * 10)::integer,
    'standard_miles_tenths', ROUND(t.miles_at_standard_rate * 10)::integer,
    'reduced_miles_tenths', ROUND(t.miles_at_reduced_rate * 10)::integer,
    'amount_pence', ROUND(t.amount_due * 100)::integer,
    'source', t.source,
    'driver_id', t.driver_id,
    'driver_name', d.display_name,
    'driver_basis', t.driver_basis,
    'oj_project_name', p.project_name,
    'oj_client_name', v.name,
    'legs', COALESCE(legs.legs, '[]'::jsonb)
  ) AS row_json
FROM public.mileage_trips t
-- LEFT, not inner: until the Release 3 cutover a trip can have no driver, and it must not vanish.
LEFT JOIN public.mileage_drivers d ON d.id = t.driver_id
LEFT JOIN public.oj_entries e ON e.id = t.oj_entry_id
LEFT JOIN public.oj_projects p ON p.id = e.project_id
LEFT JOIN public.invoice_vendors v ON v.id = e.vendor_id
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object(
      'leg_order', l.leg_order,
      'from_id', fd.id,
      'from_name', fd.name,
      'from_postcode', NULLIF(BTRIM(fd.postcode), ''),
      'from_is_home_base', fd.is_home_base,
      'to_id', td.id,
      'to_name', td.name,
      'to_postcode', NULLIF(BTRIM(td.postcode), ''),
      'to_is_home_base', td.is_home_base,
      'miles_tenths', ROUND(l.miles * 10)::integer
    )
    ORDER BY l.leg_order
  ) AS legs
  FROM public.mileage_trip_legs l
  JOIN public.mileage_destinations fd ON fd.id = l.from_destination_id
  JOIN public.mileage_destinations td ON td.id = l.to_destination_id
  WHERE l.trip_id = t.id
) legs ON true;

-- The live default privileges give authenticated and the service role every privilege on new
-- tables and views, so both are revoked and the service role gets SELECT back.
REVOKE ALL ON public.mileage_trip_rows_v01 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.mileage_trip_rows_v01 TO service_role;

-- plpgsql only so the no-driver guard can raise. A STABLE function sees one snapshot for every
-- statement inside it, so the guard and the document read the same data.
CREATE OR REPLACE FUNCTION public.mileage_report_dataset_v01(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Every trip that feeds the document: the report dates plus each tax year position before them.
  IF EXISTS (
    SELECT 1
    FROM public.mileage_trips t
    WHERE t.driver_id IS NULL
      AND t.trip_date BETWEEN public.mileage_tax_year_start_v01(p_from) AND p_to
  ) THEN
    RAISE EXCEPTION 'MILEAGE_REPORT_TRIPS_WITHOUT_DRIVER';
  END IF;

  RETURN (
    WITH tax_years AS (
      SELECT
        series::date AS tax_year_start,
        LEAST(p_to, (series + INTERVAL '1 year' - INTERVAL '1 day')::date) AS cutoff_date
      FROM generate_series(
        public.mileage_tax_year_start_v01(p_from)::timestamp,
        public.mileage_tax_year_start_v01(p_to)::timestamp,
        INTERVAL '1 year'
      ) AS series
    )
    SELECT jsonb_build_object(
      'generated_at', now(),
      'from', p_from,
      'to', p_to,
      'trips', COALESCE((
        SELECT jsonb_agg(r.row_json ORDER BY r.trip_date, r.created_at, r.id)
        FROM public.mileage_trip_rows_v01 r
        WHERE r.trip_date BETWEEN p_from AND p_to
      ), '[]'::jsonb),
      'tax_year_positions', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'driver_id', d.id,
            'tax_year_start', ty.tax_year_start,
            'cutoff_date', ty.cutoff_date,
            'miles_tenths_to_cutoff', COALESCE((
              SELECT SUM(ROUND(t.total_miles * 10)::integer)
              FROM public.mileage_trips t
              WHERE t.driver_id = d.id
                AND t.trip_date BETWEEN ty.tax_year_start AND ty.cutoff_date
            ), 0)
          )
          ORDER BY d.display_name, ty.tax_year_start
        )
        FROM public.mileage_drivers d
        CROSS JOIN tax_years ty
      ), '[]'::jsonb),
      'drivers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', d.id, 'display_name', d.display_name) ORDER BY d.display_name)
        FROM public.mileage_drivers d
      ), '[]'::jsonb),
      'vehicles', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object('driver_id', v.driver_id, 'valid_from', v.valid_from, 'fuel_type', v.fuel_type, 'engine_cc', v.engine_cc)
          ORDER BY v.driver_id, v.valid_from
        )
        FROM public.mileage_vehicles v
      ), '[]'::jsonb)
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mileage_report_dataset_v01(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mileage_report_dataset_v01(date, date) TO service_role;

COMMIT;
