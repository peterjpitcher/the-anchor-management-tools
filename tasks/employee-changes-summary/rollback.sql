-- Restores the definition live before 20261029114216 (it failed with 42702 on every call).
CREATE OR REPLACE FUNCTION public.get_employee_changes_summary(p_employee_id uuid, p_start_date timestamp with time zone DEFAULT (now() - '30 days'::interval), p_end_date timestamp with time zone DEFAULT now())
 RETURNS TABLE(change_date timestamp with time zone, changed_by text, operation_type text, fields_changed text[], summary text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN QUERY
  WITH changes AS (
    SELECT
      al.created_at,
      al.user_email,
      al.operation_type,
      al.old_values,
      al.new_values,
      CASE
        WHEN al.operation_type = 'create' THEN ARRAY['Employee created']
        WHEN al.operation_type = 'delete' THEN ARRAY['Employee deleted']
        WHEN al.operation_type = 'update' THEN ARRAY(
          SELECT key
          FROM jsonb_each_text(COALESCE(al.new_values, '{}'::jsonb)) AS n(key, value)
          WHERE NOT EXISTS (
            SELECT 1
            FROM jsonb_each_text(COALESCE(al.old_values, '{}'::jsonb)) AS o(key, value)
            WHERE o.key = n.key
              AND o.value IS NOT DISTINCT FROM n.value
          )
        )
        ELSE ARRAY[]::text[]
      END AS changed_fields
    FROM audit_logs al
    WHERE al.resource_type = 'employee'
      AND al.resource_id = p_employee_id::text
      AND al.created_at BETWEEN p_start_date AND p_end_date
      AND al.operation_status = 'success'
  )
  SELECT
    created_at,
    user_email,
    operation_type,
    changed_fields,
    CASE
      WHEN operation_type = 'create' THEN 'Employee record created'
      WHEN operation_type = 'delete' THEN 'Employee record deleted'
      WHEN operation_type = 'update' THEN
        'Updated ' || COALESCE(array_length(changed_fields, 1), 0) || ' field(s): ' || COALESCE(array_to_string(changed_fields, ', '), '')
      ELSE operation_type
    END
  FROM changes
  ORDER BY created_at DESC;
END;
$function$;
