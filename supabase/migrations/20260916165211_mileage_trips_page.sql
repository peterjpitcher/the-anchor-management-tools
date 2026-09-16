-- Mileage trips page: filtering, sorting, paging and totals in one validated function that reads
-- one snapshot (spec 7.1). Read-only; no data changes.
--
-- Spec: tasks/spec-2026-09-15-mileage-section-design.md section 7.1.
-- Must sort after 20260916162107_mileage_report_dataset.sql, whose mileage_trip_rows_v01 view it
-- reads. Works before and after the Release 3 cutover: a trip with no driver is listed, and only a
-- driver filter leaves it out.
--
-- Returns one JSON document, so the API's 1,000-row cap never truncates it; p_limit (1 to 5,000)
-- is the only page size.

BEGIN;

CREATE OR REPLACE FUNCTION public.mileage_trips_page_v01(
  p_filters jsonb,
  p_sort text,
  p_direction text,
  p_limit integer,
  p_offset integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_key text;
  v_value jsonb;
  v_from_text text;
  v_to_text text;
  v_from date;
  v_to date;
  v_place uuid;
  v_driver uuid;
  v_source text;
  v_search text;
  v_pattern text;
BEGIN
  -- Messages are codes the app maps to wording; anything after the colon is detail for logs.
  IF p_filters IS NULL OR jsonb_typeof(p_filters) <> 'object' THEN
    RAISE EXCEPTION 'MILEAGE_LIST_INVALID_FILTERS: filters must be an object';
  END IF;
  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_filters) LOOP
    IF v_key NOT IN ('from', 'to', 'search', 'place_id', 'source', 'driver_id') THEN
      RAISE EXCEPTION 'MILEAGE_LIST_INVALID_FILTERS: unknown key %', v_key;
    END IF;
    IF jsonb_typeof(v_value) NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'MILEAGE_LIST_INVALID_FILTERS: % must be text', v_key;
    END IF;
  END LOOP;

  -- Dates must be YYYY-MM-DD: a bare cast would also accept words such as 'today' or 'infinity'.
  v_from_text := NULLIF(p_filters ->> 'from', '');
  v_to_text := NULLIF(p_filters ->> 'to', '');
  IF v_from_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR v_to_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'MILEAGE_LIST_INVALID_FILTERS: dates must be YYYY-MM-DD';
  END IF;

  BEGIN
    v_from := v_from_text::date;
    v_to := v_to_text::date;
    v_place := NULLIF(p_filters ->> 'place_id', '')::uuid;
    v_driver := NULLIF(p_filters ->> 'driver_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'MILEAGE_LIST_INVALID_FILTERS: a date or id is not valid';
  END;

  v_source := NULLIF(p_filters ->> 'source', '');
  v_search := NULLIF(BTRIM(p_filters ->> 'search'), '');

  IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_from > v_to THEN
    RAISE EXCEPTION 'MILEAGE_LIST_INVALID_FILTERS: from is after to';
  END IF;
  IF v_source IS NOT NULL AND v_source NOT IN ('manual', 'oj_projects') THEN
    RAISE EXCEPTION 'MILEAGE_LIST_INVALID_FILTERS: unknown source';
  END IF;
  IF v_search IS NOT NULL AND char_length(v_search) > 80 THEN
    RAISE EXCEPTION 'MILEAGE_LIST_INVALID_FILTERS: search is too long';
  END IF;
  IF p_sort IS NULL OR p_sort NOT IN ('date', 'miles', 'amount') OR p_direction IS NULL OR p_direction NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'MILEAGE_LIST_INVALID_SORT';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 OR p_offset IS NULL OR p_offset < 0 OR p_offset > 1000000 THEN
    RAISE EXCEPTION 'MILEAGE_LIST_INVALID_PAGE';
  END IF;

  -- Search text is matched literally: backslash, percent and underscore are escaped.
  IF v_search IS NOT NULL THEN
    v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  -- One statement, so the rows, the count and the totals all read the same snapshot.
  RETURN (
    WITH filtered AS (
      SELECT r.id, r.trip_date, r.created_at, r.total_miles_tenths, r.amount_pence, r.row_json
      FROM public.mileage_trip_rows_v01 r
      WHERE (v_from IS NULL OR r.trip_date >= v_from)
        AND (v_to IS NULL OR r.trip_date <= v_to)
        AND (v_source IS NULL OR r.source = v_source)
        AND (v_driver IS NULL OR r.driver_id = v_driver)
        AND (v_place IS NULL OR EXISTS (
          SELECT 1 FROM public.mileage_trip_legs l
          WHERE l.trip_id = r.id AND (l.from_destination_id = v_place OR l.to_destination_id = v_place)
        ))
        AND (v_pattern IS NULL
          OR r.description ILIKE v_pattern
          OR EXISTS (
            SELECT 1
            FROM public.mileage_trip_legs l
            JOIN public.mileage_destinations d ON d.id IN (l.from_destination_id, l.to_destination_id)
            WHERE l.trip_id = r.id AND d.name ILIKE v_pattern
          ))
    ),
    ordered AS (
      -- Every sort ends with date, created time and id, in the same direction, so pages never
      -- overlap or skip a trip.
      SELECT
        f.row_json,
        ROW_NUMBER() OVER (
          ORDER BY
            CASE WHEN p_sort = 'miles' AND p_direction = 'asc' THEN f.total_miles_tenths END ASC,
            CASE WHEN p_sort = 'miles' AND p_direction = 'desc' THEN f.total_miles_tenths END DESC,
            CASE WHEN p_sort = 'amount' AND p_direction = 'asc' THEN f.amount_pence END ASC,
            CASE WHEN p_sort = 'amount' AND p_direction = 'desc' THEN f.amount_pence END DESC,
            CASE WHEN p_direction = 'asc' THEN f.trip_date END ASC,
            CASE WHEN p_direction = 'desc' THEN f.trip_date END DESC,
            CASE WHEN p_direction = 'asc' THEN f.created_at END ASC,
            CASE WHEN p_direction = 'desc' THEN f.created_at END DESC,
            CASE WHEN p_direction = 'asc' THEN f.id END ASC,
            CASE WHEN p_direction = 'desc' THEN f.id END DESC
        ) AS position
      FROM filtered f
    ),
    page AS (
      SELECT row_json, position FROM ordered ORDER BY position LIMIT p_limit OFFSET p_offset
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(page.row_json ORDER BY page.position) FROM page), '[]'::jsonb),
      'total_count', (SELECT count(*) FROM filtered),
      'totals', jsonb_build_object(
        'trips', (SELECT count(*) FROM filtered),
        'miles_tenths', (SELECT COALESCE(sum(filtered.total_miles_tenths), 0) FROM filtered),
        'amount_pence', (SELECT COALESCE(sum(filtered.amount_pence), 0) FROM filtered)
      )
    )
  );
END;
$function$;

-- The live default privileges grant EXECUTE on new functions to anon and authenticated, so
-- revoking from PUBLIC alone would leave the function callable with the browser key.
REVOKE ALL ON FUNCTION public.mileage_trips_page_v01(jsonb, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mileage_trips_page_v01(jsonb, text, text, integer, integer) TO service_role;

COMMIT;
