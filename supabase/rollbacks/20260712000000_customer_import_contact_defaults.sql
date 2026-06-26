CREATE OR REPLACE FUNCTION public.import_customers_atomic(p_customers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created jsonb := '[]'::jsonb;
  v_valid_count integer := 0;
  v_created_count integer := 0;
BEGIN
  IF jsonb_typeof(p_customers) <> 'array' THEN
    RAISE EXCEPTION 'Customer import payload must be an array';
  END IF;

  WITH input_rows AS (
    SELECT
      row_number() OVER () AS import_order,
      NULLIF(btrim(item->>'first_name'), '') AS first_name,
      COALESCE(NULLIF(btrim(item->>'last_name'), ''), '') AS last_name,
      NULLIF(btrim(item->>'mobile_number'), '') AS mobile_number,
      NULLIF(lower(btrim(item->>'email')), '') AS email,
      COALESCE((item->>'sms_opt_in')::boolean, false) AS sms_opt_in
    FROM jsonb_array_elements(p_customers) AS item
  ),
  valid_rows AS (
    SELECT *
    FROM input_rows
    WHERE mobile_number IS NOT NULL
      AND (first_name IS NOT NULL OR last_name <> '')
  ),
  counted AS (
    SELECT count(*)::integer AS valid_count FROM valid_rows
  ),
  inserted AS (
    INSERT INTO public.customers (
      first_name,
      last_name,
      mobile_number,
      mobile_e164,
      email,
      sms_opt_in
    )
    SELECT
      COALESCE(v.first_name, ''),
      v.last_name,
      v.mobile_number,
      v.mobile_number,
      v.email,
      v.sms_opt_in
    FROM valid_rows v
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.mobile_e164 = v.mobile_number
         OR c.mobile_number = v.mobile_number
         OR (v.email IS NOT NULL AND lower(c.email) = v.email)
    )
    ORDER BY v.import_order
    ON CONFLICT DO NOTHING
    RETURNING *
  ),
  created_json AS (
    SELECT
      COALESCE(jsonb_agg(to_jsonb(inserted.*) ORDER BY inserted.created_at, inserted.id), '[]'::jsonb) AS created,
      count(*)::integer AS created_count
    FROM inserted
  )
  SELECT counted.valid_count, created_json.created, created_json.created_count
  INTO v_valid_count, v_created, v_created_count
  FROM counted, created_json;

  RETURN jsonb_build_object(
    'created', v_created,
    'skippedExisting', GREATEST(v_valid_count - v_created_count, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_customers_atomic(jsonb) TO authenticated, service_role;
