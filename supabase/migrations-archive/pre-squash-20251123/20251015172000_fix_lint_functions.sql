BEGIN;

-- Drop outdated functions that reference legacy columns
DROP FUNCTION IF EXISTS public.convert_quote_to_invoice(uuid);
DROP FUNCTION IF EXISTS public.generate_invoice_from_recurring(uuid);
DROP FUNCTION IF EXISTS public.process_recurring_invoices();
DROP FUNCTION IF EXISTS public.recalculate_invoice_totals(uuid);
DROP FUNCTION IF EXISTS public.recalculate_quote_totals(uuid);
DROP FUNCTION IF EXISTS public.trigger_recalculate_invoice_totals();
DROP FUNCTION IF EXISTS public.trigger_recalculate_quote_totals();

-- Update check_expired_quotes to use current quote schema
CREATE OR REPLACE FUNCTION public.check_expired_quotes()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE quotes
  SET status = 'expired',
      updated_at = NOW()
  WHERE status IN ('sent', 'draft')
    AND valid_until < CURRENT_DATE;
END;
$$;

-- Ensure customer regulars function matches declared return types
CREATE OR REPLACE FUNCTION public.get_category_regulars(p_category_id uuid, p_days_back integer DEFAULT 90)
RETURNS TABLE(
  customer_id uuid,
  first_name character varying,
  last_name character varying,
  mobile_number character varying,
  times_attended integer,
  last_attended_date date,
  days_since_last_visit integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.first_name::varchar,
    c.last_name::varchar,
    c.mobile_number::varchar,
    ccs.times_attended,
    ccs.last_attended_date,
    CASE
      WHEN ccs.last_attended_date IS NOT NULL THEN (CURRENT_DATE - ccs.last_attended_date)::integer
      ELSE NULL
    END
  FROM customer_category_stats ccs
  JOIN customers c ON c.id = ccs.customer_id
  WHERE ccs.category_id = p_category_id
    AND ccs.last_attended_date >= CURRENT_DATE - (p_days_back * INTERVAL '1 day')
    AND c.sms_opt_in = true
  ORDER BY ccs.times_attended DESC, ccs.last_attended_date DESC;
END;
$$;

-- Compare employee versions using text-based audit identifiers
CREATE OR REPLACE FUNCTION public.compare_employee_versions(p_employee_id uuid, p_version1 integer, p_version2 integer)
RETURNS TABLE(
  field_name text,
  version1_value text,
  version2_value text,
  changed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_record1 jsonb := '{}'::jsonb;
  v_record2 jsonb := '{}'::jsonb;
  v_all_keys text[] := ARRAY[]::text[];
BEGIN
  SELECT COALESCE(new_values, '{}'::jsonb)
    INTO v_record1
  FROM employee_version_history
  WHERE employee_id = p_employee_id::text
    AND version_number = p_version1;

  SELECT COALESCE(new_values, '{}'::jsonb)
    INTO v_record2
  FROM employee_version_history
  WHERE employee_id = p_employee_id::text
    AND version_number = p_version2;

  SELECT ARRAY(SELECT DISTINCT key FROM (
      SELECT jsonb_object_keys(v_record1) AS key
      UNION ALL
      SELECT jsonb_object_keys(v_record2) AS key
    ) AS keys)
    INTO v_all_keys;

  RETURN QUERY
  SELECT
    key,
    v_record1->>key,
    v_record2->>key,
    (v_record1->>key IS DISTINCT FROM v_record2->>key)
  FROM unnest(COALESCE(v_all_keys, ARRAY[]::text[])) AS key
  WHERE key NOT IN ('created_at', 'updated_at')
  ORDER BY key;
END;
$$;

-- Employee change summary uses text resource identifiers
CREATE OR REPLACE FUNCTION public.get_employee_changes_summary(
  p_employee_id uuid,
  p_start_date timestamptz DEFAULT (NOW() - INTERVAL '30 days'),
  p_end_date timestamptz DEFAULT NOW()
)
RETURNS TABLE(
  change_date timestamptz,
  changed_by text,
  operation_type text,
  fields_changed text[],
  summary text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;

-- Restore employee data using current schema
CREATE OR REPLACE FUNCTION public.restore_employee_version(
  p_employee_id uuid,
  p_version_number integer,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_employee_data jsonb;
  v_restored_data jsonb;
BEGIN
  IF NOT user_has_permission(p_user_id, 'employees', 'manage') THEN
    RAISE EXCEPTION 'Insufficient permissions to restore employee versions';
  END IF;

  SELECT new_values
    INTO v_employee_data
  FROM employee_version_history
  WHERE employee_id = p_employee_id::text
    AND version_number = p_version_number;

  IF v_employee_data IS NULL THEN
    RAISE EXCEPTION 'Version % not found for employee %', p_version_number, p_employee_id;
  END IF;

  UPDATE employees
  SET
    first_name = CASE WHEN v_employee_data ? 'first_name' THEN v_employee_data->>'first_name' ELSE first_name END,
    last_name = CASE WHEN v_employee_data ? 'last_name' THEN v_employee_data->>'last_name' ELSE last_name END,
    email_address = CASE WHEN v_employee_data ? 'email_address' THEN v_employee_data->>'email_address' ELSE email_address END,
    phone_number = CASE WHEN v_employee_data ? 'phone_number' THEN v_employee_data->>'phone_number' ELSE phone_number END,
    mobile_number = CASE WHEN v_employee_data ? 'mobile_number' THEN v_employee_data->>'mobile_number' ELSE mobile_number END,
    address = CASE WHEN v_employee_data ? 'address' THEN v_employee_data->>'address' ELSE address END,
    post_code = CASE WHEN v_employee_data ? 'post_code' THEN v_employee_data->>'post_code' ELSE post_code END,
    job_title = CASE WHEN v_employee_data ? 'job_title' THEN v_employee_data->>'job_title' ELSE job_title END,
    status = CASE WHEN v_employee_data ? 'status' THEN v_employee_data->>'status' ELSE status END,
    employment_start_date = CASE WHEN v_employee_data ? 'employment_start_date' THEN NULLIF(v_employee_data->>'employment_start_date', '')::date ELSE employment_start_date END,
    employment_end_date = CASE WHEN v_employee_data ? 'employment_end_date' THEN NULLIF(v_employee_data->>'employment_end_date', '')::date ELSE employment_end_date END,
    date_of_birth = CASE WHEN v_employee_data ? 'date_of_birth' THEN NULLIF(v_employee_data->>'date_of_birth', '')::date ELSE date_of_birth END,
    uniform_preference = CASE WHEN v_employee_data ? 'uniform_preference' THEN v_employee_data->>'uniform_preference' ELSE uniform_preference END,
    keyholder_status = CASE WHEN v_employee_data ? 'keyholder_status' THEN NULLIF(v_employee_data->>'keyholder_status', '')::boolean ELSE keyholder_status END,
    first_shift_date = CASE WHEN v_employee_data ? 'first_shift_date' THEN NULLIF(v_employee_data->>'first_shift_date', '')::date ELSE first_shift_date END,
    updated_at = NOW()
  WHERE employee_id = p_employee_id
  RETURNING to_jsonb(employees.*) INTO v_restored_data;

  RETURN jsonb_build_object(
    'success', true,
    'restored_from_version', p_version_number,
    'data', v_restored_data
  );
END;
$$;

-- Vendor invoice email helper aligned with invoice_* tables
CREATE OR REPLACE FUNCTION public.get_vendor_invoice_email(p_vendor_id uuid)
RETURNS varchar
LANGUAGE plpgsql
AS $$
DECLARE
  v_email varchar(255);
BEGIN
  SELECT email
    INTO v_email
  FROM invoice_vendor_contacts
  WHERE vendor_id = p_vendor_id
  ORDER BY is_primary DESC, created_at ASC
  LIMIT 1;

  IF v_email IS NOT NULL THEN
    RETURN v_email;
  END IF;

  SELECT email
    INTO v_email
  FROM invoice_vendors
  WHERE id = p_vendor_id AND email IS NOT NULL
  LIMIT 1;

  IF v_email IS NOT NULL THEN
    RETURN v_email;
  END IF;

  SELECT email
    INTO v_email
  FROM vendor_contacts
  WHERE vendor_id = p_vendor_id
    AND (receives_invoices = true OR is_primary = true)
  ORDER BY is_primary DESC, created_at ASC
  LIMIT 1;

  IF v_email IS NOT NULL THEN
    RETURN v_email;
  END IF;

  SELECT contact_email
    INTO v_email
  FROM vendors
  WHERE id = p_vendor_id AND contact_email IS NOT NULL
  LIMIT 1;

  RETURN v_email;
END;
$$;

-- Invoice reminder digest updated for current schemas
CREATE OR REPLACE FUNCTION public.generate_invoice_reminder_digest()
RETURNS TABLE(
  category text,
  invoice_id uuid,
  invoice_number varchar,
  vendor_name varchar,
  amount numeric,
  due_date date,
  days_until_due integer
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    'due_soon',
    i.id,
    i.invoice_number,
    v.name,
    i.total_amount,
    i.due_date,
    (i.due_date - CURRENT_DATE)::integer
  FROM invoices i
  JOIN invoice_vendors v ON i.vendor_id = v.id
  WHERE i.status IN ('sent', 'partially_paid')
    AND i.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
    AND NOT EXISTS (
      SELECT 1
      FROM invoice_reminder_settings s
      WHERE s.exclude_vendors @> ARRAY[i.vendor_id]
    );

  RETURN QUERY
  SELECT
    'overdue',
    i.id,
    i.invoice_number,
    v.name,
    i.total_amount,
    i.due_date,
    (CURRENT_DATE - i.due_date)::integer
  FROM invoices i
  JOIN invoice_vendors v ON i.vendor_id = v.id
  WHERE i.status = 'overdue'
    AND NOT EXISTS (
      SELECT 1
      FROM invoice_reminder_settings s
      WHERE s.exclude_vendors @> ARRAY[i.vendor_id]
    );

  RETURN QUERY
  SELECT
    'quote_expiring',
    q.id,
    q.quote_number,
    v.name,
    q.total_amount,
    q.valid_until,
    (q.valid_until - CURRENT_DATE)::integer
  FROM quotes q
  JOIN invoice_vendors v ON q.vendor_id = v.id
  WHERE q.status IN ('sent', 'draft')
    AND q.valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days';

  RETURN QUERY
  SELECT
    'recurring_ready',
    NULL::uuid,
    COALESCE(r.reference, v.name)::varchar,
    v.name,
    NULL::numeric,
    r.next_invoice_date,
    GREATEST((r.next_invoice_date - CURRENT_DATE)::integer, 0)
  FROM recurring_invoices r
  JOIN invoice_vendors v ON r.vendor_id = v.id
  WHERE r.is_active = true
    AND r.next_invoice_date <= CURRENT_DATE
    AND (r.end_date IS NULL OR r.end_date >= CURRENT_DATE);
END;
$$;

-- Encrypt audit data by encoding pgcrypto output
CREATE OR REPLACE FUNCTION public.encrypt_sensitive_audit_data(p_encryption_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_record RECORD;
  v_encrypted_old jsonb;
  v_encrypted_new jsonb;
  v_field text;
  v_plain text;
  v_sensitive_fields text[] := ARRAY[
    'national_insurance_number',
    'bank_account_number',
    'bank_sort_code',
    'ni_number',
    'allergies',
    'illness_history',
    'recent_treatment',
    'disability_details'
  ];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()
      AND r.name = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Only super admins can encrypt audit data';
  END IF;

  FOR v_record IN
    SELECT id, old_values, new_values
    FROM audit_logs
    WHERE resource_type = 'employee'
      AND (old_values IS NOT NULL OR new_values IS NOT NULL)
      AND operation_status = 'success'
  LOOP
    v_encrypted_old := v_record.old_values;
    IF v_encrypted_old IS NOT NULL THEN
      FOREACH v_field IN ARRAY v_sensitive_fields LOOP
        IF v_encrypted_old ? v_field THEN
          v_plain := v_encrypted_old->>v_field;
          IF v_plain IS NOT NULL THEN
            v_encrypted_old := jsonb_set(
              v_encrypted_old,
              ARRAY[v_field],
              to_jsonb(encode(pgp_sym_encrypt(v_plain, p_encryption_key), 'base64'))
            );
          END IF;
        END IF;
      END LOOP;
    END IF;

    v_encrypted_new := v_record.new_values;
    IF v_encrypted_new IS NOT NULL THEN
      FOREACH v_field IN ARRAY v_sensitive_fields LOOP
        IF v_encrypted_new ? v_field THEN
          v_plain := v_encrypted_new->>v_field;
          IF v_plain IS NOT NULL THEN
            v_encrypted_new := jsonb_set(
              v_encrypted_new,
              ARRAY[v_field],
              to_jsonb(encode(pgp_sym_encrypt(v_plain, p_encryption_key), 'base64'))
            );
          END IF;
        END IF;
      END LOOP;
    END IF;

    -- Immutable audit log retained; this function intentionally avoids UPDATEs.
  END LOOP;
END;
$$;

COMMIT;
