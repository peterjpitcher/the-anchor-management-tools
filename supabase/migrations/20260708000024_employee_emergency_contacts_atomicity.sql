BEGIN;

CREATE OR REPLACE FUNCTION public.replace_employee_emergency_contacts(
  p_employee_id uuid,
  p_contacts jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked_employee_id uuid;
  v_saved_count integer := 0;
BEGIN
  IF jsonb_typeof(p_contacts) <> 'array' THEN
    RAISE EXCEPTION 'Emergency contacts payload must be an array';
  END IF;

  SELECT employee_id
  INTO v_locked_employee_id
  FROM public.employees
  WHERE employee_id = p_employee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  DELETE FROM public.employee_emergency_contacts
  WHERE employee_id = p_employee_id;

  WITH input_contacts AS (
    SELECT
      row_number() OVER () AS contact_order,
      NULLIF(btrim(item->>'name'), '') AS name,
      NULLIF(btrim(item->>'relationship'), '') AS relationship,
      NULLIF(btrim(item->>'phone_number'), '') AS phone_number,
      NULLIF(btrim(item->>'mobile_number'), '') AS mobile_number,
      NULLIF(btrim(item->>'address'), '') AS address,
      NULLIF(btrim(item->>'priority'), '') AS priority
    FROM jsonb_array_elements(p_contacts) AS item
  ),
  inserted AS (
    INSERT INTO public.employee_emergency_contacts (
      employee_id,
      name,
      relationship,
      phone_number,
      mobile_number,
      address,
      priority
    )
    SELECT
      p_employee_id,
      name,
      relationship,
      phone_number,
      mobile_number,
      address,
      priority
    FROM input_contacts
    WHERE name IS NOT NULL
    ORDER BY contact_order
    RETURNING id
  )
  SELECT count(*)::integer
  INTO v_saved_count
  FROM inserted;

  RETURN jsonb_build_object('saved', v_saved_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_employee_emergency_contacts(uuid, jsonb) TO authenticated, service_role;

COMMIT;
