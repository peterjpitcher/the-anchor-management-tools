-- Fix the employee "Recent Changes" panel, which has failed on every load.
--
-- get_employee_changes_summary returned 42702 "column reference operation_type
-- is ambiguous": its RETURNS TABLE output columns are PL/pgSQL variables, and
-- the outer SELECT named the CTE's columns without a table alias. Every column
-- is now qualified.
--
-- While here:
--   * Only real record changes are listed. Reliability scoring, shift replies
--     and birthday reminder runs (over 2,000 rows) are left out, so they cannot
--     push the edits staff care about off the five-row panel.
--   * Each change reads as a sentence, and changed field names are shown with
--     spaces instead of underscores. Timestamps (updated_at, created_at) are
--     not counted as changed fields.
--   * The function is SECURITY DEFINER, so it now checks employees/view itself
--     rather than relying on the one server action that calls it.
--
-- Same signature, so CREATE OR REPLACE keeps the existing EXECUTE grants
-- (authenticated and service_role; anon has none).

CREATE OR REPLACE FUNCTION public.get_employee_changes_summary(
  p_employee_id uuid,
  p_start_date timestamp with time zone DEFAULT (now() - '30 days'::interval),
  p_end_date timestamp with time zone DEFAULT now()
)
RETURNS TABLE(change_date timestamp with time zone, changed_by text, operation_type text, fields_changed text[], summary text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT COALESCE(public.user_has_permission(auth.uid(), 'employees', 'view'), false) THEN
    RAISE EXCEPTION 'Insufficient permissions' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH changes AS (
    SELECT
      al.created_at,
      al.user_email,
      al.operation_type AS op,
      CASE
        WHEN al.operation_type = 'update' THEN ARRAY(
          SELECT replace(n.key, '_', ' ')
          FROM jsonb_each_text(COALESCE(al.new_values, '{}'::jsonb)) AS n(key, value)
          WHERE n.key NOT IN ('updated_at', 'created_at')
            AND NOT EXISTS (
            SELECT 1
            FROM jsonb_each_text(COALESCE(al.old_values, '{}'::jsonb)) AS o(key, value)
            WHERE o.key = n.key
              AND o.value IS NOT DISTINCT FROM n.value
          )
          ORDER BY n.key
        )
        ELSE ARRAY[]::text[]
      END AS changed_fields
    FROM public.audit_logs al
    WHERE al.resource_type = 'employee'
      AND al.resource_id = p_employee_id::text
      AND al.created_at BETWEEN p_start_date AND p_end_date
      AND al.operation_status = 'success'
      AND al.operation_type NOT IN ('reliability_event', 'holiday_reliability', 'shift_response', 'send_birthday_reminders')
  )
  SELECT
    c.created_at,
    c.user_email,
    c.op,
    c.changed_fields,
    CASE c.op
      WHEN 'create' THEN 'Employee record created'
      WHEN 'delete' THEN 'Employee record deleted'
      WHEN 'update' THEN
        CASE
          WHEN COALESCE(array_length(c.changed_fields, 1), 0) = 0 THEN 'Employee record updated'
          ELSE 'Updated ' || array_length(c.changed_fields, 1) || ' field(s): ' || array_to_string(c.changed_fields, ', ')
        END
      WHEN 'status_change' THEN 'Employment status changed'
      WHEN 'add_note' THEN 'Note added'
      WHEN 'add_attachment' THEN 'Document added'
      WHEN 'delete_attachment' THEN 'Document removed'
      WHEN 'invite' THEN 'Invited to the staff portal'
      WHEN 'onboarding_complete' THEN 'Onboarding completed'
      WHEN 'access_revoked' THEN 'Staff portal access removed'
      ELSE initcap(replace(c.op, '_', ' '))
    END
  FROM changes c
  ORDER BY c.created_at DESC;
END;
$function$;
