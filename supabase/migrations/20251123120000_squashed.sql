-- Squashed migration generated on 2025-11-23
-- Consolidated from supabase/migrations-backup and supabase/migrations-archive/pre-squash-20251123
-- Do not re-run individual pre-squash migrations; this file is the new base.

-- Begin 20240625000000_initial_baseline.sql

--
-- Baseline migration created from production schema on 2025-06-25
-- Previous migrations archived in archive_20250625 folder
-- This represents the complete schema as deployed in production
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."calculate_balance_due_date"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.event_date IS NOT NULL AND NEW.balance_due_date IS NULL THEN
    NEW.balance_due_date := NEW.event_date - INTERVAL '7 days';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."calculate_balance_due_date"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_message_cost"("segments" integer) RETURNS numeric
    LANGUAGE "plpgsql"
    AS $_$
BEGIN
  -- Twilio SMS pricing for UK (approximate)
  -- $0.04 per segment
  RETURN segments * 0.04;
END;
$_$;


ALTER FUNCTION "public"."calculate_message_cost"("segments" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_private_booking_balance"("p_booking_id" "uuid") RETURNS numeric
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_total NUMERIC;
  v_deposit_paid NUMERIC;
  v_final_paid NUMERIC;
BEGIN
  -- Get total from booking items
  SELECT COALESCE(SUM(line_total), 0) INTO v_total
  FROM private_booking_items
  WHERE booking_id = p_booking_id;
  
  -- Get deposit amount paid
  SELECT COALESCE(deposit_amount, 0) INTO v_deposit_paid
  FROM private_bookings
  WHERE id = p_booking_id
    AND deposit_paid_date IS NOT NULL;
  
  -- Check if final payment made
  SELECT CASE WHEN final_payment_date IS NOT NULL THEN 0 ELSE 1 END INTO v_final_paid
  FROM private_bookings
  WHERE id = p_booking_id;
  
  -- If final payment made, balance is 0
  IF v_final_paid = 0 THEN
    RETURN 0;
  END IF;
  
  -- Otherwise return total minus deposit
  RETURN v_total - v_deposit_paid;
END;
$$;


ALTER FUNCTION "public"."calculate_private_booking_balance"("p_booking_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_send_time"("p_event_timestamp" timestamp with time zone, "p_send_timing" "text", "p_custom_hours" integer DEFAULT NULL::integer) RETURNS timestamp with time zone
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  CASE p_send_timing
    WHEN 'immediate' THEN
      RETURN NOW();
    WHEN '1_hour' THEN
      RETURN p_event_timestamp - INTERVAL '1 hour';
    WHEN '12_hours' THEN
      RETURN p_event_timestamp - INTERVAL '12 hours';
    WHEN '24_hours' THEN
      RETURN p_event_timestamp - INTERVAL '24 hours';
    WHEN '7_days' THEN
      RETURN p_event_timestamp - INTERVAL '7 days';
    WHEN 'custom' THEN
      IF p_custom_hours IS NOT NULL THEN
        RETURN p_event_timestamp - (p_custom_hours || ' hours')::INTERVAL;
      ELSE
        RETURN p_event_timestamp; -- Fallback if custom hours not provided
      END IF;
    ELSE
      RETURN p_event_timestamp; -- Fallback for unknown timing
  END CASE;
END;
$$;


ALTER FUNCTION "public"."calculate_send_time"("p_event_timestamp" timestamp with time zone, "p_send_timing" "text", "p_custom_hours" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."calculate_send_time"("p_event_timestamp" timestamp with time zone, "p_send_timing" "text", "p_custom_hours" integer) IS 'Calculates when a message should be sent based on event time and timing configuration';



CREATE OR REPLACE FUNCTION "public"."categorize_historical_events"() RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_count INTEGER := 0;
  v_temp_count INTEGER;
  v_quiz_id UUID;
  v_tasting_id UUID;
  v_bingo_id UUID;
  v_drag_id UUID;
BEGIN
  -- Get category IDs
  SELECT id INTO v_quiz_id FROM event_categories WHERE name = 'Quiz Night';
  SELECT id INTO v_tasting_id FROM event_categories WHERE name = 'Tasting Night';
  SELECT id INTO v_bingo_id FROM event_categories WHERE name = 'Bingo Night';
  SELECT id INTO v_drag_id FROM event_categories WHERE name = 'Drag Night';

  -- Update events based on name patterns
  -- Quiz nights
  UPDATE events 
  SET category_id = v_quiz_id 
  WHERE category_id IS NULL 
    AND (LOWER(name) LIKE '%quiz%' OR LOWER(name) LIKE '%trivia%')
    AND v_quiz_id IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Tasting nights
  UPDATE events 
  SET category_id = v_tasting_id 
  WHERE category_id IS NULL 
    AND (LOWER(name) LIKE '%tasting%' OR LOWER(name) LIKE '%wine%' OR LOWER(name) LIKE '%whisky%' OR LOWER(name) LIKE '%beer%')
    AND v_tasting_id IS NOT NULL;
  GET DIAGNOSTICS v_temp_count = ROW_COUNT;
  v_count := v_count + v_temp_count;

  -- Bingo nights
  UPDATE events 
  SET category_id = v_bingo_id 
  WHERE category_id IS NULL 
    AND LOWER(name) LIKE '%bingo%'
    AND v_bingo_id IS NOT NULL;
  GET DIAGNOSTICS v_temp_count = ROW_COUNT;
  v_count := v_count + v_temp_count;

  -- Drag nights
  UPDATE events 
  SET category_id = v_drag_id 
  WHERE category_id IS NULL 
    AND (LOWER(name) LIKE '%drag%' OR LOWER(name) LIKE '%cabaret%')
    AND v_drag_id IS NOT NULL;
  GET DIAGNOSTICS v_temp_count = ROW_COUNT;
  v_count := v_count + v_temp_count;

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."categorize_historical_events"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_event_date_not_past"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Only check on INSERT, not UPDATE (to allow updating past events)
  IF TG_OP = 'INSERT' THEN
    IF NEW.date < CURRENT_DATE THEN
      RAISE EXCEPTION 'Cannot create events with dates in the past';
    END IF;
  END IF;
  
  -- For UPDATE, prevent changing a future event to a past date
  IF TG_OP = 'UPDATE' THEN
    -- If the old date was in the future and new date is in the past, prevent it
    IF OLD.date >= CURRENT_DATE AND NEW.date < CURRENT_DATE THEN
      RAISE EXCEPTION 'Cannot change event date to the past';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_event_date_not_past"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_import"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  DROP FUNCTION IF EXISTS import_message_history();
  DROP FUNCTION IF EXISTS find_customer_by_phone(TEXT);
  DROP FUNCTION IF EXISTS clean_phone_for_match(TEXT);
END;
$$;


ALTER FUNCTION "public"."cleanup_import"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_old_jobs"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM background_jobs
  WHERE (status = 'completed' AND completed_at < NOW() - INTERVAL '7 days')
     OR (status = 'failed' AND created_at < NOW() - INTERVAL '30 days');
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_old_jobs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_old_reminder_logs"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  DELETE FROM reminder_processing_logs
  WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '30 days';
END;
$$;


ALTER FUNCTION "public"."cleanup_old_reminder_logs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compare_employee_versions"("p_employee_id" "uuid", "p_version1" integer, "p_version2" integer) RETURNS TABLE("field_name" "text", "version1_value" "text", "version2_value" "text", "changed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_record1 JSONB;
  v_record2 JSONB;
  v_all_keys TEXT[];
BEGIN
  -- Get the two versions
  SELECT new_values INTO v_record1
  FROM employee_version_history
  WHERE employee_id = p_employee_id AND version_number = p_version1;

  SELECT new_values INTO v_record2
  FROM employee_version_history
  WHERE employee_id = p_employee_id AND version_number = p_version2;

  -- Get all unique keys from both versions
  SELECT ARRAY(
    SELECT DISTINCT jsonb_object_keys(v_record1) 
    UNION 
    SELECT DISTINCT jsonb_object_keys(v_record2)
  ) INTO v_all_keys;

  -- Compare each field
  RETURN QUERY
  SELECT 
    key AS field_name,
    v_record1->>key AS version1_value,
    v_record2->>key AS version2_value,
    (v_record1->>key IS DISTINCT FROM v_record2->>key) AS changed
  FROM unnest(v_all_keys) AS key
  WHERE key NOT IN ('id', 'created_at', 'updated_at') -- Exclude system fields
  ORDER BY 
    CASE 
      -- Order important fields first
      WHEN key LIKE '%name%' THEN 1
      WHEN key LIKE '%email%' THEN 2
      WHEN key LIKE '%phone%' THEN 3
      WHEN key LIKE '%job%' THEN 4
      ELSE 5
    END,
    key;
END;
$$;


ALTER FUNCTION "public"."compare_employee_versions"("p_employee_id" "uuid", "p_version1" integer, "p_version2" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."compare_employee_versions"("p_employee_id" "uuid", "p_version1" integer, "p_version2" integer) IS 'Compare two versions of an employee record to see what changed';



CREATE OR REPLACE FUNCTION "public"."date_utc"(timestamp with time zone) RETURNS "date"
    LANGUAGE "sql" IMMUTABLE
    AS $_$
  SELECT DATE($1 AT TIME ZONE 'UTC');
$_$;


ALTER FUNCTION "public"."date_utc"(timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."encrypt_sensitive_audit_data"("p_encryption_key" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_record RECORD;
  v_encrypted_old JSONB;
  v_encrypted_new JSONB;
  v_sensitive_fields TEXT[] := ARRAY[
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
  -- Only super admins can run this
  IF NOT EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Only super admins can encrypt audit data';
  END IF;

  -- Process each employee audit log
  FOR v_record IN
    SELECT id, old_values, new_values
    FROM audit_logs
    WHERE resource_type = 'employee'
      AND (old_values IS NOT NULL OR new_values IS NOT NULL)
      AND operation_status = 'success'
  LOOP
    -- Encrypt sensitive fields in old_values
    IF v_record.old_values IS NOT NULL THEN
      v_encrypted_old = v_record.old_values;
      FOR i IN 1..array_length(v_sensitive_fields, 1) LOOP
        IF v_encrypted_old ? v_sensitive_fields[i] THEN
          v_encrypted_old = jsonb_set(
            v_encrypted_old,
            ARRAY[v_sensitive_fields[i]],
            to_jsonb(pgp_sym_encrypt(
              v_encrypted_old->v_sensitive_fields[i],
              p_encryption_key
            ))
          );
        END IF;
      END LOOP;
    END IF;

    -- Encrypt sensitive fields in new_values
    IF v_record.new_values IS NOT NULL THEN
      v_encrypted_new = v_record.new_values;
      FOR i IN 1..array_length(v_sensitive_fields, 1) LOOP
        IF v_encrypted_new ? v_sensitive_fields[i] THEN
          v_encrypted_new = jsonb_set(
            v_encrypted_new,
            ARRAY[v_sensitive_fields[i]],
            to_jsonb(pgp_sym_encrypt(
              v_encrypted_new->v_sensitive_fields[i],
              p_encryption_key
            ))
          );
        END IF;
      END LOOP;
    END IF;

    -- Note: We can't actually update audit_logs due to immutability
    -- This function would need to be modified to create a new encrypted audit table
    -- or the immutability constraint would need to be temporarily disabled
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."encrypt_sensitive_audit_data"("p_encryption_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_single_default_category"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- If setting this category as default
  IF NEW.is_default = true THEN
    -- Remove default flag from all other categories
    UPDATE event_categories 
    SET is_default = false 
    WHERE id != NEW.id AND is_default = true;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."ensure_single_default_category"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_all_users_unsafe"() RETURNS TABLE("id" "uuid", "email" "text", "created_at" timestamp with time zone, "last_sign_in_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id,
        u.email::text,
        u.created_at,
        u.last_sign_in_at
    FROM auth.users u
    ORDER BY u.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_all_users_unsafe"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_all_users_with_roles"() RETURNS TABLE("id" "uuid", "email" "text", "created_at" timestamp with time zone, "last_sign_in_at" timestamp with time zone, "roles" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    -- Check if the current user is a super admin
    IF NOT EXISTS (
        SELECT 1 
        FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() 
        AND r.name = 'super_admin'
    ) THEN
        RAISE EXCEPTION 'Access denied. Only super admins can view all users.';
    END IF;
    
    -- Return all users with their roles
    RETURN QUERY
    SELECT 
        u.id,
        u.email::TEXT,
        u.created_at,
        u.last_sign_in_at,
        COALESCE(
            jsonb_agg(
                DISTINCT jsonb_build_object(
                    'id', r.id,
                    'name', r.name,
                    'description', r.description
                )
            ) FILTER (WHERE r.id IS NOT NULL),
            '[]'::jsonb
        ) as roles
    FROM auth.users u
    LEFT JOIN public.user_roles ur ON u.id = ur.user_id
    LEFT JOIN public.roles r ON ur.role_id = r.id
    GROUP BY u.id, u.email, u.created_at, u.last_sign_in_at
    ORDER BY u.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_all_users_with_roles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_bookings_needing_reminders"() RETURNS TABLE("booking_id" "uuid", "customer_id" "uuid", "event_id" "uuid", "template_type" "text", "reminder_type" "text", "send_timing" "text", "custom_timing_hours" integer)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  WITH template_configs AS (
    -- Get all active message templates with their timing
    SELECT DISTINCT
      mt.template_type,
      mt.send_timing,
      mt.custom_timing_hours,
      CASE 
        WHEN mt.send_timing = '1_hour' THEN 1
        WHEN mt.send_timing = '12_hours' THEN 12
        WHEN mt.send_timing = '24_hours' THEN 24
        WHEN mt.send_timing = '7_days' THEN 168
        WHEN mt.send_timing = 'custom' THEN mt.custom_timing_hours
        ELSE NULL
      END AS hours_before_event
    FROM message_templates mt
    WHERE mt.is_active = true
      AND mt.send_timing != 'immediate'
      AND mt.template_type IN (
        'dayBeforeReminder', 
        'weekBeforeReminder',
        'booking_reminder_24_hour',
        'booking_reminder_7_day'
      )
  ),
  bookings_with_timing AS (
    -- Get all bookings with customers opted in for SMS
    SELECT 
      b.id AS booking_id,
      b.customer_id,
      b.event_id,
      b.seats,
      e.date AS event_date,
      e.time AS event_time,
      c.sms_opt_in,
      c.mobile_number
    FROM bookings b
    INNER JOIN events e ON b.event_id = e.id
    INNER JOIN customers c ON b.customer_id = c.id
    WHERE c.sms_opt_in = true
      AND c.mobile_number IS NOT NULL
      AND e.date >= CURRENT_DATE
  )
  -- Match bookings with templates based on timing
  SELECT DISTINCT
    bwt.booking_id,
    bwt.customer_id,
    bwt.event_id,
    tc.template_type,
    CASE 
      WHEN tc.send_timing = '1_hour' THEN '1_hour'
      WHEN tc.send_timing = '12_hours' THEN '12_hour'
      WHEN tc.send_timing = '24_hours' THEN '24_hour'
      WHEN tc.send_timing = '7_days' THEN '7_day'
      WHEN tc.send_timing = 'custom' THEN 'custom_' || tc.custom_timing_hours::TEXT || '_hour'
      ELSE tc.send_timing
    END AS reminder_type,
    tc.send_timing,
    tc.custom_timing_hours
  FROM bookings_with_timing bwt
  CROSS JOIN template_configs tc
  WHERE tc.hours_before_event IS NOT NULL
    -- FIXED: Check if we should send the reminder now
    -- The reminder should be sent when:
    -- current time >= (event time - reminder hours) AND current time < (event time - reminder hours + 1 hour)
    -- This ensures we send within a 1-hour window after the reminder time has passed
    AND NOW() >= ((bwt.event_date::timestamp + bwt.event_time::time) - INTERVAL '1 hour' * tc.hours_before_event)
    AND NOW() < ((bwt.event_date::timestamp + bwt.event_time::time) - INTERVAL '1 hour' * tc.hours_before_event + INTERVAL '1 hour')
    -- Filter for appropriate template type based on booking
    AND (
      -- For bookings with seats
      (bwt.seats > 0 AND tc.template_type IN ('dayBeforeReminder', 'weekBeforeReminder'))
      OR
      -- For reminders (0 seats)
      ((bwt.seats = 0 OR bwt.seats IS NULL) AND tc.template_type IN ('booking_reminder_24_hour', 'booking_reminder_7_day'))
    )
    -- Check if reminder hasn't been sent yet
    AND NOT EXISTS (
      SELECT 1 
      FROM booking_reminders br 
      WHERE br.booking_id = bwt.booking_id 
        AND br.reminder_type = CASE 
          WHEN tc.send_timing = '1_hour' THEN '1_hour'
          WHEN tc.send_timing = '12_hours' THEN '12_hour'
          WHEN tc.send_timing = '24_hours' THEN '24_hour'
          WHEN tc.send_timing = '7_days' THEN '7_day'
          WHEN tc.send_timing = 'custom' THEN 'custom_' || tc.custom_timing_hours::TEXT || '_hour'
          ELSE tc.send_timing
        END
    );
END;
$$;


ALTER FUNCTION "public"."get_bookings_needing_reminders"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_bookings_needing_reminders"() IS 'Returns bookings that need reminders sent based on message template timing configuration. 
FIXED: Corrected timing logic to send reminders when the calculated reminder time has passed
but is still within the last hour. This accounts for the cron job running hourly.
Example: For a 24-hour reminder, if the event is at 7 PM tomorrow, the reminder should be sent
when the cron runs at 9 AM today (since 7 PM tomorrow - 24 hours = 7 PM today, which is 
within the past hour when checked at 9 AM the next day).';



CREATE OR REPLACE FUNCTION "public"."get_category_regulars"("p_category_id" "uuid", "p_days_back" integer DEFAULT 90) RETURNS TABLE("customer_id" "uuid", "first_name" character varying, "last_name" character varying, "mobile_number" character varying, "times_attended" integer, "last_attended_date" "date", "days_since_last_visit" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.first_name,
    c.last_name,
    c.mobile_number,
    ccs.times_attended,
    ccs.last_attended_date,
    EXTRACT(DAY FROM NOW() - ccs.last_attended_date)::INTEGER as days_since_last_visit
  FROM customer_category_stats ccs
  JOIN customers c ON c.id = ccs.customer_id
  WHERE ccs.category_id = p_category_id
    AND ccs.last_attended_date >= CURRENT_DATE - INTERVAL '1 day' * p_days_back
    AND c.sms_opt_in = true  -- Only include customers who can receive SMS
  ORDER BY ccs.times_attended DESC, ccs.last_attended_date DESC;
END;
$$;


ALTER FUNCTION "public"."get_category_regulars"("p_category_id" "uuid", "p_days_back" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_category_regulars"("p_category_id" "uuid", "p_days_back" integer) IS 'Returns customers who attended a specific category within the specified time period';



CREATE OR REPLACE FUNCTION "public"."get_cross_category_suggestions"("p_target_category_id" "uuid", "p_source_category_id" "uuid", "p_limit" integer DEFAULT 20) RETURNS TABLE("customer_id" "uuid", "first_name" character varying, "last_name" character varying, "mobile_number" character varying, "source_times_attended" integer, "source_last_attended" "date", "already_attended_target" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.first_name,
    c.last_name,
    c.mobile_number,
    source_stats.times_attended,
    source_stats.last_attended_date,
    COALESCE(target_stats.customer_id IS NOT NULL, false) as already_attended_target
  FROM customer_category_stats source_stats
  JOIN customers c ON c.id = source_stats.customer_id
  LEFT JOIN customer_category_stats target_stats 
    ON target_stats.customer_id = source_stats.customer_id 
    AND target_stats.category_id = p_target_category_id
  WHERE source_stats.category_id = p_source_category_id
    AND source_stats.times_attended >= 2  -- Regular attendees of source category
    AND (target_stats.customer_id IS NULL  -- Haven't tried target category
         OR target_stats.last_attended_date < CURRENT_DATE - INTERVAL '60 days') -- Or haven't been recently
    AND c.sms_opt_in = true
  ORDER BY 
    source_stats.times_attended DESC,
    source_stats.last_attended_date DESC
  LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."get_cross_category_suggestions"("p_target_category_id" "uuid", "p_source_category_id" "uuid", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_cross_category_suggestions"("p_target_category_id" "uuid", "p_source_category_id" "uuid", "p_limit" integer) IS 'Suggests customers from one category who might enjoy another category';



CREATE OR REPLACE FUNCTION "public"."get_dashboard_stats"() RETURNS TABLE("total_customers" bigint, "new_customers_week" bigint, "upcoming_events" bigint, "recent_bookings" bigint, "unread_messages" bigint, "active_employees" bigint)
    LANGUAGE "plpgsql" STABLE
    AS $$
    BEGIN
      RETURN QUERY
      SELECT 
        (SELECT COUNT(*) FROM customers)::bigint,
        (SELECT COUNT(*) FROM customers WHERE created_at >= CURRENT_DATE - INTERVAL '7 days')::bigint,
        (SELECT COUNT(*) FROM events WHERE date >= CURRENT_DATE)::bigint,
        (SELECT COUNT(*) FROM bookings WHERE created_at >= CURRENT_DATE - INTERVAL '30 days')::bigint,
        (SELECT COUNT(*) FROM messages WHERE direction = 'inbound' AND read_at IS NULL)::bigint,
        (SELECT COUNT(*) FROM employees WHERE is_active = true)::bigint;
    END;
    $$;


ALTER FUNCTION "public"."get_dashboard_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_employee_at_timestamp"("p_employee_id" "uuid", "p_timestamp" timestamp with time zone DEFAULT "now"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_employee_state JSONB;
  v_audit_record RECORD;
BEGIN
  -- Start with the current employee record if it exists
  SELECT to_jsonb(e.*) INTO v_employee_state
  FROM employees e
  WHERE e.id = p_employee_id;

  -- If employee doesn't exist (deleted), start with empty object
  IF v_employee_state IS NULL THEN
    v_employee_state = '{}'::JSONB;
  END IF;

  -- Apply all audit log changes up to the specified timestamp
  FOR v_audit_record IN
    SELECT 
      operation_type,
      old_values,
      new_values,
      created_at
    FROM audit_logs
    WHERE resource_type = 'employee'
      AND resource_id = p_employee_id
      AND created_at <= p_timestamp
      AND operation_status = 'success'
    ORDER BY created_at DESC
  LOOP
    -- For the most recent change before our timestamp, use those values
    IF v_audit_record.operation_type = 'create' THEN
      v_employee_state = v_audit_record.new_values;
    ELSIF v_audit_record.operation_type = 'update' THEN
      v_employee_state = v_audit_record.new_values;
    ELSIF v_audit_record.operation_type = 'delete' THEN
      -- If deleted before our timestamp, employee didn't exist
      RETURN NULL;
    END IF;
    
    -- We only need the first (most recent) record before our timestamp
    EXIT;
  END LOOP;

  RETURN v_employee_state;
END;
$$;


ALTER FUNCTION "public"."get_employee_at_timestamp"("p_employee_id" "uuid", "p_timestamp" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_employee_at_timestamp"("p_employee_id" "uuid", "p_timestamp" timestamp with time zone) IS 'Retrieve the state of an employee record at any point in time';



CREATE OR REPLACE FUNCTION "public"."get_employee_changes_summary"("p_employee_id" "uuid", "p_start_date" timestamp with time zone DEFAULT ("now"() - '30 days'::interval), "p_end_date" timestamp with time zone DEFAULT "now"()) RETURNS TABLE("change_date" timestamp with time zone, "changed_by" "text", "operation_type" "text", "fields_changed" "text"[], "summary" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
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
        WHEN al.operation_type = 'create' THEN 
          ARRAY['Employee created']
        WHEN al.operation_type = 'delete' THEN 
          ARRAY['Employee deleted']
        WHEN al.operation_type = 'update' THEN
          ARRAY(
            SELECT key FROM jsonb_each_text(al.new_values) AS n(key, value)
            WHERE NOT EXISTS (
              SELECT 1 FROM jsonb_each_text(al.old_values) AS o(key, value)
              WHERE o.key = n.key AND o.value = n.value
            )
          )
        ELSE ARRAY[]::TEXT[]
      END as changed_fields
    FROM audit_logs al
    WHERE al.resource_type = 'employee'
      AND al.resource_id = p_employee_id
      AND al.created_at BETWEEN p_start_date AND p_end_date
      AND al.operation_status = 'success'
  )
  SELECT 
    created_at as change_date,
    user_email as changed_by,
    operation_type,
    changed_fields as fields_changed,
    CASE 
      WHEN operation_type = 'create' THEN 'Employee record created'
      WHEN operation_type = 'delete' THEN 'Employee record deleted'
      WHEN operation_type = 'update' THEN 
        'Updated ' || array_length(changed_fields, 1) || ' field(s): ' || 
        array_to_string(changed_fields, ', ')
      ELSE operation_type
    END as summary
  FROM changes
  ORDER BY created_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_employee_changes_summary"("p_employee_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_employee_changes_summary"("p_employee_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) IS 'Get a summary of all changes made to an employee within a date range';



CREATE OR REPLACE FUNCTION "public"."get_message_template"("p_event_id" "uuid", "p_template_type" "text") RETURNS TABLE("content" "text", "variables" "text"[], "send_timing" "text", "custom_timing_hours" integer)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- First check for event-specific template
  RETURN QUERY
  SELECT emt.content, emt.variables, emt.send_timing, emt.custom_timing_hours
  FROM event_message_templates emt
  WHERE emt.event_id = p_event_id
    AND emt.template_type = p_template_type
    AND emt.is_active = true
  LIMIT 1;
  
  -- If no event-specific template, return default
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT mt.content, mt.variables, mt.send_timing, mt.custom_timing_hours
    FROM message_templates mt
    WHERE mt.template_type = p_template_type
      AND mt.is_default = true
      AND mt.is_active = true
    LIMIT 1;
  END IF;
END;
$$;


ALTER FUNCTION "public"."get_message_template"("p_event_id" "uuid", "p_template_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_next_booking_reference"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  year_suffix TEXT;
  next_number INTEGER;
BEGIN
  year_suffix := TO_CHAR(CURRENT_DATE, 'YY');
  
  SELECT COALESCE(MAX(
    CAST(
      SUBSTRING(id::text FROM 'PB' || year_suffix || '-(\d+)')
      AS INTEGER
    )
  ), 0) + 1
  INTO next_number
  FROM private_bookings
  WHERE created_at >= DATE_TRUNC('year', CURRENT_DATE);
  
  RETURN 'PB' || year_suffix || '-' || LPAD(next_number::TEXT, 4, '0');
END;
$$;


ALTER FUNCTION "public"."get_next_booking_reference"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_permissions"("p_user_id" "uuid") RETURNS TABLE("module_name" "text", "action" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT p.module_name, p.action
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON ur.role_id = rp.role_id
    JOIN public.permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = p_user_id
    ORDER BY p.module_name, p.action;
END;
$$;


ALTER FUNCTION "public"."get_user_permissions"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_roles"("p_user_id" "uuid") RETURNS TABLE("role_id" "uuid", "role_name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT r.id, r.name
    FROM public.user_roles ur
    JOIN public.roles r ON ur.role_id = r.id
    WHERE ur.user_id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."get_user_roles"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_users_for_admin"() RETURNS TABLE("id" "uuid", "email" "text", "created_at" timestamp with time zone, "last_sign_in_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
BEGIN
    -- Check if the current user is a super admin
    -- Note: auth.uid() might be NULL in SQL Editor, so we check for that
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 
        FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() 
        AND r.name = 'super_admin'
    ) THEN
        RAISE EXCEPTION 'Access denied. Only super admins can view all users.';
    END IF;
    
    -- Return user data
    RETURN QUERY
    SELECT 
        u.id,
        u.email::text,
        u.created_at,
        u.last_sign_in_at
    FROM auth.users u
    ORDER BY u.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_users_for_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name) -- You can add other default fields here
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name'); -- Tries to get full_name from sign-up metadata if provided
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_audit_event"("p_user_id" "uuid", "p_user_email" "text", "p_operation_type" "text", "p_resource_type" "text", "p_resource_id" "text", "p_operation_status" "text", "p_ip_address" "inet" DEFAULT NULL::"inet", "p_user_agent" "text" DEFAULT NULL::"text", "p_old_values" "jsonb" DEFAULT NULL::"jsonb", "p_new_values" "jsonb" DEFAULT NULL::"jsonb", "p_error_message" "text" DEFAULT NULL::"text", "p_additional_info" "jsonb" DEFAULT NULL::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO audit_logs (
    user_id,
    user_email,
    operation_type,
    resource_type,
    resource_id,
    operation_status,
    ip_address,
    user_agent,
    old_values,
    new_values,
    error_message,
    additional_info
  ) VALUES (
    p_user_id,
    p_user_email,
    p_operation_type,
    p_resource_type,
    p_resource_id,
    p_operation_status,
    p_ip_address,
    p_user_agent,
    p_old_values,
    p_new_values,
    p_error_message,
    p_additional_info
  ) RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$;


ALTER FUNCTION "public"."log_audit_event"("p_user_id" "uuid", "p_user_email" "text", "p_operation_type" "text", "p_resource_type" "text", "p_resource_id" "text", "p_operation_status" "text", "p_ip_address" "inet", "p_user_agent" "text", "p_old_values" "jsonb", "p_new_values" "jsonb", "p_error_message" "text", "p_additional_info" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_reminder_processing"("p_processing_type" "text", "p_message" "text", "p_booking_id" "uuid" DEFAULT NULL::"uuid", "p_event_id" "uuid" DEFAULT NULL::"uuid", "p_customer_id" "uuid" DEFAULT NULL::"uuid", "p_template_type" "text" DEFAULT NULL::"text", "p_reminder_type" "text" DEFAULT NULL::"text", "p_error_details" "jsonb" DEFAULT NULL::"jsonb", "p_metadata" "jsonb" DEFAULT NULL::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO reminder_processing_logs (
    processing_type,
    message,
    booking_id,
    event_id,
    customer_id,
    template_type,
    reminder_type,
    error_details,
    metadata
  ) VALUES (
    p_processing_type,
    p_message,
    p_booking_id,
    p_event_id,
    p_customer_id,
    p_template_type,
    p_reminder_type,
    p_error_details,
    p_metadata
  ) RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$;


ALTER FUNCTION "public"."log_reminder_processing"("p_processing_type" "text", "p_message" "text", "p_booking_id" "uuid", "p_event_id" "uuid", "p_customer_id" "uuid", "p_template_type" "text", "p_reminder_type" "text", "p_error_details" "jsonb", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_template_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF OLD.content IS DISTINCT FROM NEW.content THEN
    INSERT INTO message_template_history (template_id, content, changed_by)
    VALUES (NEW.id, OLD.content, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."log_template_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_audit_log_deletion"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs cannot be deleted';
END;
$$;


ALTER FUNCTION "public"."prevent_audit_log_deletion"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_audit_log_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs cannot be modified';
END;
$$;


ALTER FUNCTION "public"."prevent_audit_log_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_pending_jobs"() RETURNS TABLE("job_id" "uuid", "job_type" character varying)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  UPDATE job_queue
  SET status = 'processing',
      started_at = NOW()
  WHERE id IN (
    SELECT id 
    FROM job_queue 
    WHERE status = 'pending' 
    ORDER BY created_at ASC 
    LIMIT 10
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, type;
END;
$$;


ALTER FUNCTION "public"."process_pending_jobs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_private_booking_sms"("p_booking_id" "uuid", "p_trigger_type" "text", "p_template_key" "text", "p_message_body" "text", "p_recipient_phone" "text", "p_customer_name" "text", "p_priority" integer DEFAULT 3, "p_scheduled_for" timestamp with time zone DEFAULT "now"(), "p_metadata" "jsonb" DEFAULT '{}'::"jsonb", "p_skip_conditions" "jsonb" DEFAULT NULL::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_sms_id UUID;
BEGIN
  -- Check if we should send this SMS
  IF NOT should_send_private_booking_sms(p_booking_id, p_recipient_phone, p_priority, p_trigger_type) THEN
    RAISE NOTICE 'SMS not queued: Daily limit reached or lower priority than existing message';
    RETURN NULL;
  END IF;
  
  -- Insert the SMS
  INSERT INTO private_booking_sms_queue (
    booking_id,
    trigger_type,
    template_key,
    message_body,
    recipient_phone,
    customer_name,
    priority,
    scheduled_for,
    metadata,
    skip_conditions,
    status
  ) VALUES (
    p_booking_id,
    p_trigger_type,
    p_template_key,
    p_message_body,
    p_recipient_phone,
    p_customer_name,
    p_priority,
    p_scheduled_for,
    p_metadata,
    p_skip_conditions,
    'pending'
  ) RETURNING id INTO v_sms_id;
  
  RETURN v_sms_id;
END;
$$;


ALTER FUNCTION "public"."queue_private_booking_sms"("p_booking_id" "uuid", "p_trigger_type" "text", "p_template_key" "text", "p_message_body" "text", "p_recipient_phone" "text", "p_customer_name" "text", "p_priority" integer, "p_scheduled_for" timestamp with time zone, "p_metadata" "jsonb", "p_skip_conditions" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."queue_private_booking_sms"("p_booking_id" "uuid", "p_trigger_type" "text", "p_template_key" "text", "p_message_body" "text", "p_recipient_phone" "text", "p_customer_name" "text", "p_priority" integer, "p_scheduled_for" timestamp with time zone, "p_metadata" "jsonb", "p_skip_conditions" "jsonb") IS 'Queues an SMS with automatic deduplication and priority handling';



CREATE OR REPLACE FUNCTION "public"."rebuild_customer_category_stats"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  -- Clear existing stats
  TRUNCATE customer_category_stats;

  -- Rebuild from bookings
  INSERT INTO customer_category_stats (
    customer_id,
    category_id,
    times_attended,
    first_attended_date,
    last_attended_date
  )
  SELECT 
    b.customer_id,
    e.category_id,
    COUNT(*) as times_attended,
    MIN(e.date) as first_attended_date,
    MAX(e.date) as last_attended_date
  FROM bookings b
  JOIN events e ON e.id = b.event_id
  WHERE e.category_id IS NOT NULL
    AND b.seats > 0
  GROUP BY b.customer_id, e.category_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."rebuild_customer_category_stats"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."rebuild_customer_category_stats"() IS 'Rebuilds customer category statistics from historical bookings. Uses SECURITY DEFINER to bypass RLS.';



CREATE OR REPLACE FUNCTION "public"."render_template"("p_template" "text", "p_variables" "jsonb") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_result TEXT := p_template;
  v_key TEXT;
  v_value TEXT;
BEGIN
  -- Replace each variable in the template
  FOR v_key, v_value IN SELECT * FROM jsonb_each_text(p_variables)
  LOOP
    v_result := REPLACE(v_result, '{{' || v_key || '}}', COALESCE(v_value, ''));
  END LOOP;
  
  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."render_template"("p_template" "text", "p_variables" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restore_employee_version"("p_employee_id" "uuid", "p_version_number" integer, "p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_employee_data JSONB;
  v_current_data JSONB;
  v_restored_data JSONB;
BEGIN
  -- Check if user has permission
  IF NOT user_has_permission(p_user_id, 'employees', 'manage') THEN
    RAISE EXCEPTION 'Insufficient permissions to restore employee versions';
  END IF;

  -- Get the version to restore
  SELECT new_values INTO v_employee_data
  FROM employee_version_history
  WHERE employee_id = p_employee_id AND version_number = p_version_number;

  IF v_employee_data IS NULL THEN
    RAISE EXCEPTION 'Version % not found for employee %', p_version_number, p_employee_id;
  END IF;

  -- Get current employee data
  SELECT to_jsonb(e.*) INTO v_current_data
  FROM employees e
  WHERE e.id = p_employee_id;

  -- Remove system fields that shouldn't be restored
  v_employee_data = v_employee_data - 'id' - 'created_at' - 'updated_at';

  -- Update the employee with the restored data
  UPDATE employees
  SET 
    first_name = v_employee_data->>'first_name',
    last_name = v_employee_data->>'last_name',
    email = v_employee_data->>'email',
    phone = v_employee_data->>'phone',
    date_of_birth = (v_employee_data->>'date_of_birth')::DATE,
    hire_date = (v_employee_data->>'hire_date')::DATE,
    job_title = v_employee_data->>'job_title',
    address = v_employee_data->>'address',
    national_insurance_number = v_employee_data->>'national_insurance_number',
    emergency_contact_name = v_employee_data->>'emergency_contact_name',
    emergency_contact_phone = v_employee_data->>'emergency_contact_phone',
    employment_status = v_employee_data->>'employment_status',
    updated_at = NOW()
  WHERE id = p_employee_id
  RETURNING to_jsonb(employees.*) INTO v_restored_data;

  -- The audit log will automatically capture this as a regular update
  -- with a note in additional_info that it's a version restore
  
  RETURN jsonb_build_object(
    'success', true,
    'restored_from_version', p_version_number,
    'data', v_restored_data
  );
END;
$$;


ALTER FUNCTION "public"."restore_employee_version"("p_employee_id" "uuid", "p_version_number" integer, "p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."restore_employee_version"("p_employee_id" "uuid", "p_version_number" integer, "p_user_id" "uuid") IS 'Restore an employee record to a previous version (requires manage permission)';



CREATE OR REPLACE FUNCTION "public"."should_send_private_booking_sms"("p_booking_id" "uuid", "p_phone" "text", "p_priority" integer, "p_trigger_type" "text") RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_last_sms RECORD;
  v_today DATE;
BEGIN
  v_today := CURRENT_DATE;
  
  -- Get the last SMS sent today to this phone for this booking
  SELECT * INTO v_last_sms
  FROM private_booking_sms_queue
  WHERE booking_id = p_booking_id
    AND recipient_phone = p_phone
    AND date_utc(created_at) = v_today
    AND status IN ('pending', 'approved', 'sent')
  ORDER BY priority ASC, created_at DESC
  LIMIT 1;
  
  -- If no SMS today, allow sending
  IF v_last_sms IS NULL THEN
    RETURN TRUE;
  END IF;
  
  -- If new message has higher priority (lower number), allow sending
  IF p_priority < v_last_sms.priority THEN
    RETURN TRUE;
  END IF;
  
  -- Otherwise, don't send
  RETURN FALSE;
END;
$$;


ALTER FUNCTION "public"."should_send_private_booking_sms"("p_booking_id" "uuid", "p_phone" "text", "p_priority" integer, "p_trigger_type" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."should_send_private_booking_sms"("p_booking_id" "uuid", "p_phone" "text", "p_priority" integer, "p_trigger_type" "text") IS 'Checks if an SMS should be sent based on daily limits and priority';



CREATE OR REPLACE FUNCTION "public"."standardize_phone_flexible"("phone" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $_$
DECLARE
  cleaned text;
BEGIN
  -- Return NULL for NULL or empty input
  IF phone IS NULL OR phone = '' THEN
    RETURN NULL;
  END IF;
  
  -- Remove all non-numeric characters except leading +
  cleaned := regexp_replace(phone, '[^0-9+]', '', 'g');
  
  -- Remove any + that's not at the start
  cleaned := regexp_replace(cleaned, '(?<!^)\+', '', 'g');
  
  -- Handle various UK formats
  -- UK mobile starting with 07
  IF cleaned ~ '^07\d{9}$' THEN
    RETURN '+44' || substring(cleaned from 2);
  -- UK number starting with 447
  ELSIF cleaned ~ '^447\d{9}$' THEN
    RETURN '+' || cleaned;
  -- UK number starting with +447
  ELSIF cleaned ~ '^\+447\d{9}$' THEN
    RETURN cleaned;
  -- UK number starting with 00447
  ELSIF cleaned ~ '^00447\d{9}$' THEN
    RETURN '+' || substring(cleaned from 3);
  -- Just 7 followed by 9 digits (assume UK mobile)
  ELSIF cleaned ~ '^7\d{9}$' THEN
    RETURN '+44' || cleaned;
  -- UK landline formats (01, 02, 03, etc)
  ELSIF cleaned ~ '^0[1-3]\d{9,10}$' THEN
    RETURN '+44' || substring(cleaned from 2);
  -- Already in international format
  ELSIF cleaned ~ '^\+44\d{10,11}$' THEN
    RETURN cleaned;
  -- Other international numbers - keep as is if valid
  ELSIF cleaned ~ '^\+[1-9]\d{7,14}$' THEN
    RETURN cleaned;
  -- Special case: Some numbers stored without country code
  ELSIF cleaned ~ '^\d{10}$' AND substring(cleaned for 1) = '7' THEN
    -- Likely UK mobile without 0
    RETURN '+447' || substring(cleaned from 2);
  ELSE
    -- Log problematic numbers
    RAISE NOTICE 'Could not standardize phone number: %', phone;
    -- For now, try to keep it if it looks like a phone number
    IF length(cleaned) >= 7 AND cleaned ~ '^\+?\d+$' THEN
      -- If it doesn't have a country code, assume UK
      IF cleaned !~ '^\+' THEN
        RETURN '+44' || cleaned;
      ELSE
        RETURN cleaned;
      END IF;
    END IF;
    RETURN NULL;
  END IF;
END;
$_$;


ALTER FUNCTION "public"."standardize_phone_flexible"("phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_customer_name_from_customers"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- If customer_id is set, sync the name from customers table
    IF NEW.customer_id IS NOT NULL THEN
        SELECT first_name, last_name 
        INTO NEW.customer_first_name, NEW.customer_last_name
        FROM customers 
        WHERE id = NEW.customer_id;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_customer_name_from_customers"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_customer_category_stats"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Only process if the event has a category
  IF EXISTS (
    SELECT 1 FROM events 
    WHERE id = NEW.event_id AND category_id IS NOT NULL
  ) THEN
    -- Get the category_id from the event
    INSERT INTO customer_category_stats (
      customer_id,
      category_id,
      times_attended,
      last_attended_date,
      first_attended_date
    )
    SELECT 
      NEW.customer_id,
      e.category_id,
      1,
      e.date,
      e.date
    FROM events e
    WHERE e.id = NEW.event_id
    ON CONFLICT (customer_id, category_id) DO UPDATE SET
      times_attended = customer_category_stats.times_attended + 1,
      last_attended_date = GREATEST(customer_category_stats.last_attended_date, EXCLUDED.last_attended_date),
      updated_at = NOW();
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_customer_category_stats"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_customer_category_stats"() IS 'Automatically updates customer category stats when bookings are created. Uses SECURITY DEFINER to bypass RLS.';



CREATE OR REPLACE FUNCTION "public"."update_customer_messaging_health"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_customer_id UUID;
  v_previous_status TEXT;
  v_new_status TEXT;
  v_failure_count_30d INTEGER;
BEGIN
  -- Get customer ID from the message
  SELECT customer_id INTO v_customer_id FROM messages WHERE id = NEW.message_id;
  
  IF v_customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get previous status
  v_previous_status := OLD.status;
  v_new_status := NEW.status;

  -- Update based on status change
  IF v_new_status = 'delivered' THEN
    -- Reset consecutive failures on successful delivery
    UPDATE customers 
    SET 
      consecutive_failures = 0,
      last_successful_delivery = NOW()
    WHERE id = v_customer_id;
    
  ELSIF v_new_status IN ('failed', 'undelivered') THEN
    -- Increment failure counts
    UPDATE customers 
    SET 
      consecutive_failures = consecutive_failures + 1,
      last_failure_type = COALESCE(NEW.error_message, 'Unknown error')
    WHERE id = v_customer_id;
    
    -- Count failures in last 30 days
    SELECT COUNT(*) INTO v_failure_count_30d
    FROM messages m
    JOIN message_delivery_status mds ON m.id = mds.message_id
    WHERE m.customer_id = v_customer_id
      AND mds.status IN ('failed', 'undelivered')
      AND mds.created_at >= NOW() - INTERVAL '30 days';
    
    UPDATE customers 
    SET total_failures_30d = v_failure_count_30d
    WHERE id = v_customer_id;
    
    -- Apply automatic deactivation rules
    UPDATE customers 
    SET 
      messaging_status = CASE
        -- Invalid number: immediate suspension
        WHEN NEW.error_code IN ('21211', '21217', '21219', '21408', '21610', '21611', '21612', '21614') THEN 'invalid_number'
        -- Carrier violations after 3 strikes
        WHEN consecutive_failures >= 3 AND NEW.error_code IN ('30003', '30004', '30005', '30006', '30007', '30008') THEN 'suspended'
        -- General failures after 5 consecutive attempts
        WHEN consecutive_failures >= 5 THEN 'suspended'
        -- High failure rate in 30 days
        WHEN total_failures_30d >= 10 THEN 'suspended'
        ELSE messaging_status
      END,
      sms_opt_in = CASE
        WHEN messaging_status != 'active' THEN false
        ELSE sms_opt_in
      END
    WHERE id = v_customer_id
      AND messaging_status = 'active'; -- Only auto-deactivate active customers
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_customer_messaging_health"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_customer_sms_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Only process if the message is outbound and has failed/undelivered status
  IF NEW.direction = 'outbound' AND NEW.twilio_status IN ('failed', 'undelivered') THEN
    -- Update customer's failure count and last failure reason
    UPDATE public.customers
    SET 
      sms_delivery_failures = sms_delivery_failures + 1,
      last_sms_failure_reason = NEW.error_message,
      -- Auto-deactivate based on failure count and error type
      sms_opt_in = CASE 
        -- Invalid number: immediate deactivation
        WHEN NEW.error_code IN ('21211', '21614', '21217') THEN false
        -- Carrier violations: deactivate after 3 failures
        WHEN NEW.error_code IN ('21610', '21612') AND sms_delivery_failures >= 2 THEN false
        -- Other failures: deactivate after 5 failures
        WHEN sms_delivery_failures >= 4 THEN false
        ELSE sms_opt_in
      END,
      sms_deactivated_at = CASE
        WHEN NEW.error_code IN ('21211', '21614', '21217') THEN NOW()
        WHEN NEW.error_code IN ('21610', '21612') AND sms_delivery_failures >= 2 THEN NOW()
        WHEN sms_delivery_failures >= 4 THEN NOW()
        ELSE sms_deactivated_at
      END,
      sms_deactivation_reason = CASE
        WHEN NEW.error_code IN ('21211', '21614', '21217') THEN 'Invalid phone number'
        WHEN NEW.error_code IN ('21610', '21612') AND sms_delivery_failures >= 2 THEN 'Carrier violations'
        WHEN sms_delivery_failures >= 4 THEN 'Too many delivery failures'
        ELSE sms_deactivation_reason
      END
    WHERE id = NEW.customer_id;
  -- Reset failure count on successful delivery
  ELSIF NEW.direction = 'outbound' AND NEW.twilio_status = 'delivered' THEN
    UPDATE public.customers
    SET 
      sms_delivery_failures = 0,
      last_successful_sms_at = NOW()
    WHERE id = NEW.customer_id;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_customer_sms_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_event_images_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_event_images_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_messages_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_messages_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_has_permission"("p_user_id" "uuid", "p_module_name" "text", "p_action" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.role_permissions rp ON ur.role_id = rp.role_id
        JOIN public.permissions p ON rp.permission_id = p.id
        WHERE ur.user_id = p_user_id
        AND p.module_name = p_module_name
        AND p.action = p_action
    );
END;
$$;


ALTER FUNCTION "public"."user_has_permission"("p_user_id" "uuid", "p_module_name" "text", "p_action" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_employee_attachment_upload"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Check file size (5MB limit)
  IF NEW.metadata->>'size' IS NOT NULL AND (NEW.metadata->>'size')::bigint > 5242880 THEN
    RAISE EXCEPTION 'File size exceeds 5MB limit';
  END IF;
  
  -- Check file type (optional - add allowed mime types)
  IF NEW.metadata->>'mimetype' IS NOT NULL AND NEW.metadata->>'mimetype' NOT IN (
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    'application/zip',
    'application/x-zip-compressed'
  ) THEN
    RAISE EXCEPTION 'File type not allowed. Supported types: PDF, images (JPG, PNG, GIF, WebP), Word documents, Excel spreadsheets, text files, and ZIP archives.';
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_employee_attachment_upload"() OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."admin_users_view" AS
 SELECT "u"."id",
    "u"."email",
    "u"."created_at",
    "u"."last_sign_in_at"
   FROM "auth"."users" "u";


ALTER TABLE "public"."admin_users_view" OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key_hash" character varying(255) NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" "text",
    "permissions" "jsonb" DEFAULT '["read:events"]'::"jsonb",
    "rate_limit" integer DEFAULT 1000,
    "is_active" boolean DEFAULT true,
    "last_used_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."api_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."api_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "api_key_id" "uuid" NOT NULL,
    "endpoint" character varying(255) NOT NULL,
    "method" character varying(10) NOT NULL,
    "status_code" integer,
    "response_time_ms" integer,
    "ip_address" "inet",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."api_usage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attachment_categories" (
    "category_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."attachment_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid",
    "user_email" "text",
    "operation_type" "text" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "text",
    "operation_status" "text" NOT NULL,
    "ip_address" "inet",
    "user_agent" "text",
    "old_values" "jsonb",
    "new_values" "jsonb",
    "error_message" "text",
    "additional_info" "jsonb",
    CONSTRAINT "audit_logs_operation_status_check" CHECK (("operation_status" = ANY (ARRAY['success'::"text", 'failure'::"text"])))
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."audit_logs" IS 'Immutable audit log for tracking sensitive operations. Access controlled by RLS policies allowing: 1) Full access for users with audit_logs permission, 2) Limited access for dashboard widgets, 3) Users can see their own auth activity';



COMMENT ON COLUMN "public"."audit_logs"."operation_type" IS 'Type of operation: login, logout, create, update, delete, view, export, etc.';



COMMENT ON COLUMN "public"."audit_logs"."resource_type" IS 'Type of resource: employee, customer, financial_details, health_records, attachment, etc.';



COMMENT ON COLUMN "public"."audit_logs"."old_values" IS 'Previous values before update (for update operations)';



COMMENT ON COLUMN "public"."audit_logs"."new_values" IS 'New values after update (for create/update operations)';



CREATE TABLE IF NOT EXISTS "public"."background_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "priority" integer DEFAULT 0,
    "attempts" integer DEFAULT 0,
    "max_attempts" integer DEFAULT 3,
    "scheduled_for" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "processed_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "error" "text",
    "result" "jsonb",
    "duration_ms" integer,
    CONSTRAINT "background_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."background_jobs" OWNER TO "postgres";


COMMENT ON TABLE "public"."background_jobs" IS 'Queue for background job processing';



COMMENT ON COLUMN "public"."background_jobs"."type" IS 'Job type identifier';



COMMENT ON COLUMN "public"."background_jobs"."payload" IS 'Job-specific data';



COMMENT ON COLUMN "public"."background_jobs"."status" IS 'Current job status';



COMMENT ON COLUMN "public"."background_jobs"."priority" IS 'Higher number = higher priority';



COMMENT ON COLUMN "public"."background_jobs"."attempts" IS 'Number of processing attempts';



COMMENT ON COLUMN "public"."background_jobs"."scheduled_for" IS 'When the job should be processed';



COMMENT ON COLUMN "public"."background_jobs"."duration_ms" IS 'How long the job took to process';



CREATE TABLE IF NOT EXISTS "public"."booking_reminders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "reminder_type" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "message_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "booking_reminders_reminder_type_check" CHECK (("reminder_type" = ANY (ARRAY['24_hour'::"text", '7_day'::"text", '1_hour'::"text", '12_hour'::"text", 'custom'::"text"])))
);


ALTER TABLE "public"."booking_reminders" OWNER TO "postgres";


COMMENT ON TABLE "public"."booking_reminders" IS 'Tracks which reminders have been sent for each booking to prevent duplicates';



CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "seats" integer,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "notes" "text",
    CONSTRAINT "chk_booking_seats" CHECK (("seats" >= 0))
);


ALTER TABLE "public"."bookings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."business_amenities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" character varying(50) NOT NULL,
    "available" boolean DEFAULT true,
    "details" "text",
    "capacity" integer,
    "additional_info" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."business_amenities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."business_hours" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "day_of_week" integer NOT NULL,
    "opens" time without time zone,
    "closes" time without time zone,
    "kitchen_opens" time without time zone,
    "kitchen_closes" time without time zone,
    "is_closed" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "business_hours_day_of_week_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6)))
);


ALTER TABLE "public"."business_hours" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."catering_packages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "package_type" "text",
    "cost_per_head" numeric(10,2) NOT NULL,
    "minimum_guests" integer DEFAULT 10,
    "maximum_guests" integer,
    "dietary_notes" "text",
    "active" boolean DEFAULT true,
    "display_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "catering_packages_package_type_check" CHECK (("package_type" = ANY (ARRAY['buffet'::"text", 'sit-down'::"text", 'canapes'::"text", 'drinks'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."catering_packages" OWNER TO "postgres";


COMMENT ON TABLE "public"."catering_packages" IS 'Pre-configured catering options with per-head pricing';



CREATE TABLE IF NOT EXISTS "public"."customer_category_stats" (
    "customer_id" "uuid" NOT NULL,
    "category_id" "uuid" NOT NULL,
    "times_attended" integer DEFAULT 0,
    "last_attended_date" "date",
    "first_attended_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."customer_category_stats" OWNER TO "postgres";


COMMENT ON TABLE "public"."customer_category_stats" IS 'Tracks customer attendance patterns by event category';



CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "first_name" "text" NOT NULL,
    "last_name" "text" NOT NULL,
    "mobile_number" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "sms_opt_in" boolean DEFAULT true,
    "sms_delivery_failures" integer DEFAULT 0,
    "last_sms_failure_reason" "text",
    "last_successful_sms_at" timestamp with time zone,
    "sms_deactivated_at" timestamp with time zone,
    "sms_deactivation_reason" "text",
    "messaging_status" "text" DEFAULT 'active'::"text",
    "last_successful_delivery" timestamp with time zone,
    "consecutive_failures" integer DEFAULT 0,
    "total_failures_30d" integer DEFAULT 0,
    "last_failure_type" "text",
    CONSTRAINT "chk_customer_name_length" CHECK ((("length"("first_name") <= 100) AND ("length"("last_name") <= 100))),
    CONSTRAINT "chk_customer_phone_format" CHECK ((("mobile_number" IS NULL) OR ("mobile_number" ~ '^\+[1-9]\d{7,14}$'::"text") OR ("mobile_number" ~ '^0[1-9]\d{9,10}$'::"text"))),
    CONSTRAINT "customers_messaging_status_check" CHECK (("messaging_status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'invalid_number'::"text", 'opted_out'::"text"])))
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


COMMENT ON COLUMN "public"."customers"."mobile_number" IS 'Phone number in E.164 format (e.g., +447700900123). Standardized on 2025-06-19.';



COMMENT ON COLUMN "public"."customers"."sms_opt_in" IS 'Whether the customer has opted in to receive SMS messages';



COMMENT ON COLUMN "public"."customers"."sms_delivery_failures" IS 'Count of consecutive SMS delivery failures';



COMMENT ON COLUMN "public"."customers"."last_sms_failure_reason" IS 'The reason for the last SMS delivery failure';



COMMENT ON COLUMN "public"."customers"."last_successful_sms_at" IS 'Timestamp of the last successful SMS delivery';



COMMENT ON COLUMN "public"."customers"."sms_deactivated_at" IS 'When SMS was automatically deactivated for this customer';



COMMENT ON COLUMN "public"."customers"."sms_deactivation_reason" IS 'Reason for automatic SMS deactivation';



COMMENT ON COLUMN "public"."customers"."messaging_status" IS 'Current messaging status: active, suspended, invalid_number, opted_out';



COMMENT ON COLUMN "public"."customers"."consecutive_failures" IS 'Number of consecutive delivery failures';



COMMENT ON COLUMN "public"."customers"."total_failures_30d" IS 'Total delivery failures in the last 30 days';



COMMENT ON COLUMN "public"."customers"."last_failure_type" IS 'Description of the last delivery failure';



CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "direction" "text" NOT NULL,
    "message_sid" "text" NOT NULL,
    "body" "text" NOT NULL,
    "status" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "twilio_message_sid" "text",
    "error_code" "text",
    "error_message" "text",
    "price" numeric(10,4),
    "price_unit" "text",
    "sent_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "twilio_status" "text",
    "from_number" "text",
    "to_number" "text",
    "message_type" "text" DEFAULT 'sms'::"text",
    "read_at" timestamp with time zone,
    "segments" integer DEFAULT 1,
    "cost_usd" numeric(10,4),
    CONSTRAINT "chk_message_direction" CHECK (("direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text"]))),
    CONSTRAINT "chk_message_segments" CHECK (("segments" >= 1)),
    CONSTRAINT "messages_direction_check" CHECK (("direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text"]))),
    CONSTRAINT "messages_message_type_check" CHECK (("message_type" = ANY (ARRAY['sms'::"text", 'mms'::"text", 'whatsapp'::"text"])))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


COMMENT ON TABLE "public"."messages" IS 'Messages table for SMS communications - updated to remove is_read column';



COMMENT ON COLUMN "public"."messages"."twilio_message_sid" IS 'Twilio message SID for tracking';



COMMENT ON COLUMN "public"."messages"."error_code" IS 'Twilio error code if message failed';



COMMENT ON COLUMN "public"."messages"."error_message" IS 'Human-readable error message if failed';



COMMENT ON COLUMN "public"."messages"."twilio_status" IS 'Current status of the message from Twilio (queued, sent, delivered, failed, etc)';



COMMENT ON COLUMN "public"."messages"."segments" IS 'Number of SMS segments (160 chars for single, 153 for multi-part)';



COMMENT ON COLUMN "public"."messages"."cost_usd" IS 'Estimated cost in USD based on segments';



CREATE OR REPLACE VIEW "public"."customer_messaging_health" AS
 SELECT "c"."id",
    "c"."first_name",
    "c"."last_name",
    "c"."mobile_number",
    "c"."messaging_status",
    "c"."sms_opt_in",
    "c"."consecutive_failures",
    "c"."total_failures_30d",
    "c"."last_successful_delivery",
    "c"."last_failure_type",
    "count"(DISTINCT "m"."id") AS "total_messages_sent",
    "count"(DISTINCT
        CASE
            WHEN ("m"."twilio_status" = 'delivered'::"text") THEN "m"."id"
            ELSE NULL::"uuid"
        END) AS "messages_delivered",
    "count"(DISTINCT
        CASE
            WHEN ("m"."twilio_status" = ANY (ARRAY['failed'::"text", 'undelivered'::"text"])) THEN "m"."id"
            ELSE NULL::"uuid"
        END) AS "messages_failed",
        CASE
            WHEN ("count"(DISTINCT "m"."id") > 0) THEN "round"(((("count"(DISTINCT
            CASE
                WHEN ("m"."twilio_status" = 'delivered'::"text") THEN "m"."id"
                ELSE NULL::"uuid"
            END))::numeric / ("count"(DISTINCT "m"."id"))::numeric) * (100)::numeric), 2)
            ELSE (0)::numeric
        END AS "delivery_rate",
    "sum"(COALESCE("m"."cost_usd", (0)::numeric)) AS "total_cost_usd",
    "max"("m"."created_at") AS "last_message_date"
   FROM ("public"."customers" "c"
     LEFT JOIN "public"."messages" "m" ON ((("c"."id" = "m"."customer_id") AND ("m"."direction" = 'outbound'::"text"))))
  GROUP BY "c"."id", "c"."first_name", "c"."last_name", "c"."mobile_number", "c"."messaging_status", "c"."sms_opt_in", "c"."consecutive_failures", "c"."total_failures_30d", "c"."last_successful_delivery", "c"."last_failure_type";


ALTER TABLE "public"."customer_messaging_health" OWNER TO "postgres";


COMMENT ON VIEW "public"."customer_messaging_health" IS 'Comprehensive view of customer messaging health and statistics';



CREATE TABLE IF NOT EXISTS "public"."employee_attachments" (
    "attachment_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "category_id" "uuid" NOT NULL,
    "file_name" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "mime_type" "text" NOT NULL,
    "file_size_bytes" bigint NOT NULL,
    "description" "text",
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."employee_attachments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."employee_attachments"."uploaded_at" IS 'Timestamp when the file was uploaded. Note: This column is named uploaded_at, not created_at.';



CREATE TABLE IF NOT EXISTS "public"."employee_emergency_contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "employee_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "relationship" "text",
    "address" "text",
    "phone_number" "text",
    CONSTRAINT "chk_emergency_phone_format" CHECK ((("phone_number" IS NULL) OR ("phone_number" ~* '^(\+?44|0)?[0-9]{10,11}$'::"text")))
);


ALTER TABLE "public"."employee_emergency_contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employee_financial_details" (
    "employee_id" "uuid" NOT NULL,
    "ni_number" "text",
    "bank_account_number" "text",
    "bank_sort_code" "text",
    "bank_name" "text",
    "payee_name" "text",
    "branch_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_bank_details" CHECK (((("bank_account_number" IS NULL) OR ("bank_account_number" ~* '^[0-9]{8}$'::"text")) AND (("bank_sort_code" IS NULL) OR ("bank_sort_code" ~* '^[0-9]{2}-?[0-9]{2}-?[0-9]{2}$'::"text"))))
);


ALTER TABLE "public"."employee_financial_details" OWNER TO "postgres";


COMMENT ON TABLE "public"."employee_financial_details" IS 'Stores confidential financial details for employees.';



COMMENT ON CONSTRAINT "chk_bank_details" ON "public"."employee_financial_details" IS 'Ensures UK bank account and sort code formats are valid';



CREATE TABLE IF NOT EXISTS "public"."employee_health_records" (
    "employee_id" "uuid" NOT NULL,
    "doctor_name" "text",
    "doctor_address" "text",
    "allergies" "text",
    "illness_history" "text",
    "recent_treatment" "text",
    "has_diabetes" boolean DEFAULT false NOT NULL,
    "has_epilepsy" boolean DEFAULT false NOT NULL,
    "has_skin_condition" boolean DEFAULT false NOT NULL,
    "has_depressive_illness" boolean DEFAULT false NOT NULL,
    "has_bowel_problems" boolean DEFAULT false NOT NULL,
    "has_ear_problems" boolean DEFAULT false NOT NULL,
    "is_registered_disabled" boolean DEFAULT false NOT NULL,
    "disability_reg_number" "text",
    "disability_reg_expiry_date" "date",
    "disability_details" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."employee_health_records" OWNER TO "postgres";


COMMENT ON TABLE "public"."employee_health_records" IS 'Stores confidential health and medical records for employees.';



CREATE TABLE IF NOT EXISTS "public"."employee_notes" (
    "note_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "note_text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by_user_id" "uuid"
);


ALTER TABLE "public"."employee_notes" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."employee_version_history" AS
 WITH "version_data" AS (
         SELECT "al"."id",
            "al"."created_at",
            "al"."user_id",
            "al"."user_email",
            "al"."operation_type",
            "al"."resource_id" AS "employee_id",
            "al"."old_values",
            "al"."new_values",
            "al"."ip_address",
            "row_number"() OVER (PARTITION BY "al"."resource_id" ORDER BY "al"."created_at") AS "version_number",
            COALESCE(
                CASE
                    WHEN ("al"."new_values" IS NOT NULL) THEN ((("al"."new_values" ->> 'first_name'::"text") || ' '::"text") || ("al"."new_values" ->> 'last_name'::"text"))
                    ELSE NULL::"text"
                END,
                CASE
                    WHEN ("al"."old_values" IS NOT NULL) THEN ((("al"."old_values" ->> 'first_name'::"text") || ' '::"text") || ("al"."old_values" ->> 'last_name'::"text"))
                    ELSE NULL::"text"
                END) AS "employee_name"
           FROM "public"."audit_logs" "al"
          WHERE (("al"."resource_type" = 'employee'::"text") AND ("al"."operation_status" = 'success'::"text"))
        )
 SELECT "version_data"."id",
    "version_data"."created_at",
    "version_data"."user_id",
    "version_data"."user_email",
    "version_data"."operation_type",
    "version_data"."employee_id",
    "version_data"."old_values",
    "version_data"."new_values",
    "version_data"."ip_address",
    "version_data"."version_number",
    "version_data"."employee_name"
   FROM "version_data"
  ORDER BY "version_data"."employee_id", "version_data"."version_number";


ALTER TABLE "public"."employee_version_history" OWNER TO "postgres";


COMMENT ON VIEW "public"."employee_version_history" IS 'Comprehensive version history for all employee records, tracking all changes over time';



CREATE TABLE IF NOT EXISTS "public"."employees" (
    "employee_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "first_name" "text" NOT NULL,
    "last_name" "text" NOT NULL,
    "date_of_birth" "date",
    "address" "text",
    "phone_number" "text",
    "email_address" "text" NOT NULL,
    "job_title" "text" NOT NULL,
    "employment_start_date" "date" NOT NULL,
    "employment_end_date" "date",
    "status" "text" DEFAULT 'Active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_date_of_birth" CHECK ((("date_of_birth" IS NULL) OR (("date_of_birth" > '1900-01-01'::"date") AND ("date_of_birth" < CURRENT_DATE)))),
    CONSTRAINT "chk_email_length" CHECK ((("email_address" IS NULL) OR ("length"("email_address") <= 255))),
    CONSTRAINT "chk_employee_email_format" CHECK ((("email_address" IS NULL) OR ("email_address" ~* '^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::"text"))),
    CONSTRAINT "chk_employee_name_length" CHECK ((("length"("first_name") <= 100) AND ("length"("last_name") <= 100) AND (("job_title" IS NULL) OR ("length"("job_title") <= 100)))),
    CONSTRAINT "chk_employee_phone_format" CHECK ((("phone_number" IS NULL) OR ("phone_number" ~ '^\+[1-9]\d{7,14}$'::"text") OR ("phone_number" ~ '^0[1-9]\d{9,10}$'::"text"))),
    CONSTRAINT "chk_employee_status" CHECK (("status" = ANY (ARRAY['Active'::"text", 'Former'::"text"]))),
    CONSTRAINT "chk_employment_dates" CHECK ((("employment_end_date" IS NULL) OR ("employment_end_date" > "employment_start_date")))
);


ALTER TABLE "public"."employees" OWNER TO "postgres";


COMMENT ON CONSTRAINT "chk_date_of_birth" ON "public"."employees" IS 'Ensures date of birth is reasonable (after 1900 and before current date)';



COMMENT ON CONSTRAINT "chk_employee_email_format" ON "public"."employees" IS 'Ensures email addresses follow valid format';



COMMENT ON CONSTRAINT "chk_employee_status" ON "public"."employees" IS 'Ensures employee status is either Active or Former';



COMMENT ON CONSTRAINT "chk_employment_dates" ON "public"."employees" IS 'Ensures employment end date is after start date';



CREATE TABLE IF NOT EXISTS "public"."event_categories" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" character varying(100) NOT NULL,
    "description" "text",
    "color" character varying(7) DEFAULT '#6B7280'::character varying NOT NULL,
    "icon" character varying(50) DEFAULT 'CalendarIcon'::character varying,
    "default_start_time" time without time zone,
    "default_capacity" integer,
    "default_reminder_hours" integer DEFAULT 24,
    "sort_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_default" boolean DEFAULT false,
    "default_end_time" time without time zone,
    "default_price" numeric(10,2) DEFAULT 0,
    "default_is_free" boolean DEFAULT false,
    "default_performer_type" character varying(50),
    "default_event_status" character varying(50) DEFAULT 'scheduled'::character varying,
    "slug" character varying(100) NOT NULL,
    "meta_description" "text",
    "default_image_url" "text",
    "short_description" "text",
    "long_description" "text",
    "highlights" "jsonb" DEFAULT '[]'::"jsonb",
    "meta_title" character varying(255),
    "keywords" "jsonb" DEFAULT '[]'::"jsonb",
    "gallery_image_urls" "jsonb" DEFAULT '[]'::"jsonb",
    "poster_image_url" "text",
    "thumbnail_image_url" "text",
    "promo_video_url" "text",
    "highlight_video_urls" "jsonb" DEFAULT '[]'::"jsonb",
    "default_duration_minutes" integer,
    "default_doors_time" character varying(10),
    "default_last_entry_time" character varying(10),
    "default_booking_url" "text",
    "faqs" "jsonb" DEFAULT '[]'::"jsonb",
    CONSTRAINT "check_default_event_status" CHECK ((("default_event_status")::"text" = ANY ((ARRAY['scheduled'::character varying, 'cancelled'::character varying, 'postponed'::character varying, 'rescheduled'::character varying])::"text"[]))),
    CONSTRAINT "check_default_performer_type" CHECK (((("default_performer_type")::"text" = ANY ((ARRAY['MusicGroup'::character varying, 'Person'::character varying, 'TheaterGroup'::character varying, 'DanceGroup'::character varying, 'ComedyGroup'::character varying, 'Organization'::character varying])::"text"[])) OR ("default_performer_type" IS NULL)))
);


ALTER TABLE "public"."event_categories" OWNER TO "postgres";


COMMENT ON TABLE "public"."event_categories" IS 'Event categories for organizing different types of events and tracking customer preferences';



COMMENT ON COLUMN "public"."event_categories"."is_default" IS 'If true, this category will be automatically selected for new events. Only one category can be default at a time.';



COMMENT ON COLUMN "public"."event_categories"."default_end_time" IS 'Default end time for events in this category';



COMMENT ON COLUMN "public"."event_categories"."default_price" IS 'Default ticket price';



COMMENT ON COLUMN "public"."event_categories"."default_is_free" IS 'Whether events in this category are typically free';



COMMENT ON COLUMN "public"."event_categories"."default_performer_type" IS 'Default performer type (Person, MusicGroup, etc)';



COMMENT ON COLUMN "public"."event_categories"."default_event_status" IS 'Default status for new events in this category';



COMMENT ON COLUMN "public"."event_categories"."slug" IS 'URL-friendly identifier for the category';



COMMENT ON COLUMN "public"."event_categories"."meta_description" IS 'Default SEO meta description template';



COMMENT ON COLUMN "public"."event_categories"."short_description" IS 'Default short description for events in this category';



COMMENT ON COLUMN "public"."event_categories"."long_description" IS 'Default long description for events in this category';



COMMENT ON COLUMN "public"."event_categories"."highlights" IS 'Default highlights/bullet points for events';



COMMENT ON COLUMN "public"."event_categories"."meta_title" IS 'Default SEO meta title template';



COMMENT ON COLUMN "public"."event_categories"."keywords" IS 'Default keywords for SEO';



COMMENT ON COLUMN "public"."event_categories"."gallery_image_urls" IS 'Default gallery images';



COMMENT ON COLUMN "public"."event_categories"."poster_image_url" IS 'Default poster image URL';



COMMENT ON COLUMN "public"."event_categories"."thumbnail_image_url" IS 'Default thumbnail image URL';



COMMENT ON COLUMN "public"."event_categories"."promo_video_url" IS 'Default promotional video URL';



COMMENT ON COLUMN "public"."event_categories"."highlight_video_urls" IS 'Default highlight video URLs';



COMMENT ON COLUMN "public"."event_categories"."default_duration_minutes" IS 'Default event duration in minutes';



COMMENT ON COLUMN "public"."event_categories"."default_doors_time" IS 'Default doors opening time before event';



COMMENT ON COLUMN "public"."event_categories"."default_last_entry_time" IS 'Default last entry time';



COMMENT ON COLUMN "public"."event_categories"."default_booking_url" IS 'Default external booking URL';



COMMENT ON COLUMN "public"."event_categories"."faqs" IS 'Default FAQs for events in this category';



CREATE TABLE IF NOT EXISTS "public"."event_faqs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "question" "text" NOT NULL,
    "answer" "text" NOT NULL,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."event_faqs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "storage_path" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "mime_type" "text" NOT NULL,
    "file_size_bytes" integer NOT NULL,
    "image_type" "text" NOT NULL,
    "display_order" integer DEFAULT 0,
    "alt_text" "text",
    "caption" "text",
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "event_images_image_type_check" CHECK (("image_type" = ANY (ARRAY['hero'::"text", 'thumbnail'::"text", 'poster'::"text", 'gallery'::"text"])))
);


ALTER TABLE "public"."event_images" OWNER TO "postgres";


COMMENT ON TABLE "public"."event_images" IS 'Tracks uploaded images for events with metadata';



CREATE TABLE IF NOT EXISTS "public"."event_message_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "template_type" "text" NOT NULL,
    "content" "text" NOT NULL,
    "variables" "text"[] DEFAULT '{}'::"text"[],
    "is_active" boolean DEFAULT true,
    "character_count" integer GENERATED ALWAYS AS ("length"("content")) STORED,
    "estimated_segments" integer GENERATED ALWAYS AS (
CASE
    WHEN ("length"("content") <= 160) THEN (1)::numeric
    ELSE "ceil"((("length"("content"))::numeric / (153)::numeric))
END) STORED,
    "send_timing" "text" DEFAULT 'immediate'::"text",
    "custom_timing_hours" integer,
    CONSTRAINT "event_message_templates_custom_timing_hours_check" CHECK ((("custom_timing_hours" > 0) AND ("custom_timing_hours" <= 720))),
    CONSTRAINT "event_message_templates_send_timing_check" CHECK (("send_timing" = ANY (ARRAY['immediate'::"text", '1_hour'::"text", '12_hours'::"text", '24_hours'::"text", '7_days'::"text", 'custom'::"text"]))),
    CONSTRAINT "event_message_templates_template_type_check" CHECK (("template_type" = ANY (ARRAY['booking_confirmation'::"text", 'reminder_7_day'::"text", 'reminder_24_hour'::"text", 'booking_reminder_confirmation'::"text", 'booking_reminder_7_day'::"text", 'booking_reminder_24_hour'::"text", 'custom'::"text"])))
);


ALTER TABLE "public"."event_message_templates" OWNER TO "postgres";


COMMENT ON TABLE "public"."event_message_templates" IS 'Event-specific overrides for message templates';



CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "date" "date" NOT NULL,
    "time" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "capacity" integer,
    "category_id" "uuid",
    "description" "text",
    "end_time" time without time zone,
    "event_status" character varying(50) DEFAULT 'scheduled'::character varying,
    "performer_name" character varying(255),
    "performer_type" character varying(50),
    "price" numeric(10,2) DEFAULT 0,
    "price_currency" character varying(3) DEFAULT 'GBP'::character varying,
    "is_free" boolean DEFAULT true,
    "booking_url" "text",
    "image_urls" "jsonb" DEFAULT '[]'::"jsonb",
    "is_recurring" boolean DEFAULT false,
    "recurrence_rule" "text",
    "parent_event_id" "uuid",
    "slug" character varying(255) NOT NULL,
    "short_description" "text",
    "long_description" "text",
    "highlights" "jsonb" DEFAULT '[]'::"jsonb",
    "meta_title" character varying(255),
    "meta_description" "text",
    "keywords" "jsonb" DEFAULT '[]'::"jsonb",
    "hero_image_url" "text",
    "gallery_image_urls" "jsonb" DEFAULT '[]'::"jsonb",
    "poster_image_url" "text",
    "thumbnail_image_url" "text",
    "promo_video_url" "text",
    "highlight_video_urls" "jsonb" DEFAULT '[]'::"jsonb",
    "doors_time" time without time zone,
    "duration_minutes" integer,
    "last_entry_time" time without time zone,
    CONSTRAINT "check_duration_positive" CHECK ((("duration_minutes" IS NULL) OR ("duration_minutes" > 0))),
    CONSTRAINT "chk_event_date_reasonable" CHECK (("date" >= (CURRENT_DATE - '1 year'::interval))),
    CONSTRAINT "events_capacity_check" CHECK ((("capacity" IS NULL) OR ("capacity" > 0)))
);


ALTER TABLE "public"."events" OWNER TO "postgres";


COMMENT ON COLUMN "public"."events"."capacity" IS 'Maximum number of seats available for the event. NULL means unlimited capacity.';



COMMENT ON COLUMN "public"."events"."slug" IS 'URL-friendly identifier for the event (SEO)';



COMMENT ON COLUMN "public"."events"."short_description" IS 'Brief description (50-150 chars) for list views and meta descriptions';



COMMENT ON COLUMN "public"."events"."long_description" IS 'Full HTML/Markdown content for event page';



COMMENT ON COLUMN "public"."events"."highlights" IS 'JSON array of bullet points highlighting key features';



COMMENT ON COLUMN "public"."events"."meta_title" IS 'Custom page title for SEO (optional)';



COMMENT ON COLUMN "public"."events"."meta_description" IS 'Custom meta description for SEO (optional)';



COMMENT ON COLUMN "public"."events"."keywords" IS 'JSON array of target keywords for SEO';



COMMENT ON COLUMN "public"."events"."hero_image_url" IS 'Main hero image (1200x630 minimum for Open Graph)';



COMMENT ON COLUMN "public"."events"."gallery_image_urls" IS 'JSON array of additional photo URLs';



COMMENT ON COLUMN "public"."events"."poster_image_url" IS 'Event poster/flyer URL if different from hero';



COMMENT ON COLUMN "public"."events"."thumbnail_image_url" IS 'Square image for list views (400x400)';



COMMENT ON COLUMN "public"."events"."promo_video_url" IS 'YouTube/Vimeo URL for promotional video';



COMMENT ON COLUMN "public"."events"."highlight_video_urls" IS 'JSON array of previous event highlight video URLs';



COMMENT ON COLUMN "public"."events"."doors_time" IS 'Door opening time if different from start';



COMMENT ON COLUMN "public"."events"."duration_minutes" IS 'Event duration in minutes';



COMMENT ON COLUMN "public"."events"."last_entry_time" IS 'Last entry time for the event';



CREATE TABLE IF NOT EXISTS "public"."job_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" character varying(100) NOT NULL,
    "status" character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    "payload" "jsonb",
    "result" "jsonb",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_by" "uuid",
    CONSTRAINT "valid_status" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying])::"text"[])))
);


ALTER TABLE "public"."job_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."menu_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "section_id" "uuid" NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" "text",
    "price" numeric(10,2) NOT NULL,
    "price_currency" character varying(3) DEFAULT 'GBP'::character varying,
    "calories" integer,
    "dietary_info" "jsonb" DEFAULT '[]'::"jsonb",
    "allergens" "jsonb" DEFAULT '[]'::"jsonb",
    "is_available" boolean DEFAULT true,
    "is_special" boolean DEFAULT false,
    "available_from" timestamp with time zone,
    "available_until" timestamp with time zone,
    "image_url" "text",
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."menu_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."menu_sections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" "text",
    "sort_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."menu_sections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."message_delivery_status" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "error_code" "text",
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "raw_webhook_data" "jsonb"
);


ALTER TABLE "public"."message_delivery_status" OWNER TO "postgres";


COMMENT ON TABLE "public"."message_delivery_status" IS 'Tracks the full history of message delivery status changes from Twilio webhooks';



CREATE TABLE IF NOT EXISTS "public"."message_template_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "content" "text" NOT NULL,
    "changed_by" "uuid",
    "change_reason" "text"
);


ALTER TABLE "public"."message_template_history" OWNER TO "postgres";


COMMENT ON TABLE "public"."message_template_history" IS 'Version history for message templates';



CREATE TABLE IF NOT EXISTS "public"."message_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "template_type" "text" NOT NULL,
    "content" "text" NOT NULL,
    "variables" "text"[] DEFAULT '{}'::"text"[],
    "is_default" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "created_by" "uuid",
    "character_count" integer GENERATED ALWAYS AS ("length"("content")) STORED,
    "estimated_segments" integer GENERATED ALWAYS AS (
CASE
    WHEN ("length"("content") <= 160) THEN (1)::numeric
    ELSE "ceil"((("length"("content"))::numeric / (153)::numeric))
END) STORED,
    "send_timing" "text" DEFAULT 'immediate'::"text" NOT NULL,
    "custom_timing_hours" integer,
    CONSTRAINT "message_templates_custom_timing_hours_check" CHECK ((("custom_timing_hours" > 0) AND ("custom_timing_hours" <= 720))),
    CONSTRAINT "message_templates_send_timing_check" CHECK (("send_timing" = ANY (ARRAY['immediate'::"text", '1_hour'::"text", '12_hours'::"text", '24_hours'::"text", '7_days'::"text", 'custom'::"text"]))),
    CONSTRAINT "message_templates_template_type_check" CHECK (("template_type" = ANY (ARRAY['booking_confirmation'::"text", 'reminder_7_day'::"text", 'reminder_24_hour'::"text", 'booking_reminder_confirmation'::"text", 'booking_reminder_7_day'::"text", 'booking_reminder_24_hour'::"text", 'custom'::"text", 'private_booking_created'::"text", 'private_booking_deposit_received'::"text", 'private_booking_final_payment'::"text", 'private_booking_reminder_14d'::"text", 'private_booking_balance_reminder'::"text", 'private_booking_reminder_1d'::"text", 'private_booking_date_changed'::"text", 'private_booking_confirmed'::"text", 'private_booking_cancelled'::"text"])))
);


ALTER TABLE "public"."message_templates" OWNER TO "postgres";


COMMENT ON TABLE "public"."message_templates" IS 'Stores reusable message templates with variable substitution. Templates support both {{customer_name}} for full name and {{first_name}} for personalized messages.';



COMMENT ON COLUMN "public"."message_templates"."template_type" IS 'Template type: booking_confirmation/reminder_* for actual bookings with seats, booking_reminder_* for 0-seat reminders';



COMMENT ON COLUMN "public"."message_templates"."send_timing" IS 'When to send the message relative to the event time';



COMMENT ON COLUMN "public"."message_templates"."custom_timing_hours" IS 'Custom timing in hours before event (only used when send_timing = custom)';



CREATE OR REPLACE VIEW "public"."message_templates_with_timing" AS
 SELECT "mt"."id",
    "mt"."created_at",
    "mt"."updated_at",
    "mt"."name",
    "mt"."description",
    "mt"."template_type",
    "mt"."content",
    "mt"."variables",
    "mt"."is_default",
    "mt"."is_active",
    "mt"."created_by",
    "mt"."character_count",
    "mt"."estimated_segments",
    "mt"."send_timing",
    "mt"."custom_timing_hours",
        CASE
            WHEN ("mt"."send_timing" = 'immediate'::"text") THEN 'Send immediately'::"text"
            WHEN ("mt"."send_timing" = '1_hour'::"text") THEN '1 hour before event'::"text"
            WHEN ("mt"."send_timing" = '12_hours'::"text") THEN '12 hours before event'::"text"
            WHEN ("mt"."send_timing" = '24_hours'::"text") THEN '24 hours before event'::"text"
            WHEN ("mt"."send_timing" = '7_days'::"text") THEN '7 days before event'::"text"
            WHEN (("mt"."send_timing" = 'custom'::"text") AND ("mt"."custom_timing_hours" IS NOT NULL)) THEN ("mt"."custom_timing_hours" || ' hours before event'::"text")
            ELSE 'Unknown timing'::"text"
        END AS "timing_description"
   FROM "public"."message_templates" "mt";


ALTER TABLE "public"."message_templates_with_timing" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "module_name" "text" NOT NULL,
    "action" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."phone_standardization_issues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "table_name" "text" NOT NULL,
    "record_id" "uuid" NOT NULL,
    "original_phone" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."phone_standardization_issues" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."private_booking_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "field_name" "text",
    "old_value" "text",
    "new_value" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "performed_by" "uuid",
    "performed_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."private_booking_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."private_booking_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "document_type" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "mime_type" "text",
    "file_size_bytes" integer,
    "version" integer DEFAULT 1,
    "generated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "generated_by" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "private_booking_documents_document_type_check" CHECK (("document_type" = ANY (ARRAY['contract'::"text", 'invoice'::"text", 'receipt'::"text", 'correspondence'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."private_booking_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."private_booking_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "item_type" "text" NOT NULL,
    "space_id" "uuid",
    "package_id" "uuid",
    "vendor_id" "uuid",
    "description" "text" NOT NULL,
    "quantity" numeric(10,2) DEFAULT 1 NOT NULL,
    "unit_price" numeric(10,2) NOT NULL,
    "discount_type" "text",
    "discount_value" numeric(10,2) DEFAULT 0,
    "discount_reason" "text",
    "line_total" numeric(10,2) GENERATED ALWAYS AS (
CASE
    WHEN ("discount_type" = 'percent'::"text") THEN (("quantity" * "unit_price") * ((1)::numeric - (COALESCE("discount_value", (0)::numeric) / (100)::numeric)))
    WHEN ("discount_type" = 'fixed'::"text") THEN (("quantity" * "unit_price") - COALESCE("discount_value", (0)::numeric))
    ELSE ("quantity" * "unit_price")
END) STORED,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "chk_item_references" CHECK (((("item_type" = 'space'::"text") AND ("space_id" IS NOT NULL) AND ("package_id" IS NULL) AND ("vendor_id" IS NULL)) OR (("item_type" = 'catering'::"text") AND ("package_id" IS NOT NULL) AND ("space_id" IS NULL) AND ("vendor_id" IS NULL)) OR (("item_type" = 'vendor'::"text") AND ("vendor_id" IS NOT NULL) AND ("space_id" IS NULL) AND ("package_id" IS NULL)) OR (("item_type" = 'other'::"text") AND ("space_id" IS NULL) AND ("package_id" IS NULL) AND ("vendor_id" IS NULL)))),
    CONSTRAINT "private_booking_items_discount_type_check" CHECK (("discount_type" = ANY (ARRAY['percent'::"text", 'fixed'::"text"]))),
    CONSTRAINT "private_booking_items_item_type_check" CHECK (("item_type" = ANY (ARRAY['space'::"text", 'catering'::"text", 'vendor'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."private_booking_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."private_booking_items" IS 'Line items for spaces, catering, vendors, and other charges';



CREATE TABLE IF NOT EXISTS "public"."private_booking_sms_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "trigger_type" "text" NOT NULL,
    "template_key" "text" NOT NULL,
    "scheduled_for" timestamp with time zone NOT NULL,
    "message_body" "text" NOT NULL,
    "customer_phone" "text" NOT NULL,
    "customer_name" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "twilio_message_sid" "text",
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "created_by" "uuid",
    "priority" integer DEFAULT 3,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "recipient_phone" "text",
    "skip_conditions" "jsonb",
    CONSTRAINT "private_booking_sms_queue_priority_check" CHECK ((("priority" >= 1) AND ("priority" <= 5))),
    CONSTRAINT "private_booking_sms_queue_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'sent'::"text", 'cancelled'::"text", 'failed'::"text"]))),
    CONSTRAINT "private_booking_sms_queue_trigger_type_check" CHECK (("trigger_type" = ANY (ARRAY['status_change'::"text", 'deposit_received'::"text", 'payment_received'::"text", 'final_payment_received'::"text", 'reminder'::"text", 'payment_due'::"text", 'urgent'::"text", 'manual'::"text", 'booking_created'::"text", 'date_changed'::"text", 'booking_cancelled'::"text", 'event_reminder_14d'::"text", 'event_reminder_1d'::"text", 'balance_reminder'::"text", 'setup_reminder'::"text"])))
);


ALTER TABLE "public"."private_booking_sms_queue" OWNER TO "postgres";


COMMENT ON TABLE "public"."private_booking_sms_queue" IS 'Queue for SMS messages requiring approval before sending';



COMMENT ON COLUMN "public"."private_booking_sms_queue"."priority" IS '1=Highest (payments), 2=High (status changes), 3=Normal (reminders), 4=Low, 5=Lowest';



COMMENT ON COLUMN "public"."private_booking_sms_queue"."metadata" IS 'Additional data for the SMS, including template variables';



COMMENT ON COLUMN "public"."private_booking_sms_queue"."skip_conditions" IS 'JSON array of conditions that would skip this SMS, e.g. ["final_payment_received"]';



CREATE TABLE IF NOT EXISTS "public"."private_bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid",
    "customer_name" "text" NOT NULL,
    "contact_phone" "text",
    "contact_email" "text",
    "event_date" "date" NOT NULL,
    "start_time" time without time zone NOT NULL,
    "setup_time" time without time zone,
    "end_time" time without time zone,
    "guest_count" integer,
    "event_type" "text",
    "status" "text" DEFAULT 'draft'::"text",
    "deposit_amount" numeric(10,2) DEFAULT 250.00,
    "deposit_paid_date" timestamp with time zone,
    "deposit_payment_method" "text",
    "total_amount" numeric(10,2) DEFAULT 0,
    "balance_due_date" "date",
    "final_payment_date" timestamp with time zone,
    "final_payment_method" "text",
    "calendar_event_id" "text",
    "contract_version" integer DEFAULT 0,
    "internal_notes" "text",
    "customer_requests" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "setup_date" "date",
    "discount_type" "text",
    "discount_amount" numeric(10,2) DEFAULT 0,
    "discount_reason" "text",
    "customer_first_name" "text",
    "customer_last_name" "text",
    "customer_full_name" "text" GENERATED ALWAYS AS (
CASE
    WHEN (("customer_last_name" IS NOT NULL) AND ("customer_last_name" <> ''::"text")) THEN (("customer_first_name" || ' '::"text") || "customer_last_name")
    ELSE "customer_first_name"
END) STORED,
    "source" "text",
    "special_requirements" "text",
    "accessibility_needs" "text",
    CONSTRAINT "chk_booking_times" CHECK (("end_time" > "start_time")),
    CONSTRAINT "chk_email_format" CHECK ((("contact_email" IS NULL) OR ("contact_email" ~* '^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::"text"))),
    CONSTRAINT "chk_phone_format" CHECK ((("contact_phone" IS NULL) OR ("contact_phone" ~* '^(\+?44|0)?[0-9]{10,11}$'::"text"))),
    CONSTRAINT "chk_setup_before_start" CHECK ((("setup_time" IS NULL) OR ("setup_date" < "event_date") OR (("setup_date" = "event_date") AND ("setup_time" <= "start_time")) OR (("setup_date" IS NULL) AND ("setup_time" <= "start_time")))),
    CONSTRAINT "private_bookings_discount_type_check" CHECK (("discount_type" = ANY (ARRAY['percent'::"text", 'fixed'::"text"]))),
    CONSTRAINT "private_bookings_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'confirmed'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."private_bookings" OWNER TO "postgres";


COMMENT ON TABLE "public"."private_bookings" IS 'Main table for private venue hire bookings';



COMMENT ON COLUMN "public"."private_bookings"."customer_name" IS 'Deprecated: Use customer_first_name and customer_last_name instead. This column will be removed in a future migration.';



COMMENT ON COLUMN "public"."private_bookings"."setup_time" IS 'Time when vendors/staff can begin setup, must be before start_time';



COMMENT ON COLUMN "public"."private_bookings"."status" IS 'Booking status: draft, confirmed, completed, cancelled';



COMMENT ON COLUMN "public"."private_bookings"."deposit_amount" IS 'Standard £250 deposit required to confirm booking';



COMMENT ON COLUMN "public"."private_bookings"."balance_due_date" IS 'Auto-calculated as event_date - 7 days';



COMMENT ON COLUMN "public"."private_bookings"."setup_date" IS 'Optional date for setup if different from event_date (e.g., night before)';



COMMENT ON COLUMN "public"."private_bookings"."customer_first_name" IS 'Customer first name - synced from customers table when customer_id is set';



COMMENT ON COLUMN "public"."private_bookings"."customer_last_name" IS 'Customer last name - synced from customers table when customer_id is set';



COMMENT ON COLUMN "public"."private_bookings"."customer_full_name" IS 'Generated column combining first and last name';



COMMENT ON COLUMN "public"."private_bookings"."source" IS 'Where the booking enquiry originated from (phone, email, walk-in, website, referral, other)';



COMMENT ON COLUMN "public"."private_bookings"."special_requirements" IS 'Special requirements for the event (equipment needs, layout preferences, technical requirements)';



COMMENT ON COLUMN "public"."private_bookings"."accessibility_needs" IS 'Accessibility requirements for the event (wheelchair access, hearing loops, dietary restrictions)';



COMMENT ON CONSTRAINT "chk_setup_before_start" ON "public"."private_bookings" IS 'Ensures setup happens before event start. Allows setup on earlier dates or same-day setup before start time.';



CREATE OR REPLACE VIEW "public"."private_booking_sms_reminders" AS
 SELECT "pb"."id" AS "booking_id",
    "pb"."customer_first_name",
    "pb"."contact_phone",
    "pb"."event_date",
    "pb"."start_time",
    "pb"."guest_count",
    "pb"."balance_due_date",
    "pb"."deposit_paid_date",
    "pb"."final_payment_date",
    "pb"."status",
        CASE
            WHEN (("pb"."event_date" - '14 days'::interval) > "now"()) THEN ("pb"."event_date" - '14 days'::interval)
            ELSE NULL::timestamp without time zone
        END AS "reminder_14d_due",
        CASE
            WHEN (("pb"."balance_due_date" IS NOT NULL) AND ("pb"."final_payment_date" IS NULL) AND (("pb"."balance_due_date" - '3 days'::interval) > "now"())) THEN ("pb"."balance_due_date" - '3 days'::interval)
            ELSE NULL::timestamp without time zone
        END AS "balance_reminder_due",
        CASE
            WHEN (("pb"."event_date" - '1 day'::interval) > "now"()) THEN ("pb"."event_date" - '1 day'::interval)
            ELSE NULL::timestamp without time zone
        END AS "reminder_1d_due",
    "public"."calculate_private_booking_balance"("pb"."id") AS "balance_amount"
   FROM "public"."private_bookings" "pb"
  WHERE (("pb"."status" = ANY (ARRAY['tentative'::"text", 'confirmed'::"text"])) AND ("pb"."contact_phone" IS NOT NULL) AND ("pb"."event_date" > "now"()));


ALTER TABLE "public"."private_booking_sms_reminders" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."private_booking_summary" AS
 SELECT "pb"."id",
    "pb"."customer_id",
    "pb"."customer_name",
    "pb"."contact_phone",
    "pb"."contact_email",
    "pb"."event_date",
    "pb"."start_time",
    "pb"."setup_time",
    "pb"."end_time",
    "pb"."guest_count",
    "pb"."event_type",
    "pb"."status",
    "pb"."deposit_amount",
    "pb"."deposit_paid_date",
    "pb"."deposit_payment_method",
    "pb"."total_amount",
    "pb"."balance_due_date",
    "pb"."final_payment_date",
    "pb"."final_payment_method",
    "pb"."calendar_event_id",
    "pb"."contract_version",
    "pb"."internal_notes",
    "pb"."customer_requests",
    "pb"."created_by",
    "pb"."created_at",
    "pb"."updated_at",
    "c"."first_name",
    "c"."last_name",
    COALESCE(( SELECT "sum"("private_booking_items"."line_total") AS "sum"
           FROM "public"."private_booking_items"
          WHERE ("private_booking_items"."booking_id" = "pb"."id")), (0)::numeric) AS "calculated_total",
        CASE
            WHEN ("pb"."deposit_paid_date" IS NOT NULL) THEN 'Paid'::"text"
            WHEN ("pb"."status" = 'confirmed'::"text") THEN 'Required'::"text"
            ELSE 'Not Required'::"text"
        END AS "deposit_status",
    ("pb"."event_date" - CURRENT_DATE) AS "days_until_event"
   FROM ("public"."private_bookings" "pb"
     LEFT JOIN "public"."customers" "c" ON (("pb"."customer_id" = "c"."id")));


ALTER TABLE "public"."private_booking_summary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."private_bookings_with_details" AS
 SELECT "pb"."id",
    "pb"."customer_id",
    "pb"."customer_name",
    "pb"."contact_phone",
    "pb"."contact_email",
    "pb"."event_date",
    "pb"."start_time",
    "pb"."setup_time",
    "pb"."end_time",
    "pb"."guest_count",
    "pb"."event_type",
    "pb"."status",
    "pb"."deposit_amount",
    "pb"."deposit_paid_date",
    "pb"."deposit_payment_method",
    "pb"."total_amount",
    "pb"."balance_due_date",
    "pb"."final_payment_date",
    "pb"."final_payment_method",
    "pb"."calendar_event_id",
    "pb"."contract_version",
    "pb"."internal_notes",
    "pb"."customer_requests",
    "pb"."created_by",
    "pb"."created_at",
    "pb"."updated_at",
    "pb"."setup_date",
    "pb"."discount_type",
    "pb"."discount_amount",
    "pb"."discount_reason",
    "pb"."customer_first_name",
    "pb"."customer_last_name",
    "pb"."customer_full_name",
    "c"."mobile_number" AS "customer_mobile",
    ( SELECT COALESCE("sum"("pbi"."line_total"), (0)::numeric) AS "coalesce"
           FROM "public"."private_booking_items" "pbi"
          WHERE ("pbi"."booking_id" = "pb"."id")) AS "calculated_total",
        CASE
            WHEN ("pb"."deposit_paid_date" IS NOT NULL) THEN 'Paid'::"text"
            WHEN ("pb"."status" = 'confirmed'::"text") THEN 'Required'::"text"
            ELSE 'Not Required'::"text"
        END AS "deposit_status",
    ("pb"."event_date" - CURRENT_DATE) AS "days_until_event"
   FROM ("public"."private_bookings" "pb"
     LEFT JOIN "public"."customers" "c" ON (("pb"."customer_id" = "c"."id")));


ALTER TABLE "public"."private_bookings_with_details" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "email" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "sms_notifications" boolean DEFAULT true,
    "email_notifications" boolean DEFAULT true,
    "avatar_url" "text"
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."profiles" IS 'Required by Supabase Auth. Stores basic user profile data. No UI currently implemented but kept for authentication purposes.';



COMMENT ON COLUMN "public"."profiles"."sms_notifications" IS 'Whether the user wants to receive SMS notifications';



COMMENT ON COLUMN "public"."profiles"."email_notifications" IS 'Whether the user wants to receive email notifications';



COMMENT ON COLUMN "public"."profiles"."avatar_url" IS 'Path to user avatar in storage bucket';



CREATE TABLE IF NOT EXISTS "public"."reminder_processing_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "processing_type" "text" NOT NULL,
    "booking_id" "uuid",
    "event_id" "uuid",
    "customer_id" "uuid",
    "template_type" "text",
    "reminder_type" "text",
    "message" "text",
    "error_details" "jsonb",
    "metadata" "jsonb"
);


ALTER TABLE "public"."reminder_processing_logs" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."recent_reminder_activity" AS
 SELECT "rpl"."created_at",
    "rpl"."processing_type",
    "rpl"."message",
    (("c"."first_name" || ' '::"text") || "c"."last_name") AS "customer_name",
    "e"."name" AS "event_name",
    "e"."date" AS "event_date",
    "e"."time" AS "event_time",
    "rpl"."template_type",
    "rpl"."reminder_type",
    "rpl"."error_details"
   FROM (("public"."reminder_processing_logs" "rpl"
     LEFT JOIN "public"."customers" "c" ON (("rpl"."customer_id" = "c"."id")))
     LEFT JOIN "public"."events" "e" ON (("rpl"."event_id" = "e"."id")))
  ORDER BY "rpl"."created_at" DESC
 LIMIT 100;


ALTER TABLE "public"."recent_reminder_activity" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."reminder_timing_debug" AS
 WITH "template_configs" AS (
         SELECT DISTINCT "mt"."template_type",
            "mt"."send_timing",
            "mt"."custom_timing_hours",
                CASE
                    WHEN ("mt"."send_timing" = '1_hour'::"text") THEN 1
                    WHEN ("mt"."send_timing" = '12_hours'::"text") THEN 12
                    WHEN ("mt"."send_timing" = '24_hours'::"text") THEN 24
                    WHEN ("mt"."send_timing" = '7_days'::"text") THEN 168
                    WHEN ("mt"."send_timing" = 'custom'::"text") THEN "mt"."custom_timing_hours"
                    ELSE NULL::integer
                END AS "hours_before_event"
           FROM "public"."message_templates" "mt"
          WHERE (("mt"."is_active" = true) AND ("mt"."send_timing" <> 'immediate'::"text"))
        ), "bookings_with_timing" AS (
         SELECT "b"."id" AS "booking_id",
            (("c"."first_name" || ' '::"text") || "c"."last_name") AS "customer_name",
            "e"."name" AS "event_name",
            "e"."date" AS "event_date",
            "e"."time" AS "event_time",
            (("e"."date")::timestamp without time zone + (("e"."time")::time without time zone)::interval) AS "event_datetime",
            "b"."seats",
            "c"."sms_opt_in",
            (EXISTS ( SELECT 1
                   FROM "public"."booking_reminders" "br"
                  WHERE ("br"."booking_id" = "b"."id"))) AS "has_any_reminder_sent"
           FROM (("public"."bookings" "b"
             JOIN "public"."events" "e" ON (("b"."event_id" = "e"."id")))
             JOIN "public"."customers" "c" ON (("b"."customer_id" = "c"."id")))
          WHERE (("c"."sms_opt_in" = true) AND ("c"."mobile_number" IS NOT NULL) AND ("e"."date" >= (CURRENT_DATE - '7 days'::interval)))
        )
 SELECT "bwt"."booking_id",
    "bwt"."customer_name",
    "bwt"."event_name",
    "bwt"."event_datetime",
    "tc"."template_type",
    "tc"."send_timing",
    "tc"."hours_before_event",
    ("bwt"."event_datetime" - ('01:00:00'::interval * ("tc"."hours_before_event")::double precision)) AS "reminder_should_send_at",
        CASE
            WHEN (("now"() >= ("bwt"."event_datetime" - ('01:00:00'::interval * ("tc"."hours_before_event")::double precision))) AND ("now"() < (("bwt"."event_datetime" - ('01:00:00'::interval * ("tc"."hours_before_event")::double precision)) + '01:00:00'::interval))) THEN 'Should send NOW'::"text"
            WHEN ("now"() < ("bwt"."event_datetime" - ('01:00:00'::interval * ("tc"."hours_before_event")::double precision))) THEN ('Future - will send at '::"text" || (("bwt"."event_datetime" - ('01:00:00'::interval * ("tc"."hours_before_event")::double precision)))::"text")
            ELSE 'Past - window missed'::"text"
        END AS "send_status",
    (EXISTS ( SELECT 1
           FROM "public"."booking_reminders" "br"
          WHERE (("br"."booking_id" = "bwt"."booking_id") AND ("br"."reminder_type" =
                CASE
                    WHEN ("tc"."send_timing" = '1_hour'::"text") THEN '1_hour'::"text"
                    WHEN ("tc"."send_timing" = '12_hours'::"text") THEN '12_hour'::"text"
                    WHEN ("tc"."send_timing" = '24_hours'::"text") THEN '24_hour'::"text"
                    WHEN ("tc"."send_timing" = '7_days'::"text") THEN '7_day'::"text"
                    WHEN ("tc"."send_timing" = 'custom'::"text") THEN (('custom_'::"text" || ("tc"."custom_timing_hours")::"text") || '_hour'::"text")
                    ELSE "tc"."send_timing"
                END)))) AS "reminder_already_sent",
    "bwt"."has_any_reminder_sent"
   FROM ("bookings_with_timing" "bwt"
     CROSS JOIN "template_configs" "tc")
  WHERE (("tc"."hours_before_event" IS NOT NULL) AND ((("bwt"."seats" > 0) AND ("tc"."template_type" = ANY (ARRAY['dayBeforeReminder'::"text", 'weekBeforeReminder'::"text"]))) OR ((("bwt"."seats" = 0) OR ("bwt"."seats" IS NULL)) AND ("tc"."template_type" = ANY (ARRAY['booking_reminder_24_hour'::"text", 'booking_reminder_7_day'::"text"])))))
  ORDER BY "bwt"."event_datetime", "tc"."hours_before_event" DESC;


ALTER TABLE "public"."reminder_timing_debug" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "role_id" "uuid" NOT NULL,
    "permission_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_system" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."special_hours" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "date" "date" NOT NULL,
    "opens" time without time zone,
    "closes" time without time zone,
    "kitchen_opens" time without time zone,
    "kitchen_closes" time without time zone,
    "is_closed" boolean DEFAULT false,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."special_hours" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "user_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"(),
    "assigned_by" "uuid"
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "company_name" "text",
    "service_type" "text" NOT NULL,
    "contact_phone" "text",
    "contact_email" "text",
    "website" "text",
    "typical_rate" "text",
    "notes" "text",
    "preferred" boolean DEFAULT false,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "chk_vendor_email" CHECK ((("contact_email" IS NULL) OR ("contact_email" ~* '^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::"text"))),
    CONSTRAINT "chk_vendor_phone" CHECK ((("contact_phone" IS NULL) OR ("contact_phone" ~* '^(\+?44|0)?[0-9]{10,11}$'::"text"))),
    CONSTRAINT "vendors_service_type_check" CHECK (("service_type" = ANY (ARRAY['dj'::"text", 'band'::"text", 'photographer'::"text", 'florist'::"text", 'decorator'::"text", 'cake'::"text", 'transport'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."vendors" OWNER TO "postgres";


COMMENT ON TABLE "public"."vendors" IS 'Database of external vendors (DJs, photographers, etc.)';



CREATE TABLE IF NOT EXISTS "public"."venue_spaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "capacity_seated" integer,
    "capacity_standing" integer,
    "rate_per_hour" numeric(10,2) NOT NULL,
    "minimum_hours" integer DEFAULT 2,
    "setup_fee" numeric(10,2) DEFAULT 0,
    "active" boolean DEFAULT true,
    "display_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."venue_spaces" OWNER TO "postgres";


COMMENT ON TABLE "public"."venue_spaces" IS 'Configurable spaces within The Anchor available for private hire';



CREATE TABLE IF NOT EXISTS "public"."webhook_deliveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "webhook_id" "uuid" NOT NULL,
    "event_type" character varying(100) NOT NULL,
    "payload" "jsonb" NOT NULL,
    "response_status" integer,
    "response_body" "text",
    "attempt_count" integer DEFAULT 1,
    "delivered_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."webhook_deliveries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."webhook_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "webhook_type" "text" DEFAULT 'twilio'::"text" NOT NULL,
    "status" "text" NOT NULL,
    "headers" "jsonb",
    "body" "text",
    "params" "jsonb",
    "error_message" "text",
    "error_details" "jsonb",
    "processed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "message_sid" "text",
    "from_number" "text",
    "to_number" "text",
    "message_body" "text",
    "customer_id" "uuid",
    "message_id" "uuid"
);


ALTER TABLE "public"."webhook_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."webhook_logs" IS 'Stores all webhook requests from Twilio for debugging and auditing purposes';



COMMENT ON COLUMN "public"."webhook_logs"."headers" IS 'HTTP headers from the webhook request';



COMMENT ON COLUMN "public"."webhook_logs"."body" IS 'Raw body of the webhook request (limited to 10000 chars)';



COMMENT ON COLUMN "public"."webhook_logs"."params" IS 'Parsed parameters from the webhook body';



COMMENT ON COLUMN "public"."webhook_logs"."error_details" IS 'Detailed error information including stack traces';



COMMENT ON COLUMN "public"."webhook_logs"."from_number" IS 'Phone number that sent the message (for inbound SMS)';



COMMENT ON COLUMN "public"."webhook_logs"."to_number" IS 'Phone number that received the message';



COMMENT ON COLUMN "public"."webhook_logs"."message_body" IS 'SMS message content (limited to 1000 chars)';



COMMENT ON COLUMN "public"."webhook_logs"."customer_id" IS 'Reference to the customer associated with this webhook';



COMMENT ON COLUMN "public"."webhook_logs"."message_id" IS 'Reference to the message created from this webhook';



CREATE TABLE IF NOT EXISTS "public"."webhooks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "url" "text" NOT NULL,
    "events" "jsonb" DEFAULT '["*"]'::"jsonb",
    "secret" character varying(255),
    "is_active" boolean DEFAULT true,
    "last_triggered_at" timestamp with time zone,
    "failure_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."webhooks" OWNER TO "postgres";


ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_key_hash_key" UNIQUE ("key_hash");



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."api_usage"
    ADD CONSTRAINT "api_usage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attachment_categories"
    ADD CONSTRAINT "attachment_categories_category_name_key" UNIQUE ("category_name");



ALTER TABLE ONLY "public"."attachment_categories"
    ADD CONSTRAINT "attachment_categories_pkey" PRIMARY KEY ("category_id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."background_jobs"
    ADD CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_reminders"
    ADD CONSTRAINT "booking_reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_customer_id_event_id_key" UNIQUE ("customer_id", "event_id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."business_amenities"
    ADD CONSTRAINT "business_amenities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."business_amenities"
    ADD CONSTRAINT "business_amenities_type_key" UNIQUE ("type");



ALTER TABLE ONLY "public"."business_hours"
    ADD CONSTRAINT "business_hours_day_of_week_key" UNIQUE ("day_of_week");



ALTER TABLE ONLY "public"."business_hours"
    ADD CONSTRAINT "business_hours_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."catering_packages"
    ADD CONSTRAINT "catering_packages_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."catering_packages"
    ADD CONSTRAINT "catering_packages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_category_stats"
    ADD CONSTRAINT "customer_category_stats_pkey" PRIMARY KEY ("customer_id", "category_id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_attachments"
    ADD CONSTRAINT "employee_attachments_pkey" PRIMARY KEY ("attachment_id");



ALTER TABLE ONLY "public"."employee_emergency_contacts"
    ADD CONSTRAINT "employee_emergency_contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_financial_details"
    ADD CONSTRAINT "employee_financial_details_pkey" PRIMARY KEY ("employee_id");



ALTER TABLE ONLY "public"."employee_health_records"
    ADD CONSTRAINT "employee_health_records_pkey" PRIMARY KEY ("employee_id");



ALTER TABLE ONLY "public"."employee_notes"
    ADD CONSTRAINT "employee_notes_pkey" PRIMARY KEY ("note_id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_email_address_key" UNIQUE ("email_address");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_pkey" PRIMARY KEY ("employee_id");



ALTER TABLE ONLY "public"."event_categories"
    ADD CONSTRAINT "event_categories_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."event_categories"
    ADD CONSTRAINT "event_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_categories"
    ADD CONSTRAINT "event_categories_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."event_faqs"
    ADD CONSTRAINT "event_faqs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_images"
    ADD CONSTRAINT "event_images_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_message_templates"
    ADD CONSTRAINT "event_message_templates_event_id_template_type_key" UNIQUE ("event_id", "template_type");



ALTER TABLE ONLY "public"."event_message_templates"
    ADD CONSTRAINT "event_message_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."job_queue"
    ADD CONSTRAINT "job_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."menu_items"
    ADD CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."menu_sections"
    ADD CONSTRAINT "menu_sections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."message_delivery_status"
    ADD CONSTRAINT "message_delivery_status_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."message_template_history"
    ADD CONSTRAINT "message_template_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."message_templates"
    ADD CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_module_name_action_key" UNIQUE ("module_name", "action");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."phone_standardization_issues"
    ADD CONSTRAINT "phone_standardization_issues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."private_booking_audit"
    ADD CONSTRAINT "private_booking_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."private_booking_documents"
    ADD CONSTRAINT "private_booking_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."private_booking_items"
    ADD CONSTRAINT "private_booking_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."private_booking_sms_queue"
    ADD CONSTRAINT "private_booking_sms_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."private_bookings"
    ADD CONSTRAINT "private_bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminder_processing_logs"
    ADD CONSTRAINT "reminder_processing_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."special_hours"
    ADD CONSTRAINT "special_hours_date_key" UNIQUE ("date");



ALTER TABLE ONLY "public"."special_hours"
    ADD CONSTRAINT "special_hours_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_reminders"
    ADD CONSTRAINT "unique_booking_reminder" UNIQUE ("booking_id", "reminder_type");



COMMENT ON CONSTRAINT "unique_booking_reminder" ON "public"."booking_reminders" IS 'Ensures each reminder type is only sent once per booking';



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id", "role_id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venue_spaces"
    ADD CONSTRAINT "venue_spaces_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."venue_spaces"
    ADD CONSTRAINT "venue_spaces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."webhook_deliveries"
    ADD CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."webhook_logs"
    ADD CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."webhooks"
    ADD CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_api_usage_key_time" ON "public"."api_usage" USING "btree" ("api_key_id", "created_at" DESC);



CREATE INDEX "idx_audit_logs_created_at" ON "public"."audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_logs_employee_history" ON "public"."audit_logs" USING "btree" ("resource_id", "created_at" DESC) WHERE (("resource_type" = 'employee'::"text") AND ("operation_status" = 'success'::"text"));



CREATE INDEX "idx_audit_logs_operation_type" ON "public"."audit_logs" USING "btree" ("operation_type");



CREATE INDEX "idx_audit_logs_resource" ON "public"."audit_logs" USING "btree" ("resource_type", "resource_id");



CREATE INDEX "idx_audit_logs_resource_composite" ON "public"."audit_logs" USING "btree" ("resource_type", "resource_id", "created_at" DESC);



CREATE INDEX "idx_audit_logs_resource_created" ON "public"."audit_logs" USING "btree" ("resource_type", "created_at" DESC) WHERE ("resource_type" = ANY (ARRAY['employee'::"text", 'message_template'::"text", 'bulk_message'::"text"]));



CREATE INDEX "idx_audit_logs_user_created" ON "public"."audit_logs" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_audit_logs_user_date" ON "public"."audit_logs" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_audit_logs_user_id" ON "public"."audit_logs" USING "btree" ("user_id");



CREATE INDEX "idx_background_jobs_created_at" ON "public"."background_jobs" USING "btree" ("created_at");



CREATE INDEX "idx_background_jobs_priority" ON "public"."background_jobs" USING "btree" ("priority" DESC, "created_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_background_jobs_status_scheduled" ON "public"."background_jobs" USING "btree" ("status", "scheduled_for") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_background_jobs_type" ON "public"."background_jobs" USING "btree" ("type");



CREATE INDEX "idx_booking_reminders_booking_id" ON "public"."booking_reminders" USING "btree" ("booking_id");



CREATE INDEX "idx_booking_reminders_booking_type" ON "public"."booking_reminders" USING "btree" ("booking_id", "reminder_type");



CREATE INDEX "idx_booking_reminders_sent_at" ON "public"."booking_reminders" USING "btree" ("sent_at");



CREATE INDEX "idx_bookings_created_recent" ON "public"."bookings" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_bookings_customer_id" ON "public"."bookings" USING "btree" ("customer_id");



CREATE INDEX "idx_bookings_customer_id_created_at" ON "public"."bookings" USING "btree" ("customer_id", "created_at" DESC);



CREATE INDEX "idx_bookings_event_customer" ON "public"."bookings" USING "btree" ("event_id", "customer_id");



CREATE INDEX "idx_bookings_event_date" ON "public"."bookings" USING "btree" ("event_id", "created_at" DESC);



CREATE INDEX "idx_bookings_event_id" ON "public"."bookings" USING "btree" ("event_id");



CREATE INDEX "idx_bookings_event_id_count" ON "public"."bookings" USING "btree" ("event_id") INCLUDE ("id");



CREATE INDEX "idx_customer_category_stats_category_id" ON "public"."customer_category_stats" USING "btree" ("category_id");



CREATE INDEX "idx_customer_category_stats_customer_id" ON "public"."customer_category_stats" USING "btree" ("customer_id");



CREATE INDEX "idx_customer_category_stats_last_attended" ON "public"."customer_category_stats" USING "btree" ("last_attended_date" DESC);



CREATE INDEX "idx_customers_consecutive_failures" ON "public"."customers" USING "btree" ("consecutive_failures");



CREATE INDEX "idx_customers_created_recent" ON "public"."customers" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_customers_messaging_status" ON "public"."customers" USING "btree" ("messaging_status");



CREATE INDEX "idx_customers_mobile_number" ON "public"."customers" USING "btree" ("mobile_number");



CREATE INDEX "idx_customers_mobile_number_normalized" ON "public"."customers" USING "btree" ("mobile_number") WHERE ("mobile_number" IS NOT NULL);



CREATE INDEX "idx_customers_sms_delivery_failures" ON "public"."customers" USING "btree" ("sms_delivery_failures");



CREATE INDEX "idx_customers_sms_failures" ON "public"."customers" USING "btree" ("sms_opt_in", "sms_delivery_failures") WHERE (("sms_opt_in" = false) OR ("sms_delivery_failures" > 0));



CREATE INDEX "idx_customers_sms_opt_in" ON "public"."customers" USING "btree" ("sms_opt_in");



CREATE INDEX "idx_employee_attachments_category" ON "public"."employee_attachments" USING "btree" ("category_id", "uploaded_at" DESC);



CREATE INDEX "idx_employee_attachments_employee" ON "public"."employee_attachments" USING "btree" ("employee_id", "uploaded_at" DESC);



CREATE INDEX "idx_employee_attachments_employee_id" ON "public"."employee_attachments" USING "btree" ("employee_id");



CREATE INDEX "idx_employee_emergency_contacts_employee_id" ON "public"."employee_emergency_contacts" USING "btree" ("employee_id");



CREATE INDEX "idx_employee_financial_details_employee_id" ON "public"."employee_financial_details" USING "btree" ("employee_id");



CREATE INDEX "idx_employee_health_records_employee_id" ON "public"."employee_health_records" USING "btree" ("employee_id");



CREATE INDEX "idx_employee_notes_created_at" ON "public"."employee_notes" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_employee_notes_employee_created" ON "public"."employee_notes" USING "btree" ("employee_id", "created_at" DESC);



CREATE INDEX "idx_employee_notes_employee_id" ON "public"."employee_notes" USING "btree" ("employee_id");



CREATE UNIQUE INDEX "idx_employees_email" ON "public"."employees" USING "btree" ("email_address");



CREATE INDEX "idx_employees_employment_dates" ON "public"."employees" USING "btree" ("employment_start_date", "employment_end_date");



CREATE INDEX "idx_employees_name_search" ON "public"."employees" USING "btree" ("last_name", "first_name");



CREATE INDEX "idx_employees_status" ON "public"."employees" USING "btree" ("status");



CREATE INDEX "idx_event_categories_slug" ON "public"."event_categories" USING "btree" ("slug");



CREATE INDEX "idx_event_categories_sort_order" ON "public"."event_categories" USING "btree" ("sort_order");



CREATE INDEX "idx_event_faqs_event_id" ON "public"."event_faqs" USING "btree" ("event_id");



CREATE INDEX "idx_event_faqs_sort_order" ON "public"."event_faqs" USING "btree" ("event_id", "sort_order");



CREATE INDEX "idx_event_images_event_id" ON "public"."event_images" USING "btree" ("event_id");



CREATE INDEX "idx_event_images_type" ON "public"."event_images" USING "btree" ("image_type");



CREATE INDEX "idx_event_message_templates_event" ON "public"."event_message_templates" USING "btree" ("event_id");



CREATE INDEX "idx_event_message_templates_send_timing" ON "public"."event_message_templates" USING "btree" ("send_timing");



CREATE INDEX "idx_events_category_id" ON "public"."events" USING "btree" ("category_id");



CREATE INDEX "idx_events_date" ON "public"."events" USING "btree" ("date");



CREATE INDEX "idx_events_date_status" ON "public"."events" USING "btree" ("date", "event_status");



CREATE INDEX "idx_events_date_upcoming" ON "public"."events" USING "btree" ("date");



CREATE INDEX "idx_events_recurring" ON "public"."events" USING "btree" ("is_recurring", "parent_event_id");



CREATE UNIQUE INDEX "idx_events_slug" ON "public"."events" USING "btree" ("slug");



CREATE INDEX "idx_job_queue_created_at" ON "public"."job_queue" USING "btree" ("created_at");



CREATE INDEX "idx_job_queue_status" ON "public"."job_queue" USING "btree" ("status");



CREATE INDEX "idx_job_queue_type" ON "public"."job_queue" USING "btree" ("type");



CREATE INDEX "idx_menu_items_section" ON "public"."menu_items" USING "btree" ("section_id", "sort_order");



CREATE INDEX "idx_menu_items_special" ON "public"."menu_items" USING "btree" ("is_special", "is_available");



CREATE INDEX "idx_message_delivery_message" ON "public"."message_delivery_status" USING "btree" ("message_id", "created_at" DESC);



CREATE INDEX "idx_message_delivery_status_created_at" ON "public"."message_delivery_status" USING "btree" ("created_at");



CREATE INDEX "idx_message_delivery_status_message_id" ON "public"."message_delivery_status" USING "btree" ("message_id");



CREATE INDEX "idx_message_templates_default" ON "public"."message_templates" USING "btree" ("is_default");



CREATE INDEX "idx_message_templates_send_timing" ON "public"."message_templates" USING "btree" ("send_timing");



CREATE INDEX "idx_message_templates_type" ON "public"."message_templates" USING "btree" ("template_type");



CREATE INDEX "idx_messages_created_at" ON "public"."messages" USING "btree" ("created_at");



CREATE INDEX "idx_messages_customer_created" ON "public"."messages" USING "btree" ("customer_id", "created_at" DESC);



CREATE INDEX "idx_messages_customer_direction_read" ON "public"."messages" USING "btree" ("customer_id", "direction", "read_at") WHERE ("direction" = 'inbound'::"text");



CREATE INDEX "idx_messages_customer_direction_status" ON "public"."messages" USING "btree" ("customer_id", "direction", "twilio_status") WHERE ("direction" = 'outbound'::"text");



CREATE INDEX "idx_messages_customer_id" ON "public"."messages" USING "btree" ("customer_id");



CREATE INDEX "idx_messages_customer_id_created_at" ON "public"."messages" USING "btree" ("customer_id", "created_at");



CREATE INDEX "idx_messages_direction" ON "public"."messages" USING "btree" ("direction");



CREATE INDEX "idx_messages_direction_created_at" ON "public"."messages" USING "btree" ("direction", "created_at" DESC) WHERE ("direction" = 'inbound'::"text");



CREATE INDEX "idx_messages_from_number" ON "public"."messages" USING "btree" ("from_number");



CREATE INDEX "idx_messages_twilio_message_sid" ON "public"."messages" USING "btree" ("twilio_message_sid");



CREATE INDEX "idx_messages_twilio_status" ON "public"."messages" USING "btree" ("twilio_status");



CREATE INDEX "idx_messages_unread_inbound" ON "public"."messages" USING "btree" ("direction", "read_at") WHERE (("direction" = 'inbound'::"text") AND ("read_at" IS NULL));



CREATE INDEX "idx_permissions_module_name" ON "public"."permissions" USING "btree" ("module_name");



CREATE INDEX "idx_private_booking_audit_booking_id" ON "public"."private_booking_audit" USING "btree" ("booking_id");



CREATE INDEX "idx_private_booking_audit_performed_at" ON "public"."private_booking_audit" USING "btree" ("performed_at" DESC);



CREATE INDEX "idx_private_booking_items_booking_id" ON "public"."private_booking_items" USING "btree" ("booking_id");



CREATE INDEX "idx_private_booking_items_type" ON "public"."private_booking_items" USING "btree" ("item_type");



CREATE INDEX "idx_private_booking_sms_queue_booking_id" ON "public"."private_booking_sms_queue" USING "btree" ("booking_id");



CREATE INDEX "idx_private_booking_sms_queue_status_scheduled" ON "public"."private_booking_sms_queue" USING "btree" ("status", "scheduled_for") WHERE ("status" = ANY (ARRAY['pending'::"text", 'approved'::"text"]));



CREATE INDEX "idx_private_bookings_created_at" ON "public"."private_bookings" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_private_bookings_customer_id" ON "public"."private_bookings" USING "btree" ("customer_id");



CREATE INDEX "idx_private_bookings_event_date" ON "public"."private_bookings" USING "btree" ("event_date");



CREATE INDEX "idx_private_bookings_status" ON "public"."private_bookings" USING "btree" ("status");



CREATE INDEX "idx_private_bookings_status_date" ON "public"."private_bookings" USING "btree" ("status", "event_date") WHERE ("status" = ANY (ARRAY['tentative'::"text", 'confirmed'::"text"]));



CREATE INDEX "idx_profiles_email" ON "public"."profiles" USING "btree" ("email");



CREATE INDEX "idx_reminder_logs_booking_id" ON "public"."reminder_processing_logs" USING "btree" ("booking_id");



CREATE INDEX "idx_reminder_logs_created_at" ON "public"."reminder_processing_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_reminder_logs_processing_type" ON "public"."reminder_processing_logs" USING "btree" ("processing_type");



CREATE INDEX "idx_role_permissions_permission_id" ON "public"."role_permissions" USING "btree" ("permission_id");



CREATE INDEX "idx_role_permissions_role_id" ON "public"."role_permissions" USING "btree" ("role_id");



CREATE INDEX "idx_sms_queue_booking_daily" ON "public"."private_booking_sms_queue" USING "btree" ("booking_id", "recipient_phone", "public"."date_utc"("created_at"));



CREATE INDEX "idx_sms_queue_priority" ON "public"."private_booking_sms_queue" USING "btree" ("priority", "created_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_sms_queue_scheduled_status" ON "public"."private_booking_sms_queue" USING "btree" ("scheduled_for", "status") WHERE ("status" = ANY (ARRAY['pending'::"text", 'approved'::"text"]));



CREATE INDEX "idx_special_hours_date" ON "public"."special_hours" USING "btree" ("date");



CREATE INDEX "idx_user_roles_role_id" ON "public"."user_roles" USING "btree" ("role_id");



CREATE INDEX "idx_user_roles_user_id" ON "public"."user_roles" USING "btree" ("user_id");



CREATE INDEX "idx_webhook_logs_customer_id" ON "public"."webhook_logs" USING "btree" ("customer_id");



CREATE INDEX "idx_webhook_logs_from_number" ON "public"."webhook_logs" USING "btree" ("from_number");



CREATE INDEX "idx_webhook_logs_message_id" ON "public"."webhook_logs" USING "btree" ("message_id");



CREATE INDEX "idx_webhook_logs_message_sid" ON "public"."webhook_logs" USING "btree" ("message_sid");



CREATE INDEX "idx_webhook_logs_processed_at" ON "public"."webhook_logs" USING "btree" ("processed_at" DESC);



CREATE INDEX "idx_webhook_logs_status" ON "public"."webhook_logs" USING "btree" ("status");



CREATE INDEX "idx_webhook_logs_to_number" ON "public"."webhook_logs" USING "btree" ("to_number");



CREATE INDEX "idx_webhook_logs_webhook_type" ON "public"."webhook_logs" USING "btree" ("webhook_type");



CREATE OR REPLACE TRIGGER "booking_category_stats_trigger" AFTER INSERT ON "public"."bookings" FOR EACH ROW WHEN (("new"."seats" > 0)) EXECUTE FUNCTION "public"."update_customer_category_stats"();



CREATE OR REPLACE TRIGGER "enforce_event_date_not_past" BEFORE INSERT OR UPDATE ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."check_event_date_not_past"();



COMMENT ON TRIGGER "enforce_event_date_not_past" ON "public"."events" IS 'Prevents creating new events with past dates and changing future events to past dates';



CREATE OR REPLACE TRIGGER "enforce_single_default_category" BEFORE INSERT OR UPDATE ON "public"."event_categories" FOR EACH ROW WHEN (("new"."is_default" = true)) EXECUTE FUNCTION "public"."ensure_single_default_category"();



CREATE OR REPLACE TRIGGER "log_template_changes" AFTER UPDATE ON "public"."message_templates" FOR EACH ROW EXECUTE FUNCTION "public"."log_template_change"();



CREATE OR REPLACE TRIGGER "on_employees_updated" BEFORE UPDATE ON "public"."employees" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "on_financial_details_updated" BEFORE UPDATE ON "public"."employee_financial_details" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "on_health_records_updated" BEFORE UPDATE ON "public"."employee_health_records" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "prevent_audit_log_delete" BEFORE DELETE ON "public"."audit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_audit_log_deletion"();



CREATE OR REPLACE TRIGGER "prevent_audit_log_update" BEFORE UPDATE ON "public"."audit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_audit_log_update"();



CREATE OR REPLACE TRIGGER "set_balance_due_date" BEFORE INSERT OR UPDATE OF "event_date" ON "public"."private_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."calculate_balance_due_date"();



CREATE OR REPLACE TRIGGER "sync_customer_name_trigger" BEFORE INSERT OR UPDATE OF "customer_id" ON "public"."private_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."sync_customer_name_from_customers"();



CREATE OR REPLACE TRIGGER "update_api_keys_updated_at" BEFORE UPDATE ON "public"."api_keys" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_attachment_categories_updated_at" BEFORE UPDATE ON "public"."attachment_categories" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_business_amenities_updated_at" BEFORE UPDATE ON "public"."business_amenities" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_business_hours_updated_at" BEFORE UPDATE ON "public"."business_hours" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_catering_packages_updated_at" BEFORE UPDATE ON "public"."catering_packages" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_customer_health_on_delivery_status" AFTER INSERT OR UPDATE ON "public"."message_delivery_status" FOR EACH ROW EXECUTE FUNCTION "public"."update_customer_messaging_health"();



CREATE OR REPLACE TRIGGER "update_customer_sms_status_trigger" AFTER UPDATE OF "twilio_status" ON "public"."messages" FOR EACH ROW WHEN (("new"."twilio_status" IS DISTINCT FROM "old"."twilio_status")) EXECUTE FUNCTION "public"."update_customer_sms_status"();



CREATE OR REPLACE TRIGGER "update_employees_updated_at" BEFORE UPDATE ON "public"."employees" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_event_faqs_updated_at" BEFORE UPDATE ON "public"."event_faqs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_event_images_updated_at_trigger" BEFORE UPDATE ON "public"."event_images" FOR EACH ROW EXECUTE FUNCTION "public"."update_event_images_updated_at"();



CREATE OR REPLACE TRIGGER "update_menu_items_updated_at" BEFORE UPDATE ON "public"."menu_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_menu_sections_updated_at" BEFORE UPDATE ON "public"."menu_sections" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_message_templates_updated_at" BEFORE UPDATE ON "public"."message_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_messages_updated_at" BEFORE UPDATE ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."update_messages_updated_at"();



CREATE OR REPLACE TRIGGER "update_private_bookings_updated_at" BEFORE UPDATE ON "public"."private_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_roles_updated_at" BEFORE UPDATE ON "public"."roles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_special_hours_updated_at" BEFORE UPDATE ON "public"."special_hours" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_vendors_updated_at" BEFORE UPDATE ON "public"."vendors" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_venue_spaces_updated_at" BEFORE UPDATE ON "public"."venue_spaces" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_webhooks_updated_at" BEFORE UPDATE ON "public"."webhooks" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."api_usage"
    ADD CONSTRAINT "api_usage_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."booking_reminders"
    ADD CONSTRAINT "booking_reminders_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_reminders"
    ADD CONSTRAINT "booking_reminders_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_category_stats"
    ADD CONSTRAINT "customer_category_stats_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."event_categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_category_stats"
    ADD CONSTRAINT "customer_category_stats_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_attachments"
    ADD CONSTRAINT "employee_attachments_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."attachment_categories"("category_id");



ALTER TABLE ONLY "public"."employee_attachments"
    ADD CONSTRAINT "employee_attachments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_emergency_contacts"
    ADD CONSTRAINT "employee_emergency_contacts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_financial_details"
    ADD CONSTRAINT "employee_financial_details_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_health_records"
    ADD CONSTRAINT "employee_health_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_notes"
    ADD CONSTRAINT "employee_notes_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_faqs"
    ADD CONSTRAINT "event_faqs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_images"
    ADD CONSTRAINT "event_images_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_images"
    ADD CONSTRAINT "event_images_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."event_message_templates"
    ADD CONSTRAINT "event_message_templates_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."event_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_parent_event_id_fkey" FOREIGN KEY ("parent_event_id") REFERENCES "public"."events"("id");



ALTER TABLE ONLY "public"."job_queue"
    ADD CONSTRAINT "job_queue_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."menu_items"
    ADD CONSTRAINT "menu_items_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "public"."menu_sections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."message_delivery_status"
    ADD CONSTRAINT "message_delivery_status_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."message_template_history"
    ADD CONSTRAINT "message_template_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."message_template_history"
    ADD CONSTRAINT "message_template_history_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."message_templates"
    ADD CONSTRAINT "message_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."private_booking_audit"
    ADD CONSTRAINT "private_booking_audit_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."private_bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."private_booking_audit"
    ADD CONSTRAINT "private_booking_audit_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."private_booking_documents"
    ADD CONSTRAINT "private_booking_documents_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."private_bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."private_booking_documents"
    ADD CONSTRAINT "private_booking_documents_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."private_booking_items"
    ADD CONSTRAINT "private_booking_items_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."private_bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."private_booking_items"
    ADD CONSTRAINT "private_booking_items_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."catering_packages"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."private_booking_items"
    ADD CONSTRAINT "private_booking_items_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "public"."venue_spaces"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."private_booking_items"
    ADD CONSTRAINT "private_booking_items_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."private_booking_sms_queue"
    ADD CONSTRAINT "private_booking_sms_queue_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."private_booking_sms_queue"
    ADD CONSTRAINT "private_booking_sms_queue_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."private_bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."private_booking_sms_queue"
    ADD CONSTRAINT "private_booking_sms_queue_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."private_bookings"
    ADD CONSTRAINT "private_bookings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."private_bookings"
    ADD CONSTRAINT "private_bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminder_processing_logs"
    ADD CONSTRAINT "reminder_processing_logs_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminder_processing_logs"
    ADD CONSTRAINT "reminder_processing_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminder_processing_logs"
    ADD CONSTRAINT "reminder_processing_logs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."webhook_deliveries"
    ADD CONSTRAINT "webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE CASCADE;



CREATE POLICY "All authenticated users can view active catering packages" ON "public"."catering_packages" FOR SELECT TO "authenticated" USING ((("active" = true) OR "public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'manage_catering'::"text")));



CREATE POLICY "All authenticated users can view active vendors" ON "public"."vendors" FOR SELECT TO "authenticated" USING ((("active" = true) OR "public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'manage_vendors'::"text")));



CREATE POLICY "All authenticated users can view active venue spaces" ON "public"."venue_spaces" FOR SELECT TO "authenticated" USING ((("active" = true) OR "public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'manage_spaces'::"text")));



CREATE POLICY "Allow authenticated users to insert message delivery status" ON "public"."message_delivery_status" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow authenticated users to insert messages" ON "public"."messages" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow authenticated users to read event FAQs" ON "public"."event_faqs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated users to read message delivery status" ON "public"."message_delivery_status" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated users to read messages" ON "public"."messages" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated users to read webhook_logs" ON "public"."webhook_logs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow individual users to update their own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Allow public inserts to webhook_logs" ON "public"."webhook_logs" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public read access to profiles" ON "public"."profiles" FOR SELECT USING ((("auth"."role"() = 'authenticated'::"text") OR ("auth"."role"() = 'anon'::"text")));



CREATE POLICY "Allow users with events:edit to manage FAQs" ON "public"."event_faqs" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_has_permission"("auth"."uid"(), 'events'::"text", 'edit'::"text") "user_has_permission"("user_has_permission"))));



CREATE POLICY "Anyone can view event images" ON "public"."event_images" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Authenticated users can insert" ON "public"."private_booking_sms_queue" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Authenticated users can view permissions" ON "public"."permissions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view role permissions" ON "public"."role_permissions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view roles" ON "public"."roles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view template history" ON "public"."message_template_history" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can view their own" ON "public"."private_booking_sms_queue" FOR SELECT TO "authenticated" USING ((("created_by" = "auth"."uid"()) OR ("auth"."uid"() IN ( SELECT "user_roles"."user_id"
   FROM "public"."user_roles"
  WHERE ("user_roles"."role_id" IN ( SELECT "roles"."id"
           FROM "public"."roles"
          WHERE ("roles"."name" = ANY (ARRAY['super_admin'::"text", 'manager'::"text"]))))))));



CREATE POLICY "Authorized users can delete event images" ON "public"."event_images" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = ANY (ARRAY['super_admin'::"text", 'manager'::"text", 'staff'::"text"]))))));



CREATE POLICY "Authorized users can insert event images" ON "public"."event_images" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = ANY (ARRAY['super_admin'::"text", 'manager'::"text", 'staff'::"text"]))))));



CREATE POLICY "Authorized users can manage business hours" ON "public"."business_hours" USING ("public"."user_has_permission"("auth"."uid"(), 'settings'::"text", 'manage'::"text"));



CREATE POLICY "Authorized users can manage special hours" ON "public"."special_hours" USING ("public"."user_has_permission"("auth"."uid"(), 'settings'::"text", 'manage'::"text"));



CREATE POLICY "Authorized users can update event images" ON "public"."event_images" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = ANY (ARRAY['super_admin'::"text", 'manager'::"text", 'staff'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = ANY (ARRAY['super_admin'::"text", 'manager'::"text", 'staff'::"text"]))))));



CREATE POLICY "Customer category stats are viewable by authenticated users" ON "public"."customer_category_stats" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Customer category stats viewable by authenticated" ON "public"."customer_category_stats" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Event categories are manageable by admins" ON "public"."event_categories" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = ANY (ARRAY['super_admin'::"text", 'manager'::"text"]))))));



CREATE POLICY "Event categories are viewable by authenticated users" ON "public"."event_categories" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Only users with role management permission can manage permissio" ON "public"."permissions" TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'roles'::"text", 'manage'::"text"));



CREATE POLICY "Only users with role management permission can manage role perm" ON "public"."role_permissions" TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'roles'::"text", 'manage'::"text"));



CREATE POLICY "Only users with role management permission can manage roles" ON "public"."roles" TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'roles'::"text", 'manage'::"text"));



CREATE POLICY "Only users with user management permission can manage user role" ON "public"."user_roles" TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'users'::"text", 'manage_roles'::"text"));



CREATE POLICY "Public can read active API keys" ON "public"."api_keys" FOR SELECT USING (("is_active" = true));



CREATE POLICY "Public can read active menu sections" ON "public"."menu_sections" FOR SELECT USING (("is_active" = true));



CREATE POLICY "Public can read available menu items" ON "public"."menu_items" FOR SELECT USING (("is_available" = true));



CREATE POLICY "Public can read business amenities" ON "public"."business_amenities" FOR SELECT USING (true);



CREATE POLICY "Public can read business hours" ON "public"."business_hours" FOR SELECT USING (true);



CREATE POLICY "Public can read special hours" ON "public"."special_hours" FOR SELECT USING (true);



CREATE POLICY "Service role can do everything" ON "public"."private_booking_sms_queue" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can manage API keys" ON "public"."api_keys" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can manage booking_reminders" ON "public"."booking_reminders" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can manage jobs" ON "public"."background_jobs" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



CREATE POLICY "Service role can manage reminder logs" ON "public"."reminder_processing_logs" TO "service_role" USING (true);



CREATE POLICY "Service role full access" ON "public"."job_queue" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



CREATE POLICY "System can insert template history" ON "public"."message_template_history" FOR INSERT WITH CHECK (true);



CREATE POLICY "System can manage API keys" ON "public"."api_keys" USING (("auth"."uid"() IN ( SELECT "ur"."user_id"
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE ("r"."name" = 'super_admin'::"text"))));



CREATE POLICY "Users can approve SMS with permission" ON "public"."private_booking_sms_queue" FOR UPDATE TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'approve_sms'::"text")) WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'approve_sms'::"text"));



CREATE POLICY "Users can create employees" ON "public"."employees" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Users can create jobs" ON "public"."job_queue" FOR INSERT WITH CHECK (("auth"."uid"() = "created_by"));



CREATE POLICY "Users can create notes" ON "public"."employee_notes" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Users can create private bookings with permission" ON "public"."private_bookings" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'create'::"text"));



CREATE POLICY "Users can delete employees" ON "public"."employees" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Users can delete own notes" ON "public"."employee_notes" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "created_by_user_id"));



CREATE POLICY "Users can delete private bookings with permission" ON "public"."private_bookings" FOR DELETE TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'delete'::"text"));



CREATE POLICY "Users can manage attachments" ON "public"."employee_attachments" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Users can manage booking items with booking edit permission" ON "public"."private_booking_items" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."private_bookings" "pb"
  WHERE (("pb"."id" = "private_booking_items"."booking_id") AND "public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'edit'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."private_bookings" "pb"
  WHERE (("pb"."id" = "private_booking_items"."booking_id") AND "public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'edit'::"text")))));



CREATE POLICY "Users can manage catering packages with permission" ON "public"."catering_packages" TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'manage_catering'::"text")) WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'manage_catering'::"text"));



CREATE POLICY "Users can manage documents with permission" ON "public"."private_booking_documents" TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'generate_contracts'::"text")) WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'generate_contracts'::"text"));



CREATE POLICY "Users can manage emergency contacts" ON "public"."employee_emergency_contacts" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Users can manage event templates" ON "public"."event_message_templates" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Users can manage financial details" ON "public"."employee_financial_details" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Users can manage health records" ON "public"."employee_health_records" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Users can manage templates" ON "public"."message_templates" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Users can manage vendors with permission" ON "public"."vendors" TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'manage_vendors'::"text")) WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'manage_vendors'::"text"));



CREATE POLICY "Users can manage venue spaces with permission" ON "public"."venue_spaces" TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'manage_spaces'::"text")) WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'manage_spaces'::"text"));



CREATE POLICY "Users can update employees" ON "public"."employees" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Users can update own notes" ON "public"."employee_notes" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "created_by_user_id")) WITH CHECK (("auth"."uid"() = "created_by_user_id"));



CREATE POLICY "Users can update private bookings with permission" ON "public"."private_bookings" FOR UPDATE TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'edit'::"text")) WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'edit'::"text"));



CREATE POLICY "Users can view SMS queue with permission" ON "public"."private_booking_sms_queue" FOR SELECT TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'view_sms_queue'::"text"));



CREATE POLICY "Users can view all employees" ON "public"."employees" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view all templates" ON "public"."message_templates" FOR SELECT USING (true);



CREATE POLICY "Users can view attachments" ON "public"."employee_attachments" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view audit trail with booking view permission" ON "public"."private_booking_audit" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."private_bookings" "pb"
  WHERE (("pb"."id" = "private_booking_audit"."booking_id") AND "public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'view'::"text")))));



CREATE POLICY "Users can view booking items with booking view permission" ON "public"."private_booking_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."private_bookings" "pb"
  WHERE (("pb"."id" = "private_booking_items"."booking_id") AND "public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'view'::"text")))));



CREATE POLICY "Users can view documents with booking view permission" ON "public"."private_booking_documents" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."private_bookings" "pb"
  WHERE (("pb"."id" = "private_booking_documents"."booking_id") AND "public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'view'::"text")))));



CREATE POLICY "Users can view emergency contacts" ON "public"."employee_emergency_contacts" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view event templates" ON "public"."event_message_templates" FOR SELECT USING (true);



CREATE POLICY "Users can view financial details" ON "public"."employee_financial_details" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view health records" ON "public"."employee_health_records" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view limited audit logs for dashboard" ON "public"."audit_logs" FOR SELECT USING ((("auth"."role"() = 'authenticated'::"text") AND ("resource_type" = ANY (ARRAY['employee'::"text", 'message_template'::"text", 'bulk_message'::"text"])) AND ("operation_type" = ANY (ARRAY['create'::"text", 'update'::"text", 'delete'::"text"]))));



CREATE POLICY "Users can view notes" ON "public"."employee_notes" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view own auth logs" ON "public"."audit_logs" FOR SELECT USING ((("auth"."role"() = 'authenticated'::"text") AND ("user_id" = "auth"."uid"()) AND ("operation_type" = ANY (ARRAY['login'::"text", 'logout'::"text"]))));



CREATE POLICY "Users can view own jobs" ON "public"."job_queue" FOR SELECT USING (("auth"."uid"() = "created_by"));



CREATE POLICY "Users can view private bookings with permission" ON "public"."private_bookings" FOR SELECT TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'view'::"text"));



CREATE POLICY "Users can view reminder logs" ON "public"."reminder_processing_logs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view their own roles" ON "public"."user_roles" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."user_has_permission"("auth"."uid"(), 'users'::"text", 'view'::"text")));



CREATE POLICY "Users with audit permission can view all logs" ON "public"."audit_logs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."user_has_permission"("auth"."uid"(), 'audit_logs'::"text", 'view'::"text") "user_has_permission"("user_has_permission")
  WHERE ("user_has_permission"."user_has_permission" = true))));



CREATE POLICY "Users with bookings create permission can create bookings" ON "public"."bookings" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'bookings'::"text", 'create'::"text"));



CREATE POLICY "Users with bookings delete permission can delete bookings" ON "public"."bookings" FOR DELETE TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'bookings'::"text", 'delete'::"text"));



CREATE POLICY "Users with bookings edit permission can update bookings" ON "public"."bookings" FOR UPDATE TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'bookings'::"text", 'edit'::"text")) WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'bookings'::"text", 'edit'::"text"));



CREATE POLICY "Users with bookings view permission can view bookings" ON "public"."bookings" FOR SELECT TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'bookings'::"text", 'view'::"text"));



CREATE POLICY "Users with customers create permission can create customers" ON "public"."customers" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'customers'::"text", 'create'::"text"));



CREATE POLICY "Users with customers delete permission can delete customers" ON "public"."customers" FOR DELETE TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'customers'::"text", 'delete'::"text"));



CREATE POLICY "Users with customers edit permission can update customers" ON "public"."customers" FOR UPDATE TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'customers'::"text", 'edit'::"text")) WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'customers'::"text", 'edit'::"text"));



CREATE POLICY "Users with customers view permission can view customers" ON "public"."customers" FOR SELECT TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'customers'::"text", 'view'::"text"));



CREATE POLICY "Users with events create permission can create events" ON "public"."events" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'events'::"text", 'create'::"text"));



CREATE POLICY "Users with events delete permission can delete events" ON "public"."events" FOR DELETE TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'events'::"text", 'delete'::"text"));



CREATE POLICY "Users with events edit permission can update events" ON "public"."events" FOR UPDATE TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'events'::"text", 'edit'::"text")) WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'events'::"text", 'edit'::"text"));



CREATE POLICY "Users with events view permission can view events" ON "public"."events" FOR SELECT TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'events'::"text", 'view'::"text"));



ALTER TABLE "public"."api_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."api_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_logs_insert_policy" ON "public"."audit_logs" FOR INSERT WITH CHECK ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



CREATE POLICY "audit_logs_read_policy" ON "public"."audit_logs" FOR SELECT USING (("public"."user_has_permission"("auth"."uid"(), 'settings'::"text", 'view'::"text") OR ("user_id" = "auth"."uid"())));



ALTER TABLE "public"."background_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_reminders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."business_amenities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."business_hours" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."catering_packages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_category_stats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_attachments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_emergency_contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_financial_details" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_health_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_faqs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_images" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_message_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."job_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."menu_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."menu_sections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."message_delivery_status" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."message_template_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."message_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."private_booking_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."private_booking_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."private_booking_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."private_booking_sms_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."private_bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reminder_processing_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."special_hours" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."venue_spaces" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."webhook_deliveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."webhook_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."webhooks" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_balance_due_date"() TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_balance_due_date"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_balance_due_date"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_message_cost"("segments" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_message_cost"("segments" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_message_cost"("segments" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_private_booking_balance"("p_booking_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_private_booking_balance"("p_booking_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_private_booking_balance"("p_booking_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_send_time"("p_event_timestamp" timestamp with time zone, "p_send_timing" "text", "p_custom_hours" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_send_time"("p_event_timestamp" timestamp with time zone, "p_send_timing" "text", "p_custom_hours" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_send_time"("p_event_timestamp" timestamp with time zone, "p_send_timing" "text", "p_custom_hours" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."categorize_historical_events"() TO "anon";
GRANT ALL ON FUNCTION "public"."categorize_historical_events"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."categorize_historical_events"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_event_date_not_past"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_event_date_not_past"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_event_date_not_past"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_import"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_import"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_import"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_jobs"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_jobs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_jobs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_reminder_logs"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_reminder_logs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_reminder_logs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."compare_employee_versions"("p_employee_id" "uuid", "p_version1" integer, "p_version2" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."compare_employee_versions"("p_employee_id" "uuid", "p_version1" integer, "p_version2" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compare_employee_versions"("p_employee_id" "uuid", "p_version1" integer, "p_version2" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."date_utc"(timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."date_utc"(timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."date_utc"(timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."encrypt_sensitive_audit_data"("p_encryption_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."encrypt_sensitive_audit_data"("p_encryption_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."encrypt_sensitive_audit_data"("p_encryption_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_single_default_category"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_single_default_category"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_single_default_category"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_all_users_unsafe"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_users_unsafe"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_users_unsafe"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_all_users_with_roles"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_users_with_roles"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_users_with_roles"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_bookings_needing_reminders"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_bookings_needing_reminders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_bookings_needing_reminders"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_category_regulars"("p_category_id" "uuid", "p_days_back" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_category_regulars"("p_category_id" "uuid", "p_days_back" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_category_regulars"("p_category_id" "uuid", "p_days_back" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_cross_category_suggestions"("p_target_category_id" "uuid", "p_source_category_id" "uuid", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_cross_category_suggestions"("p_target_category_id" "uuid", "p_source_category_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_cross_category_suggestions"("p_target_category_id" "uuid", "p_source_category_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_employee_at_timestamp"("p_employee_id" "uuid", "p_timestamp" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_employee_at_timestamp"("p_employee_id" "uuid", "p_timestamp" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_employee_at_timestamp"("p_employee_id" "uuid", "p_timestamp" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_employee_changes_summary"("p_employee_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_employee_changes_summary"("p_employee_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_employee_changes_summary"("p_employee_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_message_template"("p_event_id" "uuid", "p_template_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_message_template"("p_event_id" "uuid", "p_template_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_message_template"("p_event_id" "uuid", "p_template_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_next_booking_reference"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_next_booking_reference"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_next_booking_reference"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_permissions"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_permissions"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_permissions"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_roles"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_roles"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_roles"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_users_for_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_users_for_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_users_for_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_audit_event"("p_user_id" "uuid", "p_user_email" "text", "p_operation_type" "text", "p_resource_type" "text", "p_resource_id" "text", "p_operation_status" "text", "p_ip_address" "inet", "p_user_agent" "text", "p_old_values" "jsonb", "p_new_values" "jsonb", "p_error_message" "text", "p_additional_info" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."log_audit_event"("p_user_id" "uuid", "p_user_email" "text", "p_operation_type" "text", "p_resource_type" "text", "p_resource_id" "text", "p_operation_status" "text", "p_ip_address" "inet", "p_user_agent" "text", "p_old_values" "jsonb", "p_new_values" "jsonb", "p_error_message" "text", "p_additional_info" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_audit_event"("p_user_id" "uuid", "p_user_email" "text", "p_operation_type" "text", "p_resource_type" "text", "p_resource_id" "text", "p_operation_status" "text", "p_ip_address" "inet", "p_user_agent" "text", "p_old_values" "jsonb", "p_new_values" "jsonb", "p_error_message" "text", "p_additional_info" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_reminder_processing"("p_processing_type" "text", "p_message" "text", "p_booking_id" "uuid", "p_event_id" "uuid", "p_customer_id" "uuid", "p_template_type" "text", "p_reminder_type" "text", "p_error_details" "jsonb", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."log_reminder_processing"("p_processing_type" "text", "p_message" "text", "p_booking_id" "uuid", "p_event_id" "uuid", "p_customer_id" "uuid", "p_template_type" "text", "p_reminder_type" "text", "p_error_details" "jsonb", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_reminder_processing"("p_processing_type" "text", "p_message" "text", "p_booking_id" "uuid", "p_event_id" "uuid", "p_customer_id" "uuid", "p_template_type" "text", "p_reminder_type" "text", "p_error_details" "jsonb", "p_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_template_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_template_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_template_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_audit_log_deletion"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_audit_log_deletion"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_audit_log_deletion"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_audit_log_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_audit_log_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_audit_log_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."process_pending_jobs"() TO "anon";
GRANT ALL ON FUNCTION "public"."process_pending_jobs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_pending_jobs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."queue_private_booking_sms"("p_booking_id" "uuid", "p_trigger_type" "text", "p_template_key" "text", "p_message_body" "text", "p_recipient_phone" "text", "p_customer_name" "text", "p_priority" integer, "p_scheduled_for" timestamp with time zone, "p_metadata" "jsonb", "p_skip_conditions" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."queue_private_booking_sms"("p_booking_id" "uuid", "p_trigger_type" "text", "p_template_key" "text", "p_message_body" "text", "p_recipient_phone" "text", "p_customer_name" "text", "p_priority" integer, "p_scheduled_for" timestamp with time zone, "p_metadata" "jsonb", "p_skip_conditions" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."queue_private_booking_sms"("p_booking_id" "uuid", "p_trigger_type" "text", "p_template_key" "text", "p_message_body" "text", "p_recipient_phone" "text", "p_customer_name" "text", "p_priority" integer, "p_scheduled_for" timestamp with time zone, "p_metadata" "jsonb", "p_skip_conditions" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rebuild_customer_category_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."rebuild_customer_category_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rebuild_customer_category_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."render_template"("p_template" "text", "p_variables" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."render_template"("p_template" "text", "p_variables" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."render_template"("p_template" "text", "p_variables" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."restore_employee_version"("p_employee_id" "uuid", "p_version_number" integer, "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."restore_employee_version"("p_employee_id" "uuid", "p_version_number" integer, "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."restore_employee_version"("p_employee_id" "uuid", "p_version_number" integer, "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."should_send_private_booking_sms"("p_booking_id" "uuid", "p_phone" "text", "p_priority" integer, "p_trigger_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."should_send_private_booking_sms"("p_booking_id" "uuid", "p_phone" "text", "p_priority" integer, "p_trigger_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."should_send_private_booking_sms"("p_booking_id" "uuid", "p_phone" "text", "p_priority" integer, "p_trigger_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."standardize_phone_flexible"("phone" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."standardize_phone_flexible"("phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."standardize_phone_flexible"("phone" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_customer_name_from_customers"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_customer_name_from_customers"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_customer_name_from_customers"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_customer_category_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_customer_category_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_customer_category_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_customer_messaging_health"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_customer_messaging_health"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_customer_messaging_health"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_customer_sms_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_customer_sms_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_customer_sms_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_event_images_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_event_images_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_event_images_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_messages_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_messages_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_messages_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."user_has_permission"("p_user_id" "uuid", "p_module_name" "text", "p_action" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."user_has_permission"("p_user_id" "uuid", "p_module_name" "text", "p_action" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_has_permission"("p_user_id" "uuid", "p_module_name" "text", "p_action" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_employee_attachment_upload"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_employee_attachment_upload"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_employee_attachment_upload"() TO "service_role";



GRANT ALL ON TABLE "public"."admin_users_view" TO "anon";
GRANT ALL ON TABLE "public"."admin_users_view" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_users_view" TO "service_role";



GRANT ALL ON TABLE "public"."api_keys" TO "anon";
GRANT ALL ON TABLE "public"."api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."api_keys" TO "service_role";



GRANT ALL ON TABLE "public"."api_usage" TO "anon";
GRANT ALL ON TABLE "public"."api_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."api_usage" TO "service_role";



GRANT ALL ON TABLE "public"."attachment_categories" TO "anon";
GRANT ALL ON TABLE "public"."attachment_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."attachment_categories" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."background_jobs" TO "anon";
GRANT ALL ON TABLE "public"."background_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."background_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."booking_reminders" TO "anon";
GRANT ALL ON TABLE "public"."booking_reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_reminders" TO "service_role";



GRANT ALL ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";



GRANT ALL ON TABLE "public"."business_amenities" TO "anon";
GRANT ALL ON TABLE "public"."business_amenities" TO "authenticated";
GRANT ALL ON TABLE "public"."business_amenities" TO "service_role";



GRANT ALL ON TABLE "public"."business_hours" TO "anon";
GRANT ALL ON TABLE "public"."business_hours" TO "authenticated";
GRANT ALL ON TABLE "public"."business_hours" TO "service_role";



GRANT ALL ON TABLE "public"."catering_packages" TO "anon";
GRANT ALL ON TABLE "public"."catering_packages" TO "authenticated";
GRANT ALL ON TABLE "public"."catering_packages" TO "service_role";



GRANT ALL ON TABLE "public"."customer_category_stats" TO "anon";
GRANT ALL ON TABLE "public"."customer_category_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_category_stats" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."customer_messaging_health" TO "anon";
GRANT ALL ON TABLE "public"."customer_messaging_health" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_messaging_health" TO "service_role";



GRANT ALL ON TABLE "public"."employee_attachments" TO "anon";
GRANT ALL ON TABLE "public"."employee_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."employee_emergency_contacts" TO "anon";
GRANT ALL ON TABLE "public"."employee_emergency_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_emergency_contacts" TO "service_role";



GRANT ALL ON TABLE "public"."employee_financial_details" TO "anon";
GRANT ALL ON TABLE "public"."employee_financial_details" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_financial_details" TO "service_role";



GRANT ALL ON TABLE "public"."employee_health_records" TO "anon";
GRANT ALL ON TABLE "public"."employee_health_records" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_health_records" TO "service_role";



GRANT ALL ON TABLE "public"."employee_notes" TO "anon";
GRANT ALL ON TABLE "public"."employee_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_notes" TO "service_role";



GRANT ALL ON TABLE "public"."employee_version_history" TO "anon";
GRANT ALL ON TABLE "public"."employee_version_history" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_version_history" TO "service_role";



GRANT ALL ON TABLE "public"."employees" TO "anon";
GRANT ALL ON TABLE "public"."employees" TO "authenticated";
GRANT ALL ON TABLE "public"."employees" TO "service_role";



GRANT ALL ON TABLE "public"."event_categories" TO "anon";
GRANT ALL ON TABLE "public"."event_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."event_categories" TO "service_role";



GRANT ALL ON TABLE "public"."event_faqs" TO "anon";
GRANT ALL ON TABLE "public"."event_faqs" TO "authenticated";
GRANT ALL ON TABLE "public"."event_faqs" TO "service_role";



GRANT ALL ON TABLE "public"."event_images" TO "anon";
GRANT ALL ON TABLE "public"."event_images" TO "authenticated";
GRANT ALL ON TABLE "public"."event_images" TO "service_role";



GRANT ALL ON TABLE "public"."event_message_templates" TO "anon";
GRANT ALL ON TABLE "public"."event_message_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."event_message_templates" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."job_queue" TO "anon";
GRANT ALL ON TABLE "public"."job_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."job_queue" TO "service_role";



GRANT ALL ON TABLE "public"."menu_items" TO "anon";
GRANT ALL ON TABLE "public"."menu_items" TO "authenticated";
GRANT ALL ON TABLE "public"."menu_items" TO "service_role";



GRANT ALL ON TABLE "public"."menu_sections" TO "anon";
GRANT ALL ON TABLE "public"."menu_sections" TO "authenticated";
GRANT ALL ON TABLE "public"."menu_sections" TO "service_role";



GRANT ALL ON TABLE "public"."message_delivery_status" TO "anon";
GRANT ALL ON TABLE "public"."message_delivery_status" TO "authenticated";
GRANT ALL ON TABLE "public"."message_delivery_status" TO "service_role";



GRANT ALL ON TABLE "public"."message_template_history" TO "anon";
GRANT ALL ON TABLE "public"."message_template_history" TO "authenticated";
GRANT ALL ON TABLE "public"."message_template_history" TO "service_role";



GRANT ALL ON TABLE "public"."message_templates" TO "anon";
GRANT ALL ON TABLE "public"."message_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."message_templates" TO "service_role";



GRANT ALL ON TABLE "public"."message_templates_with_timing" TO "anon";
GRANT ALL ON TABLE "public"."message_templates_with_timing" TO "authenticated";
GRANT ALL ON TABLE "public"."message_templates_with_timing" TO "service_role";



GRANT ALL ON TABLE "public"."permissions" TO "anon";
GRANT ALL ON TABLE "public"."permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."permissions" TO "service_role";



GRANT ALL ON TABLE "public"."phone_standardization_issues" TO "anon";
GRANT ALL ON TABLE "public"."phone_standardization_issues" TO "authenticated";
GRANT ALL ON TABLE "public"."phone_standardization_issues" TO "service_role";



GRANT ALL ON TABLE "public"."private_booking_audit" TO "anon";
GRANT ALL ON TABLE "public"."private_booking_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."private_booking_audit" TO "service_role";



GRANT ALL ON TABLE "public"."private_booking_documents" TO "anon";
GRANT ALL ON TABLE "public"."private_booking_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."private_booking_documents" TO "service_role";



GRANT ALL ON TABLE "public"."private_booking_items" TO "anon";
GRANT ALL ON TABLE "public"."private_booking_items" TO "authenticated";
GRANT ALL ON TABLE "public"."private_booking_items" TO "service_role";



GRANT ALL ON TABLE "public"."private_booking_sms_queue" TO "anon";
GRANT ALL ON TABLE "public"."private_booking_sms_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."private_booking_sms_queue" TO "service_role";



GRANT ALL ON TABLE "public"."private_bookings" TO "anon";
GRANT ALL ON TABLE "public"."private_bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."private_bookings" TO "service_role";



GRANT ALL ON TABLE "public"."private_booking_sms_reminders" TO "anon";
GRANT ALL ON TABLE "public"."private_booking_sms_reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."private_booking_sms_reminders" TO "service_role";



GRANT ALL ON TABLE "public"."private_booking_summary" TO "anon";
GRANT ALL ON TABLE "public"."private_booking_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."private_booking_summary" TO "service_role";



GRANT ALL ON TABLE "public"."private_bookings_with_details" TO "anon";
GRANT ALL ON TABLE "public"."private_bookings_with_details" TO "authenticated";
GRANT ALL ON TABLE "public"."private_bookings_with_details" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."reminder_processing_logs" TO "anon";
GRANT ALL ON TABLE "public"."reminder_processing_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."reminder_processing_logs" TO "service_role";



GRANT ALL ON TABLE "public"."recent_reminder_activity" TO "anon";
GRANT ALL ON TABLE "public"."recent_reminder_activity" TO "authenticated";
GRANT ALL ON TABLE "public"."recent_reminder_activity" TO "service_role";



GRANT ALL ON TABLE "public"."reminder_timing_debug" TO "anon";
GRANT ALL ON TABLE "public"."reminder_timing_debug" TO "authenticated";
GRANT ALL ON TABLE "public"."reminder_timing_debug" TO "service_role";



GRANT ALL ON TABLE "public"."role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";



GRANT ALL ON TABLE "public"."special_hours" TO "anon";
GRANT ALL ON TABLE "public"."special_hours" TO "authenticated";
GRANT ALL ON TABLE "public"."special_hours" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."vendors" TO "anon";
GRANT ALL ON TABLE "public"."vendors" TO "authenticated";
GRANT ALL ON TABLE "public"."vendors" TO "service_role";



GRANT ALL ON TABLE "public"."venue_spaces" TO "anon";
GRANT ALL ON TABLE "public"."venue_spaces" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_spaces" TO "service_role";



GRANT ALL ON TABLE "public"."webhook_deliveries" TO "anon";
GRANT ALL ON TABLE "public"."webhook_deliveries" TO "authenticated";
GRANT ALL ON TABLE "public"."webhook_deliveries" TO "service_role";



GRANT ALL ON TABLE "public"."webhook_logs" TO "anon";
GRANT ALL ON TABLE "public"."webhook_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."webhook_logs" TO "service_role";



GRANT ALL ON TABLE "public"."webhooks" TO "anon";
GRANT ALL ON TABLE "public"."webhooks" TO "authenticated";
GRANT ALL ON TABLE "public"."webhooks" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";






RESET ALL;
-- End 20240625000000_initial_baseline.sql


-- Begin 20240712000001_loyalty_system_complete.sql
-- Complete Loyalty System Database Schema
-- This migration creates all tables needed for The Anchor VIP Club
-- Including rewards, achievements, and challenges

-- Create loyalty programs table (for future multi-program support)
CREATE TABLE IF NOT EXISTS loyalty_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  active BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create loyalty tiers table
CREATE TABLE IF NOT EXISTS loyalty_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  level INTEGER NOT NULL,
  min_events INTEGER DEFAULT 0,
  point_multiplier DECIMAL(3,2) DEFAULT 1.0,
  color VARCHAR(7),
  icon VARCHAR(10),
  benefits JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(program_id, level)
);

-- Create loyalty members table
CREATE TABLE IF NOT EXISTS loyalty_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  program_id UUID REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  tier_id UUID REFERENCES loyalty_tiers(id),
  total_points INTEGER DEFAULT 0,
  available_points INTEGER DEFAULT 0,
  lifetime_points INTEGER DEFAULT 0,
  lifetime_events INTEGER DEFAULT 0,
  join_date DATE DEFAULT CURRENT_DATE,
  last_visit_date DATE,
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'inactive')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(customer_id, program_id)
);

-- Create event check-ins table
CREATE TABLE IF NOT EXISTS event_check_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id),
  check_in_time TIMESTAMPTZ DEFAULT NOW(),
  check_in_method VARCHAR(50) DEFAULT 'qr' CHECK (check_in_method IN ('qr', 'manual', 'auto')),
  points_earned INTEGER DEFAULT 0,
  staff_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, customer_id)
);

-- Create loyalty achievements table
CREATE TABLE IF NOT EXISTS loyalty_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  icon VARCHAR(10),
  points_value INTEGER DEFAULT 0,
  criteria JSONB NOT NULL,
  category VARCHAR(50),
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create customer achievements table
CREATE TABLE IF NOT EXISTS customer_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE,
  achievement_id UUID REFERENCES loyalty_achievements(id) ON DELETE CASCADE,
  earned_date TIMESTAMPTZ DEFAULT NOW(),
  points_awarded INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(member_id, achievement_id)
);

-- Create loyalty rewards table
CREATE TABLE IF NOT EXISTS loyalty_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  points_cost INTEGER NOT NULL,
  tier_required UUID REFERENCES loyalty_tiers(id),
  category VARCHAR(50),
  icon VARCHAR(10),
  inventory INTEGER,
  daily_limit INTEGER,
  active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create reward redemptions table
CREATE TABLE IF NOT EXISTS reward_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE,
  reward_id UUID REFERENCES loyalty_rewards(id) ON DELETE CASCADE,
  redemption_code VARCHAR(20) UNIQUE,
  points_spent INTEGER NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  redeemed_at TIMESTAMPTZ,
  redeemed_by UUID REFERENCES auth.users(id),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'redeemed', 'expired', 'cancelled')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create loyalty point transactions table
CREATE TABLE IF NOT EXISTS loyalty_point_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE,
  points INTEGER NOT NULL, -- positive for earned, negative for spent
  transaction_type VARCHAR(50) NOT NULL,
  description TEXT,
  reference_type VARCHAR(50), -- 'check_in', 'achievement', 'redemption', 'adjustment', 'challenge'
  reference_id UUID, -- links to check_in, achievement, redemption, challenge, etc
  balance_after INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Create loyalty campaigns table (for bonus point events)
CREATE TABLE IF NOT EXISTS loyalty_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  bonus_type VARCHAR(50) NOT NULL, -- 'multiplier', 'fixed', 'percentage'
  bonus_value DECIMAL(10,2) NOT NULL,
  criteria JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create loyalty challenges table (time-limited achievements)
CREATE TABLE IF NOT EXISTS loyalty_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  icon VARCHAR(10),
  points_value INTEGER DEFAULT 0,
  criteria JSONB NOT NULL,
  category VARCHAR(50), -- 'monthly', 'seasonal', 'special'
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  max_completions INTEGER DEFAULT 1, -- How many times can be completed
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create customer challenges table (tracking challenge progress)
CREATE TABLE IF NOT EXISTS customer_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE,
  challenge_id UUID REFERENCES loyalty_challenges(id) ON DELETE CASCADE,
  progress JSONB DEFAULT '{}', -- Stores progress data
  completed_count INTEGER DEFAULT 0,
  last_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(member_id, challenge_id)
);

-- Create achievement progress table (for multi-step achievements)
CREATE TABLE IF NOT EXISTS achievement_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE,
  achievement_id UUID REFERENCES loyalty_achievements(id) ON DELETE CASCADE,
  progress JSONB DEFAULT '{}', -- Stores progress data
  current_value INTEGER DEFAULT 0,
  target_value INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(member_id, achievement_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_loyalty_members_customer_id ON loyalty_members(customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_members_tier_id ON loyalty_members(tier_id);
CREATE INDEX IF NOT EXISTS idx_event_check_ins_event_id ON event_check_ins(event_id);
CREATE INDEX IF NOT EXISTS idx_event_check_ins_customer_id ON event_check_ins(customer_id);
CREATE INDEX IF NOT EXISTS idx_event_check_ins_member_id ON event_check_ins(member_id);
CREATE INDEX IF NOT EXISTS idx_event_check_ins_check_in_time ON event_check_ins(check_in_time);
CREATE INDEX IF NOT EXISTS idx_customer_achievements_member_id ON customer_achievements(member_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_member_id ON reward_redemptions(member_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_code ON reward_redemptions(redemption_code);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_status ON reward_redemptions(status);
CREATE INDEX IF NOT EXISTS idx_loyalty_point_transactions_member_id ON loyalty_point_transactions(member_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_point_transactions_created_at ON loyalty_point_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_loyalty_challenges_active ON loyalty_challenges(active, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_customer_challenges_member_id ON customer_challenges(member_id);
CREATE INDEX IF NOT EXISTS idx_achievement_progress_member_id ON achievement_progress(member_id);

-- Enable Row Level Security
ALTER TABLE loyalty_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_point_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievement_progress ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for staff access (drop existing policies first to avoid conflicts)
-- Loyalty Programs
DROP POLICY IF EXISTS "Staff can view loyalty programs" ON loyalty_programs;
DROP POLICY IF EXISTS "Staff can manage loyalty programs" ON loyalty_programs;
CREATE POLICY "Staff can view loyalty programs" ON loyalty_programs
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage loyalty programs" ON loyalty_programs
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Loyalty Tiers
DROP POLICY IF EXISTS "Staff can view loyalty tiers" ON loyalty_tiers;
DROP POLICY IF EXISTS "Staff can manage loyalty tiers" ON loyalty_tiers;
CREATE POLICY "Staff can view loyalty tiers" ON loyalty_tiers
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage loyalty tiers" ON loyalty_tiers
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Loyalty Members
DROP POLICY IF EXISTS "Staff can view loyalty members" ON loyalty_members;
DROP POLICY IF EXISTS "Staff can manage loyalty members" ON loyalty_members;
DROP POLICY IF EXISTS "Members can view own loyalty data" ON loyalty_members;
DROP POLICY IF EXISTS "Staff can view all loyalty data" ON loyalty_members;
DROP POLICY IF EXISTS "Staff can manage loyalty data" ON loyalty_members;
CREATE POLICY "Staff can view loyalty members" ON loyalty_members
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage loyalty members" ON loyalty_members
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Event Check-ins
DROP POLICY IF EXISTS "Staff can view event check-ins" ON event_check_ins;
DROP POLICY IF EXISTS "Staff can manage event check-ins" ON event_check_ins;
CREATE POLICY "Staff can view event check-ins" ON event_check_ins
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage event check-ins" ON event_check_ins
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Loyalty Achievements
DROP POLICY IF EXISTS "Staff can view achievements" ON loyalty_achievements;
DROP POLICY IF EXISTS "Staff can manage achievements" ON loyalty_achievements;
CREATE POLICY "Staff can view achievements" ON loyalty_achievements
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage achievements" ON loyalty_achievements
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Customer Achievements
DROP POLICY IF EXISTS "Staff can view customer achievements" ON customer_achievements;
DROP POLICY IF EXISTS "Staff can manage customer achievements" ON customer_achievements;
CREATE POLICY "Staff can view customer achievements" ON customer_achievements
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage customer achievements" ON customer_achievements
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Loyalty Rewards
DROP POLICY IF EXISTS "Staff can view rewards" ON loyalty_rewards;
DROP POLICY IF EXISTS "Staff can manage rewards" ON loyalty_rewards;
CREATE POLICY "Staff can view rewards" ON loyalty_rewards
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage rewards" ON loyalty_rewards
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Reward Redemptions
DROP POLICY IF EXISTS "Staff can view redemptions" ON reward_redemptions;
DROP POLICY IF EXISTS "Staff can manage redemptions" ON reward_redemptions;
CREATE POLICY "Staff can view redemptions" ON reward_redemptions
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage redemptions" ON reward_redemptions
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Point Transactions
DROP POLICY IF EXISTS "Staff can view point transactions" ON loyalty_point_transactions;
DROP POLICY IF EXISTS "Staff can manage point transactions" ON loyalty_point_transactions;
CREATE POLICY "Staff can view point transactions" ON loyalty_point_transactions
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage point transactions" ON loyalty_point_transactions
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Loyalty Campaigns
DROP POLICY IF EXISTS "Staff can view campaigns" ON loyalty_campaigns;
DROP POLICY IF EXISTS "Staff can manage campaigns" ON loyalty_campaigns;
CREATE POLICY "Staff can view campaigns" ON loyalty_campaigns
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage campaigns" ON loyalty_campaigns
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Loyalty Challenges
DROP POLICY IF EXISTS "Staff can view challenges" ON loyalty_challenges;
DROP POLICY IF EXISTS "Staff can manage challenges" ON loyalty_challenges;
CREATE POLICY "Staff can view challenges" ON loyalty_challenges
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage challenges" ON loyalty_challenges
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Customer Challenges
DROP POLICY IF EXISTS "Staff can view customer challenges" ON customer_challenges;
DROP POLICY IF EXISTS "Staff can manage customer challenges" ON customer_challenges;
CREATE POLICY "Staff can view customer challenges" ON customer_challenges
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage customer challenges" ON customer_challenges
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Achievement Progress
DROP POLICY IF EXISTS "Staff can view achievement progress" ON achievement_progress;
DROP POLICY IF EXISTS "Staff can manage achievement progress" ON achievement_progress;
CREATE POLICY "Staff can view achievement progress" ON achievement_progress
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage achievement progress" ON achievement_progress
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Create update triggers for updated_at columns
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_loyalty_programs_updated_at BEFORE UPDATE ON loyalty_programs 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_loyalty_tiers_updated_at BEFORE UPDATE ON loyalty_tiers 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_loyalty_members_updated_at BEFORE UPDATE ON loyalty_members 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_loyalty_achievements_updated_at BEFORE UPDATE ON loyalty_achievements 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_loyalty_rewards_updated_at BEFORE UPDATE ON loyalty_rewards 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_loyalty_campaigns_updated_at BEFORE UPDATE ON loyalty_campaigns 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_loyalty_challenges_updated_at BEFORE UPDATE ON loyalty_challenges 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_customer_challenges_updated_at BEFORE UPDATE ON customer_challenges 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_achievement_progress_updated_at BEFORE UPDATE ON achievement_progress 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Insert default loyalty program and tiers
INSERT INTO loyalty_programs (id, name, active, settings)
VALUES ('550e8400-e29b-41d4-a716-446655440000', 'The Anchor VIP Club', true, '{
  "points_per_check_in": 10,
  "welcome_bonus": 50,
  "birthday_bonus": 100,
  "referral_bonus": 50
}')
ON CONFLICT (id) DO NOTHING;

-- Insert default tiers
INSERT INTO loyalty_tiers (program_id, name, level, min_events, point_multiplier, color, icon)
VALUES 
  ('550e8400-e29b-41d4-a716-446655440000', 'Member', 0, 0, 1.0, '#9CA3AF', '🟢'),
  ('550e8400-e29b-41d4-a716-446655440000', 'Bronze', 1, 5, 1.1, '#B87333', '🥉'),
  ('550e8400-e29b-41d4-a716-446655440000', 'Silver', 2, 15, 1.25, '#C0C0C0', '🥈'),
  ('550e8400-e29b-41d4-a716-446655440000', 'Gold', 3, 30, 1.5, '#FFD700', '🥇'),
  ('550e8400-e29b-41d4-a716-446655440000', 'Platinum', 4, 50, 2.0, '#E5E4E2', '💎')
ON CONFLICT DO NOTHING;
-- End 20240712000001_loyalty_system_complete.sql


-- Begin 20240712000002_loyalty_core_tables_fix.sql
-- Create core loyalty tables for The Anchor VIP Club
-- This migration creates the foundation for the loyalty program including members, tiers, points, and check-ins

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Staff can view loyalty campaigns" ON loyalty_campaigns;
DROP POLICY IF EXISTS "Staff can manage loyalty campaigns" ON loyalty_campaigns;
DROP POLICY IF EXISTS "Staff can view loyalty members" ON loyalty_members;
DROP POLICY IF EXISTS "Staff can manage loyalty members" ON loyalty_members;
DROP POLICY IF EXISTS "Staff can view loyalty tiers" ON loyalty_tiers;
DROP POLICY IF EXISTS "Staff can manage loyalty tiers" ON loyalty_tiers;
DROP POLICY IF EXISTS "Staff can view point transactions" ON loyalty_point_transactions;
DROP POLICY IF EXISTS "Staff can manage point transactions" ON loyalty_point_transactions;
DROP POLICY IF EXISTS "Staff can view event check-ins" ON event_check_ins;
DROP POLICY IF EXISTS "Staff can manage event check-ins" ON event_check_ins;
DROP POLICY IF EXISTS "Staff can view reward redemptions" ON reward_redemptions;
DROP POLICY IF EXISTS "Staff can manage reward redemptions" ON reward_redemptions;

-- Create loyalty_campaigns table
CREATE TABLE IF NOT EXISTS loyalty_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  bonus_type VARCHAR(50) NOT NULL CHECK (bonus_type IN ('multiplier', 'fixed', 'percentage')),
  bonus_value DECIMAL(10,2) NOT NULL,
  criteria JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create loyalty_members table
CREATE TABLE IF NOT EXISTS loyalty_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE UNIQUE NOT NULL,
  program_id UUID REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  tier_id UUID REFERENCES loyalty_tiers(id),
  total_points INTEGER DEFAULT 0,
  available_points INTEGER DEFAULT 0,
  lifetime_points INTEGER DEFAULT 0,
  lifetime_events INTEGER DEFAULT 0,
  join_date DATE DEFAULT CURRENT_DATE,
  last_activity_date DATE,
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create loyalty_tiers table
CREATE TABLE IF NOT EXISTS loyalty_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  level INTEGER NOT NULL,
  min_events INTEGER NOT NULL DEFAULT 0,
  point_multiplier DECIMAL(3,2) DEFAULT 1.0,
  color VARCHAR(7), -- Hex color for UI
  icon VARCHAR(50), -- Icon/emoji
  benefits JSONB DEFAULT '[]',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create event_check_ins table
CREATE TABLE IF NOT EXISTS event_check_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id),
  event_id UUID REFERENCES events(id) NOT NULL,
  customer_id UUID REFERENCES customers(id) NOT NULL,
  member_id UUID REFERENCES loyalty_members(id),
  check_in_time TIMESTAMPTZ DEFAULT NOW(),
  check_in_method VARCHAR(50) DEFAULT 'manual', -- 'qr', 'manual', 'self'
  points_earned INTEGER DEFAULT 0,
  achievements_earned UUID[] DEFAULT '{}',
  staff_id UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create loyalty_point_transactions table
CREATE TABLE IF NOT EXISTS loyalty_point_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE NOT NULL,
  points INTEGER NOT NULL, -- positive for earned, negative for spent
  balance_after INTEGER NOT NULL,
  transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('earned', 'redeemed', 'expired', 'adjusted', 'bonus')),
  description TEXT,
  reference_type VARCHAR(50), -- 'check_in', 'achievement', 'redemption', 'manual'
  reference_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- Create reward_redemptions table
CREATE TABLE IF NOT EXISTS reward_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE NOT NULL,
  reward_id UUID REFERENCES loyalty_rewards(id),
  points_spent INTEGER NOT NULL,
  redeemed_at TIMESTAMPTZ DEFAULT NOW(),
  fulfilled_at TIMESTAMPTZ,
  fulfilled_by UUID REFERENCES users(id),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'fulfilled', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_loyalty_campaigns_program_id ON loyalty_campaigns(program_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_campaigns_start_date ON loyalty_campaigns(start_date);
CREATE INDEX IF NOT EXISTS idx_loyalty_campaigns_end_date ON loyalty_campaigns(end_date);
CREATE INDEX IF NOT EXISTS idx_loyalty_campaigns_active ON loyalty_campaigns(active);
CREATE INDEX IF NOT EXISTS idx_loyalty_members_customer_id ON loyalty_members(customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_members_tier_id ON loyalty_members(tier_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_members_status ON loyalty_members(status);
CREATE INDEX IF NOT EXISTS idx_event_check_ins_event_id ON event_check_ins(event_id);
CREATE INDEX IF NOT EXISTS idx_event_check_ins_customer_id ON event_check_ins(customer_id);
CREATE INDEX IF NOT EXISTS idx_event_check_ins_check_in_time ON event_check_ins(check_in_time DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_point_transactions_member_id ON loyalty_point_transactions(member_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_point_transactions_created_at ON loyalty_point_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_member_id ON reward_redemptions(member_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_status ON reward_redemptions(status);

-- Enable RLS
ALTER TABLE loyalty_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_point_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_redemptions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for loyalty_campaigns
CREATE POLICY "Staff can view loyalty campaigns" ON loyalty_campaigns
  FOR SELECT USING (
    user_has_permission(auth.uid(), 'loyalty', 'view')
  );

CREATE POLICY "Staff can manage loyalty campaigns" ON loyalty_campaigns
  FOR ALL USING (
    user_has_permission(auth.uid(), 'loyalty', 'manage')
  );

-- Create RLS policies for loyalty_members
CREATE POLICY "Staff can view loyalty members" ON loyalty_members
  FOR SELECT USING (
    user_has_permission(auth.uid(), 'loyalty', 'view')
  );

CREATE POLICY "Staff can manage loyalty members" ON loyalty_members
  FOR ALL USING (
    user_has_permission(auth.uid(), 'loyalty', 'manage')
  );

-- Create RLS policies for loyalty_tiers
CREATE POLICY "Staff can view loyalty tiers" ON loyalty_tiers
  FOR SELECT USING (
    user_has_permission(auth.uid(), 'loyalty', 'view')
  );

CREATE POLICY "Staff can manage loyalty tiers" ON loyalty_tiers
  FOR ALL USING (
    user_has_permission(auth.uid(), 'loyalty', 'manage')
  );

-- Create RLS policies for event_check_ins
CREATE POLICY "Staff can view event check-ins" ON event_check_ins
  FOR SELECT USING (
    user_has_permission(auth.uid(), 'loyalty', 'view')
  );

CREATE POLICY "Staff can manage event check-ins" ON event_check_ins
  FOR ALL USING (
    user_has_permission(auth.uid(), 'loyalty', 'manage')
  );

-- Create RLS policies for loyalty_point_transactions
CREATE POLICY "Staff can view point transactions" ON loyalty_point_transactions
  FOR SELECT USING (
    user_has_permission(auth.uid(), 'loyalty', 'view')
  );

CREATE POLICY "Staff can manage point transactions" ON loyalty_point_transactions
  FOR ALL USING (
    user_has_permission(auth.uid(), 'loyalty', 'manage')
  );

-- Create RLS policies for reward_redemptions
CREATE POLICY "Staff can view reward redemptions" ON reward_redemptions
  FOR SELECT USING (
    user_has_permission(auth.uid(), 'loyalty', 'view')
  );

CREATE POLICY "Staff can manage reward redemptions" ON reward_redemptions
  FOR ALL USING (
    user_has_permission(auth.uid(), 'loyalty', 'manage')
  );

-- Create update timestamp triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_loyalty_campaigns_updated_at ON loyalty_campaigns;
CREATE TRIGGER update_loyalty_campaigns_updated_at BEFORE UPDATE
  ON loyalty_campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_loyalty_members_updated_at ON loyalty_members;
CREATE TRIGGER update_loyalty_members_updated_at BEFORE UPDATE
  ON loyalty_members FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_loyalty_tiers_updated_at ON loyalty_tiers;
CREATE TRIGGER update_loyalty_tiers_updated_at BEFORE UPDATE
  ON loyalty_tiers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default tiers for The Anchor VIP Club
ALTER TABLE loyalty_tiers ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
INSERT INTO loyalty_tiers (program_id, name, level, min_events, point_multiplier, color, icon, benefits, sort_order)
SELECT 
  lp.id,
  tier.name,
  tier.level,
  tier.min_events,
  tier.point_multiplier,
  tier.color,
  tier.icon,
  tier.benefits,
  tier.sort_order
FROM loyalty_programs lp
CROSS JOIN (
  VALUES 
    ('VIP Member', 1, 0, 1.0, '#6B7280', '⭐', '["Welcome bonus: 50 points", "SMS event alerts", "Birthday month recognition", "Access to loyalty portal"]'::jsonb, 1),
    ('VIP Bronze', 2, 5, 2.0, '#92400E', '🥉', '["100 points per attendance", "Early access booking (24 hours)", "10% off ticketed events", "Monthly bonus challenges"]'::jsonb, 2),
    ('VIP Silver', 3, 10, 3.0, '#6B7280', '🥈', '["150 points per attendance", "Bring-a-friend bonus points", "15% off ticketed events", "Exclusive Silver-only events", "Skip-the-queue privileges"]'::jsonb, 3),
    ('VIP Gold', 4, 20, 4.0, '#F59E0B', '🥇', '["200 points per attendance", "Complimentary welcome drink each visit", "20% off ticketed events", "Influence on event planning", "Reserved Gold table option"]'::jsonb, 4),
    ('VIP Platinum', 5, 40, 6.0, '#7C3AED', '💎', '["300 points per attendance", "Free plus-one to all events", "Lifetime membership status", "Custom achievement creation", "Wall of Fame recognition"]'::jsonb, 5)
) AS tier(name, level, min_events, point_multiplier, color, icon, benefits, sort_order)
WHERE lp.name = 'The Anchor VIP Club' AND NOT EXISTS (
  SELECT 1 FROM loyalty_tiers WHERE program_id = lp.id AND name = tier.name
) 
ON CONFLICT (program_id, level) DO NOTHING;

-- Create function to calculate member tier based on lifetime events
CREATE OR REPLACE FUNCTION calculate_member_tier(p_lifetime_events INTEGER, p_program_id UUID)
RETURNS UUID AS $$
DECLARE
  v_tier_id UUID;
BEGIN
  SELECT id INTO v_tier_id
  FROM loyalty_tiers
  WHERE program_id = p_program_id
    AND min_events <= p_lifetime_events
  ORDER BY min_events DESC
  LIMIT 1;
  
  RETURN v_tier_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to update member tier
CREATE OR REPLACE FUNCTION update_member_tier(p_member_id UUID)
RETURNS VOID AS $$
DECLARE
  v_member RECORD;
  v_new_tier_id UUID;
BEGIN
  SELECT * INTO v_member FROM loyalty_members WHERE id = p_member_id;
  
  v_new_tier_id := calculate_member_tier(v_member.lifetime_events, v_member.program_id);
  
  IF v_new_tier_id IS DISTINCT FROM v_member.tier_id THEN
    UPDATE loyalty_members 
    SET tier_id = v_new_tier_id
    WHERE id = p_member_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create function to record check-in and award points
CREATE OR REPLACE FUNCTION process_event_check_in(
  p_event_id UUID,
  p_customer_id UUID,
  p_booking_id UUID DEFAULT NULL,
  p_check_in_method VARCHAR DEFAULT 'manual',
  p_staff_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_member RECORD;
  v_tier RECORD;
  v_check_in_id UUID;
  v_points_earned INTEGER;
  v_base_points INTEGER := 50;
  v_result JSONB;
BEGIN
  -- Get member details
  SELECT m.*, t.point_multiplier 
  INTO v_member
  FROM loyalty_members m
  LEFT JOIN loyalty_tiers t ON m.tier_id = t.id
  WHERE m.customer_id = p_customer_id AND m.status = 'active';
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Customer is not a loyalty member');
  END IF;
  
  -- Check if already checked in for this event
  IF EXISTS (
    SELECT 1 FROM event_check_ins 
    WHERE event_id = p_event_id AND customer_id = p_customer_id
  ) THEN
    RETURN jsonb_build_object('error', 'Customer already checked in for this event');
  END IF;
  
  -- Calculate points earned
  v_points_earned := COALESCE(v_base_points * v_member.point_multiplier, v_base_points);
  
  -- Create check-in record
  INSERT INTO event_check_ins (
    booking_id, event_id, customer_id, member_id, 
    check_in_method, points_earned, staff_id, notes
  )
  VALUES (
    p_booking_id, p_event_id, p_customer_id, v_member.id,
    p_check_in_method, v_points_earned, p_staff_id, p_notes
  )
  RETURNING id INTO v_check_in_id;
  
  -- Update member points and stats
  UPDATE loyalty_members
  SET 
    available_points = available_points + v_points_earned,
    total_points = total_points + v_points_earned,
    lifetime_points = lifetime_points + v_points_earned,
    lifetime_events = lifetime_events + 1,
    last_activity_date = CURRENT_DATE
  WHERE id = v_member.id;
  
  -- Record point transaction
  INSERT INTO loyalty_point_transactions (
    member_id, points, balance_after, transaction_type,
    description, reference_type, reference_id, created_by
  )
  VALUES (
    v_member.id, 
    v_points_earned, 
    v_member.available_points + v_points_earned,
    'earned',
    'Event check-in',
    'check_in',
    v_check_in_id,
    p_staff_id
  );
  
  -- Update member tier if needed
  PERFORM update_member_tier(v_member.id);
  
  -- Return success with details
  RETURN jsonb_build_object(
    'success', true,
    'check_in_id', v_check_in_id,
    'points_earned', v_points_earned,
    'new_balance', v_member.available_points + v_points_earned,
    'lifetime_events', v_member.lifetime_events + 1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- End 20240712000002_loyalty_core_tables_fix.sql


-- Begin 20240712000003_loyalty_fix_references.sql
-- Fix references and conflicts in loyalty system
-- This migration ensures all tables exist and references are correct

-- First, ensure we have the users table reference correct
-- The baseline migration should have created profiles, not users
-- So we need to check what exists

-- Fix the event_check_ins table to use auth.users instead of users
DO $$
BEGIN
  -- Check if event_check_ins exists and has the wrong reference
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'event_check_ins' 
    AND column_name = 'staff_id'
  ) THEN
    -- Drop the existing constraint if it exists
    ALTER TABLE event_check_ins 
    DROP CONSTRAINT IF EXISTS event_check_ins_staff_id_fkey;
    
    -- Add the correct constraint
    ALTER TABLE event_check_ins 
    ADD CONSTRAINT event_check_ins_staff_id_fkey 
    FOREIGN KEY (staff_id) REFERENCES auth.users(id);
  END IF;
END $$;

-- Fix the loyalty_point_transactions table to use auth.users instead of users
DO $$
BEGIN
  -- Check if loyalty_point_transactions exists and has the wrong reference
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'loyalty_point_transactions' 
    AND column_name = 'created_by'
  ) THEN
    -- Drop the existing constraint if it exists
    ALTER TABLE loyalty_point_transactions 
    DROP CONSTRAINT IF EXISTS loyalty_point_transactions_created_by_fkey;
    
    -- Add the correct constraint
    ALTER TABLE loyalty_point_transactions 
    ADD CONSTRAINT loyalty_point_transactions_created_by_fkey 
    FOREIGN KEY (created_by) REFERENCES auth.users(id);
  END IF;
END $$;

-- Fix the reward_redemptions table to use auth.users instead of users
DO $$
BEGIN
  -- Check if reward_redemptions exists and has the wrong reference
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'reward_redemptions' 
    AND column_name = 'fulfilled_by'
  ) THEN
    -- Drop the existing constraint if it exists
    ALTER TABLE reward_redemptions 
    DROP CONSTRAINT IF EXISTS reward_redemptions_fulfilled_by_fkey;
    
    -- Add the correct constraint
    ALTER TABLE reward_redemptions 
    ADD CONSTRAINT reward_redemptions_fulfilled_by_fkey 
    FOREIGN KEY (fulfilled_by) REFERENCES auth.users(id);
  END IF;
END $$;

-- Add any missing columns to loyalty_members that differ between migrations
DO $$
BEGIN
  -- Add last_visit_date if it doesn't exist (from first migration)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'loyalty_members' 
    AND column_name = 'last_visit_date'
  ) THEN
    ALTER TABLE loyalty_members ADD COLUMN last_visit_date DATE;
  END IF;
  
  -- Add metadata if it doesn't exist (from first migration)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'loyalty_members' 
    AND column_name = 'metadata'
  ) THEN
    ALTER TABLE loyalty_members ADD COLUMN metadata JSONB DEFAULT '{}';
  END IF;
  
  -- Add last_activity_date if it doesn't exist (from second migration)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'loyalty_members' 
    AND column_name = 'last_activity_date'
  ) THEN
    ALTER TABLE loyalty_members ADD COLUMN last_activity_date DATE;
  END IF;
END $$;

-- Ensure unique constraints exist
DO $$
BEGIN
  -- Add unique constraint on loyalty_members(customer_id, program_id) if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'loyalty_members' 
    AND constraint_type = 'UNIQUE'
    AND constraint_name = 'loyalty_members_customer_id_program_id_key'
  ) THEN
    ALTER TABLE loyalty_members 
    ADD CONSTRAINT loyalty_members_customer_id_program_id_key 
    UNIQUE(customer_id, program_id);
  END IF;
  
  -- Add unique constraint on event_check_ins(event_id, customer_id) if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'event_check_ins' 
    AND constraint_type = 'UNIQUE'
    AND constraint_name = 'event_check_ins_event_id_customer_id_key'
  ) THEN
    ALTER TABLE event_check_ins 
    ADD CONSTRAINT event_check_ins_event_id_customer_id_key 
    UNIQUE(event_id, customer_id);
  END IF;
END $$;

-- Add comment to track migration status
COMMENT ON SCHEMA public IS 'Loyalty system tables reconciled and references fixed';
-- End 20240712000003_loyalty_fix_references.sql


-- Begin 20240712000004_add_redemption_code_fields.sql
-- Add code and expires_at fields to reward_redemptions table

-- Add code column for unique redemption codes
ALTER TABLE reward_redemptions 
ADD COLUMN IF NOT EXISTS code VARCHAR(10) UNIQUE;

-- Add expires_at column for time-limited redemptions
ALTER TABLE reward_redemptions 
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Create index on code for fast lookups
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_code 
ON reward_redemptions(code) WHERE code IS NOT NULL;

-- Create index on expires_at for filtering active redemptions
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_expires_at 
ON reward_redemptions(expires_at) WHERE expires_at IS NOT NULL;
-- End 20240712000004_add_redemption_code_fields.sql


-- Begin 20240712000005_add_booking_qr_fields.sql
-- Add QR code fields to bookings table for loyalty check-ins

-- Add qr_token column for unique QR codes
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS qr_token VARCHAR(64);

-- Add qr_expires_at column for time-limited QR codes
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS qr_expires_at TIMESTAMPTZ;

-- Create index on qr_token for fast lookups
CREATE INDEX IF NOT EXISTS idx_bookings_qr_token 
ON bookings(qr_token) WHERE qr_token IS NOT NULL;
-- End 20240712000005_add_booking_qr_fields.sql


-- Begin 20240712000006_loyalty_portal_auth.sql
-- Create tables for loyalty portal OTP authentication

-- OTP verification table
CREATE TABLE IF NOT EXISTS loyalty_otp_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(20) NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE,
  otp_code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER DEFAULT 0,
  verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Portal sessions table
CREATE TABLE IF NOT EXISTS loyalty_portal_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
  session_token VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  active BOOLEAN DEFAULT true,
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_loyalty_otp_phone ON loyalty_otp_verifications(phone_number);
CREATE INDEX IF NOT EXISTS idx_loyalty_otp_expires ON loyalty_otp_verifications(expires_at) WHERE verified = false;
CREATE INDEX IF NOT EXISTS idx_loyalty_sessions_token ON loyalty_portal_sessions(session_token) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_loyalty_sessions_expires ON loyalty_portal_sessions(expires_at) WHERE active = true;

-- Enable RLS
ALTER TABLE loyalty_otp_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_portal_sessions ENABLE ROW LEVEL SECURITY;

-- RLS policies for OTP verifications (no direct access, only through server actions)
CREATE POLICY "No direct access to OTP verifications" ON loyalty_otp_verifications
  FOR ALL USING (false);

-- RLS policies for portal sessions (no direct access, only through server actions)
CREATE POLICY "No direct access to portal sessions" ON loyalty_portal_sessions
  FOR ALL USING (false);
-- End 20240712000006_loyalty_portal_auth.sql


-- Begin 20240712000007_loyalty_initial_rewards.sql
-- Insert initial loyalty rewards

-- First, get the active program ID
DO $$
DECLARE
  program_id UUID;
BEGIN
  -- Get the active loyalty program
  SELECT id INTO program_id FROM loyalty_programs WHERE active = true LIMIT 1;
  
  -- Only proceed if we have an active program
  IF program_id IS NOT NULL THEN
    -- Insert initial rewards
    INSERT INTO loyalty_rewards (program_id, name, description, points_cost, category, icon, active, metadata)
    VALUES
      -- Drinks
      (program_id, 'Free Coffee', 'Enjoy a complimentary coffee on us', 100, 'drinks', '☕', true, '{}'),
      (program_id, 'Free Pint', 'A refreshing pint of your choice', 200, 'drinks', '🍺', true, '{}'),
      (program_id, 'Premium Cocktail', 'Choose from our signature cocktail menu', 400, 'drinks', '🍸', true, '{}'),
      (program_id, 'Bottle of House Wine', 'Red or white house wine', 800, 'drinks', '🍷', true, '{}'),
      
      -- Food
      (program_id, '10% Off Food', '10% discount on your food bill', 300, 'food', '🍽️', true, '{}'),
      (program_id, 'Free Starter', 'Any starter from our menu', 350, 'food', '🥗', true, '{}'),
      (program_id, 'Free Main Course', 'Choose any main course', 600, 'food', '🍖', true, '{}'),
      (program_id, '25% Off Food Bill', '25% off your entire food order', 700, 'food', '💰', true, '{}'),
      
      -- Special
      (program_id, 'Birthday Treat', 'Free dessert or shot on your birthday', 0, 'special', '🎂', true, '{"birthday_only": true}'),
      (program_id, 'Priority Booking', 'Jump the queue for event bookings', 500, 'special', '⚡', true, '{}'),
      (program_id, 'VIP Table Service', 'Dedicated table service for the evening', 1000, 'special', '👑', true, '{}'),
      (program_id, 'Private Event Discount', '20% off private venue hire', 1500, 'special', '🎉', true, '{}')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
-- End 20240712000007_loyalty_initial_rewards.sql


-- Begin 20240712000008_loyalty_notifications.sql
-- Loyalty Notifications System
-- Tracks all loyalty-related notifications sent to members

-- Create loyalty notifications table
CREATE TABLE IF NOT EXISTS loyalty_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE,
  notification_type VARCHAR(50) NOT NULL,
  channel VARCHAR(20) NOT NULL DEFAULT 'sms',
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  job_id VARCHAR(255), -- Reference to background job
  sent_at TIMESTAMPTZ,
  delivered BOOLEAN,
  failed BOOLEAN DEFAULT false,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create bulk notifications table
CREATE TABLE IF NOT EXISTS loyalty_bulk_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  recipient_count INTEGER NOT NULL,
  filter_criteria JSONB DEFAULT '{}',
  scheduled_for TIMESTAMPTZ,
  job_id VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending',
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Add notification tracking columns to loyalty_members
ALTER TABLE loyalty_members 
ADD COLUMN IF NOT EXISTS welcome_sent BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS last_reward_notification TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{"sms": true, "email": true}';

-- Add automated notification settings to loyalty programs
UPDATE loyalty_programs 
SET settings = jsonb_set(
  COALESCE(settings, '{}'),
  '{automated_notifications}',
  '{
    "welcome_enabled": true,
    "tier_upgrade_enabled": true,
    "achievement_enabled": true,
    "points_earned_enabled": true,
    "reward_available_enabled": true,
    "challenge_update_enabled": true,
    "min_points_for_notification": 10,
    "quiet_hours_start": "21:00",
    "quiet_hours_end": "09:00"
  }'::jsonb
)
WHERE active = true;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_loyalty_notifications_member_id ON loyalty_notifications(member_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_notifications_created_at ON loyalty_notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_loyalty_notifications_job_id ON loyalty_notifications(job_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_bulk_notifications_status ON loyalty_bulk_notifications(status);
CREATE INDEX IF NOT EXISTS idx_loyalty_bulk_notifications_scheduled ON loyalty_bulk_notifications(scheduled_for);

-- Enable RLS
ALTER TABLE loyalty_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_bulk_notifications ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
DROP POLICY IF EXISTS "Staff can view loyalty notifications" ON loyalty_notifications;
DROP POLICY IF EXISTS "Staff can manage loyalty notifications" ON loyalty_notifications;
CREATE POLICY "Staff can view loyalty notifications" ON loyalty_notifications
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage loyalty notifications" ON loyalty_notifications
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

DROP POLICY IF EXISTS "Staff can view bulk notifications" ON loyalty_bulk_notifications;
DROP POLICY IF EXISTS "Staff can manage bulk notifications" ON loyalty_bulk_notifications;
CREATE POLICY "Staff can view bulk notifications" ON loyalty_bulk_notifications
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage bulk notifications" ON loyalty_bulk_notifications
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Create function to update loyalty member stats after notification
CREATE OR REPLACE FUNCTION update_member_notification_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.channel = 'sms' AND NEW.delivered = true THEN
    UPDATE loyalty_members
    SET metadata = jsonb_set(
      COALESCE(metadata, '{}'),
      '{last_sms_sent}',
      to_jsonb(NEW.sent_at)
    )
    WHERE id = NEW.member_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for notification stats
DROP TRIGGER IF EXISTS update_member_notification_stats_trigger ON loyalty_notifications;
CREATE TRIGGER update_member_notification_stats_trigger
  AFTER INSERT OR UPDATE ON loyalty_notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_member_notification_stats();
-- End 20240712000008_loyalty_notifications.sql


-- Begin 20240720000000_add_rate_limits_table.sql
-- Create rate_limits table for API rate limiting
CREATE TABLE IF NOT EXISTS rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(255) NOT NULL UNIQUE,
  requests JSONB DEFAULT '[]'::jsonb,
  window_ms INTEGER NOT NULL,
  max_requests INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key);
CREATE INDEX IF NOT EXISTS idx_rate_limits_updated_at ON rate_limits(updated_at);

-- Enable RLS
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- No RLS policies needed as this table is only accessed via service role

-- Add cleanup function for old entries
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS void AS $$
BEGIN
  DELETE FROM rate_limits
  WHERE updated_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON TABLE rate_limits IS 'Stores rate limiting data for API endpoints';
-- End 20240720000000_add_rate_limits_table.sql


-- Begin 20240928123000_update_vendor_service_type_check.sql
ALTER TABLE public.vendors DROP CONSTRAINT IF EXISTS vendors_service_type_check;
ALTER TABLE public.vendors ADD CONSTRAINT vendors_service_type_check CHECK (
  service_type = ANY (ARRAY['dj','band','photographer','florist','decorator','cake','entertainment','transport','equipment','other'])
);
-- End 20240928123000_update_vendor_service_type_check.sql


-- Begin 20240929120000_add_vendor_contact_name.sql
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS contact_name text;

COMMENT ON COLUMN public.vendors.contact_name IS 'Primary contact person for private bookings.';
-- End 20240929120000_add_vendor_contact_name.sql


-- Begin 20250113155500_add_loyalty_access_token.sql
-- Add access token to loyalty_members for direct portal access
-- This allows members to access their loyalty portal without phone verification

-- Add access_token column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'loyalty_members' AND column_name = 'access_token'
  ) THEN
    ALTER TABLE loyalty_members ADD COLUMN access_token VARCHAR(255) UNIQUE;
  END IF;
END $$;

-- Create index for faster token lookups
CREATE INDEX IF NOT EXISTS idx_loyalty_members_access_token ON loyalty_members(access_token);

-- Function to generate a secure access token
CREATE OR REPLACE FUNCTION generate_loyalty_access_token()
RETURNS VARCHAR AS $$
DECLARE
  token VARCHAR;
BEGIN
  -- Generate a URL-safe random token (32 characters)
  SELECT encode(gen_random_bytes(24), 'base64') INTO token;
  -- Replace URL-unsafe characters
  token := replace(replace(replace(token, '+', '-'), '/', '_'), '=', '');
  RETURN token;
END;
$$ LANGUAGE plpgsql;

-- Update existing members with access tokens
UPDATE loyalty_members 
SET access_token = generate_loyalty_access_token()
WHERE access_token IS NULL;

-- Ensure new members get access tokens automatically
CREATE OR REPLACE FUNCTION set_loyalty_access_token()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.access_token IS NULL THEN
    NEW.access_token := generate_loyalty_access_token();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for new members
DROP TRIGGER IF EXISTS set_loyalty_access_token_trigger ON loyalty_members;
CREATE TRIGGER set_loyalty_access_token_trigger
  BEFORE INSERT ON loyalty_members
  FOR EACH ROW
  EXECUTE FUNCTION set_loyalty_access_token();
-- End 20250113155500_add_loyalty_access_token.sql


-- Begin 20250113170000_add_short_links.sql
-- Create short links system for vip-club.uk
-- This allows us to create short, memorable URLs that redirect to various parts of the system

-- Create short_links table
CREATE TABLE IF NOT EXISTS short_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code VARCHAR(20) UNIQUE NOT NULL,
  destination_url TEXT NOT NULL,
  link_type VARCHAR(50) NOT NULL CHECK (link_type IN ('loyalty_portal', 'event_checkin', 'promotion', 'reward_redemption', 'custom')),
  metadata JSONB DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  click_count INTEGER DEFAULT 0,
  last_clicked_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_short_links_short_code ON short_links(short_code);
CREATE INDEX IF NOT EXISTS idx_short_links_link_type ON short_links(link_type);
CREATE INDEX IF NOT EXISTS idx_short_links_expires_at ON short_links(expires_at) WHERE expires_at IS NOT NULL;

-- Create click tracking table
CREATE TABLE IF NOT EXISTS short_link_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_link_id UUID REFERENCES short_links(id) ON DELETE CASCADE,
  clicked_at TIMESTAMPTZ DEFAULT NOW(),
  user_agent TEXT,
  ip_address INET,
  referrer TEXT,
  metadata JSONB DEFAULT '{}'
);

-- Create index for analytics
CREATE INDEX IF NOT EXISTS idx_short_link_clicks_short_link_id ON short_link_clicks(short_link_id);
CREATE INDEX IF NOT EXISTS idx_short_link_clicks_clicked_at ON short_link_clicks(clicked_at);

-- Function to generate unique short codes
CREATE OR REPLACE FUNCTION generate_short_code(length INTEGER DEFAULT 6)
RETURNS VARCHAR AS $$
DECLARE
  chars VARCHAR := 'abcdefghijklmnopqrstuvwxyz0123456789';
  result VARCHAR := '';
  i INTEGER;
BEGIN
  -- Generate random string
  FOR i IN 1..length LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to create a short link with automatic code generation
CREATE OR REPLACE FUNCTION create_short_link(
  p_destination_url TEXT,
  p_link_type VARCHAR,
  p_metadata JSONB DEFAULT '{}',
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_custom_code VARCHAR DEFAULT NULL
)
RETURNS TABLE(short_code VARCHAR, full_url TEXT) AS $$
DECLARE
  v_short_code VARCHAR;
  v_attempts INTEGER := 0;
  v_max_attempts INTEGER := 10;
BEGIN
  -- Use custom code if provided
  IF p_custom_code IS NOT NULL THEN
    v_short_code := p_custom_code;
  ELSE
    -- Generate unique short code
    LOOP
      v_short_code := generate_short_code(6);
      
      -- Check if code already exists
      IF NOT EXISTS (SELECT 1 FROM short_links WHERE short_code = v_short_code) THEN
        EXIT;
      END IF;
      
      v_attempts := v_attempts + 1;
      IF v_attempts >= v_max_attempts THEN
        RAISE EXCEPTION 'Could not generate unique short code after % attempts', v_max_attempts;
      END IF;
    END LOOP;
  END IF;
  
  -- Insert the short link
  INSERT INTO short_links (
    short_code,
    destination_url,
    link_type,
    metadata,
    expires_at,
    created_by
  ) VALUES (
    v_short_code,
    p_destination_url,
    p_link_type,
    p_metadata,
    p_expires_at,
    auth.uid()
  );
  
  -- Return the short code and full URL
  RETURN QUERY SELECT 
    v_short_code,
    'https://vip-club.uk/' || v_short_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS policies
ALTER TABLE short_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE short_link_clicks ENABLE ROW LEVEL SECURITY;

-- Staff can view all short links
CREATE POLICY "Staff can view short links" ON short_links
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
    )
  );

-- Staff can create short links
CREATE POLICY "Staff can create short links" ON short_links
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
    )
  );

-- Staff can update their own short links
CREATE POLICY "Staff can update own short links" ON short_links
  FOR UPDATE
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Anyone can view click analytics (but only for existing short links)
CREATE POLICY "View click analytics" ON short_link_clicks
  FOR SELECT
  USING (true);

-- System can insert click tracking
CREATE POLICY "System can track clicks" ON short_link_clicks
  FOR INSERT
  WITH CHECK (true);
-- End 20250113170000_add_short_links.sql


-- Begin 20250113180000_fix_short_links_permissions.sql
-- Fix permissions and ambiguous column reference in short links

-- First, fix the ambiguous column reference in the function
CREATE OR REPLACE FUNCTION create_short_link(
  p_destination_url TEXT,
  p_link_type VARCHAR,
  p_metadata JSONB DEFAULT '{}',
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_custom_code VARCHAR DEFAULT NULL
)
RETURNS TABLE(short_code VARCHAR, full_url TEXT) AS $$
DECLARE
  v_short_code VARCHAR;
  v_attempts INTEGER := 0;
  v_max_attempts INTEGER := 10;
BEGIN
  -- Use custom code if provided
  IF p_custom_code IS NOT NULL THEN
    v_short_code := p_custom_code;
  ELSE
    -- Generate unique short code
    LOOP
      v_short_code := generate_short_code(6);
      
      -- Check if code already exists (use full table reference to avoid ambiguity)
      IF NOT EXISTS (SELECT 1 FROM short_links sl WHERE sl.short_code = v_short_code) THEN
        EXIT;
      END IF;
      
      v_attempts := v_attempts + 1;
      IF v_attempts >= v_max_attempts THEN
        RAISE EXCEPTION 'Could not generate unique short code after % attempts', v_max_attempts;
      END IF;
    END LOOP;
  END IF;
  
  -- Insert the short link
  INSERT INTO short_links (
    short_code,
    destination_url,
    link_type,
    metadata,
    expires_at,
    created_by
  ) VALUES (
    v_short_code,
    p_destination_url,
    p_link_type,
    p_metadata,
    p_expires_at,
    auth.uid()
  );
  
  -- Return the short code and full URL (use explicit column names)
  RETURN QUERY SELECT 
    v_short_code AS short_code,
    'https://vip-club.uk/' || v_short_code AS full_url;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add more permissive RLS policies for short_links
DROP POLICY IF EXISTS "Staff can view short links" ON short_links;
DROP POLICY IF EXISTS "Staff can create short links" ON short_links;
DROP POLICY IF EXISTS "Staff can update own short links" ON short_links;

-- Allow any authenticated user to view short links
CREATE POLICY "Authenticated users can view short links" ON short_links
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Allow any authenticated user to create short links
CREATE POLICY "Authenticated users can create short links" ON short_links
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Allow users to update their own short links
CREATE POLICY "Users can update own short links" ON short_links
  FOR UPDATE
  USING (created_by = auth.uid() OR created_by IS NULL)
  WITH CHECK (created_by = auth.uid() OR created_by IS NULL);

-- Allow users to delete their own short links
CREATE POLICY "Users can delete own short links" ON short_links
  FOR DELETE
  USING (created_by = auth.uid() OR created_by IS NULL);

-- Also ensure clicks can be inserted by anyone
DROP POLICY IF EXISTS "System can track clicks" ON short_link_clicks;
CREATE POLICY "Anyone can track clicks" ON short_link_clicks
  FOR INSERT
  WITH CHECK (true);

-- Allow viewing clicks for authenticated users
CREATE POLICY "Authenticated users can view clicks" ON short_link_clicks
  FOR SELECT
  USING (auth.uid() IS NOT NULL);
-- End 20250113180000_fix_short_links_permissions.sql


-- Begin 20250114180000_add_click_demographics.sql
-- Add demographic data fields to short_link_clicks for better analytics
-- This allows us to capture and analyze visitor demographics

-- Add new columns for demographic data
ALTER TABLE short_link_clicks
ADD COLUMN IF NOT EXISTS country VARCHAR(2),
ADD COLUMN IF NOT EXISTS city VARCHAR(100),
ADD COLUMN IF NOT EXISTS region VARCHAR(100),
ADD COLUMN IF NOT EXISTS device_type VARCHAR(20) CHECK (device_type IN ('mobile', 'tablet', 'desktop', 'bot', 'unknown')),
ADD COLUMN IF NOT EXISTS browser VARCHAR(50),
ADD COLUMN IF NOT EXISTS os VARCHAR(50),
ADD COLUMN IF NOT EXISTS utm_source VARCHAR(100),
ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(100),
ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(100);

-- Create indexes for demographic queries
CREATE INDEX IF NOT EXISTS idx_short_link_clicks_country ON short_link_clicks(country);
CREATE INDEX IF NOT EXISTS idx_short_link_clicks_device_type ON short_link_clicks(device_type);
-- Index on the timestamp column directly (the date casting will use this index)
CREATE INDEX IF NOT EXISTS idx_short_link_clicks_clicked_at ON short_link_clicks(clicked_at);

-- Create a view for daily click aggregations (simplified without nested aggregations)
CREATE OR REPLACE VIEW short_link_daily_stats AS
SELECT 
  sl.id as short_link_id,
  sl.short_code,
  sl.link_type,
  slc.clicked_at::date as click_date,
  COUNT(*) as total_clicks,
  COUNT(DISTINCT slc.ip_address) as unique_visitors,
  COUNT(CASE WHEN slc.device_type = 'mobile' THEN 1 END) as mobile_clicks,
  COUNT(CASE WHEN slc.device_type = 'desktop' THEN 1 END) as desktop_clicks,
  COUNT(CASE WHEN slc.device_type = 'tablet' THEN 1 END) as tablet_clicks
FROM short_links sl
LEFT JOIN short_link_clicks slc ON sl.id = slc.short_link_id
WHERE slc.clicked_at IS NOT NULL
GROUP BY sl.id, sl.short_code, sl.link_type, slc.clicked_at::date;

-- Grant permissions on the view
GRANT SELECT ON short_link_daily_stats TO authenticated;

-- Create a function to get analytics for a specific link with date range (simplified)
CREATE OR REPLACE FUNCTION get_short_link_analytics(
  p_short_code VARCHAR,
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  click_date DATE,
  total_clicks BIGINT,
  unique_visitors BIGINT,
  mobile_clicks BIGINT,
  desktop_clicks BIGINT,
  tablet_clicks BIGINT,
  top_countries JSONB,
  top_browsers JSONB,
  top_referrers JSONB
) AS $$
BEGIN
  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - INTERVAL '1 day' * (p_days - 1),
      CURRENT_DATE,
      INTERVAL '1 day'
    )::DATE AS date
  ),
  daily_stats AS (
    SELECT 
      slc.clicked_at::date as click_date,
      COUNT(*) as total_clicks,
      COUNT(DISTINCT slc.ip_address) as unique_visitors,
      COUNT(CASE WHEN slc.device_type = 'mobile' THEN 1 END) as mobile_clicks,
      COUNT(CASE WHEN slc.device_type = 'desktop' THEN 1 END) as desktop_clicks,
      COUNT(CASE WHEN slc.device_type = 'tablet' THEN 1 END) as tablet_clicks
    FROM short_links sl
    INNER JOIN short_link_clicks slc ON sl.id = slc.short_link_id
    WHERE sl.short_code = p_short_code
      AND slc.clicked_at >= CURRENT_DATE - INTERVAL '1 day' * (p_days - 1)
    GROUP BY slc.clicked_at::date
  ),
  country_stats AS (
    SELECT 
      slc.clicked_at::date as click_date,
      jsonb_object_agg(COALESCE(slc.country, 'Unknown'), count(*)) as countries
    FROM short_links sl
    INNER JOIN short_link_clicks slc ON sl.id = slc.short_link_id
    WHERE sl.short_code = p_short_code
      AND slc.clicked_at >= CURRENT_DATE - INTERVAL '1 day' * (p_days - 1)
      AND slc.country IS NOT NULL
    GROUP BY slc.clicked_at::date
  ),
  browser_stats AS (
    SELECT 
      slc.clicked_at::date as click_date,
      jsonb_object_agg(COALESCE(slc.browser, 'Unknown'), count(*)) as browsers
    FROM short_links sl
    INNER JOIN short_link_clicks slc ON sl.id = slc.short_link_id
    WHERE sl.short_code = p_short_code
      AND slc.clicked_at >= CURRENT_DATE - INTERVAL '1 day' * (p_days - 1)
      AND slc.browser IS NOT NULL
    GROUP BY slc.clicked_at::date
  ),
  referrer_stats AS (
    SELECT 
      slc.clicked_at::date as click_date,
      jsonb_object_agg(COALESCE(slc.referrer, 'Direct'), count(*)) as referrers
    FROM short_links sl
    INNER JOIN short_link_clicks slc ON sl.id = slc.short_link_id
    WHERE sl.short_code = p_short_code
      AND slc.clicked_at >= CURRENT_DATE - INTERVAL '1 day' * (p_days - 1)
    GROUP BY slc.clicked_at::date
  )
  SELECT 
    ds.date,
    COALESCE(dst.total_clicks, 0),
    COALESCE(dst.unique_visitors, 0),
    COALESCE(dst.mobile_clicks, 0),
    COALESCE(dst.desktop_clicks, 0),
    COALESCE(dst.tablet_clicks, 0),
    cs.countries,
    bs.browsers,
    rs.referrers
  FROM date_series ds
  LEFT JOIN daily_stats dst ON ds.date = dst.click_date
  LEFT JOIN country_stats cs ON ds.date = cs.click_date
  LEFT JOIN browser_stats bs ON ds.date = bs.click_date
  LEFT JOIN referrer_stats rs ON ds.date = rs.click_date
  ORDER BY ds.date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a function to get aggregated analytics for all links
CREATE OR REPLACE FUNCTION get_all_links_analytics(
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  short_code VARCHAR,
  link_type VARCHAR,
  destination_url TEXT,
  click_dates DATE[],
  click_counts BIGINT[],
  total_clicks BIGINT,
  unique_visitors BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - INTERVAL '1 day' * (p_days - 1),
      CURRENT_DATE,
      INTERVAL '1 day'
    )::DATE AS date
  ),
  link_daily_clicks AS (
    SELECT 
      sl.short_code,
      sl.link_type,
      sl.destination_url,
      slc.clicked_at::date as click_date,
      COUNT(*) as daily_clicks,
      COUNT(DISTINCT slc.ip_address) as daily_unique
    FROM short_links sl
    LEFT JOIN short_link_clicks slc ON sl.id = slc.short_link_id
    WHERE slc.clicked_at >= CURRENT_DATE - INTERVAL '1 day' * (p_days - 1)
    GROUP BY sl.short_code, sl.link_type, sl.destination_url, DATE(slc.clicked_at)
  ),
  aggregated AS (
    SELECT 
      sl.short_code,
      sl.link_type,
      sl.destination_url,
      array_agg(ds.date ORDER BY ds.date) as dates,
      array_agg(COALESCE(ldc.daily_clicks, 0) ORDER BY ds.date) as clicks,
      COALESCE(SUM(ldc.daily_clicks), 0) as total_clicks,
      COALESCE(SUM(ldc.daily_unique), 0) as unique_visitors
    FROM short_links sl
    CROSS JOIN date_series ds
    LEFT JOIN link_daily_clicks ldc ON 
      sl.short_code = ldc.short_code AND 
      ds.date = ldc.click_date
    GROUP BY sl.short_code, sl.link_type, sl.destination_url
  )
  SELECT * FROM aggregated
  WHERE total_clicks > 0
  ORDER BY total_clicks DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- End 20250114180000_add_click_demographics.sql


-- Begin 20250114181000_fix_ambiguous_column.sql
-- Fix ambiguous column reference in get_all_links_analytics function

CREATE OR REPLACE FUNCTION get_all_links_analytics(
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  short_code VARCHAR,
  link_type VARCHAR,
  destination_url TEXT,
  click_dates DATE[],
  click_counts BIGINT[],
  total_clicks BIGINT,
  unique_visitors BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - INTERVAL '1 day' * (p_days - 1),
      CURRENT_DATE,
      INTERVAL '1 day'
    )::DATE AS date
  ),
  link_daily_clicks AS (
    SELECT 
      sl.short_code,
      sl.link_type,
      sl.destination_url,
      slc.clicked_at::date as click_date,
      COUNT(*) as daily_clicks,
      COUNT(DISTINCT slc.ip_address) as daily_unique
    FROM short_links sl
    LEFT JOIN short_link_clicks slc ON sl.id = slc.short_link_id
    WHERE slc.clicked_at >= CURRENT_DATE - INTERVAL '1 day' * (p_days - 1)
    GROUP BY sl.short_code, sl.link_type, sl.destination_url, slc.clicked_at::date
  ),
  aggregated AS (
    SELECT 
      sl.short_code,
      sl.link_type,
      sl.destination_url,
      array_agg(ds.date ORDER BY ds.date) as dates,
      array_agg(COALESCE(ldc.daily_clicks, 0) ORDER BY ds.date) as clicks,
      COALESCE(SUM(ldc.daily_clicks), 0)::BIGINT as total_click_count,
      COALESCE(SUM(ldc.daily_unique), 0)::BIGINT as unique_visitor_count
    FROM short_links sl
    CROSS JOIN date_series ds
    LEFT JOIN link_daily_clicks ldc ON 
      sl.short_code = ldc.short_code AND 
      ds.date = ldc.click_date
    GROUP BY sl.short_code, sl.link_type, sl.destination_url
  )
  SELECT 
    aggregated.short_code,
    aggregated.link_type,
    aggregated.destination_url,
    aggregated.dates,
    aggregated.clicks,
    aggregated.total_click_count,
    aggregated.unique_visitor_count
  FROM aggregated
  WHERE aggregated.total_click_count > 0
  ORDER BY aggregated.total_click_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- End 20250114181000_fix_ambiguous_column.sql


-- Begin 20250114182000_fix_all_analytics_functions.sql
-- Fix all analytics functions to avoid nested aggregates and type mismatches

-- Drop the view first as it depends on the functions
DROP VIEW IF EXISTS short_link_daily_stats;

-- Fix get_short_link_analytics function
CREATE OR REPLACE FUNCTION get_short_link_analytics(
  p_short_code VARCHAR,
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  click_date DATE,
  total_clicks BIGINT,
  unique_visitors BIGINT,
  mobile_clicks BIGINT,
  desktop_clicks BIGINT,
  tablet_clicks BIGINT,
  top_countries JSONB,
  top_browsers JSONB,
  top_referrers JSONB
) AS $$
BEGIN
  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - INTERVAL '1 day' * (p_days - 1),
      CURRENT_DATE,
      INTERVAL '1 day'
    )::DATE AS date
  ),
  daily_stats AS (
    SELECT 
      slc.clicked_at::date as click_date,
      COUNT(*)::BIGINT as total_clicks,
      COUNT(DISTINCT slc.ip_address)::BIGINT as unique_visitors,
      COUNT(CASE WHEN slc.device_type = 'mobile' THEN 1 END)::BIGINT as mobile_clicks,
      COUNT(CASE WHEN slc.device_type = 'desktop' THEN 1 END)::BIGINT as desktop_clicks,
      COUNT(CASE WHEN slc.device_type = 'tablet' THEN 1 END)::BIGINT as tablet_clicks
    FROM short_links sl
    INNER JOIN short_link_clicks slc ON sl.id = slc.short_link_id
    WHERE sl.short_code = p_short_code
      AND slc.clicked_at >= CURRENT_DATE - INTERVAL '1 day' * (p_days - 1)
    GROUP BY slc.clicked_at::date
  ),
  country_stats AS (
    SELECT 
      slc.clicked_at::date as click_date,
      jsonb_object_agg(COALESCE(slc.country, 'Unknown'), count(*)) as countries
    FROM short_links sl
    INNER JOIN short_link_clicks slc ON sl.id = slc.short_link_id
    WHERE sl.short_code = p_short_code
      AND slc.clicked_at >= CURRENT_DATE - INTERVAL '1 day' * (p_days - 1)
      AND slc.country IS NOT NULL
    GROUP BY slc.clicked_at::date
  ),
  browser_stats AS (
    SELECT 
      slc.clicked_at::date as click_date,
      jsonb_object_agg(COALESCE(slc.browser, 'Unknown'), count(*)) as browsers
    FROM short_links sl
    INNER JOIN short_link_clicks slc ON sl.id = slc.short_link_id
    WHERE sl.short_code = p_short_code
      AND slc.clicked_at >= CURRENT_DATE - INTERVAL '1 day' * (p_days - 1)
      AND slc.browser IS NOT NULL
    GROUP BY slc.clicked_at::date
  ),
  referrer_stats AS (
    SELECT 
      slc.clicked_at::date as click_date,
      jsonb_object_agg(COALESCE(slc.referrer, 'Direct'), count(*)) as referrers
    FROM short_links sl
    INNER JOIN short_link_clicks slc ON sl.id = slc.short_link_id
    WHERE sl.short_code = p_short_code
      AND slc.clicked_at >= CURRENT_DATE - INTERVAL '1 day' * (p_days - 1)
    GROUP BY slc.clicked_at::date
  )
  SELECT 
    ds.date,
    COALESCE(dst.total_clicks, 0),
    COALESCE(dst.unique_visitors, 0),
    COALESCE(dst.mobile_clicks, 0),
    COALESCE(dst.desktop_clicks, 0),
    COALESCE(dst.tablet_clicks, 0),
    cs.countries,
    bs.browsers,
    rs.referrers
  FROM date_series ds
  LEFT JOIN daily_stats dst ON ds.date = dst.click_date
  LEFT JOIN country_stats cs ON ds.date = cs.click_date
  LEFT JOIN browser_stats bs ON ds.date = bs.click_date
  LEFT JOIN referrer_stats rs ON ds.date = rs.click_date
  ORDER BY ds.date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix get_all_links_analytics function with proper type casting
CREATE OR REPLACE FUNCTION get_all_links_analytics(
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  short_code VARCHAR,
  link_type VARCHAR,
  destination_url TEXT,
  click_dates DATE[],
  click_counts BIGINT[],
  total_clicks BIGINT,
  unique_visitors BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - INTERVAL '1 day' * (p_days - 1),
      CURRENT_DATE,
      INTERVAL '1 day'
    )::DATE AS date
  ),
  link_daily_clicks AS (
    SELECT 
      sl.short_code,
      sl.link_type,
      sl.destination_url,
      slc.clicked_at::date as click_date,
      COUNT(*)::BIGINT as daily_clicks,
      COUNT(DISTINCT slc.ip_address)::BIGINT as daily_unique
    FROM short_links sl
    LEFT JOIN short_link_clicks slc ON sl.id = slc.short_link_id
    WHERE slc.clicked_at >= CURRENT_DATE - INTERVAL '1 day' * (p_days - 1)
    GROUP BY sl.short_code, sl.link_type, sl.destination_url, slc.clicked_at::date
  ),
  aggregated AS (
    SELECT 
      sl.short_code,
      sl.link_type,
      sl.destination_url,
      array_agg(ds.date ORDER BY ds.date) as dates,
      array_agg(COALESCE(ldc.daily_clicks, 0)::BIGINT ORDER BY ds.date) as clicks,
      COALESCE(SUM(ldc.daily_clicks), 0)::BIGINT as total_click_count,
      COALESCE(SUM(ldc.daily_unique), 0)::BIGINT as unique_visitor_count
    FROM short_links sl
    CROSS JOIN date_series ds
    LEFT JOIN link_daily_clicks ldc ON 
      sl.short_code = ldc.short_code AND 
      ds.date = ldc.click_date
    GROUP BY sl.short_code, sl.link_type, sl.destination_url
  )
  SELECT 
    aggregated.short_code,
    aggregated.link_type,
    aggregated.destination_url,
    aggregated.dates,
    aggregated.clicks,
    aggregated.total_click_count,
    aggregated.unique_visitor_count
  FROM aggregated
  WHERE aggregated.total_click_count > 0
  ORDER BY aggregated.total_click_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the simplified view
CREATE VIEW short_link_daily_stats AS
SELECT 
  sl.id as short_link_id,
  sl.short_code,
  sl.link_type,
  slc.clicked_at::date as click_date,
  COUNT(*) as total_clicks,
  COUNT(DISTINCT slc.ip_address) as unique_visitors,
  COUNT(CASE WHEN slc.device_type = 'mobile' THEN 1 END) as mobile_clicks,
  COUNT(CASE WHEN slc.device_type = 'desktop' THEN 1 END) as desktop_clicks,
  COUNT(CASE WHEN slc.device_type = 'tablet' THEN 1 END) as tablet_clicks
FROM short_links sl
LEFT JOIN short_link_clicks slc ON sl.id = slc.short_link_id
WHERE slc.clicked_at IS NOT NULL
GROUP BY sl.id, sl.short_code, sl.link_type, slc.clicked_at::date;

-- Grant permissions on the view
GRANT SELECT ON short_link_daily_stats TO authenticated;
-- End 20250114182000_fix_all_analytics_functions.sql


-- Begin 20250114183000_drop_and_recreate_analytics_functions.sql
-- Drop and recreate analytics functions to ensure clean state

-- First, drop the functions completely
DROP FUNCTION IF EXISTS get_short_link_analytics(VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS get_all_links_analytics(INTEGER);

-- Now recreate get_short_link_analytics without any nested aggregates
CREATE FUNCTION get_short_link_analytics(
  p_short_code VARCHAR,
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  click_date DATE,
  total_clicks BIGINT,
  unique_visitors BIGINT,
  mobile_clicks BIGINT,
  desktop_clicks BIGINT,
  tablet_clicks BIGINT,
  top_countries JSONB,
  top_browsers JSONB,
  top_referrers JSONB
) AS $$
BEGIN
  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - INTERVAL '1 day' * (p_days - 1),
      CURRENT_DATE,
      INTERVAL '1 day'
    )::DATE AS date
  ),
  daily_stats AS (
    SELECT 
      slc.clicked_at::date as click_date,
      COUNT(*)::BIGINT as total_clicks,
      COUNT(DISTINCT slc.ip_address)::BIGINT as unique_visitors,
      COUNT(CASE WHEN slc.device_type = 'mobile' THEN 1 END)::BIGINT as mobile_clicks,
      COUNT(CASE WHEN slc.device_type = 'desktop' THEN 1 END)::BIGINT as desktop_clicks,
      COUNT(CASE WHEN slc.device_type = 'tablet' THEN 1 END)::BIGINT as tablet_clicks
    FROM short_links sl
    INNER JOIN short_link_clicks slc ON sl.id = slc.short_link_id
    WHERE sl.short_code = p_short_code
      AND slc.clicked_at >= CURRENT_DATE - INTERVAL '1 day' * (p_days - 1)
    GROUP BY slc.clicked_at::date
  )
  SELECT 
    ds.date,
    COALESCE(dst.total_clicks, 0),
    COALESCE(dst.unique_visitors, 0),
    COALESCE(dst.mobile_clicks, 0),
    COALESCE(dst.desktop_clicks, 0),
    COALESCE(dst.tablet_clicks, 0),
    NULL::JSONB,  -- Temporarily return NULL for countries
    NULL::JSONB,  -- Temporarily return NULL for browsers
    NULL::JSONB   -- Temporarily return NULL for referrers
  FROM date_series ds
  LEFT JOIN daily_stats dst ON ds.date = dst.click_date
  ORDER BY ds.date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate get_all_links_analytics with proper types
CREATE FUNCTION get_all_links_analytics(
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  short_code VARCHAR,
  link_type VARCHAR,
  destination_url TEXT,
  click_dates DATE[],
  click_counts BIGINT[],
  total_clicks BIGINT,
  unique_visitors BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - INTERVAL '1 day' * (p_days - 1),
      CURRENT_DATE,
      INTERVAL '1 day'
    )::DATE AS date
  ),
  link_daily_clicks AS (
    SELECT 
      sl.short_code,
      sl.link_type,
      sl.destination_url,
      slc.clicked_at::date as click_date,
      COUNT(*)::BIGINT as daily_clicks,
      COUNT(DISTINCT slc.ip_address)::BIGINT as daily_unique
    FROM short_links sl
    LEFT JOIN short_link_clicks slc ON sl.id = slc.short_link_id
    WHERE slc.clicked_at >= CURRENT_DATE - INTERVAL '1 day' * (p_days - 1)
    GROUP BY sl.short_code, sl.link_type, sl.destination_url, slc.clicked_at::date
  ),
  aggregated AS (
    SELECT 
      sl.short_code,
      sl.link_type,
      sl.destination_url,
      array_agg(ds.date ORDER BY ds.date) as dates,
      array_agg(COALESCE(ldc.daily_clicks, 0)::BIGINT ORDER BY ds.date) as clicks,
      COALESCE(SUM(ldc.daily_clicks), 0)::BIGINT as total_click_count,
      COALESCE(SUM(ldc.daily_unique), 0)::BIGINT as unique_visitor_count
    FROM short_links sl
    CROSS JOIN date_series ds
    LEFT JOIN link_daily_clicks ldc ON 
      sl.short_code = ldc.short_code AND 
      ds.date = ldc.click_date
    GROUP BY sl.short_code, sl.link_type, sl.destination_url
  )
  SELECT 
    aggregated.short_code,
    aggregated.link_type,
    aggregated.destination_url,
    aggregated.dates,
    aggregated.clicks,
    aggregated.total_click_count,
    aggregated.unique_visitor_count
  FROM aggregated
  WHERE aggregated.total_click_count > 0
  ORDER BY aggregated.total_click_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- End 20250114183000_drop_and_recreate_analytics_functions.sql


-- Begin 20250119210000_create_sunday_lunch_menu.sql
-- Create sunday_lunch_menu_items table
CREATE TABLE IF NOT EXISTS sunday_lunch_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  category VARCHAR(50) NOT NULL CHECK (category IN ('main', 'side', 'dessert', 'extra')),
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  allergens TEXT[] DEFAULT '{}',
  dietary_info TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_sunday_lunch_menu_items_category ON sunday_lunch_menu_items(category);
CREATE INDEX IF NOT EXISTS idx_sunday_lunch_menu_items_display_order ON sunday_lunch_menu_items(display_order);
CREATE INDEX IF NOT EXISTS idx_sunday_lunch_menu_items_is_active ON sunday_lunch_menu_items(is_active);

-- Enable RLS
ALTER TABLE sunday_lunch_menu_items ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Public can view active menu items" ON sunday_lunch_menu_items;
DROP POLICY IF EXISTS "Staff can view all menu items" ON sunday_lunch_menu_items;
DROP POLICY IF EXISTS "Managers can manage menu items" ON sunday_lunch_menu_items;

-- Create RLS policies
-- Public can view active menu items
CREATE POLICY "Public can view active menu items" ON sunday_lunch_menu_items
  FOR SELECT
  USING (is_active = true);

-- Staff can view all menu items
CREATE POLICY "Staff can view all menu items" ON sunday_lunch_menu_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

-- Managers can manage menu items
CREATE POLICY "Managers can manage menu items" ON sunday_lunch_menu_items
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

-- Create updated_at trigger
DROP TRIGGER IF EXISTS update_sunday_lunch_menu_items_updated_at ON sunday_lunch_menu_items;
CREATE TRIGGER update_sunday_lunch_menu_items_updated_at
  BEFORE UPDATE ON sunday_lunch_menu_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Insert default menu items
INSERT INTO sunday_lunch_menu_items (name, description, price, category, display_order, allergens, dietary_info) VALUES
  ('Roasted Chicken', 'Oven-roasted chicken breast with sage & onion stuffing balls, herb and garlic-crusted roast potatoes, seasonal vegetables, Yorkshire pudding, and red wine gravy', 14.99, 'main', 1, ARRAY['Gluten'], ARRAY[]::text[]),
  ('Slow-Cooked Lamb Shank', 'Tender slow-braised lamb shank in rich red wine gravy, served with herb and garlic-crusted roast potatoes, seasonal vegetables, and a Yorkshire pudding', 15.49, 'main', 2, ARRAY[]::text[], ARRAY[]::text[]),
  ('Crispy Pork Belly', 'Crispy crackling and tender slow-roasted pork belly with Bramley apple sauce, herb and garlic-crusted roast potatoes, seasonal vegetables, Yorkshire pudding, and red wine gravy', 15.99, 'main', 3, ARRAY[]::text[], ARRAY[]::text[]),
  ('Beetroot & Butternut Squash Wellington', 'Golden puff pastry filled with beetroot & butternut squash, served with herb and garlic-crusted roast potatoes, seasonal vegetables, and vegetarian gravy', 15.49, 'main', 4, ARRAY['Gluten'], ARRAY['Vegan']),
  ('Kids Roasted Chicken', 'A smaller portion of our roasted chicken with herb and garlic-crusted roast potatoes, seasonal vegetables, Yorkshire pudding, and red wine gravy', 9.99, 'main', 5, ARRAY['Gluten'], ARRAY[]::text[]),
  ('Herb & Garlic Roast Potatoes', 'Crispy roast potatoes with herbs and garlic', 0, 'side', 1, ARRAY[]::text[], ARRAY['Vegan', 'Gluten-free']),
  ('Yorkshire Pudding', 'Traditional Yorkshire pudding', 0, 'side', 2, ARRAY['Gluten', 'Eggs', 'Milk'], ARRAY['Vegetarian']),
  ('Seasonal Vegetables', 'Selection of fresh seasonal vegetables', 0, 'side', 3, ARRAY[]::text[], ARRAY['Vegan', 'Gluten-free']),
  ('Cauliflower Cheese', 'Creamy mature cheddar sauce, baked until golden and bubbling', 3.99, 'extra', 4, ARRAY['Milk'], ARRAY['Vegetarian', 'Gluten-free'])
ON CONFLICT DO NOTHING;
-- End 20250119210000_create_sunday_lunch_menu.sql


-- Begin 20250122000000_allow_overnight_private_bookings.sql
-- Allow private bookings to extend past midnight by tracking whether the end time is on the next day

ALTER TABLE public.private_bookings
ADD COLUMN IF NOT EXISTS end_time_next_day boolean DEFAULT false;

ALTER TABLE public.private_bookings
DROP CONSTRAINT IF EXISTS chk_booking_times;

ALTER TABLE public.private_bookings
ADD CONSTRAINT chk_booking_times CHECK (
  end_time IS NULL
  OR end_time > start_time
  OR end_time_next_day = true
);

DROP VIEW IF EXISTS public.private_bookings_with_details;

CREATE VIEW public.private_bookings_with_details AS
 SELECT
  pb.id,
  pb.customer_id,
  pb.customer_name,
  pb.contact_phone,
  pb.contact_email,
  pb.event_date,
  pb.start_time,
  pb.setup_time,
  pb.end_time,
  pb.end_time_next_day,
  pb.guest_count,
  pb.event_type,
  pb.status,
  pb.deposit_amount,
  pb.deposit_paid_date,
  pb.deposit_payment_method,
  pb.total_amount,
  pb.balance_due_date,
  pb.final_payment_date,
  pb.final_payment_method,
  pb.calendar_event_id,
  pb.contract_version,
  pb.internal_notes,
  pb.customer_requests,
  pb.created_by,
  pb.created_at,
  pb.updated_at,
  pb.setup_date,
  pb.discount_type,
  pb.discount_amount,
  pb.discount_reason,
  pb.customer_first_name,
  pb.customer_last_name,
  pb.customer_full_name,
  c.mobile_number AS customer_mobile,
  (
    SELECT COALESCE(sum(pbi.line_total), (0)::numeric)
    FROM public.private_booking_items pbi
    WHERE pbi.booking_id = pb.id
  ) AS calculated_total,
  CASE
    WHEN pb.deposit_paid_date IS NOT NULL THEN 'Paid'::text
    WHEN pb.status = 'confirmed'::text THEN 'Required'::text
    ELSE 'Not Required'::text
  END AS deposit_status,
  (pb.event_date - CURRENT_DATE) AS days_until_event
 FROM public.private_bookings pb
 LEFT JOIN public.customers c ON pb.customer_id = c.id;
-- End 20250122000000_allow_overnight_private_bookings.sql


-- Begin 20250126000001_add_kitchen_closed_to_special_hours.sql
-- Add is_kitchen_closed column to special_hours table
-- This allows venues to indicate the kitchen is closed while the venue remains open

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'special_hours' AND column_name = 'is_kitchen_closed'
  ) THEN
    ALTER TABLE special_hours ADD COLUMN is_kitchen_closed BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Add comment for clarity
COMMENT ON COLUMN special_hours.is_kitchen_closed IS 'Indicates if the kitchen is closed while the venue remains open';
-- End 20250126000001_add_kitchen_closed_to_special_hours.sql


-- Begin 20250127000001_remove_advance_booking_constraint.sql
-- Remove 2-hour advance booking constraint by setting minimum advance hours to 0

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'booking_policies'
  ) THEN
    -- Update existing policies to allow immediate bookings
    UPDATE booking_policies
    SET min_advance_hours = 0
    WHERE min_advance_hours > 0;

    -- Add comment for clarity
    COMMENT ON COLUMN booking_policies.min_advance_hours IS 'Minimum hours in advance a booking must be made (0 = immediate bookings allowed)';
  END IF;
END $$;
-- End 20250127000001_remove_advance_booking_constraint.sql


-- Begin 20250129120000_add_increment_short_link_clicks.sql
-- Ensure click counters are updated atomically when tracking short link hits
create or replace function public.increment_short_link_clicks(
  p_short_link_id uuid
)
returns table(click_count integer, last_clicked_at timestamptz) as $$
begin
  return query
    update public.short_links
    set
      click_count = coalesce(click_count, 0) + 1,
      last_clicked_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
    where id = p_short_link_id
    returning click_count, last_clicked_at;
end;
$$ language plpgsql
security definer;

grant execute on function public.increment_short_link_clicks(uuid) to service_role;
-- End 20250129120000_add_increment_short_link_clicks.sql


-- Begin 20250212100000_add_event_checklist_statuses.sql
-- Create table to track per-event checklist task completion
CREATE TABLE IF NOT EXISTS event_checklist_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  task_key TEXT NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (event_id, task_key)
);

ALTER TABLE event_checklist_statuses ENABLE ROW LEVEL SECURITY;

-- Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION event_checklist_statuses_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS event_checklist_statuses_set_updated_at_trigger ON event_checklist_statuses;
CREATE TRIGGER event_checklist_statuses_set_updated_at_trigger
  BEFORE UPDATE ON event_checklist_statuses
  FOR EACH ROW
  EXECUTE FUNCTION event_checklist_statuses_set_updated_at();

-- Policies: view for events:view, modify for events:manage
CREATE POLICY "event_checklist_view"
ON event_checklist_statuses
FOR SELECT
USING (
  public.user_has_permission(auth.uid(), 'events', 'view')
);

CREATE POLICY "event_checklist_insert"
ON event_checklist_statuses
FOR INSERT
WITH CHECK (
  public.user_has_permission(auth.uid(), 'events', 'manage')
);

CREATE POLICY "event_checklist_update"
ON event_checklist_statuses
FOR UPDATE
USING (
  public.user_has_permission(auth.uid(), 'events', 'manage')
)
WITH CHECK (
  public.user_has_permission(auth.uid(), 'events', 'manage')
);

CREATE POLICY "event_checklist_delete"
ON event_checklist_statuses
FOR DELETE
USING (
  public.user_has_permission(auth.uid(), 'events', 'manage')
);

CREATE INDEX IF NOT EXISTS event_checklist_statuses_event_id_idx
  ON event_checklist_statuses (event_id);

CREATE INDEX IF NOT EXISTS event_checklist_statuses_task_key_idx
  ON event_checklist_statuses (task_key);
-- End 20250212100000_add_event_checklist_statuses.sql








-- Begin 20250714144905_add_pending_bookings.sql
-- Description: Add pending_bookings table for API-initiated booking confirmations

-- Create pending_bookings table
CREATE TABLE IF NOT EXISTS pending_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token UUID NOT NULL UNIQUE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  mobile_number VARCHAR(20) NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  seats INTEGER,
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  initiated_by_api_key UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_pending_bookings_token ON pending_bookings(token);
CREATE INDEX IF NOT EXISTS idx_pending_bookings_expires_at ON pending_bookings(expires_at);
CREATE INDEX IF NOT EXISTS idx_pending_bookings_event_id ON pending_bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_pending_bookings_mobile_number ON pending_bookings(mobile_number);

-- Enable RLS
ALTER TABLE pending_bookings ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Service role can manage pending bookings" ON pending_bookings
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Create updated_at trigger
CREATE TRIGGER pending_bookings_updated_at
  BEFORE UPDATE ON pending_bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
-- End 20250714144905_add_pending_bookings.sql


-- Begin 20250714152207_remove_unused_event_columns.sql
-- Description: Remove unused columns from events table (description, image_urls, is_recurring, recurrence_rule, parent_event_id, price_currency) and menu_items table (price_currency)

-- Drop columns from events table that are not being used
ALTER TABLE events 
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS image_urls,
  DROP COLUMN IF EXISTS is_recurring,
  DROP COLUMN IF EXISTS recurrence_rule,
  DROP COLUMN IF EXISTS parent_event_id,
  DROP COLUMN IF EXISTS price_currency;

-- Also drop the foreign key constraint for parent_event_id if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'events' 
    AND constraint_name = 'events_parent_event_id_fkey'
  ) THEN
    ALTER TABLE events DROP CONSTRAINT events_parent_event_id_fkey;
  END IF;
END $$;

-- Drop price_currency from menu_items table (all prices are in GBP)
ALTER TABLE menu_items 
  DROP COLUMN IF EXISTS price_currency;
-- End 20250714152207_remove_unused_event_columns.sql


-- Begin 20250714170000_add_booking_confirmation_link_type.sql
-- Description: Add booking_confirmation as a valid link type for short links

-- Drop the existing constraint
ALTER TABLE short_links 
DROP CONSTRAINT IF EXISTS short_links_link_type_check;

-- Add the new constraint with booking_confirmation included
ALTER TABLE short_links 
ADD CONSTRAINT short_links_link_type_check 
CHECK (link_type IN ('loyalty_portal', 'event_checkin', 'promotion', 'reward_redemption', 'custom', 'booking_confirmation'));

-- Update any existing custom links that have booking_confirmation metadata
UPDATE short_links 
SET link_type = 'booking_confirmation' 
WHERE link_type = 'custom' 
  AND metadata->>'type' = 'booking_confirmation';
-- End 20250714170000_add_booking_confirmation_link_type.sql


-- Begin 20250714210000_fix_pending_bookings_rls.sql
-- Description: Add RLS policy to allow public access to pending bookings by token

-- Add policy to allow anyone to read pending bookings by token
-- This is needed for the booking confirmation page which runs in the browser
CREATE POLICY "Anyone can read pending bookings by token" ON pending_bookings
  FOR SELECT
  USING (true); -- Allow reading any pending booking - security is through the unique token

-- Also allow anonymous users to read related events and customers through the foreign keys
CREATE POLICY "Anyone can read events for pending bookings" ON events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pending_bookings
      WHERE pending_bookings.event_id = events.id
    )
  );

-- Note: Customers already have a policy that allows reading by anyone, so no additional policy needed
-- End 20250714210000_fix_pending_bookings_rls.sql


-- Begin 20250714215000_fix_booking_confirmation_rls_properly.sql
-- Description: Fix RLS policies to allow anonymous access for booking confirmation flow

-- Drop the previous incomplete policy if it exists
DROP POLICY IF EXISTS "Anyone can read events for pending bookings" ON events;

-- Allow anonymous users to read events that have pending bookings
-- This is more specific and should work alongside existing policies
CREATE POLICY "Public can read events with pending bookings" ON events
  FOR SELECT
  TO anon  -- Specifically for anonymous users
  USING (
    id IN (
      SELECT event_id FROM pending_bookings
      WHERE expires_at > NOW()  -- Only non-expired bookings
    )
  );

-- Allow anonymous users to read customers that have pending bookings
CREATE POLICY "Public can read customers with pending bookings" ON customers
  FOR SELECT
  TO anon  -- Specifically for anonymous users
  USING (
    id IN (
      SELECT customer_id FROM pending_bookings
      WHERE customer_id IS NOT NULL
        AND expires_at > NOW()  -- Only non-expired bookings
    )
  );

-- Also ensure the pending_bookings policy is specifically for anon role
DROP POLICY IF EXISTS "Anyone can read pending bookings by token" ON pending_bookings;

CREATE POLICY "Public can read pending bookings" ON pending_bookings
  FOR SELECT
  TO anon  -- Specifically for anonymous users
  USING (expires_at > NOW());  -- Only allow reading non-expired bookings
-- End 20250714215000_fix_booking_confirmation_rls_properly.sql


-- Begin 20250714220000_fix_booking_confirmation_anon_access.sql
-- Description: Fix anonymous access for booking confirmation - comprehensive approach

-- First, let's check and clean up existing policies
DO $$
BEGIN
  -- Drop all existing policies we've created for this
  DROP POLICY IF EXISTS "Anyone can read pending bookings by token" ON pending_bookings;
  DROP POLICY IF EXISTS "Public can read pending bookings" ON pending_bookings;
  DROP POLICY IF EXISTS "Anyone can read events for pending bookings" ON events;
  DROP POLICY IF EXISTS "Public can read events with pending bookings" ON events;
  DROP POLICY IF EXISTS "Public can read customers with pending bookings" ON customers;
END $$;

-- PENDING BOOKINGS - Allow anon to read
CREATE POLICY "anon_read_pending_bookings" ON pending_bookings
  FOR SELECT
  TO anon
  USING (true);  -- Allow all reads - security is through unique token

-- EVENTS - Create a simple policy for anon to read events referenced by pending bookings
-- First check if any anon policies exist for events
DO $$
BEGIN
  -- Create policy only if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'events' 
    AND policyname = 'anon_read_events_for_bookings'
  ) THEN
    EXECUTE 'CREATE POLICY anon_read_events_for_bookings ON events
      FOR SELECT
      TO anon
      USING (
        id IN (SELECT event_id FROM pending_bookings)
      )';
  END IF;
END $$;

-- CUSTOMERS - Create a simple policy for anon to read customers referenced by pending bookings
DO $$
BEGIN
  -- Create policy only if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'customers' 
    AND policyname = 'anon_read_customers_for_bookings'
  ) THEN
    EXECUTE 'CREATE POLICY anon_read_customers_for_bookings ON customers
      FOR SELECT
      TO anon
      USING (
        id IN (SELECT customer_id FROM pending_bookings WHERE customer_id IS NOT NULL)
      )';
  END IF;
END $$;

-- Grant explicit permissions to anon role on these tables
-- This ensures the anon role can actually SELECT from these tables
GRANT SELECT ON pending_bookings TO anon;
GRANT SELECT ON events TO anon;
GRANT SELECT ON customers TO anon;

-- Verify RLS is enabled (it should be, but let's make sure)
ALTER TABLE pending_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
-- End 20250714220000_fix_booking_confirmation_anon_access.sql


-- Begin 20250715061200_add_metadata_to_pending_bookings.sql
-- Add metadata column to pending_bookings table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pending_bookings' 
    AND column_name = 'metadata'
  ) THEN
    ALTER TABLE pending_bookings ADD COLUMN metadata JSONB;
  END IF;
END $$;
-- End 20250715061200_add_metadata_to_pending_bookings.sql


-- Begin 20250719140000_add_table_bookings_system.sql
-- Description: Add table booking system for restaurant dining reservations
-- 
-- COMPATIBILITY NOTES:
-- 1. This migration is designed to work with or without existing menu_items table
-- 2. RLS policies will use user_has_permission if available, otherwise permissive policies
-- 3. Triggers will only be created if update_updated_at_column function exists
-- 4. RBAC permissions will only be inserted if rbac_permissions table exists
-- 5. Menu sections insert is commented out - uncomment if you have menu_sections table
-- 
-- After running this migration:
-- - Review and tighten the permissive RLS policies based on your auth setup
-- - Configure time slot capacities in booking_time_slots table
-- - Add table configurations in table_configuration
-- - Set up booking policies in booking_policies

-- Create enum types
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'table_booking_type') THEN
    CREATE TYPE table_booking_type AS ENUM ('regular', 'sunday_lunch');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'table_booking_status') THEN
    CREATE TYPE table_booking_status AS ENUM ('pending_payment', 'confirmed', 'cancelled', 'no_show', 'completed');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
    CREATE TYPE payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded', 'partial_refund');
  END IF;
END $$;

-- Table configuration for managing restaurant tables
CREATE TABLE IF NOT EXISTS table_configuration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number VARCHAR(10) NOT NULL UNIQUE,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Booking time slots configuration
CREATE TABLE IF NOT EXISTS booking_time_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  slot_time TIME NOT NULL,
  duration_minutes INTEGER DEFAULT 120,
  max_covers INTEGER NOT NULL,
  booking_type table_booking_type DEFAULT NULL, -- NULL means available for both types
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(day_of_week, slot_time, booking_type)
);

-- Main table bookings table
CREATE TABLE IF NOT EXISTS table_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_reference VARCHAR(20) UNIQUE NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT,
  booking_date DATE NOT NULL,
  booking_time TIME NOT NULL,
  party_size INTEGER NOT NULL CHECK (party_size > 0),
  tables_assigned JSONB,
  booking_type table_booking_type NOT NULL,
  status table_booking_status NOT NULL DEFAULT 'pending_payment',
  duration_minutes INTEGER DEFAULT 120,
  special_requirements TEXT,
  dietary_requirements TEXT[],
  allergies TEXT[],
  celebration_type VARCHAR(50),
  internal_notes TEXT,
  source VARCHAR(20) DEFAULT 'website', -- website, phone, walk-in
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  completed_at TIMESTAMPTZ,
  no_show_at TIMESTAMPTZ
);

-- Sunday lunch menu selections
CREATE TABLE IF NOT EXISTS table_booking_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES table_bookings(id) ON DELETE CASCADE,
  menu_item_id UUID, -- References menu_items if available, otherwise use custom_item_name
  custom_item_name VARCHAR(255), -- For items not in menu_items or if menu system not available
  item_type VARCHAR(20) DEFAULT 'main' CHECK (item_type IN ('main', 'side', 'extra')),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  special_requests TEXT,
  price_at_booking DECIMAL(10,2) NOT NULL,
  guest_name VARCHAR(100), -- Which guest ordered this
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Ensure either menu_item_id or custom_item_name is provided
  CONSTRAINT item_name_required CHECK (menu_item_id IS NOT NULL OR custom_item_name IS NOT NULL)
);

-- Payment tracking for bookings
CREATE TABLE IF NOT EXISTS table_booking_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES table_bookings(id) ON DELETE CASCADE,
  payment_method VARCHAR(20) NOT NULL DEFAULT 'paypal',
  transaction_id VARCHAR(255) UNIQUE,
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'GBP',
  status payment_status NOT NULL DEFAULT 'pending',
  refund_amount DECIMAL(10,2),
  refund_transaction_id VARCHAR(255),
  payment_metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_table_bookings_customer_id ON table_bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_table_bookings_booking_date ON table_bookings(booking_date);
CREATE INDEX IF NOT EXISTS idx_table_bookings_status ON table_bookings(status);
CREATE INDEX IF NOT EXISTS idx_table_bookings_booking_type ON table_bookings(booking_type);
CREATE INDEX IF NOT EXISTS idx_table_bookings_date_time ON table_bookings(booking_date, booking_time);
CREATE INDEX IF NOT EXISTS idx_table_booking_items_booking_id ON table_booking_items(booking_id);
CREATE INDEX IF NOT EXISTS idx_table_booking_payments_booking_id ON table_booking_payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_table_booking_payments_transaction_id ON table_booking_payments(transaction_id);

-- Begin 20250127170000_add_table_booking_reminder_tracking.sql
-- Add reminder tracking to table bookings
-- This migration adds the missing reminder_sent column and creates a proper tracking system

-- Add reminder_sent column to table_bookings
ALTER TABLE table_bookings 
ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE;

-- Create index for efficient querying of bookings needing reminders
CREATE INDEX IF NOT EXISTS idx_table_bookings_reminder_status 
ON table_bookings (status, reminder_sent, booking_date) 
WHERE status = 'confirmed' AND reminder_sent = FALSE;

-- Create table to track reminder history (for better tracking)
CREATE TABLE IF NOT EXISTS table_booking_reminder_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES table_bookings(id) ON DELETE CASCADE,
    reminder_type VARCHAR(50) NOT NULL, -- 'sms', 'email', 'both'
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(20) NOT NULL, -- 'sent', 'failed'
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for reminder history
CREATE INDEX IF NOT EXISTS idx_reminder_history_booking_id 
ON table_booking_reminder_history (booking_id);

-- Add RLS policies
ALTER TABLE table_booking_reminder_history ENABLE ROW LEVEL SECURITY;

-- Staff can view reminder history
CREATE POLICY "Staff can view reminder history" ON table_booking_reminder_history
    FOR SELECT USING (
        EXISTS (
            SELECT 1 
            FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid()
            AND r.name IN ('super_admin', 'manager', 'staff')
        )
    );

-- System can insert reminder history
CREATE POLICY "System can insert reminder history" ON table_booking_reminder_history
    FOR INSERT WITH CHECK (true);

-- Add comment to explain the column
COMMENT ON COLUMN table_bookings.reminder_sent IS 'Whether a reminder has been sent for this booking';
COMMENT ON TABLE table_booking_reminder_history IS 'History of reminders sent for table bookings';

-- Update any existing confirmed bookings that are in the past to have reminder_sent = true
-- This prevents sending reminders for old bookings
UPDATE table_bookings 
SET reminder_sent = TRUE 
WHERE status = 'confirmed' 
AND booking_date < CURRENT_DATE
AND reminder_sent IS NULL;
-- End 20250127170000_add_table_booking_reminder_tracking.sql

-- Add columns to customers table for booking analytics
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'table_booking_count'
  ) THEN
    ALTER TABLE customers ADD COLUMN table_booking_count INTEGER DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'no_show_count'
  ) THEN
    ALTER TABLE customers ADD COLUMN no_show_count INTEGER DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'last_table_booking_date'
  ) THEN
    ALTER TABLE customers ADD COLUMN last_table_booking_date DATE;
  END IF;
END $$;

-- Create updated_at triggers
-- Create trigger only if function exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    CREATE TRIGGER table_configuration_updated_at
      BEFORE UPDATE ON table_configuration
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Create triggers only if function exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    CREATE TRIGGER booking_time_slots_updated_at
      BEFORE UPDATE ON booking_time_slots
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
      
    CREATE TRIGGER table_bookings_updated_at
      BEFORE UPDATE ON table_bookings
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
      
    CREATE TRIGGER table_booking_items_updated_at
      BEFORE UPDATE ON table_booking_items
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
      
    CREATE TRIGGER table_booking_payments_updated_at
      BEFORE UPDATE ON table_booking_payments
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Enable Row Level Security
ALTER TABLE table_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_booking_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_booking_payments ENABLE ROW LEVEL SECURITY;

-- Check if user_has_permission function exists before creating policies
DO $$
DECLARE
  has_permission_func BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'user_has_permission'
  ) INTO has_permission_func;
  
  IF NOT has_permission_func THEN
    RAISE NOTICE 'user_has_permission function not found. RLS policies will not be created.';
    RAISE NOTICE 'You may need to create these policies manually or ensure the RBAC system is installed.';
  END IF;
END $$;

-- RLS Policies for table_configuration (staff only)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_has_permission') THEN
    CREATE POLICY "Staff can view table configuration" ON table_configuration
      FOR SELECT USING (
        user_has_permission(auth.uid(), 'table_bookings', 'view')
      );

    CREATE POLICY "Managers can manage table configuration" ON table_configuration
      FOR ALL USING (
        user_has_permission(auth.uid(), 'table_bookings', 'manage')
      );
  ELSE
    -- Create basic policies that allow all authenticated users (adjust as needed)
    CREATE POLICY "Allow authenticated read" ON table_configuration
      FOR SELECT USING (true); -- Allow public read for availability checking
  END IF;
END $$;

-- RLS Policies for booking_time_slots (public read, staff write)
CREATE POLICY "Anyone can view booking time slots" ON booking_time_slots
  FOR SELECT USING (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_has_permission') THEN
    CREATE POLICY "Managers can manage booking time slots" ON booking_time_slots
      FOR ALL USING (
        user_has_permission(auth.uid(), 'table_bookings', 'manage')
      );
  END IF;
END $$;

-- RLS Policies for table_bookings
-- Note: Customers don't have auth accounts, only staff can view bookings
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_has_permission') THEN
    CREATE POLICY "Staff can view all bookings" ON table_bookings
      FOR SELECT USING (
        user_has_permission(auth.uid(), 'table_bookings', 'view')
      );

    CREATE POLICY "Staff can create bookings" ON table_bookings
      FOR INSERT WITH CHECK (
        user_has_permission(auth.uid(), 'table_bookings', 'create')
      );

    CREATE POLICY "Staff can update bookings" ON table_bookings
      FOR UPDATE USING (
        user_has_permission(auth.uid(), 'table_bookings', 'edit')
      );

    CREATE POLICY "Managers can delete bookings" ON table_bookings
      FOR DELETE USING (
        user_has_permission(auth.uid(), 'table_bookings', 'manage')
      );
  ELSE
    -- Create basic policy for authenticated users
    CREATE POLICY "Allow authenticated access" ON table_bookings
      FOR ALL USING (true); -- Temporary permissive policy - tighten based on your auth setup
  END IF;
END $$;

-- RLS Policies for table_booking_items
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_has_permission') THEN
    CREATE POLICY "Staff can manage booking items" ON table_booking_items
      FOR ALL USING (
        user_has_permission(auth.uid(), 'table_bookings', 'view')
      );
  ELSE
    CREATE POLICY "Allow authenticated access" ON table_booking_items
      FOR ALL USING (true); -- Temporary permissive policy
  END IF;
END $$;

-- RLS Policies for table_booking_payments
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_has_permission') THEN
    CREATE POLICY "Staff can view payment info" ON table_booking_payments
      FOR SELECT USING (
        user_has_permission(auth.uid(), 'table_bookings', 'view')
      );

    CREATE POLICY "System can manage payments" ON table_booking_payments
      FOR ALL USING (
        user_has_permission(auth.uid(), 'table_bookings', 'manage')
      );
  ELSE
    CREATE POLICY "Allow authenticated access" ON table_booking_payments
      FOR ALL USING (true); -- Temporary permissive policy
  END IF;
END $$;

-- Function to check table availability
CREATE OR REPLACE FUNCTION check_table_availability(
  p_date DATE,
  p_time TIME,
  p_party_size INTEGER,
  p_duration_minutes INTEGER DEFAULT 120,
  p_exclude_booking_id UUID DEFAULT NULL
)
RETURNS TABLE (
  available_capacity INTEGER,
  tables_available INTEGER[],
  is_available BOOLEAN
) AS $$
DECLARE
  v_day_of_week INTEGER;
  v_total_capacity INTEGER;
  v_booked_capacity INTEGER;
  v_available_capacity INTEGER;
BEGIN
  -- Get day of week (0 = Sunday)
  v_day_of_week := EXTRACT(DOW FROM p_date);
  
  -- Get total capacity from active tables
  SELECT COALESCE(SUM(capacity), 0) INTO v_total_capacity
  FROM table_configuration
  WHERE is_active = true;
  
  -- Get booked capacity for the time slot
  SELECT COALESCE(SUM(party_size), 0) INTO v_booked_capacity
  FROM table_bookings
  WHERE booking_date = p_date
    AND status IN ('confirmed', 'pending_payment')
    AND (p_exclude_booking_id IS NULL OR id != p_exclude_booking_id)
    AND (
      -- Check for time overlap
      (booking_time <= p_time AND (booking_time + (duration_minutes || ' minutes')::INTERVAL) > p_time)
      OR
      (p_time <= booking_time AND (p_time + (p_duration_minutes || ' minutes')::INTERVAL) > booking_time)
    );
  
  v_available_capacity := v_total_capacity - v_booked_capacity;
  
  RETURN QUERY
  SELECT 
    v_available_capacity,
    ARRAY[]::INTEGER[], -- Simplified for now, can be enhanced later
    v_available_capacity >= p_party_size;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to generate booking reference
CREATE OR REPLACE FUNCTION generate_booking_reference()
RETURNS VARCHAR(20) AS $$
DECLARE
  v_reference VARCHAR(20);
  v_exists BOOLEAN;
BEGIN
  LOOP
    -- Generate reference like TB-2024-XXXX
    v_reference := 'TB-' || TO_CHAR(NOW(), 'YYYY') || '-' || 
                   LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
    
    -- Check if reference already exists
    SELECT EXISTS(SELECT 1 FROM table_bookings WHERE booking_reference = v_reference) INTO v_exists;
    
    EXIT WHEN NOT v_exists;
  END LOOP;
  
  RETURN v_reference;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate booking reference
CREATE OR REPLACE FUNCTION set_booking_reference()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.booking_reference IS NULL THEN
    NEW.booking_reference := generate_booking_reference();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER table_bookings_set_reference
  BEFORE INSERT ON table_bookings
  FOR EACH ROW
  EXECUTE FUNCTION set_booking_reference();

-- Function to update customer booking stats
CREATE OR REPLACE FUNCTION update_customer_booking_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'confirmed' THEN
    UPDATE customers
    SET table_booking_count = table_booking_count + 1,
        last_table_booking_date = NEW.booking_date
    WHERE id = NEW.customer_id;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Handle no-show
    IF OLD.status != 'no_show' AND NEW.status = 'no_show' THEN
      UPDATE customers
      SET no_show_count = no_show_count + 1
      WHERE id = NEW.customer_id;
    END IF;
    
    -- Handle new confirmation
    IF OLD.status != 'confirmed' AND NEW.status = 'confirmed' THEN
      UPDATE customers
      SET table_booking_count = table_booking_count + 1,
          last_table_booking_date = NEW.booking_date
      WHERE id = NEW.customer_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_customer_stats_on_booking
  AFTER INSERT OR UPDATE ON table_bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_booking_stats();

-- Insert default time slots for Sunday lunch
-- Note: These are default capacity limits per time slot
-- Actual availability is determined by kitchen hours in business_hours table
INSERT INTO booking_time_slots (day_of_week, slot_time, max_covers, booking_type)
VALUES 
  (0, '12:00:00', 40, 'sunday_lunch'),
  (0, '12:30:00', 40, 'sunday_lunch'),
  (0, '13:00:00', 60, 'sunday_lunch'),
  (0, '13:30:00', 60, 'sunday_lunch'),
  (0, '14:00:00', 40, 'sunday_lunch'),
  (0, '14:30:00', 40, 'sunday_lunch'),
  (0, '15:00:00', 30, 'sunday_lunch')
ON CONFLICT (day_of_week, slot_time, booking_type) DO NOTHING;

-- Note: Menu sections table may not exist in all installations
-- If you have a menu system, uncomment the following:
-- INSERT INTO menu_sections (name, description, sort_order, is_active)
-- SELECT 'Sunday Lunch', 'Available Sundays 12pm-5pm. Pre-order by 1pm Saturday.', 1, true
-- WHERE NOT EXISTS (
--   SELECT 1 FROM menu_sections WHERE name = 'Sunday Lunch'
-- );

-- Note: Actual menu items from your Sunday lunch menu:
-- Roasted Chicken £14.99, Slow-Cooked Lamb Shank £15.49, Crispy Pork Belly £15.99, 
-- Beetroot & Butternut Squash Wellington £15.49, Kids Roasted Chicken £9.99, 
-- Cauliflower Cheese £3.99 (optional extra)
-- These should be managed through the admin interface to allow for price and availability updates

-- Insert default time slots for regular dining
-- Tuesday to Friday dinner (6pm-9pm)
INSERT INTO booking_time_slots (day_of_week, slot_time, max_covers, booking_type)
SELECT 
  day,
  (ts::timestamp)::time,
  30,
  'regular'
FROM 
  generate_series(2, 5) AS day,  -- Tuesday to Friday
  generate_series('2024-01-01 18:00:00'::timestamp, '2024-01-01 20:30:00'::timestamp, '30 minutes'::interval) AS ts
ON CONFLICT (day_of_week, slot_time, booking_type) DO NOTHING;

-- Saturday lunch and dinner (1pm-7pm)
INSERT INTO booking_time_slots (day_of_week, slot_time, max_covers, booking_type)
SELECT 
  6,  -- Saturday
  (ts::timestamp)::time,
  30,
  'regular'
FROM 
  generate_series('2024-01-01 13:00:00'::timestamp, '2024-01-01 19:00:00'::timestamp, '30 minutes'::interval) AS ts
ON CONFLICT (day_of_week, slot_time, booking_type) DO NOTHING;

-- Sunday regular dining (12pm-5pm, alongside Sunday lunch)
INSERT INTO booking_time_slots (day_of_week, slot_time, max_covers, booking_type)
SELECT 
  0,  -- Sunday
  (ts::timestamp)::time,
  20,  -- Lower capacity as Sunday lunch takes priority
  'regular'
FROM 
  generate_series('2024-01-01 12:00:00'::timestamp, '2024-01-01 16:30:00'::timestamp, '30 minutes'::interval) AS ts
ON CONFLICT (day_of_week, slot_time, booking_type) DO NOTHING;

-- Add sample tables (can be adjusted by management)
INSERT INTO table_configuration (table_number, capacity)
VALUES 
  ('1', 2),
  ('2', 2),
  ('3', 4),
  ('4', 4),
  ('5', 4),
  ('6', 6),
  ('7', 6),
  ('8', 8),
  ('9', 4),
  ('10', 4)
ON CONFLICT (table_number) DO NOTHING;

-- Create booking policies table for configurable rules
CREATE TABLE IF NOT EXISTS booking_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_type table_booking_type NOT NULL,
  full_refund_hours INTEGER NOT NULL DEFAULT 48,
  partial_refund_hours INTEGER NOT NULL DEFAULT 24,
  partial_refund_percentage INTEGER NOT NULL DEFAULT 50,
  modification_allowed BOOLEAN DEFAULT true,
  cancellation_fee DECIMAL(10,2) DEFAULT 0,
  max_party_size INTEGER DEFAULT 20,
  min_advance_hours INTEGER DEFAULT 0, -- Minimum hours before booking
  max_advance_days INTEGER DEFAULT 56, -- Maximum days in advance (8 weeks)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(booking_type)
);

-- Insert default policies
INSERT INTO booking_policies (booking_type, full_refund_hours, partial_refund_hours, partial_refund_percentage, min_advance_hours)
VALUES 
  ('regular', 2, 0, 0, 2), -- 2 hour notice, no refunds
  ('sunday_lunch', 48, 24, 50, 20); -- 48hr full refund, 24hr 50% refund, must book by 1pm Saturday

-- Track booking modifications
CREATE TABLE IF NOT EXISTS table_booking_modifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES table_bookings(id) ON DELETE CASCADE,
  modified_by UUID, -- Staff user ID who made the modification
  modification_type VARCHAR(50) NOT NULL, -- 'time_change', 'party_size', 'menu_change', 'table_change'
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table combinations for larger parties
CREATE TABLE IF NOT EXISTS table_combinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100),
  table_ids UUID[] NOT NULL,
  total_capacity INTEGER NOT NULL,
  preferred_for_size INTEGER[], -- e.g., [6, 7, 8] for parties of 6-8
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- SMS template definitions for table bookings
CREATE TABLE IF NOT EXISTS table_booking_sms_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key VARCHAR(100) NOT NULL UNIQUE,
  booking_type table_booking_type,
  template_text TEXT NOT NULL,
  variables TEXT[], -- List of available variables
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default SMS templates
INSERT INTO table_booking_sms_templates (template_key, booking_type, template_text, variables)
VALUES 
  ('booking_confirmation_regular', 'regular', 
   'Hi {{customer_name}}, your table for {{party_size}} at The Anchor on {{date}} at {{time}} is confirmed. Reference: {{reference}}. Reply STOP to opt out.',
   ARRAY['customer_name', 'party_size', 'date', 'time', 'reference']),
  
  ('booking_confirmation_sunday_lunch', 'sunday_lunch',
   'Hi {{customer_name}}, your Sunday lunch booking for {{party_size}} on {{date}} at {{time}} is confirmed. We have your roast selections ready! Reference: {{reference}}.',
   ARRAY['customer_name', 'party_size', 'date', 'time', 'reference']),
  
  ('reminder_regular', 'regular',
   'Reminder: Your table at The Anchor is booked for today at {{time}}. Party of {{party_size}}. We look forward to seeing you! Ref: {{reference}}',
   ARRAY['time', 'party_size', 'reference']),
  
  ('reminder_sunday_lunch', 'sunday_lunch',
   'Sunday Lunch Reminder: Table for {{party_size}} at {{time}} today. {{roast_summary}}. Allergies noted: {{allergies}}. See you soon! Ref: {{reference}}',
   ARRAY['party_size', 'time', 'roast_summary', 'allergies', 'reference']),
  
  ('cancellation', NULL,
   'Your booking {{reference}} at The Anchor has been cancelled. {{refund_message}} For assistance call {{contact_phone}}.',
   ARRAY['reference', 'refund_message', 'contact_phone']),
  
  ('review_request', NULL,
   'Thanks for dining at The Anchor today! We''d love your feedback: {{review_link}} Reply STOP to opt out.',
   ARRAY['review_link']);

-- Add columns to track modifications and verification
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'table_bookings' AND column_name = 'modification_count'
  ) THEN
    ALTER TABLE table_bookings ADD COLUMN modification_count INTEGER DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'table_bookings' AND column_name = 'original_booking_data'
  ) THEN
    ALTER TABLE table_bookings ADD COLUMN original_booking_data JSONB;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'table_bookings' AND column_name = 'email_verification_token'
  ) THEN
    ALTER TABLE table_bookings ADD COLUMN email_verification_token UUID;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'table_bookings' AND column_name = 'email_verified_at'
  ) THEN
    ALTER TABLE table_bookings ADD COLUMN email_verified_at TIMESTAMPTZ;
  END IF;
END $$;

-- Add indexes for new tables
CREATE INDEX IF NOT EXISTS idx_booking_policies_type ON booking_policies(booking_type);
CREATE INDEX IF NOT EXISTS idx_booking_modifications_booking_id ON table_booking_modifications(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_modifications_created_at ON table_booking_modifications(created_at);
CREATE INDEX IF NOT EXISTS idx_table_combinations_active ON table_combinations(is_active);
CREATE INDEX IF NOT EXISTS idx_sms_templates_key ON table_booking_sms_templates(template_key);

-- Triggers for new tables
-- Create triggers only if function exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    CREATE TRIGGER booking_policies_updated_at
      BEFORE UPDATE ON booking_policies
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
      
    CREATE TRIGGER table_combinations_updated_at
      BEFORE UPDATE ON table_combinations
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
      
    CREATE TRIGGER table_booking_sms_templates_updated_at
      BEFORE UPDATE ON table_booking_sms_templates
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Enable RLS on new tables
ALTER TABLE booking_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_booking_modifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_combinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_booking_sms_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies for booking_policies (public read, admin write)
CREATE POLICY "Anyone can view booking policies" ON booking_policies
  FOR SELECT USING (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_has_permission') THEN
    CREATE POLICY "Admins can manage booking policies" ON booking_policies
      FOR ALL USING (
        user_has_permission(auth.uid(), 'table_bookings', 'manage')
      );
  END IF;
END $$;

-- RLS Policies for modifications
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_has_permission') THEN
    CREATE POLICY "Staff can view all modifications" ON table_booking_modifications
      FOR SELECT USING (
        user_has_permission(auth.uid(), 'table_bookings', 'view')
      );

    CREATE POLICY "Staff can create modifications" ON table_booking_modifications
      FOR INSERT WITH CHECK (
        user_has_permission(auth.uid(), 'table_bookings', 'edit')
      );
  ELSE
    CREATE POLICY "Allow authenticated access" ON table_booking_modifications
      FOR ALL USING (true); -- Temporary permissive policy
  END IF;
END $$;

-- RLS for table combinations and SMS templates (admin only)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_has_permission') THEN
    CREATE POLICY "Staff can view table combinations" ON table_combinations
      FOR SELECT USING (
        user_has_permission(auth.uid(), 'table_bookings', 'view')
      );

    CREATE POLICY "Admins manage table combinations" ON table_combinations
      FOR ALL USING (
        user_has_permission(auth.uid(), 'table_bookings', 'manage')
      );

    CREATE POLICY "Staff can view SMS templates" ON table_booking_sms_templates
      FOR SELECT USING (
        user_has_permission(auth.uid(), 'table_bookings', 'view')
      );

    CREATE POLICY "Admins manage SMS templates" ON table_booking_sms_templates
      FOR ALL USING (
        user_has_permission(auth.uid(), 'table_bookings', 'manage')
      );
  ELSE
    CREATE POLICY "Allow authenticated access to combinations" ON table_combinations
      FOR ALL USING (true); -- Temporary permissive policy
    CREATE POLICY "Allow authenticated access to templates" ON table_booking_sms_templates
      FOR ALL USING (true); -- Temporary permissive policy
  END IF;
END $$;

-- Function to validate booking against policies
CREATE OR REPLACE FUNCTION validate_booking_against_policy(
  p_booking_type table_booking_type,
  p_booking_date DATE,
  p_booking_time TIME,
  p_party_size INTEGER
) RETURNS TABLE (
  is_valid BOOLEAN,
  error_message TEXT
) AS $$
DECLARE
  v_policy booking_policies;
  v_hours_until_booking NUMERIC;
  v_days_until_booking NUMERIC;
BEGIN
  -- Get policy for booking type
  SELECT * INTO v_policy FROM booking_policies WHERE booking_type = p_booking_type;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'No policy found for booking type';
    RETURN;
  END IF;
  
  -- Calculate time until booking
  v_hours_until_booking := EXTRACT(EPOCH FROM (p_booking_date + p_booking_time - NOW())) / 3600;
  v_days_until_booking := p_booking_date - CURRENT_DATE;
  
  -- Check minimum advance hours
  IF v_hours_until_booking < v_policy.min_advance_hours THEN
    RETURN QUERY SELECT false, format('Bookings must be made at least %s hours in advance', v_policy.min_advance_hours);
    RETURN;
  END IF;
  
  -- Check maximum advance days
  IF v_days_until_booking > v_policy.max_advance_days THEN
    RETURN QUERY SELECT false, format('Bookings cannot be made more than %s days in advance', v_policy.max_advance_days);
    RETURN;
  END IF;
  
  -- Check party size
  IF p_party_size > v_policy.max_party_size THEN
    RETURN QUERY SELECT false, format('Maximum party size is %s', v_policy.max_party_size);
    RETURN;
  END IF;
  
  -- Special check for Sunday lunch - must be before 1pm Saturday
  IF p_booking_type = 'sunday_lunch' AND EXTRACT(DOW FROM p_booking_date) = 0 THEN
    -- If booking is for this Sunday and it's past 1pm Saturday
    IF p_booking_date - CURRENT_DATE <= 1 AND 
       (EXTRACT(DOW FROM CURRENT_DATE) = 6 AND CURRENT_TIME > '13:00:00'::TIME) THEN
      RETURN QUERY SELECT false, 'Sunday lunch bookings must be made before 1pm on Saturday';
      RETURN;
    END IF;
  END IF;
  
  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to calculate refund amount
CREATE OR REPLACE FUNCTION calculate_refund_amount(
  p_booking_id UUID
) RETURNS TABLE (
  refund_percentage INTEGER,
  refund_amount DECIMAL(10,2),
  refund_reason TEXT
) AS $$
DECLARE
  v_booking table_bookings;
  v_payment table_booking_payments;
  v_policy booking_policies;
  v_hours_until_booking NUMERIC;
BEGIN
  -- Get booking details
  SELECT * INTO v_booking FROM table_bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0.00::DECIMAL, 'Booking not found';
    RETURN;
  END IF;
  
  -- Get payment details
  SELECT * INTO v_payment FROM table_booking_payments 
  WHERE booking_id = p_booking_id AND status = 'completed'
  ORDER BY created_at DESC LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0.00::DECIMAL, 'No payment found';
    RETURN;
  END IF;
  
  -- Get policy
  SELECT * INTO v_policy FROM booking_policies WHERE booking_type = v_booking.booking_type;
  
  -- Calculate hours until booking
  v_hours_until_booking := EXTRACT(EPOCH FROM (v_booking.booking_date + v_booking.booking_time - NOW())) / 3600;
  
  -- Determine refund percentage
  IF v_hours_until_booking >= v_policy.full_refund_hours THEN
    RETURN QUERY SELECT 100, v_payment.amount, 'Full refund - cancelled with sufficient notice';
  ELSIF v_hours_until_booking >= v_policy.partial_refund_hours THEN
    RETURN QUERY SELECT 
      v_policy.partial_refund_percentage, 
      (v_payment.amount * v_policy.partial_refund_percentage / 100)::DECIMAL(10,2),
      format('%s%% refund - cancelled with %s hours notice', v_policy.partial_refund_percentage, round(v_hours_until_booking));
  ELSE
    RETURN QUERY SELECT 0, 0.00::DECIMAL, 'No refund - insufficient cancellation notice';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Insert table booking permissions into RBAC system
DO $$
BEGIN
  -- Only insert permissions if rbac_permissions table exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'rbac_permissions'
  ) THEN
    INSERT INTO rbac_permissions (module, action, description) VALUES
      ('table_bookings', 'view', 'View table bookings'),
      ('table_bookings', 'create', 'Create table bookings'),
      ('table_bookings', 'edit', 'Edit table bookings'),
      ('table_bookings', 'delete', 'Delete table bookings'),
      ('table_bookings', 'manage', 'Full table booking management')
    ON CONFLICT (module, action) DO NOTHING;
  END IF;
  
  -- Only grant permissions if both tables exist
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'rbac_role_permissions'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'rbac_roles'
  ) THEN
    -- Manager role gets all permissions
    INSERT INTO rbac_role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM rbac_roles r
    CROSS JOIN rbac_permissions p
    WHERE r.role_name = 'manager'
      AND p.module = 'table_bookings'
    ON CONFLICT (role_id, permission_id) DO NOTHING;
    
    -- Staff role gets view and create permissions
    INSERT INTO rbac_role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM rbac_roles r
    CROSS JOIN rbac_permissions p
    WHERE r.role_name = 'staff'
      AND p.module = 'table_bookings'
      AND p.action IN ('view', 'create')
    ON CONFLICT (role_id, permission_id) DO NOTHING;
  END IF;
END $$;

-- Super admin already has all permissions by default

-- Grant necessary permissions to authenticated users for API access
DO $$
BEGIN
  -- Check if 'authenticated' role exists before granting
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON booking_time_slots TO authenticated;
    GRANT SELECT ON table_configuration TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON table_bookings TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON table_booking_items TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON table_booking_payments TO authenticated;
    GRANT SELECT ON booking_policies TO authenticated;
    GRANT SELECT ON table_booking_sms_templates TO authenticated;
    GRANT SELECT, INSERT ON table_booking_modifications TO authenticated;
    GRANT EXECUTE ON FUNCTION check_table_availability TO authenticated;
    GRANT EXECUTE ON FUNCTION generate_booking_reference TO authenticated;
    GRANT EXECUTE ON FUNCTION validate_booking_against_policy TO authenticated;
    GRANT EXECUTE ON FUNCTION calculate_refund_amount TO authenticated;
  END IF;
END $$;
-- End 20250719140000_add_table_bookings_system.sql


-- Begin 20250719171529_update_nikki_event_categories.sql
-- Description: Update Nikki's event categories - split into Games Night and Karaoke Night
-- 
-- This migration:
-- 1. Updates the existing "Drag Cabaret with Nikki Manfadge" category to "Nikki's Games Night"
-- 2. Creates a new category for "Nikki's Karaoke Night"
-- 3. Updates descriptions to reflect the new branding and format

-- Update existing Drag Cabaret category to Nikki's Games Night
UPDATE event_categories
SET 
  name = 'Nikki''s Games Night',
  slug = 'nikkis-games-night',
  description = 'Classic TV gameshows with a drag twist! Join Nikki Manfadge for Blankety Blank, Name That Tune, Play Your Cards Right, and more. Interactive entertainment with prizes and laughs. Wednesdays 7-10pm.',
  default_start_time = '19:00:00', -- Default start time 7pm
  default_end_time = '22:00:00', -- Default end time 10pm
  -- Keep the same color (pink) and icon (sparkles) as they still fit
  updated_at = NOW()
WHERE id = 'f192afe3-ca45-4c53-980a-9653ed8711d7';

-- Create new category for Nikki's Karaoke Night (only if it doesn't already exist)
INSERT INTO event_categories (
  id,
  name,
  slug,
  description,
  short_description,
  long_description,
  meta_title,
  meta_description,
  keywords,
  highlights,
  faqs,
  color,
  icon,
  sort_order,
  is_active,
  default_performer_type,
  default_start_time,
  default_end_time,
  default_reminder_hours,
  default_is_free,
  default_price,
  default_capacity,
  default_event_status,
  created_at,
  updated_at
) VALUES (
  gen_random_uuid(),
  'Nikki''s Karaoke Night',
  'nikkis-karaoke-night',
  'Interactive singing with drag entertainment! Two microphones, 50,000+ songs, duets with Nikki, lip sync battles, and group singalongs. Props and costumes provided. Fridays 8-11pm.',
  'Interactive karaoke with drag queen Nikki Manfadge - Fridays 8-11pm',
  'Join Nikki Manfadge for an unforgettable karaoke experience! With two microphones, over 50,000 songs to choose from, and Nikki''s fabulous hosting, every Friday night becomes a celebration. Whether you want to belt out power ballads, duet with Nikki, or participate in lip sync battles, this is your stage. Props and costumes provided for those feeling extra fabulous!',
  'Nikki''s Karaoke Night at The Anchor | Drag Entertainment | Fridays 8-11pm',
  'Experience Nikki''s Karaoke Night at The Anchor, Stanwell Moor. Interactive singing with drag queen Nikki Manfadge every Friday 8-11pm. Free entry, 50,000+ songs, duets, lip sync battles. Book your table now!',
  '["karaoke", "drag queen", "nikki manfadge", "friday night entertainment", "stanwell moor", "the anchor pub", "live entertainment", "karaoke night", "drag entertainment", "free entry"]'::jsonb,
  '["Two microphones available", "50,000+ song catalogue", "Duets with Nikki", "Lip sync battle hour", "Props and costumes provided", "Group singalongs", "Free entry"]'::jsonb,
  '[{"question": "Is there an entry fee?", "answer": "No! Entry is completely free. Just book your table in advance."}, {"question": "Can I request any song?", "answer": "Yes! We have over 50,000 songs in our catalogue covering all genres and decades."}, {"question": "Do I have to sing?", "answer": "Not at all! You can just come to enjoy the show and support others."}, {"question": "Is it suitable for all ages?", "answer": "All ages are welcome but expect adult language and themes throughout the night."}, {"question": "Can I book for a group?", "answer": "Absolutely! We recommend booking in advance for groups. Call 01753 682707."}]'::jsonb,
  '#9333EA', -- Purple color to differentiate from Games Night
  'MicrophoneIcon', -- Microphone icon for karaoke
  (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM event_categories), -- Add to end of sort order
  true, -- Active
  'Person', -- Performer type for individual performer
  '20:00:00', -- Default start time 8pm
  '23:00:00', -- Default end time 11pm
  24, -- Default reminder 24 hours before
  true, -- Free entry
  0.00, -- No ticket price
  50, -- Maximum capacity
  'scheduled', -- Default status
  NOW(),
  NOW()
)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  short_description = EXCLUDED.short_description,
  long_description = EXCLUDED.long_description,
  meta_title = EXCLUDED.meta_title,
  meta_description = EXCLUDED.meta_description,
  keywords = EXCLUDED.keywords,
  highlights = EXCLUDED.highlights,
  faqs = EXCLUDED.faqs,
  default_start_time = EXCLUDED.default_start_time,
  default_end_time = EXCLUDED.default_end_time,
  updated_at = NOW();

-- Add note about the migration
COMMENT ON COLUMN event_categories.name IS 'Event category names. Updated 2025-01-19: Split "Drag Cabaret with Nikki Manfadge" into "Nikki''s Games Night" (Wednesdays) and "Nikki''s Karaoke Night" (Fridays)';
-- End 20250719171529_update_nikki_event_categories.sql


-- Begin 20250719190000_add_sunday_lunch_menu_items.sql
-- Create sunday_lunch_menu_items table
CREATE TABLE IF NOT EXISTS sunday_lunch_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL,
  category VARCHAR(50) NOT NULL CHECK (category IN ('main', 'side', 'extra')),
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  allergens TEXT[] DEFAULT '{}',
  dietary_info TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique constraint on name
CREATE UNIQUE INDEX IF NOT EXISTS idx_sunday_lunch_menu_items_name ON sunday_lunch_menu_items(LOWER(name));

-- Enable RLS
ALTER TABLE sunday_lunch_menu_items ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
DROP POLICY IF EXISTS "Anyone can view active menu items" ON sunday_lunch_menu_items;
CREATE POLICY "Anyone can view active menu items" ON sunday_lunch_menu_items
  FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "Staff can view all menu items" ON sunday_lunch_menu_items;
CREATE POLICY "Staff can view all menu items" ON sunday_lunch_menu_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

DROP POLICY IF EXISTS "Managers can manage menu items" ON sunday_lunch_menu_items;
CREATE POLICY "Managers can manage menu items" ON sunday_lunch_menu_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

-- Create updated_at trigger
DROP TRIGGER IF EXISTS update_sunday_lunch_menu_items_updated_at ON sunday_lunch_menu_items;
CREATE TRIGGER update_sunday_lunch_menu_items_updated_at
  BEFORE UPDATE ON sunday_lunch_menu_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Insert initial menu items
INSERT INTO sunday_lunch_menu_items (name, description, price, category, display_order, allergens, dietary_info) VALUES
  ('Roasted Chicken', 'Oven-roasted chicken breast with sage & onion stuffing balls, herb and garlic-crusted roast potatoes, seasonal vegetables, Yorkshire pudding, and red wine gravy', 14.99, 'main', 1, ARRAY['Gluten'], ARRAY[]::TEXT[]),
  ('Slow-Cooked Lamb Shank', 'Tender slow-braised lamb shank in rich red wine gravy, served with herb and garlic-crusted roast potatoes, seasonal vegetables, and a Yorkshire pudding', 15.49, 'main', 2, ARRAY[]::TEXT[], ARRAY[]::TEXT[]),
  ('Crispy Pork Belly', 'Crispy crackling and tender slow-roasted pork belly with Bramley apple sauce, herb and garlic-crusted roast potatoes, seasonal vegetables, Yorkshire pudding, and red wine gravy', 15.99, 'main', 3, ARRAY[]::TEXT[], ARRAY[]::TEXT[]),
  ('Beetroot & Butternut Squash Wellington', 'Golden puff pastry filled with beetroot & butternut squash, served with herb and garlic-crusted roast potatoes, seasonal vegetables, and vegetarian gravy', 15.49, 'main', 4, ARRAY['Gluten'], ARRAY['Vegan']),
  ('Kids Roasted Chicken', 'A smaller portion of our roasted chicken with herb and garlic-crusted roast potatoes, seasonal vegetables, Yorkshire pudding, and red wine gravy', 9.99, 'main', 5, ARRAY['Gluten'], ARRAY[]::TEXT[]),
  ('Herb & Garlic Roast Potatoes', 'Crispy roast potatoes with herbs and garlic', 0.00, 'side', 1, ARRAY[]::TEXT[], ARRAY['Vegan', 'Gluten-free']),
  ('Yorkshire Pudding', 'Traditional Yorkshire pudding', 0.00, 'side', 2, ARRAY['Gluten', 'Eggs', 'Milk'], ARRAY['Vegetarian']),
  ('Seasonal Vegetables', 'Selection of fresh seasonal vegetables', 0.00, 'side', 3, ARRAY[]::TEXT[], ARRAY['Vegan', 'Gluten-free']),
  ('Cauliflower Cheese', 'Creamy mature cheddar sauce, baked until golden and bubbling', 3.99, 'extra', 4, ARRAY['Milk'], ARRAY['Vegetarian', 'Gluten-free'])
ON CONFLICT (LOWER(name)) DO NOTHING;
-- End 20250719190000_add_sunday_lunch_menu_items.sql


-- Begin 20250719200000_add_table_management.sql
-- Create tables table
CREATE TABLE IF NOT EXISTS tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number VARCHAR(10) NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique constraint on table number
CREATE UNIQUE INDEX IF NOT EXISTS idx_tables_table_number ON tables(LOWER(table_number));

-- Create table_combinations table
CREATE TABLE IF NOT EXISTS table_combinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  total_capacity INTEGER NOT NULL CHECK (total_capacity > 0),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique constraint on combination name
CREATE UNIQUE INDEX IF NOT EXISTS idx_table_combinations_name ON table_combinations(LOWER(name));

-- Create table_combination_tables junction table
CREATE TABLE IF NOT EXISTS table_combination_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combination_id UUID NOT NULL REFERENCES table_combinations(id) ON DELETE CASCADE,
  table_id UUID NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(combination_id, table_id)
);

-- Enable RLS
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_combinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_combination_tables ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Staff can view tables" ON tables;
DROP POLICY IF EXISTS "Managers can manage tables" ON tables;
DROP POLICY IF EXISTS "Staff can view table combinations" ON table_combinations;
DROP POLICY IF EXISTS "Managers can manage table combinations" ON table_combinations;
DROP POLICY IF EXISTS "Staff can view table combination tables" ON table_combination_tables;
DROP POLICY IF EXISTS "Managers can manage table combination tables" ON table_combination_tables;

-- Create RLS policies for tables
CREATE POLICY "Staff can view tables" ON tables
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

CREATE POLICY "Managers can manage tables" ON tables
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

-- Create RLS policies for table_combinations
CREATE POLICY "Staff can view table combinations" ON table_combinations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

CREATE POLICY "Managers can manage table combinations" ON table_combinations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

-- Create RLS policies for table_combination_tables
CREATE POLICY "Staff can view table combination tables" ON table_combination_tables
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

CREATE POLICY "Managers can manage table combination tables" ON table_combination_tables
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS update_tables_updated_at ON tables;
DROP TRIGGER IF EXISTS update_table_combinations_updated_at ON table_combinations;

-- Create updated_at triggers
CREATE TRIGGER update_tables_updated_at
  BEFORE UPDATE ON tables
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_table_combinations_updated_at
  BEFORE UPDATE ON table_combinations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Insert some default tables
INSERT INTO tables (table_number, capacity, notes) VALUES
  ('1', 4, 'Near window'),
  ('2', 4, 'Near window'),
  ('3', 2, 'Bar seating'),
  ('4', 2, 'Bar seating'),
  ('5', 6, 'Round table'),
  ('6', 4, 'Corner booth'),
  ('7', 4, 'Main floor'),
  ('8', 4, 'Main floor'),
  ('9', 2, 'High top'),
  ('10', 2, 'High top')
ON CONFLICT (LOWER(table_number)) DO NOTHING;
-- End 20250719200000_add_table_management.sql


-- Begin 20250719210011_create_missing_jobs_table.sql
-- Description: Create the missing jobs table that the code expects
-- This is CRITICAL - code is referencing this table but it doesn't exist!

-- Create the jobs table only if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'jobs'
  ) THEN
    CREATE TABLE jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type VARCHAR(50) NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}',
      status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      scheduled_for TIMESTAMPTZ DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      failed_at TIMESTAMPTZ,
      error_message TEXT,
      result JSONB,
      priority INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    -- Enable RLS
    ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
    
    -- Only service role can access jobs
    CREATE POLICY "Service role manages jobs" ON jobs
      FOR ALL USING (auth.role() = 'service_role');
      
    RAISE NOTICE 'Created jobs table';
  ELSE
    RAISE NOTICE 'Jobs table already exists';
  END IF;
END $$;

-- Add essential indexes for performance (idempotent)
CREATE INDEX IF NOT EXISTS idx_jobs_status_scheduled ON jobs(status, scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_priority_scheduled ON jobs(priority DESC, scheduled_for) WHERE status = 'pending';

-- Add update trigger if function exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    -- Check if trigger already exists
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'update_jobs_updated_at'
    ) THEN
      CREATE TRIGGER update_jobs_updated_at
        BEFORE UPDATE ON jobs
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
  END IF;
END $$;

-- Add comment for documentation
COMMENT ON TABLE jobs IS 'Unified job queue table for all background processing';
COMMENT ON COLUMN jobs.type IS 'Job type identifier (e.g., send_sms, process_booking, generate_report)';
COMMENT ON COLUMN jobs.payload IS 'Job data as JSONB';
COMMENT ON COLUMN jobs.status IS 'Current job status';
COMMENT ON COLUMN jobs.priority IS 'Job priority (higher number = higher priority)';
COMMENT ON COLUMN jobs.result IS 'Job execution result data';
-- End 20250719210011_create_missing_jobs_table.sql


-- Begin 20250719210012_add_performance_indexes.sql
-- Description: Add missing database indexes for performance optimization
-- These indexes address the slow query issues, especially in private bookings
-- This version checks for column existence before creating indexes

-- Helper function to check if column exists
CREATE OR REPLACE FUNCTION column_exists(tbl_name text, col_name text) 
RETURNS boolean AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = tbl_name 
        AND column_name = col_name
    );
END;
$$ LANGUAGE plpgsql;

-- Customer table indexes (frequent lookups)
DO $$
BEGIN
    IF column_exists('customers', 'mobile_number') THEN
        CREATE INDEX IF NOT EXISTS idx_customers_mobile_number ON customers(mobile_number);
    END IF;
    
    IF column_exists('customers', 'messaging_status') THEN
        CREATE INDEX IF NOT EXISTS idx_customers_messaging_status ON customers(messaging_status);
    END IF;
    
    IF column_exists('customers', 'created_at') THEN
        CREATE INDEX IF NOT EXISTS idx_customers_created_at ON customers(created_at DESC);
    END IF;
END $$;

-- Messages table indexes (heavy queries)
DO $$
BEGIN
    IF column_exists('messages', 'customer_id') AND column_exists('messages', 'created_at') THEN
        CREATE INDEX IF NOT EXISTS idx_messages_customer_created ON messages(customer_id, created_at DESC);
    END IF;
    
    IF column_exists('messages', 'twilio_message_sid') THEN
        CREATE INDEX IF NOT EXISTS idx_messages_twilio_sid ON messages(twilio_message_sid) WHERE twilio_message_sid IS NOT NULL;
    END IF;
    
    IF column_exists('messages', 'status') THEN
        CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
    END IF;
END $$;

-- Private bookings indexes (reported as slow - PRIORITY)
DO $$
BEGIN
    IF column_exists('private_bookings', 'event_date') THEN
        CREATE INDEX IF NOT EXISTS idx_private_bookings_event_date ON private_bookings(event_date DESC);
    END IF;
    
    IF column_exists('private_bookings', 'status') THEN
        CREATE INDEX IF NOT EXISTS idx_private_bookings_status ON private_bookings(status);
    END IF;
    
    IF column_exists('private_bookings', 'customer_id') THEN
        CREATE INDEX IF NOT EXISTS idx_private_bookings_customer_id ON private_bookings(customer_id);
    END IF;
    
    IF column_exists('private_bookings', 'vendor_id') THEN
        CREATE INDEX IF NOT EXISTS idx_private_bookings_vendor_id ON private_bookings(vendor_id) WHERE vendor_id IS NOT NULL;
    END IF;
    
    IF column_exists('private_bookings', 'created_at') THEN
        CREATE INDEX IF NOT EXISTS idx_private_bookings_created_at ON private_bookings(created_at DESC);
    END IF;
    
    -- Composite index for common query pattern
    IF column_exists('private_bookings', 'status') AND column_exists('private_bookings', 'event_date') THEN
        CREATE INDEX IF NOT EXISTS idx_private_bookings_status_date ON private_bookings(status, event_date DESC);
    END IF;
END $$;

-- Private booking related tables
DO $$
BEGIN
    IF column_exists('private_booking_items', 'booking_id') THEN
        CREATE INDEX IF NOT EXISTS idx_private_booking_items_booking_id ON private_booking_items(booking_id);
    END IF;
    
    IF column_exists('private_booking_payments', 'booking_id') THEN
        CREATE INDEX IF NOT EXISTS idx_private_booking_payments_booking_id ON private_booking_payments(booking_id);
    END IF;
    
    IF column_exists('private_booking_payments', 'status') THEN
        CREATE INDEX IF NOT EXISTS idx_private_booking_payments_status ON private_booking_payments(status);
    END IF;
END $$;

-- Events table indexes
DO $$
BEGIN
    IF column_exists('events', 'event_date') AND column_exists('events', 'status') THEN
        CREATE INDEX IF NOT EXISTS idx_events_date_status ON events(event_date, status);
    END IF;
    
    IF column_exists('events', 'category_id') THEN
        CREATE INDEX IF NOT EXISTS idx_events_category_id ON events(category_id);
    END IF;
    
    IF column_exists('events', 'is_published') THEN
        CREATE INDEX IF NOT EXISTS idx_events_is_published ON events(is_published) WHERE is_published = true;
    END IF;
    
    IF column_exists('events', 'created_at') THEN
        CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
    END IF;
END $$;

-- Bookings table indexes
DO $$
BEGIN
    IF column_exists('bookings', 'event_id') AND column_exists('bookings', 'customer_id') THEN
        CREATE INDEX IF NOT EXISTS idx_bookings_event_customer ON bookings(event_id, customer_id);
    END IF;
    
    IF column_exists('bookings', 'created_at') THEN
        CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);
    END IF;
    
    IF column_exists('bookings', 'status') THEN
        CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
    END IF;
    
    IF column_exists('bookings', 'event_id') THEN
        CREATE INDEX IF NOT EXISTS idx_bookings_event_id ON bookings(event_id);
    END IF;
END $$;

-- Employees table indexes
DO $$
BEGIN
    IF column_exists('employees', 'status') THEN
        CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
    END IF;
    
    IF column_exists('employees', 'department') THEN
        CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department) WHERE department IS NOT NULL;
    END IF;
    
    IF column_exists('employees', 'created_at') THEN
        CREATE INDEX IF NOT EXISTS idx_employees_created_at ON employees(created_at DESC);
    END IF;
END $$;

-- Invoices table indexes
DO $$
BEGIN
    IF column_exists('invoices', 'status') THEN
        CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
    END IF;
    
    IF column_exists('invoices', 'vendor_id') THEN
        CREATE INDEX IF NOT EXISTS idx_invoices_vendor_id ON invoices(vendor_id);
    END IF;
    
    IF column_exists('invoices', 'invoice_date') THEN
        CREATE INDEX IF NOT EXISTS idx_invoices_invoice_date ON invoices(invoice_date DESC);
    END IF;
    
    IF column_exists('invoices', 'due_date') AND column_exists('invoices', 'status') THEN
        CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date) WHERE status != 'paid';
    END IF;
END $$;

-- Audit logs indexes (for faster queries)
DO $$
BEGIN
    IF column_exists('audit_logs', 'user_id') THEN
        CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
    END IF;
    
    IF column_exists('audit_logs', 'resource_type') AND column_exists('audit_logs', 'resource_id') THEN
        CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_type_id ON audit_logs(resource_type, resource_id);
    END IF;
    
    IF column_exists('audit_logs', 'created_at') THEN
        CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
    END IF;
    
    IF column_exists('audit_logs', 'operation_type') THEN
        CREATE INDEX IF NOT EXISTS idx_audit_logs_operation_type ON audit_logs(operation_type);
    END IF;
END $$;

-- Analyze tables to update statistics after adding indexes
DO $$
BEGIN
    -- Only analyze tables that exist
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customers') THEN
        ANALYZE customers;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages') THEN
        ANALYZE messages;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'private_bookings') THEN
        ANALYZE private_bookings;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'private_booking_items') THEN
        ANALYZE private_booking_items;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events') THEN
        ANALYZE events;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bookings') THEN
        ANALYZE bookings;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employees') THEN
        ANALYZE employees;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'invoices') THEN
        ANALYZE invoices;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
        ANALYZE audit_logs;
    END IF;
END $$;

-- Clean up the helper function
DROP FUNCTION IF EXISTS column_exists(text, text);
-- End 20250719210012_add_performance_indexes.sql


-- Begin 20250725122005_fix_table_booking_tables.sql
-- Description: Fix table booking configuration tables and relationships

-- Create table_configuration if it doesn't exist
CREATE TABLE IF NOT EXISTS public.table_configuration (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_number VARCHAR(10) NOT NULL,
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique index on table_number
CREATE UNIQUE INDEX IF NOT EXISTS idx_table_configuration_table_number 
    ON public.table_configuration(LOWER(table_number));

-- Create table_combinations if it doesn't exist
CREATE TABLE IF NOT EXISTS public.table_combinations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100),
    table_ids UUID[] NOT NULL,
    total_capacity INTEGER NOT NULL,
    preferred_for_size INTEGER[],
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique index on name
CREATE UNIQUE INDEX IF NOT EXISTS idx_table_combinations_name 
    ON public.table_combinations(LOWER(name));

-- Create index on is_active
CREATE INDEX IF NOT EXISTS idx_table_combinations_active 
    ON public.table_combinations(is_active);

-- Create table_combination_tables junction table
CREATE TABLE IF NOT EXISTS public.table_combination_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    combination_id UUID NOT NULL,
    table_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add unique constraint
ALTER TABLE public.table_combination_tables 
    DROP CONSTRAINT IF EXISTS table_combination_tables_combination_id_table_id_key;
ALTER TABLE public.table_combination_tables 
    ADD CONSTRAINT table_combination_tables_combination_id_table_id_key 
    UNIQUE (combination_id, table_id);

-- Drop old foreign key constraints if they exist
ALTER TABLE public.table_combination_tables 
    DROP CONSTRAINT IF EXISTS table_combination_tables_combination_id_fkey;
ALTER TABLE public.table_combination_tables 
    DROP CONSTRAINT IF EXISTS table_combination_tables_table_id_fkey;

-- Add foreign key constraints with correct references
ALTER TABLE public.table_combination_tables
    ADD CONSTRAINT table_combination_tables_combination_id_fkey 
    FOREIGN KEY (combination_id) REFERENCES public.table_combinations(id) ON DELETE CASCADE;

ALTER TABLE public.table_combination_tables
    ADD CONSTRAINT table_combination_tables_table_id_fkey 
    FOREIGN KEY (table_id) REFERENCES public.table_configuration(id) ON DELETE CASCADE;

-- Enable RLS
ALTER TABLE public.table_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_combinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_combination_tables ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Managers can manage table configuration" ON public.table_configuration;
DROP POLICY IF EXISTS "Staff can view table configuration" ON public.table_configuration;
DROP POLICY IF EXISTS "Admins manage table combinations" ON public.table_combinations;
DROP POLICY IF EXISTS "Managers can manage table combinations" ON public.table_combinations;
DROP POLICY IF EXISTS "Staff can view table combinations" ON public.table_combinations;
DROP POLICY IF EXISTS "Managers can manage table combination tables" ON public.table_combination_tables;
DROP POLICY IF EXISTS "Staff can view table combination tables" ON public.table_combination_tables;

-- Create RLS policies for table_configuration
CREATE POLICY "Users can manage table configuration with permission" 
    ON public.table_configuration
    FOR ALL 
    USING (public.user_has_permission(auth.uid(), 'table_bookings', 'manage'));

CREATE POLICY "Users can view table configuration with permission" 
    ON public.table_configuration
    FOR SELECT 
    USING (public.user_has_permission(auth.uid(), 'table_bookings', 'view'));

-- Create RLS policies for table_combinations
CREATE POLICY "Users can manage table combinations with permission" 
    ON public.table_combinations
    FOR ALL 
    USING (public.user_has_permission(auth.uid(), 'table_bookings', 'manage'));

CREATE POLICY "Users can view table combinations with permission" 
    ON public.table_combinations
    FOR SELECT 
    USING (public.user_has_permission(auth.uid(), 'table_bookings', 'view'));

-- Create RLS policies for table_combination_tables
CREATE POLICY "Users can manage table combination tables with permission" 
    ON public.table_combination_tables
    FOR ALL 
    USING (public.user_has_permission(auth.uid(), 'table_bookings', 'manage'));

CREATE POLICY "Users can view table combination tables with permission" 
    ON public.table_combination_tables
    FOR SELECT 
    USING (public.user_has_permission(auth.uid(), 'table_bookings', 'view'));

-- Add triggers for updated_at
CREATE OR REPLACE TRIGGER table_configuration_updated_at 
    BEFORE UPDATE ON public.table_configuration 
    FOR EACH ROW 
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER table_combinations_updated_at 
    BEFORE UPDATE ON public.table_combinations 
    FOR EACH ROW 
    EXECUTE FUNCTION public.update_updated_at_column();

-- Grant permissions
GRANT ALL ON TABLE public.table_configuration TO authenticated;
GRANT ALL ON TABLE public.table_combinations TO authenticated;
GRANT ALL ON TABLE public.table_combination_tables TO authenticated;

-- Insert some default tables if none exist
INSERT INTO public.table_configuration (table_number, capacity, notes)
SELECT * FROM (VALUES 
    ('1', 2, 'Window table'),
    ('2', 4, 'Corner booth'),
    ('3', 4, 'Center table'),
    ('4', 6, 'Large round table'),
    ('5', 2, 'Bar seating'),
    ('6', 4, 'Outdoor patio'),
    ('7', 4, 'Outdoor patio'),
    ('8', 2, 'Small table'),
    ('9', 6, 'Private dining'),
    ('10', 8, 'Large group table')
) AS default_tables(table_number, capacity, notes)
WHERE NOT EXISTS (SELECT 1 FROM public.table_configuration);

-- Create some default combinations if tables were inserted
DO $$
DECLARE
    table_1_id UUID;
    table_2_id UUID;
    table_3_id UUID;
    table_4_id UUID;
    combination_id UUID;
BEGIN
    -- Only create combinations if we just inserted the default tables
    IF (SELECT COUNT(*) FROM public.table_configuration) = 10 AND 
       (SELECT COUNT(*) FROM public.table_combinations) = 0 THEN
        
        -- Get table IDs
        SELECT id INTO table_1_id FROM public.table_configuration WHERE table_number = '1';
        SELECT id INTO table_2_id FROM public.table_configuration WHERE table_number = '2';
        SELECT id INTO table_3_id FROM public.table_configuration WHERE table_number = '3';
        SELECT id INTO table_4_id FROM public.table_configuration WHERE table_number = '4';
        
        -- Create combination for tables 1 + 2
        INSERT INTO public.table_combinations (name, table_ids, total_capacity, preferred_for_size)
        VALUES ('Tables 1 & 2', ARRAY[table_1_id, table_2_id], 6, ARRAY[5, 6])
        RETURNING id INTO combination_id;
        
        -- Insert junction records
        INSERT INTO public.table_combination_tables (combination_id, table_id)
        VALUES (combination_id, table_1_id), (combination_id, table_2_id);
        
        -- Create combination for tables 3 + 4
        INSERT INTO public.table_combinations (name, table_ids, total_capacity, preferred_for_size)
        VALUES ('Tables 3 & 4', ARRAY[table_3_id, table_4_id], 10, ARRAY[7, 8, 9, 10])
        RETURNING id INTO combination_id;
        
        -- Insert junction records
        INSERT INTO public.table_combination_tables (combination_id, table_id)
        VALUES (combination_id, table_3_id), (combination_id, table_4_id);
    END IF;
END $$;
-- End 20250725122005_fix_table_booking_tables.sql


-- Begin 20250725122348_update_table_booking_capacity_system.sql
-- Description: Update table booking system to use fixed capacity instead of table assignments

-- Update the check_table_availability function to use fixed capacity
CREATE OR REPLACE FUNCTION "public"."check_table_availability"(
  "p_date" "date", 
  "p_time" time without time zone, 
  "p_party_size" integer, 
  "p_duration_minutes" integer DEFAULT 120, 
  "p_exclude_booking_id" "uuid" DEFAULT NULL::"uuid"
) RETURNS TABLE(
  "available_capacity" integer, 
  "tables_available" integer[], 
  "is_available" boolean
)
LANGUAGE "plpgsql" SECURITY DEFINER
AS $$
DECLARE
  v_day_of_week INTEGER;
  v_total_capacity INTEGER;
  v_booked_capacity INTEGER;
  v_available_capacity INTEGER;
  v_restaurant_capacity CONSTANT INTEGER := 50; -- Fixed restaurant capacity
BEGIN
  -- Get day of week (0 = Sunday)
  v_day_of_week := EXTRACT(DOW FROM p_date);
  
  -- Use fixed restaurant capacity instead of table configuration
  v_total_capacity := v_restaurant_capacity;
  
  -- Get booked capacity for the time slot
  SELECT COALESCE(SUM(party_size), 0) INTO v_booked_capacity
  FROM table_bookings
  WHERE booking_date = p_date
    AND status IN ('confirmed', 'pending_payment')
    AND (p_exclude_booking_id IS NULL OR id != p_exclude_booking_id)
    AND (
      -- Check for time overlap
      (booking_time <= p_time AND (booking_time + (duration_minutes || ' minutes')::INTERVAL) > p_time)
      OR
      (p_time <= booking_time AND (p_time + (p_duration_minutes || ' minutes')::INTERVAL) > booking_time)
    );
  
  v_available_capacity := v_total_capacity - v_booked_capacity;
  
  RETURN QUERY
  SELECT 
    v_available_capacity,
    ARRAY[]::INTEGER[], -- No specific table assignments needed
    v_available_capacity >= p_party_size;
END;
$$;

-- Add comment to function
COMMENT ON FUNCTION "public"."check_table_availability" IS 'Checks table booking availability using fixed restaurant capacity of 50 people';

-- Optional: Add a system_settings table for configurable capacity (for future use)
CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert restaurant capacity setting
INSERT INTO system_settings (key, value, description)
VALUES ('restaurant_capacity', '{"max_capacity": 50}', 'Maximum restaurant capacity for table bookings')
ON CONFLICT (key) DO NOTHING;

-- Enable RLS on system_settings
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- Create policies for system_settings
CREATE POLICY "Staff can view system settings" ON system_settings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

CREATE POLICY "Managers can manage system settings" ON system_settings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

-- Add trigger for updated_at
CREATE TRIGGER system_settings_updated_at
  BEFORE UPDATE ON system_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
-- End 20250725122348_update_table_booking_capacity_system.sql


-- Begin 20250726000000_add_table_booking_sms_templates.sql
-- Description: Add default SMS templates for table bookings

-- Insert default SMS templates if they don't exist
INSERT INTO public.table_booking_sms_templates (template_key, booking_type, template_text, variables, is_active)
VALUES 
  -- Regular booking confirmation
  (
    'booking_confirmation_regular',
    'regular',
    'Hi {{customer_name}}, your table for {{party_size}} on {{date}} at {{time}} is confirmed. Reference: {{reference}}. If you need to make changes, call {{contact_phone}}. The Anchor',
    ARRAY['customer_name', 'party_size', 'date', 'time', 'reference', 'contact_phone'],
    true
  ),
  -- Sunday lunch booking confirmation
  (
    'booking_confirmation_sunday_lunch',
    'sunday_lunch',
    'Hi {{customer_name}}, your Sunday Lunch booking for {{party_size}} on {{date}} at {{time}} is confirmed. Reference: {{reference}}. Your roast selections have been noted. Call {{contact_phone}} for any changes. The Anchor',
    ARRAY['customer_name', 'party_size', 'date', 'time', 'reference', 'contact_phone'],
    true
  ),
  -- Regular booking reminder
  (
    'reminder_regular',
    'regular',
    'Hi {{customer_name}}, reminder of your table booking tomorrow at {{time}} for {{party_size}} people. Reference: {{reference}}. See you soon! The Anchor',
    ARRAY['customer_name', 'time', 'party_size', 'reference'],
    true
  ),
  -- Sunday lunch reminder
  (
    'reminder_sunday_lunch',
    'sunday_lunch',
    'Hi {{customer_name}}, reminder of your Sunday Lunch tomorrow at {{time}} for {{party_size}}. Roasts: {{roast_summary}}. Allergies noted: {{allergies}}. Reference: {{reference}}. The Anchor',
    ARRAY['customer_name', 'time', 'party_size', 'roast_summary', 'allergies', 'reference'],
    true
  ),
  -- Cancellation notification
  (
    'cancellation',
    NULL,
    'Your booking {{reference}} has been cancelled. {{refund_message}} For questions, call {{contact_phone}}. The Anchor',
    ARRAY['reference', 'refund_message', 'contact_phone'],
    true
  ),
  -- Payment request for Sunday lunch
  (
    'payment_request',
    'sunday_lunch',
    'Hi {{customer_name}}, payment of £{{amount}} is required for your Sunday Lunch booking {{reference}}. Pay by {{deadline}}: {{payment_link}}. The Anchor',
    ARRAY['customer_name', 'amount', 'reference', 'deadline', 'payment_link'],
    true
  ),
  -- Review request after visit
  (
    'review_request',
    NULL,
    'Hi {{customer_name}}, thanks for dining with us! We''d love your feedback: {{review_link}}. The Anchor',
    ARRAY['customer_name', 'review_link'],
    true
  )
ON CONFLICT (template_key) DO UPDATE SET
  template_text = EXCLUDED.template_text,
  variables = EXCLUDED.variables,
  updated_at = NOW()
WHERE table_booking_sms_templates.is_active = true;
-- End 20250726000000_add_table_booking_sms_templates.sql


-- Begin 20250726133015_update_sunday_lunch_sms_for_deposits.sql
-- Description: Update Sunday lunch SMS templates to reflect deposit system

-- Update Sunday lunch booking confirmation to mention deposit
UPDATE public.table_booking_sms_templates
SET 
  template_text = 'Hi {{customer_name}}, your Sunday Lunch booking for {{party_size}} on {{date}} at {{time}} is confirmed. £{{deposit_amount}} deposit paid. £{{outstanding_amount}} due on arrival. Reference: {{reference}}. Call {{contact_phone}} for any changes. The Anchor',
  variables = ARRAY['customer_name', 'party_size', 'date', 'time', 'deposit_amount', 'outstanding_amount', 'reference', 'contact_phone'],
  updated_at = NOW()
WHERE template_key = 'booking_confirmation_sunday_lunch';

-- Update Sunday lunch reminder to mention outstanding balance
UPDATE public.table_booking_sms_templates
SET 
  template_text = 'Hi {{customer_name}}, reminder of your Sunday Lunch tomorrow at {{time}} for {{party_size}}. Roasts: {{roast_summary}}. Balance due: £{{outstanding_amount}}. Reference: {{reference}}. The Anchor',
  variables = ARRAY['customer_name', 'time', 'party_size', 'roast_summary', 'outstanding_amount', 'reference'],
  updated_at = NOW()
WHERE template_key = 'reminder_sunday_lunch';

-- Update payment request to reflect deposit amount
UPDATE public.table_booking_sms_templates
SET 
  template_text = 'Hi {{customer_name}}, a £{{deposit_amount}} deposit is required for your Sunday Lunch booking {{reference}}. Total: £{{total_amount}}. Pay by {{deadline}}: {{payment_link}}. The Anchor',
  variables = ARRAY['customer_name', 'deposit_amount', 'total_amount', 'reference', 'deadline', 'payment_link'],
  updated_at = NOW()
WHERE template_key = 'payment_request' AND booking_type = 'sunday_lunch';

-- Add new template for deposit payment confirmation
INSERT INTO public.table_booking_sms_templates (template_key, booking_type, template_text, variables, is_active)
VALUES (
  'deposit_payment_confirmation',
  'sunday_lunch',
  'Hi {{customer_name}}, £{{deposit_amount}} deposit received for your Sunday Lunch on {{date}}. £{{outstanding_amount}} due on arrival. Reference: {{reference}}. The Anchor',
  ARRAY['customer_name', 'deposit_amount', 'outstanding_amount', 'date', 'reference'],
  true
)
ON CONFLICT (template_key) DO UPDATE SET
  template_text = EXCLUDED.template_text,
  variables = EXCLUDED.variables,
  booking_type = EXCLUDED.booking_type,
  updated_at = NOW();
-- End 20250726133015_update_sunday_lunch_sms_for_deposits.sql


-- Begin 20250726165344_simplify_sunday_lunch_categories.sql
-- Description: Simplify Sunday lunch menu categories to only main and side

-- First, update all 'extra' items to 'side'
UPDATE sunday_lunch_menu_items 
SET category = 'side' 
WHERE category = 'extra';

-- Update table_booking_items to change 'extra' to 'side'
UPDATE table_booking_items 
SET item_type = 'side' 
WHERE item_type = 'extra';

-- Drop existing constraints
ALTER TABLE sunday_lunch_menu_items 
DROP CONSTRAINT IF EXISTS sunday_lunch_menu_items_category_check;

ALTER TABLE table_booking_items 
DROP CONSTRAINT IF EXISTS table_booking_items_item_type_check;

-- Add new constraints with only main and side
ALTER TABLE sunday_lunch_menu_items 
ADD CONSTRAINT sunday_lunch_menu_items_category_check 
CHECK (category IN ('main', 'side'));

ALTER TABLE table_booking_items 
ADD CONSTRAINT table_booking_items_item_type_check 
CHECK (item_type IN ('main', 'side'));

-- Update Cauliflower Cheese to ensure it's marked as a side with price
UPDATE sunday_lunch_menu_items 
SET 
  category = 'side',
  price = 3.99,
  description = 'Creamy mature cheddar sauce, baked until golden and bubbling'
WHERE name = 'Cauliflower Cheese';

-- Add a note about pricing for sides
COMMENT ON COLUMN sunday_lunch_menu_items.price IS 'Price for the item. Sides included with mains should be 0, extra sides should have a price';

-- Log the migration
INSERT INTO audit_logs (
  operation_type,
  resource_type,
  operation_status,
  additional_info,
  created_at
) VALUES (
  'migrate',
  'sunday_lunch_menu',
  'success',
  jsonb_build_object(
    'migration', 'simplify_categories',
    'changes', 'Removed dessert and extra categories, simplified to main and side only'
  ),
  NOW()
);
-- End 20250726165344_simplify_sunday_lunch_categories.sql


-- Begin 20250727172250_fix_kitchen_hours_data_consistency.sql
-- Fix kitchen hours data consistency issues
-- This migration addresses the problem where special_hours entries have kitchen hours set
-- even when the kitchen is supposed to be closed

-- First, let's check if the is_kitchen_closed column exists, if not add it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'special_hours' AND column_name = 'is_kitchen_closed'
  ) THEN
    ALTER TABLE special_hours ADD COLUMN is_kitchen_closed BOOLEAN DEFAULT FALSE;
    COMMENT ON COLUMN special_hours.is_kitchen_closed IS 'Explicitly marks if kitchen is closed even if restaurant is open';
  END IF;
END $$;

-- Fix special hours entries where kitchen is marked as closed in the note
-- but still has kitchen hours set
UPDATE special_hours
SET 
  kitchen_opens = NULL,
  kitchen_closes = NULL,
  is_kitchen_closed = TRUE
WHERE 
  note ILIKE '%kitchen closed%'
  AND (kitchen_opens IS NOT NULL OR kitchen_closes IS NOT NULL);

-- Also handle any entries that say "Kitchen Closed" exactly
UPDATE special_hours
SET 
  kitchen_opens = NULL,
  kitchen_closes = NULL,
  is_kitchen_closed = TRUE
WHERE 
  LOWER(TRIM(note)) = 'kitchen closed';

-- Log what we fixed for audit purposes
DO $$
DECLARE
  fixed_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO fixed_count
  FROM special_hours
  WHERE is_kitchen_closed = TRUE
  AND note ILIKE '%kitchen closed%';
  
  IF fixed_count > 0 THEN
    RAISE NOTICE 'Fixed % special hours entries with kitchen closed status', fixed_count;
  END IF;
END $$;

-- Add check constraint to ensure data consistency going forward
-- If is_kitchen_closed is true, then kitchen hours should be null
ALTER TABLE special_hours DROP CONSTRAINT IF EXISTS check_kitchen_closed_consistency;
ALTER TABLE special_hours ADD CONSTRAINT check_kitchen_closed_consistency
  CHECK (
    (is_kitchen_closed = TRUE AND kitchen_opens IS NULL AND kitchen_closes IS NULL)
    OR
    (is_kitchen_closed = FALSE)
  );

-- Also add the same column to business_hours for consistency
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'business_hours' AND column_name = 'is_kitchen_closed'
  ) THEN
    ALTER TABLE business_hours ADD COLUMN is_kitchen_closed BOOLEAN DEFAULT FALSE;
    COMMENT ON COLUMN business_hours.is_kitchen_closed IS 'Explicitly marks if kitchen is closed on this day even if restaurant is open';
  END IF;
END $$;

-- Add the same constraint to business_hours
ALTER TABLE business_hours DROP CONSTRAINT IF EXISTS check_kitchen_closed_consistency;
ALTER TABLE business_hours ADD CONSTRAINT check_kitchen_closed_consistency
  CHECK (
    (is_kitchen_closed = TRUE AND kitchen_opens IS NULL AND kitchen_closes IS NULL)
    OR
    (is_kitchen_closed = FALSE)
  );
-- End 20250727172250_fix_kitchen_hours_data_consistency.sql


-- Begin 20250728120000_fix_booking_confirmation_join_issues.sql
-- Description: Fix booking confirmation page join issues by ensuring proper RLS policies

-- Drop existing problematic policies if they exist
DO $$
BEGIN
  -- Drop any existing policies that might be causing issues
  DROP POLICY IF EXISTS "anon_read_pending_bookings" ON pending_bookings;
  DROP POLICY IF EXISTS "anon_read_events_for_bookings" ON events;
  DROP POLICY IF EXISTS "anon_read_customers_for_bookings" ON customers;
  DROP POLICY IF EXISTS "Public can read pending bookings" ON pending_bookings;
  DROP POLICY IF EXISTS "Public can read events with pending bookings" ON events;
  DROP POLICY IF EXISTS "Public can read customers with pending bookings" ON customers;
END $$;

-- Create simplified policies for anonymous access to pending bookings
CREATE POLICY "anon_read_pending_bookings" ON pending_bookings
  FOR SELECT
  TO anon
  USING (true); -- Allow all reads - security is through unique UUID token

-- Create policy for anonymous users to read events that have pending bookings
CREATE POLICY "anon_read_events_for_bookings" ON events
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM pending_bookings
      WHERE pending_bookings.event_id = events.id
    )
  );

-- Create policy for anonymous users to read customers that have pending bookings
CREATE POLICY "anon_read_customers_for_bookings" ON customers
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM pending_bookings
      WHERE pending_bookings.customer_id = customers.id
        AND pending_bookings.customer_id IS NOT NULL
    )
  );

-- Ensure the anon role has proper permissions
GRANT SELECT ON pending_bookings TO anon;
GRANT SELECT ON events TO anon;
GRANT SELECT ON customers TO anon;

-- Create indexes to improve performance for the token lookups
CREATE INDEX IF NOT EXISTS idx_pending_bookings_token_lookup 
  ON pending_bookings(token) 
  WHERE confirmed_at IS NULL;

-- Add a comment explaining the approach
COMMENT ON POLICY "anon_read_pending_bookings" ON pending_bookings IS 
  'Allow anonymous users to read pending bookings - security is enforced through unique UUID tokens';
-- End 20250728120000_fix_booking_confirmation_join_issues.sql


-- Begin 20250810170000_add_booking_idempotency_and_improvements.sql
-- Description: Add idempotency keys table and booking improvements for Sunday lunch API stability
-- Phase 1 & 2 improvements from senior developer review

-- ========================================
-- 1. IDEMPOTENCY KEYS TABLE
-- ========================================
-- Prevents duplicate bookings from retries/double-clicks
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key VARCHAR(255) PRIMARY KEY,
  request_hash VARCHAR(64) NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours') NOT NULL
);

-- Index for cleanup job
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);

-- Enable RLS
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Policy: Service role only
CREATE POLICY "Service role only" ON idempotency_keys
  FOR ALL USING (auth.role() = 'service_role');

-- ========================================
-- 2. BOOKING AUDIT TABLE
-- ========================================
-- Track all state changes for debugging and compliance
CREATE TABLE IF NOT EXISTS booking_audit (
  id BIGSERIAL PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES table_bookings(id) ON DELETE CASCADE,
  event VARCHAR(50) NOT NULL,
  old_status VARCHAR(50),
  new_status VARCHAR(50),
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_by UUID REFERENCES auth.users(id)
);

-- Indexes for querying
CREATE INDEX IF NOT EXISTS idx_booking_audit_booking ON booking_audit(booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_audit_event ON booking_audit(event, created_at DESC);

-- Enable RLS
ALTER TABLE booking_audit ENABLE ROW LEVEL SECURITY;

-- Policy: Read own audit logs, service role sees all
CREATE POLICY "View audit logs" ON booking_audit
  FOR SELECT USING (
    auth.role() = 'service_role' OR
    booking_id IN (
      SELECT id FROM table_bookings 
      WHERE customer_id IN (
        SELECT id FROM customers 
        WHERE auth.uid() IS NOT NULL
      )
    )
  );

-- ========================================
-- 3. SERVICE SLOTS TABLE (Capacity Management)
-- ========================================
-- Define capacity windows to prevent overbooking
CREATE TABLE IF NOT EXISTS service_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_date DATE NOT NULL,
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  booking_type table_booking_type NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(service_date, starts_at, booking_type)
);

-- Index for availability queries
CREATE INDEX IF NOT EXISTS idx_service_slots_date ON service_slots(service_date, booking_type) WHERE is_active = true;

-- Enable RLS
ALTER TABLE service_slots ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Anyone can view active slots" ON service_slots
  FOR SELECT USING (is_active = true);

CREATE POLICY "Managers can manage slots" ON service_slots
  FOR ALL USING (
    auth.role() = 'service_role' OR
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
    )
  );

-- ========================================
-- 4. IMPROVE BOOKING ITEMS CONSTRAINTS
-- ========================================
-- Add proper enum for item_type if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_item_type') THEN
    CREATE TYPE booking_item_type AS ENUM ('main', 'side', 'extra');
  END IF;
END $$;

-- Update table_booking_items to use enum (safe migration)
DO $$
BEGIN
  -- First, check if column is already an enum
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'table_booking_items' 
    AND column_name = 'item_type'
    AND data_type = 'character varying'
  ) THEN
    -- Add temporary column with enum
    ALTER TABLE table_booking_items ADD COLUMN item_type_new booking_item_type;
    
    -- Copy data with validation
    UPDATE table_booking_items 
    SET item_type_new = CASE 
      WHEN item_type = 'main' THEN 'main'::booking_item_type
      WHEN item_type = 'side' THEN 'side'::booking_item_type
      WHEN item_type = 'extra' THEN 'extra'::booking_item_type
      ELSE 'main'::booking_item_type  -- Default for any invalid data
    END;
    
    -- Drop old column and rename new
    ALTER TABLE table_booking_items DROP COLUMN item_type;
    ALTER TABLE table_booking_items RENAME COLUMN item_type_new TO item_type;
    
    -- Add NOT NULL constraint
    ALTER TABLE table_booking_items ALTER COLUMN item_type SET NOT NULL;
    ALTER TABLE table_booking_items ALTER COLUMN item_type SET DEFAULT 'main'::booking_item_type;
  END IF;
END $$;

-- ========================================
-- 5. ADD CORRELATION ID TO BOOKINGS
-- ========================================
-- For request tracing through the entire flow
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'table_bookings' 
    AND column_name = 'correlation_id'
  ) THEN
    ALTER TABLE table_bookings ADD COLUMN correlation_id UUID DEFAULT gen_random_uuid();
    CREATE INDEX idx_bookings_correlation ON table_bookings(correlation_id);
  END IF;
END $$;

-- ========================================
-- 6. PHONE NUMBER NORMALIZATION
-- ========================================
-- Add normalized phone column to customers
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' 
    AND column_name = 'mobile_e164'
  ) THEN
    ALTER TABLE customers ADD COLUMN mobile_e164 VARCHAR(20);
    
    -- Create index for lookups
    CREATE UNIQUE INDEX idx_customers_mobile_e164 
      ON customers(mobile_e164) 
      WHERE mobile_e164 IS NOT NULL;
    
    -- Backfill with normalized numbers (UK specific)
    UPDATE customers 
    SET mobile_e164 = CASE
      WHEN mobile_number LIKE '0%' THEN '+44' || SUBSTRING(mobile_number FROM 2)
      WHEN mobile_number LIKE '44%' THEN '+' || mobile_number
      WHEN mobile_number LIKE '+44%' THEN mobile_number
      ELSE mobile_number
    END
    WHERE mobile_e164 IS NULL;
  END IF;
END $$;

-- ========================================
-- 7. FUNCTION: Check booking capacity atomically
-- ========================================
CREATE OR REPLACE FUNCTION check_and_reserve_capacity(
  p_service_date DATE,
  p_booking_time TIME,
  p_party_size INTEGER,
  p_booking_type table_booking_type,
  p_duration_minutes INTEGER DEFAULT 120
) RETURNS TABLE (
  available BOOLEAN,
  available_capacity INTEGER,
  message TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_slot RECORD;
  v_current_usage INTEGER;
  v_available_capacity INTEGER;
BEGIN
  -- Find applicable service slot (with lock)
  SELECT * INTO v_slot
  FROM service_slots
  WHERE service_date = p_service_date
    AND booking_type = p_booking_type
    AND p_booking_time >= starts_at
    AND p_booking_time < ends_at
    AND is_active = true
  FOR UPDATE;  -- Lock the row
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT 
      false, 
      0, 
      'No service slot configured for this time'::TEXT;
    RETURN;
  END IF;
  
  -- Calculate current usage (while holding lock)
  SELECT COALESCE(SUM(party_size), 0) INTO v_current_usage
  FROM table_bookings
  WHERE booking_date = p_service_date
    AND booking_type = p_booking_type
    AND status IN ('confirmed', 'pending_payment')
    AND booking_time >= v_slot.starts_at
    AND booking_time < v_slot.ends_at;
  
  v_available_capacity := v_slot.capacity - v_current_usage;
  
  IF v_available_capacity >= p_party_size THEN
    RETURN QUERY SELECT 
      true, 
      v_available_capacity, 
      'Capacity available'::TEXT;
  ELSE
    RETURN QUERY SELECT 
      false, 
      v_available_capacity, 
      FORMAT('Insufficient capacity. Only %s seats available', v_available_capacity)::TEXT;
  END IF;
END;
$$;

-- ========================================
-- 8. FUNCTION: Create booking transactionally
-- ========================================
CREATE OR REPLACE FUNCTION create_sunday_lunch_booking(
  p_customer_id UUID,
  p_booking_date DATE,
  p_booking_time TIME,
  p_party_size INTEGER,
  p_special_requirements TEXT DEFAULT NULL,
  p_dietary_requirements TEXT[] DEFAULT NULL,
  p_allergies TEXT[] DEFAULT NULL,
  p_correlation_id UUID DEFAULT gen_random_uuid()
) RETURNS TABLE (
  booking_id UUID,
  booking_reference VARCHAR,
  status table_booking_status,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_capacity_check RECORD;
  v_booking RECORD;
BEGIN
  -- Check capacity with lock
  SELECT * INTO v_capacity_check
  FROM check_and_reserve_capacity(
    p_booking_date,
    p_booking_time,
    p_party_size,
    'sunday_lunch'::table_booking_type
  );
  
  IF NOT v_capacity_check.available THEN
    RETURN QUERY SELECT 
      NULL::UUID,
      NULL::VARCHAR, 
      NULL::table_booking_status,
      v_capacity_check.message;
    RETURN;
  END IF;
  
  -- Create booking
  INSERT INTO table_bookings (
    customer_id,
    booking_date,
    booking_time,
    party_size,
    booking_type,
    status,
    special_requirements,
    dietary_requirements,
    allergies,
    correlation_id,
    booking_reference
  ) VALUES (
    p_customer_id,
    p_booking_date,
    p_booking_time,
    p_party_size,
    'sunday_lunch'::table_booking_type,
    'pending_payment'::table_booking_status,
    p_special_requirements,
    p_dietary_requirements,
    p_allergies,
    p_correlation_id,
    'SL' || TO_CHAR(CURRENT_DATE, 'YY') || '-' || LPAD(NEXTVAL('booking_reference_seq')::TEXT, 6, '0')
  )
  RETURNING * INTO v_booking;
  
  -- Log audit event
  INSERT INTO booking_audit (
    booking_id,
    event,
    new_status,
    meta
  ) VALUES (
    v_booking.id,
    'booking_created',
    'pending_payment',
    jsonb_build_object(
      'party_size', p_party_size,
      'booking_date', p_booking_date,
      'correlation_id', p_correlation_id
    )
  );
  
  RETURN QUERY SELECT 
    v_booking.id,
    v_booking.booking_reference,
    v_booking.status,
    'Booking created successfully'::TEXT;
END;
$$;

-- ========================================
-- 9. CREATE SEQUENCE FOR BOOKING REFERENCES
-- ========================================
CREATE SEQUENCE IF NOT EXISTS booking_reference_seq START 1000;

-- ========================================
-- 10. CLEANUP JOB FOR EXPIRED IDEMPOTENCY KEYS
-- ========================================
-- Run this periodically (via cron or scheduled function)
CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  DELETE FROM idempotency_keys
  WHERE expires_at < NOW();
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$;

-- ========================================
-- 11. INDEXES FOR PERFORMANCE
-- ========================================
-- Add missing indexes identified in discovery
CREATE INDEX IF NOT EXISTS idx_bookings_date_status 
  ON table_bookings(booking_date, status) 
  WHERE status IN ('confirmed', 'pending_payment');

CREATE INDEX IF NOT EXISTS idx_booking_items_booking 
  ON table_booking_items(booking_id);

CREATE INDEX IF NOT EXISTS idx_customers_mobile 
  ON customers(mobile_number);

-- ========================================
-- MIGRATION COMPLETE
-- ========================================
-- This migration adds:
-- 1. Idempotency protection
-- 2. Booking audit trail
-- 3. Service slots for capacity management
-- 4. Atomic capacity checking function
-- 5. Transactional booking creation function
-- 6. Phone number normalization
-- 7. Performance indexes
-- 8. Proper enum types for item_type
-- End 20250810170000_add_booking_idempotency_and_improvements.sql


-- Begin 20250811100000_auto_generate_service_slots.sql
-- Description: Automated service slot generation for table bookings
-- This ensures capacity slots are always available without manual intervention

-- ========================================
-- 1. FUNCTION: Auto-generate service slots
-- ========================================
CREATE OR REPLACE FUNCTION generate_service_slots_for_period(
  start_date DATE DEFAULT CURRENT_DATE,
  days_ahead INTEGER DEFAULT 90
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_end_date DATE;
  v_current_date DATE;
  v_day_of_week INTEGER;
  v_slots_created INTEGER := 0;
BEGIN
  v_end_date := start_date + days_ahead;
  v_current_date := start_date;
  
  WHILE v_current_date <= v_end_date LOOP
    v_day_of_week := EXTRACT(DOW FROM v_current_date);
    
    -- Sunday lunch slots (Sunday = 0)
    IF v_day_of_week = 0 THEN
      -- Early Sunday lunch sitting
      INSERT INTO service_slots (
        service_date,
        starts_at,
        ends_at,
        capacity,
        booking_type,
        is_active
      ) VALUES (
        v_current_date,
        '12:00:00'::TIME,
        '14:30:00'::TIME,
        50,
        'sunday_lunch'::table_booking_type,
        true
      ) ON CONFLICT (service_date, starts_at, booking_type) DO NOTHING;
      
      -- Late Sunday lunch sitting
      INSERT INTO service_slots (
        service_date,
        starts_at,
        ends_at,
        capacity,
        booking_type,
        is_active
      ) VALUES (
        v_current_date,
        '14:30:00'::TIME,
        '17:00:00'::TIME,
        50,
        'sunday_lunch'::table_booking_type,
        true
      ) ON CONFLICT (service_date, starts_at, booking_type) DO NOTHING;
      
      v_slots_created := v_slots_created + 2;
    END IF;
    
    -- Regular dinner service (Tuesday = 2 to Saturday = 6)
    IF v_day_of_week >= 2 AND v_day_of_week <= 6 THEN
      INSERT INTO service_slots (
        service_date,
        starts_at,
        ends_at,
        capacity,
        booking_type,
        is_active
      ) VALUES (
        v_current_date,
        '17:00:00'::TIME,
        '21:00:00'::TIME,
        50,
        'regular'::table_booking_type,
        true
      ) ON CONFLICT (service_date, starts_at, booking_type) DO NOTHING;
      
      v_slots_created := v_slots_created + 1;
    END IF;
    
    -- Friday and Saturday lunch (Friday = 5, Saturday = 6)
    IF v_day_of_week = 5 OR v_day_of_week = 6 THEN
      INSERT INTO service_slots (
        service_date,
        starts_at,
        ends_at,
        capacity,
        booking_type,
        is_active
      ) VALUES (
        v_current_date,
        '12:00:00'::TIME,
        '14:30:00'::TIME,
        50,
        'regular'::table_booking_type,
        true
      ) ON CONFLICT (service_date, starts_at, booking_type) DO NOTHING;
      
      v_slots_created := v_slots_created + 1;
    END IF;
    
    v_current_date := v_current_date + 1;
  END LOOP;
  
  RETURN v_slots_created;
END;
$$;

-- ========================================
-- 2. WEEKLY CRON JOB: Auto-generate slots
-- ========================================
-- This function will be called by your cron job
CREATE OR REPLACE FUNCTION auto_generate_weekly_slots()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_slots_created INTEGER;
  v_result JSONB;
BEGIN
  -- Generate slots for the next 90 days
  v_slots_created := generate_service_slots_for_period(CURRENT_DATE, 90);
  
  -- Log the result
  INSERT INTO audit_logs (
    entity_type,
    entity_id,
    operation_type,
    operation_status,
    additional_info
  ) VALUES (
    'service_slots',
    NULL,
    'auto_generate',
    'success',
    jsonb_build_object(
      'slots_created', v_slots_created,
      'run_date', CURRENT_DATE,
      'period_days', 90
    )
  );
  
  v_result := jsonb_build_object(
    'success', true,
    'slots_created', v_slots_created,
    'message', format('Generated %s service slots for the next 90 days', v_slots_created)
  );
  
  RETURN v_result;
END;
$$;

-- ========================================
-- 3. CONFIGURATION TABLE FOR SLOT SETTINGS
-- ========================================
-- This allows you to customize capacity and times without changing code
CREATE TABLE IF NOT EXISTS service_slot_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  slot_type VARCHAR(50) NOT NULL,
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 50,
  booking_type table_booking_type NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(day_of_week, starts_at, booking_type)
);

-- Insert default configuration
INSERT INTO service_slot_config (day_of_week, slot_type, starts_at, ends_at, capacity, booking_type) VALUES
-- Sunday lunch
(0, 'sunday_lunch_early', '12:00:00', '14:30:00', 50, 'sunday_lunch'),
(0, 'sunday_lunch_late', '14:30:00', '17:00:00', 50, 'sunday_lunch'),
-- Tuesday dinner
(2, 'dinner', '17:00:00', '21:00:00', 50, 'regular'),
-- Wednesday dinner
(3, 'dinner', '17:00:00', '21:00:00', 50, 'regular'),
-- Thursday dinner
(4, 'dinner', '17:00:00', '21:00:00', 50, 'regular'),
-- Friday lunch and dinner
(5, 'lunch', '12:00:00', '14:30:00', 50, 'regular'),
(5, 'dinner', '17:00:00', '21:00:00', 50, 'regular'),
-- Saturday lunch and dinner
(6, 'lunch', '12:00:00', '14:30:00', 50, 'regular'),
(6, 'dinner', '17:00:00', '21:00:00', 50, 'regular')
ON CONFLICT (day_of_week, starts_at, booking_type) DO NOTHING;

-- ========================================
-- 4. IMPROVED GENERATOR USING CONFIG
-- ========================================
CREATE OR REPLACE FUNCTION generate_service_slots_from_config(
  start_date DATE DEFAULT CURRENT_DATE,
  days_ahead INTEGER DEFAULT 90
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_end_date DATE;
  v_current_date DATE;
  v_day_of_week INTEGER;
  v_config RECORD;
  v_slots_created INTEGER := 0;
BEGIN
  v_end_date := start_date + days_ahead;
  v_current_date := start_date;
  
  WHILE v_current_date <= v_end_date LOOP
    v_day_of_week := EXTRACT(DOW FROM v_current_date);
    
    -- Get all configs for this day of week
    FOR v_config IN 
      SELECT * FROM service_slot_config 
      WHERE day_of_week = v_day_of_week 
      AND is_active = true
    LOOP
      INSERT INTO service_slots (
        service_date,
        starts_at,
        ends_at,
        capacity,
        booking_type,
        is_active
      ) VALUES (
        v_current_date,
        v_config.starts_at,
        v_config.ends_at,
        v_config.capacity,
        v_config.booking_type,
        true
      ) ON CONFLICT (service_date, starts_at, booking_type) DO UPDATE
      SET capacity = EXCLUDED.capacity,
          ends_at = EXCLUDED.ends_at,
          updated_at = NOW();
      
      v_slots_created := v_slots_created + 1;
    END LOOP;
    
    v_current_date := v_current_date + 1;
  END LOOP;
  
  RETURN v_slots_created;
END;
$$;

-- ========================================
-- 5. SPECIAL DATES HANDLING (Bank Holidays, etc)
-- ========================================
CREATE TABLE IF NOT EXISTS service_slot_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  override_date DATE NOT NULL,
  reason VARCHAR(255),
  is_closed BOOLEAN DEFAULT false,
  custom_capacity INTEGER,
  custom_hours JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(override_date)
);

-- Example: Christmas Day - closed
-- INSERT INTO service_slot_overrides (override_date, reason, is_closed) 
-- VALUES ('2025-12-25', 'Christmas Day', true);

-- ========================================
-- 6. CLEANUP OLD SLOTS (Optional)
-- ========================================
CREATE OR REPLACE FUNCTION cleanup_old_service_slots()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Delete service slots older than 1 month
  DELETE FROM service_slots
  WHERE service_date < CURRENT_DATE - INTERVAL '1 month';
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RETURN v_deleted_count;
END;
$$;

-- ========================================
-- 7. RUN INITIAL GENERATION
-- ========================================
-- Generate slots for the next 90 days immediately
SELECT generate_service_slots_from_config(CURRENT_DATE, 90);

-- ========================================
-- INSTRUCTIONS FOR CRON JOB SETUP
-- ========================================
-- Add this to your API cron endpoint (weekly run):
-- 
-- export async function GET(request: Request) {
--   const supabase = createAdminClient();
--   const { data, error } = await supabase.rpc('auto_generate_weekly_slots');
--   return NextResponse.json(data || { error: error?.message });
-- }
--
-- Then add to vercel.json:
-- {
--   "crons": [{
--     "path": "/api/cron/generate-slots",
--     "schedule": "0 2 * * 1"  // Every Monday at 2 AM
--   }]
-- }
-- End 20250811100000_auto_generate_service_slots.sql


-- Begin 20250811101000_fix_slot_generation_audit.sql
-- Fix the auto_generate_weekly_slots function to use correct audit_logs columns

CREATE OR REPLACE FUNCTION auto_generate_weekly_slots()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_slots_created INTEGER;
  v_result JSONB;
BEGIN
  -- Generate slots for the next 90 days
  v_slots_created := generate_service_slots_from_config(CURRENT_DATE, 90);
  
  -- Log the result (using correct column names)
  INSERT INTO audit_logs (
    resource_type,
    resource_id,
    operation_type,
    operation_status,
    additional_info
  ) VALUES (
    'service_slots',
    NULL,
    'auto_generate',
    'success',
    jsonb_build_object(
      'slots_created', v_slots_created,
      'run_date', CURRENT_DATE,
      'period_days', 90
    )
  );
  
  v_result := jsonb_build_object(
    'success', true,
    'slots_created', v_slots_created,
    'message', format('Generated %s service slots for the next 90 days', v_slots_created)
  );
  
  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    -- Return error without failing
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'message', 'Failed to generate slots'
    );
END;
$$;

-- Also create a simpler version without audit logging
CREATE OR REPLACE FUNCTION generate_slots_simple()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_slots_created INTEGER;
BEGIN
  -- Generate slots for the next 90 days
  v_slots_created := generate_service_slots_from_config(CURRENT_DATE, 90);
  
  RETURN format('Generated %s service slots', v_slots_created);
END;
$$;
-- End 20250811101000_fix_slot_generation_audit.sql


-- Begin 20250820195912_add_invoice_permissions.sql
-- Description: Add comprehensive invoice and quote permissions to RBAC system
-- This migration creates permissions for both 'invoices' and 'quotes' modules
-- and assigns them appropriately to existing roles

-- ========================================
-- 1. ADD INVOICE PERMISSIONS
-- ========================================
-- Insert invoice module permissions (check for existence first)
DO $$
BEGIN
  -- Invoice View Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'invoices' AND action = 'view'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('invoices', 'view', 'View invoices and access invoice list');
  END IF;

  -- Invoice Create Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'invoices' AND action = 'create'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('invoices', 'create', 'Create new invoices');
  END IF;

  -- Invoice Edit Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'invoices' AND action = 'edit'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('invoices', 'edit', 'Edit existing invoices');
  END IF;

  -- Invoice Delete Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'invoices' AND action = 'delete'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('invoices', 'delete', 'Delete invoices');
  END IF;

  -- Invoice Export Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'invoices' AND action = 'export'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('invoices', 'export', 'Export invoices to PDF/Excel');
  END IF;

  -- Invoice Manage Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'invoices' AND action = 'manage'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('invoices', 'manage', 'Full invoice management including settings and templates');
  END IF;

  -- Invoice Send Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'invoices' AND action = 'send'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('invoices', 'send', 'Send invoices via email');
  END IF;
END $$;

-- ========================================
-- 2. ADD QUOTE PERMISSIONS
-- ========================================
-- Insert quote module permissions (check for existence first)
DO $$
BEGIN
  -- Quote View Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'quotes' AND action = 'view'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('quotes', 'view', 'View quotes and access quote list');
  END IF;

  -- Quote Create Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'quotes' AND action = 'create'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('quotes', 'create', 'Create new quotes');
  END IF;

  -- Quote Edit Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'quotes' AND action = 'edit'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('quotes', 'edit', 'Edit existing quotes');
  END IF;

  -- Quote Delete Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'quotes' AND action = 'delete'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('quotes', 'delete', 'Delete quotes');
  END IF;

  -- Quote Export Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'quotes' AND action = 'export'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('quotes', 'export', 'Export quotes to PDF/Excel');
  END IF;

  -- Quote Manage Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'quotes' AND action = 'manage'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('quotes', 'manage', 'Full quote management including settings and templates');
  END IF;

  -- Quote Send Permission
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'quotes' AND action = 'send'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('quotes', 'send', 'Send quotes via email');
  END IF;

  -- Quote Convert Permission (unique to quotes)
  IF NOT EXISTS (
    SELECT 1 FROM permissions 
    WHERE module_name = 'quotes' AND action = 'convert'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('quotes', 'convert', 'Convert quotes to invoices');
  END IF;
END $$;

-- ========================================
-- 3. ASSIGN PERMISSIONS TO ROLES
-- ========================================
-- Assign permissions to existing roles based on role hierarchy:
-- - super_admin: All permissions
-- - manager: All except delete
-- - staff: View only

DO $$
DECLARE
  super_admin_role_id UUID;
  manager_role_id UUID;
  staff_role_id UUID;
BEGIN
  -- Get role IDs (with error handling)
  SELECT id INTO super_admin_role_id FROM roles WHERE name = 'super_admin' LIMIT 1;
  SELECT id INTO manager_role_id FROM roles WHERE name = 'manager' LIMIT 1;  
  SELECT id INTO staff_role_id FROM roles WHERE name = 'staff' LIMIT 1;

  -- ========================================
  -- SUPER_ADMIN ROLE: Full access to both invoices and quotes
  -- ========================================
  IF super_admin_role_id IS NOT NULL THEN
    -- Invoice permissions for super_admin
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT super_admin_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'invoices' 
      AND p.action IN ('view', 'create', 'edit', 'delete', 'export', 'manage', 'send')
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = super_admin_role_id AND rp.permission_id = p.id
      );

    -- Quote permissions for super_admin
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT super_admin_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'quotes' 
      AND p.action IN ('view', 'create', 'edit', 'delete', 'export', 'manage', 'send', 'convert')
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = super_admin_role_id AND rp.permission_id = p.id
      );
  END IF;

  -- ========================================
  -- MANAGER ROLE: All permissions except delete
  -- ========================================
  IF manager_role_id IS NOT NULL THEN
    -- Invoice permissions for manager (all except delete)
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT manager_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'invoices' 
      AND p.action IN ('view', 'create', 'edit', 'export', 'manage', 'send')
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = manager_role_id AND rp.permission_id = p.id
      );

    -- Quote permissions for manager (all except delete)
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT manager_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'quotes' 
      AND p.action IN ('view', 'create', 'edit', 'export', 'manage', 'send', 'convert')
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = manager_role_id AND rp.permission_id = p.id
      );
  END IF;

  -- ========================================
  -- STAFF ROLE: View-only access
  -- ========================================
  IF staff_role_id IS NOT NULL THEN
    -- Invoice permissions for staff (view only)
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT staff_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'invoices' 
      AND p.action = 'view'
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = staff_role_id AND rp.permission_id = p.id
      );

    -- Quote permissions for staff (view only)
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT staff_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'quotes' 
      AND p.action = 'view'
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = staff_role_id AND rp.permission_id = p.id
      );
  END IF;

  -- Log completion
  RAISE NOTICE 'Invoice and quote permissions have been successfully created and assigned to roles';
  RAISE NOTICE 'Super Admin: Full access to both invoices and quotes';
  RAISE NOTICE 'Manager: All permissions except delete for both modules';
  RAISE NOTICE 'Staff: View-only access for both modules';
END $$;

-- ========================================
-- 4. CREATE INDEXES FOR PERFORMANCE
-- ========================================
-- Add indexes for the new permissions (if not already exists)
CREATE INDEX IF NOT EXISTS idx_permissions_invoice_module 
  ON permissions(module_name) 
  WHERE module_name IN ('invoices', 'quotes');

-- ========================================
-- 5. VERIFICATION QUERIES
-- ========================================
-- These can be run manually to verify the migration worked correctly:
-- 
-- SELECT p.module_name, p.action, p.description 
-- FROM permissions p 
-- WHERE p.module_name IN ('invoices', 'quotes')
-- ORDER BY p.module_name, p.action;
--
-- SELECT r.name, p.module_name, p.action 
-- FROM roles r
-- JOIN role_permissions rp ON r.id = rp.role_id
-- JOIN permissions p ON rp.permission_id = p.id
-- WHERE p.module_name IN ('invoices', 'quotes')
-- ORDER BY r.name, p.module_name, p.action;

-- ========================================
-- MIGRATION COMPLETE
-- ========================================
-- This migration adds comprehensive RBAC permissions for:
-- 
-- INVOICE MODULE:
-- - view: View invoices and access invoice list
-- - create: Create new invoices  
-- - edit: Edit existing invoices
-- - delete: Delete invoices (super_admin only)
-- - export: Export invoices to PDF/Excel
-- - manage: Full management including settings and templates
-- - send: Send invoices via email
--
-- QUOTE MODULE:
-- - view: View quotes and access quote list
-- - create: Create new quotes
-- - edit: Edit existing quotes  
-- - delete: Delete quotes (super_admin only)
-- - export: Export quotes to PDF/Excel
-- - manage: Full management including settings and templates
-- - send: Send quotes via email
-- - convert: Convert quotes to invoices
--
-- ROLE ASSIGNMENTS:
-- - super_admin: All permissions for both modules
-- - manager: All permissions except delete for both modules  
-- - staff: View-only for both modules
-- End 20250820195912_add_invoice_permissions.sql

-- Invoice base tables (from production schema dump)
CREATE TABLE IF NOT EXISTS public.invoice_vendors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(200) NOT NULL,
    contact_name character varying(200),
    email character varying(255),
    phone character varying(50),
    address text,
    vat_number character varying(50),
    payment_terms integer DEFAULT 30,
    notes text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoice_vendor_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid NOT NULL,
    name text,
    email text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.invoice_series (
    series_code character varying(10) PRIMARY KEY,
    current_sequence integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_number character varying(50) NOT NULL,
    vendor_id uuid,
    invoice_date date DEFAULT CURRENT_DATE NOT NULL,
    due_date date NOT NULL,
    reference character varying(200),
    status character varying(20) DEFAULT 'draft'::character varying,
    invoice_discount_percentage numeric(5,2) DEFAULT 0,
    subtotal_amount numeric(10,2) DEFAULT 0,
    discount_amount numeric(10,2) DEFAULT 0,
    vat_amount numeric(10,2) DEFAULT 0,
    total_amount numeric(10,2) DEFAULT 0,
    paid_amount numeric(10,2) DEFAULT 0,
    notes text,
    internal_notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    deleted_by uuid,
    CONSTRAINT invoices_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'sent'::character varying, 'paid'::character varying, 'partially_paid'::character varying, 'overdue'::character varying, 'void'::character varying, 'written_off'::character varying])::text[])))
);

CREATE TABLE IF NOT EXISTS public.quotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quote_number character varying(50) NOT NULL,
    vendor_id uuid,
    quote_date date DEFAULT CURRENT_DATE NOT NULL,
    valid_until date NOT NULL,
    reference character varying(200),
    status character varying(20) DEFAULT 'draft'::character varying,
    quote_discount_percentage numeric(5,2) DEFAULT 0,
    subtotal_amount numeric(10,2) DEFAULT 0,
    discount_amount numeric(10,2) DEFAULT 0,
    vat_amount numeric(10,2) DEFAULT 0,
    total_amount numeric(10,2) DEFAULT 0,
    notes text,
    internal_notes text,
    converted_to_invoice_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT quotes_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'sent'::character varying, 'accepted'::character varying, 'rejected'::character varying, 'expired'::character varying])::text[])))
);

CREATE TABLE IF NOT EXISTS public.recurring_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid,
    frequency character varying(20),
    start_date date NOT NULL,
    end_date date,
    next_invoice_date date NOT NULL,
    days_before_due integer DEFAULT 30,
    reference character varying(200),
    invoice_discount_percentage numeric(5,2) DEFAULT 0,
    notes text,
    internal_notes text,
    is_active boolean DEFAULT true,
    last_invoice_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT recurring_invoices_frequency_check CHECK (((frequency)::text = ANY ((ARRAY['weekly'::character varying, 'monthly'::character varying, 'quarterly'::character varying, 'yearly'::character varying])::text[])))
);

CREATE TABLE IF NOT EXISTS public.invoice_line_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    catalog_item_id uuid,
    description text NOT NULL,
    quantity numeric(10,3) DEFAULT 1,
    unit_price numeric(10,2) DEFAULT 0,
    discount_percentage numeric(5,2) DEFAULT 0,
    vat_rate numeric(5,2) DEFAULT 20,
    subtotal_amount numeric(10,2) DEFAULT 0,
    discount_amount numeric(10,2) DEFAULT 0,
    vat_amount numeric(10,2) DEFAULT 0,
    total_amount numeric(10,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoice_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    payment_date date DEFAULT CURRENT_DATE NOT NULL,
    amount numeric(10,2) NOT NULL,
    payment_method character varying(50),
    reference character varying(200),
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT invoice_payments_payment_method_check CHECK (((payment_method)::text = ANY ((ARRAY['bank_transfer'::character varying, 'cash'::character varying, 'cheque'::character varying, 'card'::character varying, 'other'::character varying])::text[])))
);

CREATE TABLE IF NOT EXISTS public.invoice_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid,
    action character varying(50) NOT NULL,
    performed_by uuid,
    performed_by_email character varying(255),
    details jsonb DEFAULT '{}'::jsonb,
    old_values jsonb,
    new_values jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoice_email_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid,
    quote_id uuid,
    sent_at timestamp with time zone DEFAULT now(),
    sent_to character varying(255),
    sent_by character varying(255),
    subject text,
    body text,
    status character varying(20),
    error_message text,
    message_id character varying(255),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT chk_one_reference CHECK (((invoice_id IS NOT NULL) AND (quote_id IS NULL)) OR ((invoice_id IS NULL) AND (quote_id IS NOT NULL))),
    CONSTRAINT invoice_email_logs_status_check CHECK (((status)::text = ANY ((ARRAY['sent'::character varying, 'failed'::character varying, 'bounced'::character varying])::text[])))
);

CREATE TABLE IF NOT EXISTS public.invoice_email_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_type character varying(50) NOT NULL,
    subject_template text NOT NULL,
    body_template text NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoice_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid,
    email_type character varying(50) NOT NULL,
    recipient_email character varying(255) NOT NULL,
    cc_emails text[],
    bcc_emails text[],
    subject text NOT NULL,
    body text NOT NULL,
    attachments jsonb DEFAULT '[]'::jsonb,
    message_id character varying(255),
    sent_at timestamp with time zone,
    error_message text,
    status character varying(20) DEFAULT 'pending'::character varying,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT invoice_emails_email_type_check CHECK (((email_type)::text = ANY ((ARRAY['new_invoice'::character varying, 'reminder'::character varying, 'chase'::character varying, 'credit_note'::character varying, 'statement'::character varying, 'quote'::character varying])::text[]))),
    CONSTRAINT invoice_emails_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'sent'::character varying, 'failed'::character varying])::text[])))
);

CREATE TABLE IF NOT EXISTS public.invoice_reminder_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enabled boolean DEFAULT true,
    reminder_email character varying(255) DEFAULT 'peter@orangejelly.co.uk'::character varying,
    days_before_due integer[] DEFAULT ARRAY[7, 3, 1],
    days_after_due integer[] DEFAULT ARRAY[1, 7, 14, 30],
    reminder_time time without time zone DEFAULT '09:00:00'::time without time zone,
    exclude_vendors uuid[] DEFAULT '{}'::uuid[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


-- Begin 20250820200100_initialize_invoice_series.sql
-- Description: Initialize invoice series for invoice and quote numbering
-- This ensures the invoice_series table has the required series codes

-- Initialize invoice series (INV for invoices, QTE for quotes)
INSERT INTO invoice_series (series_code, current_sequence)
VALUES 
  ('INV', 0),
  ('QTE', 0)
ON CONFLICT (series_code) 
DO NOTHING;

-- Verify the series exist
DO $$
DECLARE
  inv_count INTEGER;
  qte_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO inv_count FROM invoice_series WHERE series_code = 'INV';
  SELECT COUNT(*) INTO qte_count FROM invoice_series WHERE series_code = 'QTE';
  
  IF inv_count > 0 AND qte_count > 0 THEN
    RAISE NOTICE 'Invoice series initialized successfully: INV and QTE series ready';
  ELSE
    RAISE WARNING 'Invoice series initialization may have failed. Please check manually.';
  END IF;
END $$;
-- End 20250820200100_initialize_invoice_series.sql


-- Begin 20250821083439_add_sms_error_tracking.sql
-- Add SMS error tracking fields and improve status handling
-- Description: Adds error_code, error_message fields to messages table and creates indexes for stuck message queries

-- Add error tracking columns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'error_code'
  ) THEN
    ALTER TABLE messages ADD COLUMN error_code TEXT;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'error_message'
  ) THEN
    ALTER TABLE messages ADD COLUMN error_message TEXT;
  END IF;
  
  -- Add sent_at if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'sent_at'
  ) THEN
    ALTER TABLE messages ADD COLUMN sent_at TIMESTAMPTZ;
  END IF;
  
  -- Add delivered_at if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'delivered_at'
  ) THEN
    ALTER TABLE messages ADD COLUMN delivered_at TIMESTAMPTZ;
  END IF;
  
  -- Add failed_at if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'failed_at'
  ) THEN
    ALTER TABLE messages ADD COLUMN failed_at TIMESTAMPTZ;
  END IF;
END $$;

-- Create unique index on twilio_message_sid for fast lookups and uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS messages_twilio_sid_unique_idx 
ON messages (twilio_message_sid) 
WHERE twilio_message_sid IS NOT NULL;

-- Create partial index for stuck messages (queued/sent status)
-- This speeds up reconciliation queries
CREATE INDEX IF NOT EXISTS messages_stuck_idx 
ON messages (status, created_at) 
WHERE status IN ('queued', 'sent') AND direction IN ('outbound', 'outbound-api');

-- Create index for webhook status updates
CREATE INDEX IF NOT EXISTS messages_twilio_sid_idx 
ON messages (twilio_message_sid) 
WHERE twilio_message_sid IS NOT NULL;

-- Add note column to message_delivery_status for tracking regression prevention
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'message_delivery_status' AND column_name = 'note'
  ) THEN
    ALTER TABLE message_delivery_status ADD COLUMN note TEXT;
  END IF;
END $$;

-- Create index on message_delivery_status for history queries
CREATE INDEX IF NOT EXISTS message_delivery_status_message_created_idx 
ON message_delivery_status (message_id, created_at DESC);

-- Add direction value for API-sent messages (if not exists)
-- This helps distinguish between different outbound message types
DO $$
BEGIN
  -- Check if 'outbound-api' is already in the enum
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_enum 
    WHERE enumlabel = 'outbound-api' 
    AND enumtypid = (
      SELECT oid FROM pg_type WHERE typname = 'message_direction'
    )
  ) THEN
    -- Note: Adding enum values requires careful handling
    -- If this fails, it means the enum type doesn't exist or has different structure
    -- In that case, we'll just use the existing values
    BEGIN
      ALTER TYPE message_direction ADD VALUE IF NOT EXISTS 'outbound-api';
    EXCEPTION WHEN OTHERS THEN
      -- Enum might not exist or might be defined differently
      NULL;
    END;
  END IF;
END $$;

-- Create a function to clean old webhook logs (keep 90 days)
CREATE OR REPLACE FUNCTION cleanup_old_webhook_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM webhook_logs 
  WHERE processed_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

-- Create a scheduled job to clean webhook logs (if pg_cron is available)
-- Note: This requires pg_cron extension which may not be available
-- Uncomment if pg_cron is installed:
-- SELECT cron.schedule('cleanup-webhook-logs', '0 2 * * *', 'SELECT cleanup_old_webhook_logs();');

-- Add comment documentation
COMMENT ON COLUMN messages.error_code IS 'Twilio error code if message failed';
COMMENT ON COLUMN messages.error_message IS 'Human-readable error message';
COMMENT ON COLUMN messages.sent_at IS 'Timestamp when message was sent by Twilio';
COMMENT ON COLUMN messages.delivered_at IS 'Timestamp when message was delivered to recipient';
COMMENT ON COLUMN messages.failed_at IS 'Timestamp when message delivery failed';
COMMENT ON INDEX messages_stuck_idx IS 'Speeds up queries for stuck messages needing reconciliation';
COMMENT ON INDEX messages_twilio_sid_unique_idx IS 'Ensures unique Twilio SIDs and speeds up webhook lookups';
-- End 20250821083439_add_sms_error_tracking.sql


-- Begin 20250822_event_sms_reminder_system.sql
-- Migration: Enhanced Event SMS Reminder System
-- Description: Adds new reminder types and booking source tracking for improved SMS messaging

-- 1. Add new reminder types to the enum (if using enum)
-- First check if we're using an enum or just text
DO $$
BEGIN
  -- Check if reminder_type enum exists
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reminder_type') THEN
    -- Try to add new values to existing enum (wrapped in exception handler)
    BEGIN
      ALTER TYPE reminder_type ADD VALUE IF NOT EXISTS 'no_seats_2_weeks';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TYPE reminder_type ADD VALUE IF NOT EXISTS 'no_seats_1_week';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TYPE reminder_type ADD VALUE IF NOT EXISTS 'no_seats_day_before';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TYPE reminder_type ADD VALUE IF NOT EXISTS 'has_seats_1_week';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER TYPE reminder_type ADD VALUE IF NOT EXISTS 'has_seats_day_before';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- 2. Add booking_source to bookings table to track how booking was created
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bookings' AND column_name = 'booking_source'
  ) THEN
    ALTER TABLE bookings 
    ADD COLUMN booking_source TEXT DEFAULT 'direct_booking'
    CHECK (booking_source IN ('direct_booking', 'bulk_add', 'customer_portal', 'sms_reply', 'import'));
  END IF;
END $$;

-- 3. Add last_reminder_sent to bookings table for tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bookings' AND column_name = 'last_reminder_sent'
  ) THEN
    ALTER TABLE bookings 
    ADD COLUMN last_reminder_sent TIMESTAMPTZ;
  END IF;
END $$;

-- 4. Ensure booking_reminders table has proper structure
-- First add missing columns if the table already exists
DO $$
BEGIN
  -- Check if table exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'booking_reminders'
  ) THEN
    -- Add scheduled_for column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'booking_reminders' AND column_name = 'scheduled_for'
    ) THEN
      ALTER TABLE booking_reminders 
      ADD COLUMN scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW();
    END IF;
    
    -- Add status column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'booking_reminders' AND column_name = 'status'
    ) THEN
      ALTER TABLE booking_reminders 
      ADD COLUMN status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled'));
    END IF;
    
    -- Add error_message column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'booking_reminders' AND column_name = 'error_message'
    ) THEN
      ALTER TABLE booking_reminders 
      ADD COLUMN error_message TEXT;
    END IF;
    
    -- Add message_id column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'booking_reminders' AND column_name = 'message_id'
    ) THEN
      ALTER TABLE booking_reminders 
      ADD COLUMN message_id TEXT;
    END IF;
    
    -- Add updated_at column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'booking_reminders' AND column_name = 'updated_at'
    ) THEN
      ALTER TABLE booking_reminders 
      ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
  END IF;
END $$;

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS booking_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  error_message TEXT,
  message_id TEXT, -- Twilio message SID
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Add indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_booking_reminders_scheduled 
ON booking_reminders(scheduled_for, status) 
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_booking_reminders_booking 
ON booking_reminders(booking_id, reminder_type);

CREATE INDEX IF NOT EXISTS idx_bookings_source 
ON bookings(booking_source);

CREATE INDEX IF NOT EXISTS idx_bookings_event_seats 
ON bookings(event_id, seats);

-- 6. Create or update the function to prevent duplicate reminders
CREATE OR REPLACE FUNCTION prevent_duplicate_reminders()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if a reminder of the same type already exists for this booking
  IF EXISTS (
    SELECT 1 FROM booking_reminders 
    WHERE booking_id = NEW.booking_id 
    AND reminder_type = NEW.reminder_type 
    AND status IN ('pending', 'sent')
    AND id != NEW.id
  ) THEN
    RAISE EXCEPTION 'Duplicate reminder already exists for booking % with type %', 
      NEW.booking_id, NEW.reminder_type;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Create trigger for duplicate prevention
DROP TRIGGER IF EXISTS prevent_duplicate_reminders_trigger ON booking_reminders;
CREATE TRIGGER prevent_duplicate_reminders_trigger
  BEFORE INSERT OR UPDATE ON booking_reminders
  FOR EACH ROW
  EXECUTE FUNCTION prevent_duplicate_reminders();

-- 8. Add RLS policies for booking_reminders
ALTER TABLE booking_reminders ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist and recreate
DROP POLICY IF EXISTS "Users can view reminders for accessible bookings" ON booking_reminders;
CREATE POLICY "Users can view reminders for accessible bookings" 
ON booking_reminders FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.id = booking_reminders.booking_id
  )
);

-- Only service role can insert/update/delete reminders
DROP POLICY IF EXISTS "Service role can manage reminders" ON booking_reminders;
CREATE POLICY "Service role can manage reminders" 
ON booking_reminders FOR ALL 
USING (auth.jwt() ->> 'role' = 'service_role')
WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- 9. Add helper function to calculate reminder dates
CREATE OR REPLACE FUNCTION calculate_reminder_dates(
  event_date DATE,
  event_time TEXT,
  has_seats BOOLEAN
)
RETURNS TABLE (
  reminder_type TEXT,
  scheduled_for TIMESTAMPTZ
) AS $$
DECLARE
  event_datetime TIMESTAMPTZ;
  days_until_event INTEGER;
BEGIN
  -- Combine date and time
  event_datetime := (event_date || ' ' || event_time)::TIMESTAMPTZ;
  days_until_event := (event_date - CURRENT_DATE);
  
  IF has_seats THEN
    -- Has seats: 1 week and 1 day before
    IF days_until_event >= 7 THEN
      RETURN QUERY SELECT 'has_seats_1_week'::TEXT, event_datetime - INTERVAL '7 days';
    END IF;
    IF days_until_event >= 1 THEN
      RETURN QUERY SELECT 'has_seats_day_before'::TEXT, event_datetime - INTERVAL '1 day';
    END IF;
  ELSE
    -- No seats: 2 weeks, 1 week, and 1 day before
    IF days_until_event >= 14 THEN
      RETURN QUERY SELECT 'no_seats_2_weeks'::TEXT, event_datetime - INTERVAL '14 days';
    END IF;
    IF days_until_event >= 7 THEN
      RETURN QUERY SELECT 'no_seats_1_week'::TEXT, event_datetime - INTERVAL '7 days';
    END IF;
    IF days_until_event >= 1 THEN
      RETURN QUERY SELECT 'no_seats_day_before'::TEXT, event_datetime - INTERVAL '1 day';
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 10. Update existing bookings to have booking_source
UPDATE bookings 
SET booking_source = CASE 
  WHEN seats > 0 THEN 'direct_booking'
  ELSE 'bulk_add'
END
WHERE booking_source IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN bookings.booking_source IS 'Source of booking creation: direct_booking (New Booking button), bulk_add (Add Attendees), customer_portal, sms_reply, import';
COMMENT ON COLUMN bookings.last_reminder_sent IS 'Timestamp of the last reminder sent for this booking';
COMMENT ON TABLE booking_reminders IS 'Tracks scheduled and sent SMS reminders for event bookings';
-- End 20250822_event_sms_reminder_system.sql


-- Begin 20250912_add_invoice_vendor_contacts.sql
-- Create a normalized contacts table for invoice vendors
create table if not exists public.invoice_vendor_contacts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.invoice_vendors(id) on delete cascade,
  name text,
  email text not null,
  is_primary boolean not null default false,
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_invoice_vendor_contacts_vendor on public.invoice_vendor_contacts(vendor_id);
create index if not exists idx_invoice_vendor_contacts_email on public.invoice_vendor_contacts(email);

-- Ensure only one primary contact per vendor
create or replace function public.enforce_single_primary_vendor_contact()
returns trigger as $$
begin
  if new.is_primary then
    update public.invoice_vendor_contacts
      set is_primary = false
      where vendor_id = new.vendor_id and id <> new.id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_single_primary_vendor_contact on public.invoice_vendor_contacts;
create trigger trg_single_primary_vendor_contact
before insert or update on public.invoice_vendor_contacts
for each row execute procedure public.enforce_single_primary_vendor_contact();

-- End 20250912_add_invoice_vendor_contacts.sql


-- Begin 2025091301_backfill_short_link_counts.sql
-- Backfill click_count and last_clicked_at from short_link_clicks
update public.short_links sl
set click_count = coalesce(c.cnt, 0),
    last_clicked_at = c.last_clicked_at
from (
  select short_link_id,
         count(*) as cnt,
         max(clicked_at) as last_clicked_at
  from public.short_link_clicks
  group by short_link_id
) c
where sl.id = c.short_link_id;

-- Ensure links with no clicks have 0
update public.short_links
set click_count = 0
where click_count is null;

-- End 2025091301_backfill_short_link_counts.sql


-- Begin 20250914_add_name_to_short_links.sql
alter table public.short_links
  add column if not exists name text;

-- End 20250914_add_name_to_short_links.sql


-- Begin 20250915093000_sms_reminder_overhaul.sql
-- SMS reminder overhaul: align schema with new scheduling pipeline

-- 1. Expand reminder_type constraint to include new cadence types while keeping legacy values
ALTER TABLE booking_reminders
  DROP CONSTRAINT IF EXISTS booking_reminders_reminder_type_check;

ALTER TABLE booking_reminders
  ADD CONSTRAINT booking_reminders_reminder_type_check
  CHECK (
    reminder_type IN (
      'booking_confirmation',
      'booked_1_month',
      'booked_1_week',
      'booked_1_day',
      'reminder_invite_1_month',
      'reminder_invite_1_week',
      'reminder_invite_1_day',
      'no_seats_2_weeks',
      'no_seats_1_week',
      'no_seats_day_before',
      'has_seats_1_week',
      'has_seats_day_before',
      'booking_reminder_24_hour',
      'booking_reminder_7_day',
      -- legacy values retained for historical rows
      '24_hour',
      '7_day',
      '12_hour',
      '1_hour',
      'custom'
    )
  );

-- 2. Ensure event_id and target_phone columns exist for deduping per guest
ALTER TABLE booking_reminders
  ADD COLUMN IF NOT EXISTS event_id UUID;

ALTER TABLE booking_reminders
  ADD COLUMN IF NOT EXISTS target_phone TEXT;

-- 3. Backfill event_id and target_phone using current booking/customer data
WITH booking_data AS (
  SELECT br.id,
         b.event_id,
         c.mobile_number
  FROM booking_reminders br
  JOIN bookings b ON b.id = br.booking_id
  JOIN customers c ON c.id = b.customer_id
)
UPDATE booking_reminders br
SET event_id = COALESCE(br.event_id, booking_data.event_id),
    target_phone = COALESCE(br.target_phone, booking_data.mobile_number)
FROM booking_data
WHERE br.id = booking_data.id
  AND (br.event_id IS NULL OR br.target_phone IS NULL);

-- 4. Normalise target_phone format by trimming whitespace
UPDATE booking_reminders
SET target_phone = NULLIF(trim(target_phone), '')
WHERE target_phone IS NOT NULL;

-- 5. Create partial unique index to prevent duplicated sends per event/phone/type
DROP INDEX IF EXISTS idx_booking_reminders_phone_unique;
CREATE UNIQUE INDEX idx_booking_reminders_phone_unique
  ON booking_reminders(event_id, target_phone, reminder_type)
  WHERE status IN ('pending', 'sent') AND target_phone IS NOT NULL;

-- 6. Refresh trigger to enforce uniqueness and backfill missing metadata automatically
CREATE OR REPLACE FUNCTION prevent_duplicate_reminders()
RETURNS TRIGGER AS $$
DECLARE
  v_event_id UUID;
  v_phone TEXT;
BEGIN
  -- Resolve event id and phone if not supplied
  IF NEW.event_id IS NULL OR NEW.target_phone IS NULL THEN
    SELECT b.event_id, c.mobile_number
    INTO v_event_id, v_phone
    FROM bookings b
    JOIN customers c ON c.id = b.customer_id
    WHERE b.id = NEW.booking_id;

    IF NEW.event_id IS NULL THEN
      NEW.event_id := v_event_id;
    END IF;
    IF NEW.target_phone IS NULL THEN
      NEW.target_phone := v_phone;
    END IF;
  END IF;

  -- Prevent duplicates for the same guest/event/type when reminder is still active
  IF EXISTS (
    SELECT 1
    FROM booking_reminders br
    WHERE br.id <> NEW.id
      AND br.event_id = NEW.event_id
      AND br.reminder_type = NEW.reminder_type
      AND br.target_phone = NEW.target_phone
      AND br.status IN ('pending', 'sent')
  ) THEN
    RAISE EXCEPTION 'Duplicate reminder already exists for event %, phone %, type %',
      NEW.event_id, NEW.target_phone, NEW.reminder_type;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_duplicate_reminders_trigger ON booking_reminders;
CREATE TRIGGER prevent_duplicate_reminders_trigger
  BEFORE INSERT OR UPDATE ON booking_reminders
  FOR EACH ROW
  EXECUTE FUNCTION prevent_duplicate_reminders();

-- 7. Touch updated_at when metadata changes
ALTER TABLE booking_reminders
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE OR REPLACE FUNCTION booking_reminders_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_reminders_set_updated_at_trigger ON booking_reminders;
CREATE TRIGGER booking_reminders_set_updated_at_trigger
  BEFORE UPDATE ON booking_reminders
  FOR EACH ROW
  EXECUTE FUNCTION booking_reminders_set_updated_at();
-- End 20250915093000_sms_reminder_overhaul.sql


-- Begin 20251002170554_create_parking_tables.sql
-- Parking module core schema

-- enums for booking and payment status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'parking_booking_status') THEN
    CREATE TYPE parking_booking_status AS ENUM ('pending_payment', 'confirmed', 'completed', 'cancelled', 'expired');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'parking_payment_status') THEN
    CREATE TYPE parking_payment_status AS ENUM ('pending', 'paid', 'refunded', 'failed', 'expired');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'parking_notification_channel') THEN
    CREATE TYPE parking_notification_channel AS ENUM ('sms', 'email');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'parking_notification_event') THEN
    CREATE TYPE parking_notification_event AS ENUM (
      'payment_request',
      'payment_reminder',
      'payment_confirmation',
      'session_start',
      'session_end',
      'payment_overdue',
      'refund_confirmation'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.parking_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_from timestamptz NOT NULL DEFAULT timezone('utc', now()),
  hourly_rate numeric(12, 2) NOT NULL,
  daily_rate numeric(12, 2) NOT NULL,
  weekly_rate numeric(12, 2) NOT NULL,
  monthly_rate numeric(12, 2) NOT NULL,
  capacity_override integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.parking_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text UNIQUE NOT NULL,
  customer_id uuid REFERENCES public.customers (id) ON DELETE RESTRICT,
  customer_first_name text NOT NULL,
  customer_last_name text,
  customer_mobile text NOT NULL,
  customer_email text,
  vehicle_registration text NOT NULL,
  vehicle_make text,
  vehicle_model text,
  vehicle_colour text,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL,
  calculated_price numeric(12,2) NOT NULL,
  pricing_breakdown jsonb NOT NULL,
  override_price numeric(12,2),
  override_reason text,
  capacity_override boolean DEFAULT false,
  capacity_override_reason text,
  status parking_booking_status NOT NULL DEFAULT 'pending_payment',
  payment_status parking_payment_status NOT NULL DEFAULT 'pending',
  payment_due_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  notes text,
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.parking_booking_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.parking_bookings (id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'paypal',
  status parking_payment_status NOT NULL DEFAULT 'pending',
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'GBP',
  paypal_order_id text,
  transaction_id text,
  expires_at timestamptz,
  paid_at timestamptz,
  refunded_at timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.parking_booking_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.parking_bookings (id) ON DELETE CASCADE,
  channel parking_notification_channel NOT NULL,
  event_type parking_notification_event NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  message_sid text,
  email_message_id text,
  payload jsonb,
  error text,
  sent_at timestamptz,
  retries integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE OR REPLACE FUNCTION public.generate_parking_reference()
RETURNS trigger AS $$
DECLARE
  prefix text := 'PAR';
  today text := to_char(timezone('Europe/London', now()), 'YYYYMMDD');
  seq int;
  candidate text;
BEGIN
  IF NEW.reference IS NOT NULL THEN
    RETURN NEW;
  END IF;

  LOOP
    SELECT COALESCE(MAX(split_part(reference, '-', 3)::int), 0) + 1
      INTO seq
      FROM public.parking_bookings
      WHERE split_part(reference, '-', 1) = prefix
        AND split_part(reference, '-', 2) = today;

    candidate := prefix || '-' || today || '-' || lpad(seq::text, 4, '0');

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.parking_bookings WHERE reference = candidate
    );
  END LOOP;

  NEW.reference := candidate;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_generate_parking_reference
BEFORE INSERT ON public.parking_bookings
FOR EACH ROW
EXECUTE FUNCTION public.generate_parking_reference();

CREATE OR REPLACE FUNCTION public.set_parking_booking_timestamps()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, timezone('utc', now()));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_parking_booking_timestamps
BEFORE INSERT OR UPDATE ON public.parking_bookings
FOR EACH ROW
EXECUTE FUNCTION public.set_parking_booking_timestamps();

CREATE OR REPLACE FUNCTION public.set_parking_payment_timestamps()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, timezone('utc', now()));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_parking_payment_timestamps
BEFORE INSERT OR UPDATE ON public.parking_booking_payments
FOR EACH ROW
EXECUTE FUNCTION public.set_parking_payment_timestamps();

CREATE INDEX IF NOT EXISTS parking_bookings_customer_idx
  ON public.parking_bookings (customer_id);

CREATE INDEX IF NOT EXISTS parking_bookings_time_range_idx
  ON public.parking_bookings USING gist (tstzrange(start_at, end_at));

CREATE INDEX IF NOT EXISTS parking_bookings_status_idx
  ON public.parking_bookings (status, payment_status);

CREATE INDEX IF NOT EXISTS parking_booking_payments_booking_idx
  ON public.parking_booking_payments (booking_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS parking_booking_payments_unique_pending
  ON public.parking_booking_payments (booking_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS parking_booking_notifications_booking_idx
  ON public.parking_booking_notifications (booking_id);

-- Capacity enforcement helper
CREATE OR REPLACE FUNCTION public.check_parking_capacity(
  p_start timestamptz,
  p_end timestamptz,
  p_ignore_booking uuid DEFAULT NULL
)
RETURNS TABLE (
  remaining integer,
  capacity integer,
  active integer
)
LANGUAGE plpgsql
AS $$
DECLARE
  active_capacity integer;
  active_bookings integer;
BEGIN
  SELECT COALESCE(capacity_override, 10)
    INTO active_capacity
  FROM public.parking_rates
  WHERE effective_from <= timezone('utc', now())
  ORDER BY effective_from DESC
  LIMIT 1;

  active_capacity := COALESCE(active_capacity, 10);

  SELECT COUNT(*)
    INTO active_bookings
  FROM public.parking_bookings
  WHERE status IN ('pending_payment', 'confirmed')
    AND tstzrange(start_at, end_at, '[]') && tstzrange(p_start, p_end, '[]')
    AND (p_ignore_booking IS NULL OR id <> p_ignore_booking);

  RETURN QUERY SELECT active_capacity - active_bookings, active_capacity, active_bookings;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_parking_capacity()
RETURNS trigger AS $$
DECLARE
  remaining_capacity integer;
BEGIN
  IF NEW.capacity_override THEN
    RETURN NEW;
  END IF;

  SELECT remaining INTO remaining_capacity
  FROM public.check_parking_capacity(NEW.start_at, NEW.end_at, CASE WHEN TG_OP = 'UPDATE' THEN NEW.id ELSE NULL END);

  IF remaining_capacity < 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Parking capacity exceeded';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_parking_capacity
BEFORE INSERT OR UPDATE ON public.parking_bookings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_parking_capacity();

-- Seed initial rates if none exist
INSERT INTO public.parking_rates (hourly_rate, daily_rate, weekly_rate, monthly_rate, notes)
SELECT 5, 15, 75, 265, 'Initial standard rates'
WHERE NOT EXISTS (SELECT 1 FROM public.parking_rates);

-- RLS & Policies
ALTER TABLE public.parking_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parking_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parking_booking_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parking_booking_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY parking_rates_read ON public.parking_rates
  FOR SELECT TO authenticated USING (true);

CREATE POLICY parking_bookings_read ON public.parking_bookings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY parking_bookings_insert ON public.parking_bookings
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_permission(auth.uid(), 'parking', 'manage'));

CREATE POLICY parking_bookings_update ON public.parking_bookings
  FOR UPDATE TO authenticated
  USING (public.user_has_permission(auth.uid(), 'parking', 'manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'parking', 'manage'));

CREATE POLICY parking_bookings_delete ON public.parking_bookings
  FOR DELETE TO authenticated
  USING (public.user_has_permission(auth.uid(), 'parking', 'manage'));

CREATE POLICY parking_booking_payments_read ON public.parking_booking_payments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY parking_booking_payments_insert ON public.parking_booking_payments
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_permission(auth.uid(), 'parking', 'manage'));

CREATE POLICY parking_booking_payments_update ON public.parking_booking_payments
  FOR UPDATE TO authenticated
  USING (public.user_has_permission(auth.uid(), 'parking', 'manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'parking', 'manage'));

CREATE POLICY parking_booking_payments_delete ON public.parking_booking_payments
  FOR DELETE TO authenticated
  USING (public.user_has_permission(auth.uid(), 'parking', 'manage'));

CREATE POLICY parking_notifications_read ON public.parking_booking_notifications
  FOR SELECT TO authenticated USING (true);

CREATE POLICY parking_notifications_insert ON public.parking_booking_notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_permission(auth.uid(), 'parking', 'manage'));

GRANT ALL ON public.parking_rates TO service_role;
GRANT ALL ON public.parking_bookings TO service_role;
GRANT ALL ON public.parking_booking_payments TO service_role;
GRANT ALL ON public.parking_booking_notifications TO service_role;

-- Parking module permissions seeded for RBAC
DO $$
DECLARE
  perm_view UUID;
  perm_manage UUID;
  perm_refund UUID;
  role_super_admin UUID;
  role_manager UUID;
  role_staff UUID;
BEGIN
  INSERT INTO permissions (module_name, action, description)
  VALUES ('parking', 'view', 'View parking bookings and availability')
  ON CONFLICT (module_name, action) DO UPDATE SET description = EXCLUDED.description
  RETURNING id INTO perm_view;

  IF perm_view IS NULL THEN
    SELECT id INTO perm_view FROM permissions WHERE module_name = 'parking' AND action = 'view' LIMIT 1;
  END IF;

  INSERT INTO permissions (module_name, action, description)
  VALUES ('parking', 'manage', 'Create and manage parking bookings')
  ON CONFLICT (module_name, action) DO UPDATE SET description = EXCLUDED.description
  RETURNING id INTO perm_manage;

  IF perm_manage IS NULL THEN
    SELECT id INTO perm_manage FROM permissions WHERE module_name = 'parking' AND action = 'manage' LIMIT 1;
  END IF;

  INSERT INTO permissions (module_name, action, description)
  VALUES ('parking', 'refund', 'Process parking payment refunds')
  ON CONFLICT (module_name, action) DO UPDATE SET description = EXCLUDED.description
  RETURNING id INTO perm_refund;

  IF perm_refund IS NULL THEN
    SELECT id INTO perm_refund FROM permissions WHERE module_name = 'parking' AND action = 'refund' LIMIT 1;
  END IF;

  SELECT id INTO role_super_admin FROM roles WHERE name = 'super_admin' LIMIT 1;
  SELECT id INTO role_manager FROM roles WHERE name = 'manager' LIMIT 1;
  SELECT id INTO role_staff FROM roles WHERE name = 'staff' LIMIT 1;

  IF role_super_admin IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT role_super_admin, p_id
    FROM (VALUES (perm_view), (perm_manage), (perm_refund)) AS perms(p_id)
    WHERE p_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp WHERE rp.role_id = role_super_admin AND rp.permission_id = p_id
      );
  END IF;

  IF role_manager IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT role_manager, p_id
    FROM (VALUES (perm_view), (perm_manage)) AS perms(p_id)
    WHERE p_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp WHERE rp.role_id = role_manager AND rp.permission_id = p_id
      );
  END IF;

  IF role_staff IS NOT NULL AND perm_view IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    VALUES (role_staff, perm_view)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
-- End 20251002170554_create_parking_tables.sql


-- Begin 20251002182601_add_parking_notification_flags.sql
ALTER TABLE public.parking_bookings
  ADD COLUMN IF NOT EXISTS start_notification_sent boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS end_notification_sent boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_overdue_notified boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS parking_bookings_start_notification_idx
  ON public.parking_bookings (start_notification_sent, start_at);

CREATE INDEX IF NOT EXISTS parking_bookings_end_notification_idx
  ON public.parking_bookings (end_notification_sent, end_at);

CREATE INDEX IF NOT EXISTS parking_bookings_payment_overdue_idx
  ON public.parking_bookings (payment_overdue_notified, payment_due_at);
-- End 20251002182601_add_parking_notification_flags.sql


-- Begin 20251003110040_fix_parking_capacity_trigger.sql
CREATE OR REPLACE FUNCTION public.enforce_parking_capacity()
RETURNS trigger AS $$
DECLARE
  remaining_capacity integer;
BEGIN
  IF NEW.capacity_override THEN
    RETURN NEW;
  END IF;

  SELECT remaining INTO remaining_capacity
  FROM public.check_parking_capacity(NEW.start_at, NEW.end_at, CASE WHEN TG_OP = 'UPDATE' THEN NEW.id ELSE NULL END);

  IF remaining_capacity < 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Parking capacity exceeded';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- End 20251003110040_fix_parking_capacity_trigger.sql


-- Begin 20251010120000_update_event_customer_labels.sql
-- Update customer labels to focus on event attendance behaviour

-- Ensure label tables exist
CREATE TABLE IF NOT EXISTS customer_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  color TEXT,
  icon TEXT,
  auto_apply_rules JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_label_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  label_id UUID REFERENCES customer_labels(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(customer_id, label_id)
);

-- Remove legacy VIP label assignments and the label itself if present
DO $$
DECLARE
  vip_label_id uuid;
BEGIN
  SELECT id INTO vip_label_id FROM customer_labels WHERE name = 'VIP';
  IF vip_label_id IS NOT NULL THEN
    DELETE FROM customer_label_assignments WHERE label_id = vip_label_id;
    DELETE FROM customer_labels WHERE id = vip_label_id;
  END IF;
END $$;

-- Ensure Event Booker label exists
INSERT INTO customer_labels (name, description, color, icon, auto_apply_rules)
SELECT 'Event Booker', 'Customers who have booked at least one event', '#2563EB', 'calendar-days', jsonb_build_object(
    'type', 'event_booking',
    'minimum_bookings', 1
  )
WHERE NOT EXISTS (
  SELECT 1 FROM customer_labels WHERE name = 'Event Booker'
);

-- Ensure Event Attendee label exists
INSERT INTO customer_labels (name, description, color, icon, auto_apply_rules)
SELECT 'Event Attendee', 'Customers who have attended an event at The Anchor', '#16A34A', 'user-group', jsonb_build_object(
    'type', 'event_attendance',
    'minimum_check_ins', 1
  )
WHERE NOT EXISTS (
  SELECT 1 FROM customer_labels WHERE name = 'Event Attendee'
);

-- Refresh the auto-apply routine to align with the new label strategy
CREATE OR REPLACE FUNCTION public.apply_customer_labels_retroactively()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  regular_label_id uuid;
  event_booker_label_id uuid;
  event_attendee_label_id uuid;
  new_customer_label_id uuid;
  at_risk_label_id uuid;
BEGIN
  SELECT id INTO regular_label_id FROM customer_labels WHERE name = 'Regular';
  SELECT id INTO event_booker_label_id FROM customer_labels WHERE name = 'Event Booker';
  SELECT id INTO event_attendee_label_id FROM customer_labels WHERE name = 'Event Attendee';
  SELECT id INTO new_customer_label_id FROM customer_labels WHERE name = 'New Customer';
  SELECT id INTO at_risk_label_id FROM customer_labels WHERE name = 'At Risk';

  -- Apply Regular label (5+ events in last 90 days)
  IF regular_label_id IS NOT NULL THEN
    INSERT INTO customer_label_assignments (customer_id, label_id, auto_assigned, notes)
    SELECT DISTINCT
      customer_id,
      regular_label_id,
      true,
      'Auto-applied: 5+ events in last 90 days'
    FROM (
      SELECT customer_id, SUM(times_attended) AS total
      FROM customer_category_stats
      WHERE last_attended_date >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY customer_id
      HAVING SUM(times_attended) >= 5
    ) qualified
    WHERE NOT EXISTS (
      SELECT 1 FROM customer_label_assignments
      WHERE customer_id = qualified.customer_id
        AND label_id = regular_label_id
    );
  END IF;

  -- Apply Event Booker label (at least one booking on record)
  IF event_booker_label_id IS NOT NULL THEN
    INSERT INTO customer_label_assignments (customer_id, label_id, auto_assigned, notes)
    SELECT DISTINCT
      b.customer_id,
      event_booker_label_id,
      true,
      'Auto-applied: Booked at least one event'
    FROM bookings b
    WHERE b.customer_id IS NOT NULL
    ON CONFLICT (customer_id, label_id) DO NOTHING;
  END IF;

  -- Apply Event Attendee label (at least one check-in)
  IF event_attendee_label_id IS NOT NULL THEN
    INSERT INTO customer_label_assignments (customer_id, label_id, auto_assigned, notes)
    SELECT DISTINCT
      eci.customer_id,
      event_attendee_label_id,
      true,
      'Auto-applied: Checked in to an event'
    FROM event_check_ins eci
    WHERE eci.customer_id IS NOT NULL
    ON CONFLICT (customer_id, label_id) DO NOTHING;
  END IF;

  -- Apply New Customer label (first event within 30 days)
  IF new_customer_label_id IS NOT NULL THEN
    INSERT INTO customer_label_assignments (customer_id, label_id, auto_assigned, notes)
    SELECT DISTINCT
      c.id,
      new_customer_label_id,
      true,
      'Auto-applied: New customer (joined within 30 days)'
    FROM customers c
    WHERE c.created_at >= CURRENT_DATE - INTERVAL '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM customer_label_assignments
        WHERE customer_id = c.id
          AND label_id = new_customer_label_id
      );
  END IF;

  -- Apply At Risk label (3+ past events but inactive 60+ days)
  IF at_risk_label_id IS NOT NULL THEN
    INSERT INTO customer_label_assignments (customer_id, label_id, auto_assigned, notes)
    SELECT DISTINCT
      customer_id,
      at_risk_label_id,
      true,
      'Auto-applied: Previously active but no recent attendance'
    FROM (
      SELECT customer_id, MAX(last_attended_date) AS last_date, SUM(times_attended) AS total
      FROM customer_category_stats
      GROUP BY customer_id
      HAVING SUM(times_attended) >= 3
         AND MAX(last_attended_date) < CURRENT_DATE - INTERVAL '60 days'
    ) qualified
    WHERE NOT EXISTS (
      SELECT 1 FROM customer_label_assignments
      WHERE customer_id = qualified.customer_id
        AND label_id = at_risk_label_id
    );
  END IF;
END;
$$;
-- End 20251010120000_update_event_customer_labels.sql


-- Begin 20251010123000_add_customer_email.sql
-- Add email support to customers for event check-in flow
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email text;

-- Optional: ensure stored emails are unique when present
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email_unique
  ON customers (lower(email))
  WHERE email IS NOT NULL;
-- End 20251010123000_add_customer_email.sql


-- Begin 20251015120000_create_receipts_module.sql
-- Receipts module: transactional ledger, rule automation, storage, and RBAC

-- 1. Ensure status enum exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'receipt_transaction_status') THEN
    CREATE TYPE receipt_transaction_status AS ENUM ('pending', 'completed', 'auto_completed', 'no_receipt_required');
  END IF;
END $$;




-- 2. Storage bucket for receipt files (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

-- 3. Receipt batches capture each bank statement import
CREATE TABLE IF NOT EXISTS receipt_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  original_filename TEXT NOT NULL,
  source_hash TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Automation rules for marking transactions that do not require receipts
CREATE TABLE IF NOT EXISTS receipt_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  match_description TEXT,
  match_transaction_type TEXT,
  match_direction TEXT NOT NULL DEFAULT 'both' CHECK (match_direction IN ('in', 'out', 'both')),
  match_min_amount NUMERIC(12, 2),
  match_max_amount NUMERIC(12, 2),
  auto_status receipt_transaction_status NOT NULL DEFAULT 'no_receipt_required',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Imported transactions tracked per row with deduplication hash
CREATE TABLE IF NOT EXISTS receipt_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID REFERENCES receipt_batches(id) ON DELETE SET NULL,
  transaction_date DATE NOT NULL,
  details TEXT NOT NULL,
  transaction_type TEXT,
  amount_in NUMERIC(12, 2),
  amount_out NUMERIC(12, 2),
  balance NUMERIC(14, 2),
  dedupe_hash TEXT NOT NULL,
  status receipt_transaction_status NOT NULL DEFAULT 'pending',
  receipt_required BOOLEAN NOT NULL DEFAULT true,
  marked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  marked_by_email TEXT,
  marked_by_name TEXT,
  marked_at TIMESTAMPTZ,
  marked_method TEXT,
  rule_applied_id UUID REFERENCES receipt_rules(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT receipt_amount_non_negative CHECK ((amount_in IS NULL OR amount_in >= 0) AND (amount_out IS NULL OR amount_out >= 0))
);





CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_transactions_dedupe_hash
  ON receipt_transactions(dedupe_hash);

CREATE INDEX IF NOT EXISTS idx_receipt_transactions_date
  ON receipt_transactions(transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_receipt_transactions_status
  ON receipt_transactions(status);

-- 6. Metadata for uploaded receipt documents
CREATE TABLE IF NOT EXISTS receipt_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES receipt_transactions(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  file_size_bytes INTEGER,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_files_transaction_path
  ON receipt_files(transaction_id, storage_path);

-- 7. Activity log to retain audit trail for manual or automated updates
CREATE TABLE IF NOT EXISTS receipt_transaction_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES receipt_transactions(id) ON DELETE CASCADE,
  previous_status receipt_transaction_status,
  new_status receipt_transaction_status,
  action_type TEXT NOT NULL,
  note TEXT,
  performed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rule_id UUID REFERENCES receipt_rules(id) ON DELETE SET NULL,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receipt_transaction_logs_transaction
  ON receipt_transaction_logs(transaction_id, performed_at DESC);

-- 8. Updated-at trigger helpers
CREATE OR REPLACE FUNCTION set_receipt_transactions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_receipt_transactions_updated_at ON receipt_transactions;
CREATE TRIGGER trg_receipt_transactions_updated_at
  BEFORE UPDATE ON receipt_transactions
  FOR EACH ROW
  EXECUTE FUNCTION set_receipt_transactions_updated_at();

CREATE OR REPLACE FUNCTION set_receipt_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_receipt_rules_updated_at ON receipt_rules;
CREATE TRIGGER trg_receipt_rules_updated_at
  BEFORE UPDATE ON receipt_rules
  FOR EACH ROW
  EXECUTE FUNCTION set_receipt_rules_updated_at();

-- 9. Enable row-level security and restrict to privileged contexts
ALTER TABLE receipt_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_transaction_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role access" ON receipt_batches
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role access" ON receipt_rules
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role access" ON receipt_transactions
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role access" ON receipt_files
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role access" ON receipt_transaction_logs
  FOR ALL USING (auth.role() = 'service_role');

-- 10. Receipts module permissions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM permissions WHERE module_name = 'receipts' AND action = 'view'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('receipts', 'view', 'View bank statement receipts workspace');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM permissions WHERE module_name = 'receipts' AND action = 'manage'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('receipts', 'manage', 'Manage receipt workflows, including marking and rules');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM permissions WHERE module_name = 'receipts' AND action = 'export'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('receipts', 'export', 'Export quarterly receipt bundles and reports');
  END IF;
END $$;

-- 11. Assign permissions to existing roles
DO $$
DECLARE
  super_admin_role_id UUID;
  finance_manager_role_id UUID;
  manager_role_id UUID;
  staff_role_id UUID;
BEGIN
  SELECT id INTO super_admin_role_id FROM roles WHERE name = 'super_admin' LIMIT 1;
  SELECT id INTO finance_manager_role_id FROM roles WHERE name = 'finance_manager' LIMIT 1;
  SELECT id INTO manager_role_id FROM roles WHERE name = 'manager' LIMIT 1;
  SELECT id INTO staff_role_id FROM roles WHERE name = 'staff' LIMIT 1;

  IF super_admin_role_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT super_admin_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'receipts'
      AND p.action IN ('view', 'manage', 'export')
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = super_admin_role_id AND rp.permission_id = p.id
      );
  END IF;

  IF finance_manager_role_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT finance_manager_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'receipts'
      AND p.action IN ('view', 'manage', 'export')
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = finance_manager_role_id AND rp.permission_id = p.id
      );
  END IF;

  IF manager_role_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT manager_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'receipts'
      AND p.action IN ('view', 'manage')
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = manager_role_id AND rp.permission_id = p.id
      );
  END IF;

  IF staff_role_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT staff_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'receipts'
      AND p.action IN ('view')
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = staff_role_id AND rp.permission_id = p.id
      );
  END IF;
END $$;

-- 12. Helper function for quarterly export windows
CREATE OR REPLACE FUNCTION get_quarter_date_range(p_year INT, p_quarter INT)
RETURNS TABLE (start_date DATE, end_date DATE) AS $$
DECLARE
  v_start_month INT;
BEGIN
  IF p_quarter NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'Quarter must be between 1 and 4';
  END IF;

  v_start_month := ((p_quarter - 1) * 3) + 1;
  start_date := make_date(p_year, v_start_month, 1);
  end_date := (start_date + INTERVAL '3 months') - INTERVAL '1 day';
  RETURN QUERY SELECT start_date, end_date;
END;
$$ LANGUAGE plpgsql;

-- 13. Aggregated status counts for dashboard summaries
CREATE OR REPLACE FUNCTION count_receipt_statuses()
RETURNS TABLE (
  pending BIGINT,
  completed BIGINT,
  auto_completed BIGINT,
  no_receipt_required BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending') AS pending,
    COUNT(*) FILTER (WHERE status = 'completed') AS completed,
    COUNT(*) FILTER (WHERE status = 'auto_completed') AS auto_completed,
    COUNT(*) FILTER (WHERE status = 'no_receipt_required') AS no_receipt_required
  FROM receipt_transactions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION count_receipt_statuses() TO authenticated, service_role;
-- End 20251015120000_create_receipts_module.sql


-- Begin 20251015130000_mark_pre_june_2025_receipts_non_required.sql
-- Backfill: mark historical transactions as not requiring receipts
-- Context: VAT already processed through June 2025; prevent old entries from appearing outstanding.

BEGIN;

WITH candidates AS (
  SELECT id, status AS previous_status
  FROM receipt_transactions
  WHERE transaction_date <= DATE '2025-06-30'
    AND status = 'pending'
),
updated AS (
  UPDATE receipt_transactions rt
  SET
    status = 'no_receipt_required',
    receipt_required = false,
    marked_by = NULL,
    marked_by_email = NULL,
    marked_by_name = NULL,
    marked_at = NOW(),
    marked_method = 'migration_backfill',
    rule_applied_id = NULL,
    updated_at = NOW()
  FROM candidates
  WHERE rt.id = candidates.id
  RETURNING rt.id, candidates.previous_status
)
INSERT INTO receipt_transaction_logs (
  transaction_id,
  previous_status,
  new_status,
  action_type,
  note,
  performed_by,
  rule_id,
  performed_at
)
SELECT
  updated.id,
  updated.previous_status,
  'no_receipt_required',
  'migration_backfill',
  'Marked as not required by June 2025 migration',
  NULL,
  NULL,
  NOW()
FROM updated;

COMMIT;
-- End 20251015130000_mark_pre_june_2025_receipts_non_required.sql


-- Begin 20251015133000_enhance_receipt_classification.sql
-- Enhance receipt classification capabilities with vendor tagging, expense categories, AI usage tracking, and analytics helpers

BEGIN;

-- 1. Extend receipt_transactions with vendor and accounting metadata
ALTER TABLE receipt_transactions
  ADD COLUMN IF NOT EXISTS vendor_name TEXT,
  ADD COLUMN IF NOT EXISTS vendor_source TEXT CHECK (vendor_source IS NULL OR vendor_source IN ('ai', 'manual', 'rule', 'import')),
  ADD COLUMN IF NOT EXISTS vendor_rule_id UUID REFERENCES receipt_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expense_category TEXT,
  ADD COLUMN IF NOT EXISTS expense_category_source TEXT CHECK (expense_category_source IS NULL OR expense_category_source IN ('ai', 'manual', 'rule', 'import')),
  ADD COLUMN IF NOT EXISTS expense_rule_id UUID REFERENCES receipt_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expense_updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'receipt_transactions_expense_category_valid'
      AND conrelid = 'receipt_transactions'::regclass
  ) THEN
    ALTER TABLE receipt_transactions
      ADD CONSTRAINT receipt_transactions_expense_category_valid
        CHECK (
          expense_category IS NULL OR expense_category IN (
            'Wages & Salaries inc NI',
            'Business Rates',
            'Water Rates',
            'Heat / Light / Power',
            'Repairs & Maintenance',
            'Gardening Expenses',
            'Insurance & MSA',
            'Licensing',
            'Tenant Insurance',
            'Sky & PRS',
            'Entertainment',
            'Marketing, Promotional & Advertising',
            'Print / Post & Stationery',
            'Telephone',
            'Travel & Car',
            'Cleaning Materials & Waste Disposal',
            'Accountant / Stock taker / Prof fees',
            'Bank Charges',
            'Equipment Hire',
            'Sundries & Consumables',
            'Drinks Gas'
          )
        );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_receipt_transactions_vendor_name ON receipt_transactions (vendor_name);
CREATE INDEX IF NOT EXISTS idx_receipt_transactions_expense_category ON receipt_transactions (expense_category);

-- 2. Extend receipt_rules to support automatic vendor / expense tagging
ALTER TABLE receipt_rules
  ADD COLUMN IF NOT EXISTS set_vendor_name TEXT,
  ADD COLUMN IF NOT EXISTS set_expense_category TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'receipt_rules_expense_category_valid'
      AND conrelid = 'receipt_rules'::regclass
  ) THEN
    ALTER TABLE receipt_rules
      ADD CONSTRAINT receipt_rules_expense_category_valid
        CHECK (
          set_expense_category IS NULL OR set_expense_category IN (
            'Wages & Salaries inc NI',
            'Business Rates',
            'Water Rates',
            'Heat / Light / Power',
            'Repairs & Maintenance',
            'Gardening Expenses',
            'Insurance & MSA',
            'Licensing',
            'Tenant Insurance',
            'Sky & PRS',
            'Entertainment',
            'Marketing, Promotional & Advertising',
            'Print / Post & Stationery',
            'Telephone',
            'Travel & Car',
            'Cleaning Materials & Waste Disposal',
            'Accountant / Stock taker / Prof fees',
            'Bank Charges',
            'Equipment Hire',
            'Sundries & Consumables',
            'Drinks Gas'
          )
        );
  END IF;
END $$;

-- 3. Track AI usage costs
CREATE TABLE IF NOT EXISTS ai_usage_events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  context TEXT,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost NUMERIC(12, 6) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_occurred_at ON ai_usage_events (occurred_at DESC);

-- 4. Analytics helpers: monthly summary and vendor trend RPCs
CREATE OR REPLACE FUNCTION get_receipt_monthly_summary(limit_months INTEGER DEFAULT 12)
RETURNS TABLE (
  month_start DATE,
  total_income NUMERIC(14, 2),
  total_outgoing NUMERIC(14, 2),
  top_income JSONB,
  top_outgoing JSONB
) AS $$
  WITH month_series AS (
    SELECT DISTINCT date_trunc('month', transaction_date)::date AS month_start
    FROM receipt_transactions
    WHERE transaction_date IS NOT NULL
    ORDER BY month_start DESC
    LIMIT GREATEST(limit_months, 1)
  ),
  month_totals AS (
    SELECT
      date_trunc('month', transaction_date)::date AS month_start,
      SUM(COALESCE(amount_in, 0))::NUMERIC(14, 2) AS total_income,
      SUM(COALESCE(amount_out, 0))::NUMERIC(14, 2) AS total_outgoing
    FROM receipt_transactions
    GROUP BY 1
  ),
  income_ranked AS (
    SELECT
      date_trunc('month', transaction_date)::date AS month_start,
      COALESCE(NULLIF(TRIM(vendor_name), ''), 'Uncategorised') AS label,
      SUM(COALESCE(amount_in, 0))::NUMERIC(14, 2) AS total_amount,
      ROW_NUMBER() OVER (
        PARTITION BY date_trunc('month', transaction_date)::date
        ORDER BY SUM(COALESCE(amount_in, 0)) DESC
      ) AS rn
    FROM receipt_transactions
    WHERE COALESCE(amount_in, 0) > 0
    GROUP BY 1, label
  ),
  outgoing_ranked AS (
    SELECT
      date_trunc('month', transaction_date)::date AS month_start,
      COALESCE(NULLIF(TRIM(vendor_name), ''), 'Uncategorised') AS label,
      SUM(COALESCE(amount_out, 0))::NUMERIC(14, 2) AS total_amount,
      ROW_NUMBER() OVER (
        PARTITION BY date_trunc('month', transaction_date)::date
        ORDER BY SUM(COALESCE(amount_out, 0)) DESC
      ) AS rn
    FROM receipt_transactions
    WHERE COALESCE(amount_out, 0) > 0
    GROUP BY 1, label
  )
  SELECT
    ms.month_start,
    COALESCE(mt.total_income, 0)::NUMERIC(14, 2) AS total_income,
    COALESCE(mt.total_outgoing, 0)::NUMERIC(14, 2) AS total_outgoing,
    (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('label', label, 'amount', total_amount) ORDER BY total_amount DESC), '[]'::jsonb)
      FROM income_ranked
      WHERE month_start = ms.month_start AND rn <= 3
    ) AS top_income,
    (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('label', label, 'amount', total_amount) ORDER BY total_amount DESC), '[]'::jsonb)
      FROM outgoing_ranked
      WHERE month_start = ms.month_start AND rn <= 3
    ) AS top_outgoing
  FROM month_series ms
  LEFT JOIN month_totals mt ON mt.month_start = ms.month_start
  ORDER BY ms.month_start DESC;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION get_receipt_vendor_trends(month_window INTEGER DEFAULT 12)
RETURNS TABLE (
  vendor_label TEXT,
  month_start DATE,
  total_outgoing NUMERIC(14, 2),
  total_income NUMERIC(14, 2),
  transaction_count BIGINT
) AS $$
  WITH base AS (
    SELECT
      COALESCE(NULLIF(TRIM(vendor_name), ''), 'Uncategorised') AS vendor_label,
      date_trunc('month', transaction_date)::date AS month_start,
      SUM(COALESCE(amount_out, 0))::NUMERIC(14, 2) AS total_outgoing,
      SUM(COALESCE(amount_in, 0))::NUMERIC(14, 2) AS total_income,
      COUNT(*) AS transaction_count
    FROM receipt_transactions
    WHERE transaction_date IS NOT NULL
    GROUP BY 1, 2
  )
  SELECT
    vendor_label,
    month_start,
    total_outgoing,
    total_income,
    transaction_count
  FROM base
  WHERE month_start >= (date_trunc('month', NOW())::date - ((GREATEST(month_window, 1) - 1) || ' months')::interval)
  ORDER BY vendor_label, month_start;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION get_openai_usage_total()
RETURNS NUMERIC(12, 6) AS $$
  SELECT COALESCE(SUM(cost), 0)::NUMERIC(12, 6)
  FROM ai_usage_events;
$$ LANGUAGE SQL STABLE;

COMMIT;
-- End 20251015133000_enhance_receipt_classification.sql

-- Begin 20250219090000_receipt_monthly_insights.sql
-- Monthly insights helpers for receipts dashboard enhancements

CREATE OR REPLACE FUNCTION get_receipt_monthly_category_breakdown(
  limit_months INTEGER DEFAULT 12,
  top_categories INTEGER DEFAULT 6
)
RETURNS TABLE (
  month_start DATE,
  category TEXT,
  total_outgoing NUMERIC(14, 2)
) AS $$
  WITH month_series AS (
    SELECT DISTINCT date_trunc('month', transaction_date)::date AS month_start
    FROM receipt_transactions
    WHERE transaction_date IS NOT NULL
    ORDER BY month_start DESC
    LIMIT GREATEST(limit_months, 1)
  ),
  base AS (
    SELECT
      date_trunc('month', transaction_date)::date AS month_start,
      COALESCE(NULLIF(TRIM(expense_category), ''), 'Uncategorised') AS category,
      SUM(COALESCE(amount_out, 0))::NUMERIC(14, 2) AS total_outgoing
    FROM receipt_transactions
    WHERE transaction_date IS NOT NULL
      AND COALESCE(amount_out, 0) > 0
    GROUP BY 1, 2
  ),
  ranked AS (
    SELECT
      category,
      SUM(total_outgoing) AS total_value,
      ROW_NUMBER() OVER (ORDER BY SUM(total_outgoing) DESC) AS rn
    FROM base
    WHERE month_start IN (SELECT month_start FROM month_series)
    GROUP BY category
  ),
  top AS (
    SELECT category
    FROM ranked
    WHERE rn <= GREATEST(top_categories, 1)
  ),
  aggregated AS (
    SELECT
      b.month_start,
      CASE WHEN t.category IS NOT NULL THEN b.category ELSE 'Other' END AS category,
      SUM(b.total_outgoing)::NUMERIC(14, 2) AS total_outgoing
    FROM base b
    LEFT JOIN top t ON t.category = b.category
    WHERE b.month_start IN (SELECT month_start FROM month_series)
    GROUP BY 1, 2
  )
  SELECT
    ms.month_start,
    COALESCE(a.category, 'Other') AS category,
    COALESCE(a.total_outgoing, 0)::NUMERIC(14, 2) AS total_outgoing
  FROM month_series ms
  LEFT JOIN aggregated a ON a.month_start = ms.month_start
  ORDER BY ms.month_start DESC, total_outgoing DESC;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION get_receipt_monthly_income_breakdown(
  limit_months INTEGER DEFAULT 12,
  top_sources INTEGER DEFAULT 6
)
RETURNS TABLE (
  month_start DATE,
  source TEXT,
  total_income NUMERIC(14, 2)
) AS $$
  WITH month_series AS (
    SELECT DISTINCT date_trunc('month', transaction_date)::date AS month_start
    FROM receipt_transactions
    WHERE transaction_date IS NOT NULL
    ORDER BY month_start DESC
    LIMIT GREATEST(limit_months, 1)
  ),
  base AS (
    SELECT
      date_trunc('month', transaction_date)::date AS month_start,
      COALESCE(NULLIF(TRIM(vendor_name), ''), 'Uncategorised') AS source,
      SUM(COALESCE(amount_in, 0))::NUMERIC(14, 2) AS total_income
    FROM receipt_transactions
    WHERE transaction_date IS NOT NULL
      AND COALESCE(amount_in, 0) > 0
    GROUP BY 1, 2
  ),
  ranked AS (
    SELECT
      source,
      SUM(total_income) AS total_value,
      ROW_NUMBER() OVER (ORDER BY SUM(total_income) DESC) AS rn
    FROM base
    WHERE month_start IN (SELECT month_start FROM month_series)
    GROUP BY source
  ),
  top AS (
    SELECT source
    FROM ranked
    WHERE rn <= GREATEST(top_sources, 1)
  ),
  aggregated AS (
    SELECT
      b.month_start,
      CASE WHEN t.source IS NOT NULL THEN b.source ELSE 'Other' END AS source,
      SUM(b.total_income)::NUMERIC(14, 2) AS total_income
    FROM base b
    LEFT JOIN top t ON t.source = b.source
    WHERE b.month_start IN (SELECT month_start FROM month_series)
    GROUP BY 1, 2
  )
  SELECT
    ms.month_start,
    COALESCE(a.source, 'Other') AS source,
    COALESCE(a.total_income, 0)::NUMERIC(14, 2) AS total_income
  FROM month_series ms
  LEFT JOIN aggregated a ON a.month_start = ms.month_start
  ORDER BY ms.month_start DESC, total_income DESC;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION get_receipt_monthly_status_counts(limit_months INTEGER DEFAULT 12)
RETURNS TABLE (
  month_start DATE,
  status receipt_transaction_status,
  total BIGINT
) AS $$
  WITH month_series AS (
    SELECT DISTINCT date_trunc('month', transaction_date)::date AS month_start
    FROM receipt_transactions
    WHERE transaction_date IS NOT NULL
    ORDER BY month_start DESC
    LIMIT GREATEST(limit_months, 1)
  ),
  base AS (
    SELECT
      date_trunc('month', transaction_date)::date AS month_start,
      status,
      COUNT(*) AS total
    FROM receipt_transactions
    WHERE transaction_date IS NOT NULL
    GROUP BY 1, 2
  )
  SELECT
    ms.month_start,
    COALESCE(b.status, 'pending') AS status,
    COALESCE(b.total, 0)::BIGINT AS total
  FROM month_series ms
  LEFT JOIN base b ON b.month_start = ms.month_start
  ORDER BY ms.month_start DESC, status;
$$ LANGUAGE SQL STABLE;
-- End 20250219090000_receipt_monthly_insights.sql

-- Begin 20250507133000_add_cant_find_receipt_status.sql
-- Add support for tracking receipts that couldn't be found
ALTER TYPE receipt_transaction_status ADD VALUE IF NOT EXISTS 'cant_find';

DROP FUNCTION IF EXISTS count_receipt_statuses();

CREATE FUNCTION count_receipt_statuses()
RETURNS TABLE (
  pending BIGINT,
  completed BIGINT,
  auto_completed BIGINT,
  no_receipt_required BIGINT,
  cant_find BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending') AS pending,
    COUNT(*) FILTER (WHERE status = 'completed') AS completed,
    COUNT(*) FILTER (WHERE status = 'auto_completed') AS auto_completed,
    COUNT(*) FILTER (WHERE status = 'no_receipt_required') AS no_receipt_required,
    COUNT(*) FILTER (WHERE status = 'cant_find') AS cant_find
  FROM receipt_transactions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_receipt_detail_groups(INTEGER, TEXT[], BOOLEAN);

CREATE FUNCTION get_receipt_detail_groups(
  limit_groups INTEGER DEFAULT 100,
  include_statuses TEXT[] DEFAULT ARRAY['pending','auto_completed','completed','no_receipt_required','cant_find'],
  only_unclassified BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  details TEXT,
  transaction_ids UUID[],
  transaction_count BIGINT,
  needs_vendor_count BIGINT,
  needs_expense_count BIGINT,
  total_in NUMERIC(14, 2),
  total_out NUMERIC(14, 2),
  first_date DATE,
  last_date DATE,
  dominant_vendor TEXT,
  dominant_expense TEXT,
  sample_transaction JSONB
) AS $$
  WITH filtered AS (
    SELECT *
    FROM receipt_transactions
    WHERE details IS NOT NULL
      AND details <> ''
      AND (include_statuses IS NULL OR status::text = ANY(include_statuses))
      AND (
        NOT only_unclassified
        OR vendor_name IS NULL
        OR expense_category IS NULL
      )
  ), grouped AS (
    SELECT
      details,
      ARRAY_AGG(id ORDER BY transaction_date DESC) AS transaction_ids,
      COUNT(*) AS transaction_count,
      COUNT(*) FILTER (WHERE vendor_name IS NULL) AS needs_vendor_count,
      COUNT(*) FILTER (WHERE expense_category IS NULL) AS needs_expense_count,
      SUM(COALESCE(amount_in, 0))::NUMERIC(14, 2) AS total_in,
      SUM(COALESCE(amount_out, 0))::NUMERIC(14, 2) AS total_out,
      MIN(transaction_date)::DATE AS first_date,
      MAX(transaction_date)::DATE AS last_date,
      MODE() WITHIN GROUP (ORDER BY vendor_name) FILTER (WHERE vendor_name IS NOT NULL) AS dominant_vendor,
      MODE() WITHIN GROUP (ORDER BY expense_category) FILTER (WHERE expense_category IS NOT NULL) AS dominant_expense,
      (
        SELECT jsonb_build_object(
          'id', t.id,
          'transaction_date', t.transaction_date,
          'transaction_type', t.transaction_type,
          'amount_in', t.amount_in,
          'amount_out', t.amount_out,
          'vendor_name', t.vendor_name,
          'vendor_source', t.vendor_source,
          'expense_category', t.expense_category,
          'expense_category_source', t.expense_category_source
        )
        FROM filtered t
        WHERE t.details = rt.details
        ORDER BY
          CASE
            WHEN t.vendor_name IS NULL OR t.expense_category IS NULL THEN 0
            ELSE 1
          END,
          t.transaction_date DESC
        LIMIT 1
      ) AS sample_transaction
    FROM filtered rt
    GROUP BY details
    ORDER BY transaction_count DESC, details ASC
    LIMIT GREATEST(limit_groups, 1)
  )
  SELECT * FROM grouped;
$$ LANGUAGE SQL STABLE;
-- End 20250507133000_add_cant_find_receipt_status.sql



-- Begin 20251015140000_create_pl_targets.sql
-- P&L targets and manual actuals storage
BEGIN;

CREATE TABLE IF NOT EXISTS pl_targets (
  metric_key TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('1m', '3m', '12m')),
  target_value NUMERIC(14, 2),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (metric_key, timeframe)
);

CREATE TABLE IF NOT EXISTS pl_manual_actuals (
  metric_key TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('1m', '3m', '12m')),
  value NUMERIC(14, 2),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (metric_key, timeframe)
);

COMMIT;
-- End 20251015140000_create_pl_targets.sql


-- Begin 20251015150000_update_receipt_expense_categories.sql
-- Align receipt expense categories with updated accounting list
BEGIN;

-- Drop existing validation constraints so remapping can use the new labels safely
ALTER TABLE receipt_transactions
  DROP CONSTRAINT IF EXISTS receipt_transactions_expense_category_valid;

ALTER TABLE receipt_rules
  DROP CONSTRAINT IF EXISTS receipt_rules_expense_category_valid;

-- Remap existing transaction expense categories to the new labels
UPDATE receipt_transactions
SET expense_category = CASE expense_category
  WHEN 'Wages & Salaries inc NI' THEN 'Total Staff'
  WHEN 'Business Rates' THEN 'Business Rate'
  WHEN 'Heat / Light / Power' THEN 'Heat/Light/Power'
  WHEN 'Repairs & Maintenance' THEN 'Premises Repairs/Maintenance'
  WHEN 'Insurance & MSA' THEN 'Maintenance and Service Plan Charges'
  WHEN 'Sky & PRS' THEN 'Sky / PRS / Vidimix'
  WHEN 'Marketing, Promotional & Advertising' THEN 'Marketing/Promotion/Advertising'
  WHEN 'Print / Post & Stationery' THEN 'Print/Post Stationary'
  WHEN 'Travel & Car' THEN 'Travel/Car'
  WHEN 'Cleaning Materials & Waste Disposal' THEN 'Waste Disposal/Cleaning/Hygiene'
  WHEN 'Accountant / Stock taker / Prof fees' THEN 'Accountant/StockTaker/Professional Fees'
  WHEN 'Bank Charges' THEN 'Bank Charges/Credit Card Commission'
  WHEN 'Sundries & Consumables' THEN 'Sundries/Consumables'
  ELSE expense_category
END
WHERE expense_category IN (
  'Wages & Salaries inc NI',
  'Business Rates',
  'Heat / Light / Power',
  'Repairs & Maintenance',
  'Insurance & MSA',
  'Sky & PRS',
  'Marketing, Promotional & Advertising',
  'Print / Post & Stationery',
  'Travel & Car',
  'Cleaning Materials & Waste Disposal',
  'Accountant / Stock taker / Prof fees',
  'Bank Charges',
  'Sundries & Consumables'
);

-- Remap rule default expense categories to the new labels
UPDATE receipt_rules
SET set_expense_category = CASE set_expense_category
  WHEN 'Wages & Salaries inc NI' THEN 'Total Staff'
  WHEN 'Business Rates' THEN 'Business Rate'
  WHEN 'Heat / Light / Power' THEN 'Heat/Light/Power'
  WHEN 'Repairs & Maintenance' THEN 'Premises Repairs/Maintenance'
  WHEN 'Insurance & MSA' THEN 'Maintenance and Service Plan Charges'
  WHEN 'Sky & PRS' THEN 'Sky / PRS / Vidimix'
  WHEN 'Marketing, Promotional & Advertising' THEN 'Marketing/Promotion/Advertising'
  WHEN 'Print / Post & Stationery' THEN 'Print/Post Stationary'
  WHEN 'Travel & Car' THEN 'Travel/Car'
  WHEN 'Cleaning Materials & Waste Disposal' THEN 'Waste Disposal/Cleaning/Hygiene'
  WHEN 'Accountant / Stock taker / Prof fees' THEN 'Accountant/StockTaker/Professional Fees'
  WHEN 'Bank Charges' THEN 'Bank Charges/Credit Card Commission'
  WHEN 'Sundries & Consumables' THEN 'Sundries/Consumables'
  ELSE set_expense_category
END
WHERE set_expense_category IN (
  'Wages & Salaries inc NI',
  'Business Rates',
  'Heat / Light / Power',
  'Repairs & Maintenance',
  'Insurance & MSA',
  'Sky & PRS',
  'Marketing, Promotional & Advertising',
  'Print / Post & Stationery',
  'Travel & Car',
  'Cleaning Materials & Waste Disposal',
  'Accountant / Stock taker / Prof fees',
  'Bank Charges',
  'Sundries & Consumables'
);

-- Make sure saved P&L targets and manual actuals align with the new metric keys
UPDATE pl_targets
SET metric_key = CASE metric_key
  WHEN 'wages_salaries' THEN 'total_staff'
  WHEN 'business_rates' THEN 'business_rate'
  WHEN 'repairs_maintenance' THEN 'premises_repairs_maintenance'
  WHEN 'insurance_msa' THEN 'maintenance_service_plans'
  WHEN 'sky_prs' THEN 'sky_prs_vidimix'
  WHEN 'marketing' THEN 'marketing_promotion_advertising'
  WHEN 'print_post_stationery' THEN 'print_post_stationary'
  WHEN 'cleaning_waste' THEN 'waste_disposal_cleaning_hygiene'
  WHEN 'professional_fees' THEN 'accountant_stocktaker_professional_fees'
  WHEN 'bank_charges' THEN 'bank_charges_credit_card_commission'
  ELSE metric_key
END
WHERE metric_key IN (
  'wages_salaries',
  'business_rates',
  'repairs_maintenance',
  'insurance_msa',
  'sky_prs',
  'marketing',
  'print_post_stationery',
  'cleaning_waste',
  'professional_fees',
  'bank_charges'
);

UPDATE pl_manual_actuals
SET metric_key = CASE metric_key
  WHEN 'wages_salaries' THEN 'total_staff'
  WHEN 'business_rates' THEN 'business_rate'
  WHEN 'repairs_maintenance' THEN 'premises_repairs_maintenance'
  WHEN 'insurance_msa' THEN 'maintenance_service_plans'
  WHEN 'sky_prs' THEN 'sky_prs_vidimix'
  WHEN 'marketing' THEN 'marketing_promotion_advertising'
  WHEN 'print_post_stationery' THEN 'print_post_stationary'
  WHEN 'cleaning_waste' THEN 'waste_disposal_cleaning_hygiene'
  WHEN 'professional_fees' THEN 'accountant_stocktaker_professional_fees'
  WHEN 'bank_charges' THEN 'bank_charges_credit_card_commission'
  ELSE metric_key
END
WHERE metric_key IN (
  'wages_salaries',
  'business_rates',
  'repairs_maintenance',
  'insurance_msa',
  'sky_prs',
  'marketing',
  'print_post_stationery',
  'cleaning_waste',
  'professional_fees',
  'bank_charges'
);

-- Refresh validation constraints to use the new category list
ALTER TABLE receipt_transactions
  ADD CONSTRAINT receipt_transactions_expense_category_valid
    CHECK (
      expense_category IS NULL OR expense_category IN (
        'Total Staff',
        'Business Rate',
        'Water Rates',
        'Heat/Light/Power',
        'Premises Repairs/Maintenance',
        'Equipment Repairs/Maintenance',
        'Gardening Expenses',
        'Buildings Insurance',
        'Maintenance and Service Plan Charges',
        'Licensing',
        'Tenant Insurance',
        'Entertainment',
        'Sky / PRS / Vidimix',
        'Marketing/Promotion/Advertising',
        'Print/Post Stationary',
        'Telephone',
        'Travel/Car',
        'Waste Disposal/Cleaning/Hygiene',
        'Third Party Booking Fee',
        'Accountant/StockTaker/Professional Fees',
        'Bank Charges/Credit Card Commission',
        'Equipment Hire',
        'Sundries/Consumables',
        'Drinks Gas'
      )
    );

ALTER TABLE receipt_rules
  ADD CONSTRAINT receipt_rules_expense_category_valid
    CHECK (
      set_expense_category IS NULL OR set_expense_category IN (
        'Total Staff',
        'Business Rate',
        'Water Rates',
        'Heat/Light/Power',
        'Premises Repairs/Maintenance',
        'Equipment Repairs/Maintenance',
        'Gardening Expenses',
        'Buildings Insurance',
        'Maintenance and Service Plan Charges',
        'Licensing',
        'Tenant Insurance',
        'Entertainment',
        'Sky / PRS / Vidimix',
        'Marketing/Promotion/Advertising',
        'Print/Post Stationary',
        'Telephone',
        'Travel/Car',
        'Waste Disposal/Cleaning/Hygiene',
        'Third Party Booking Fee',
        'Accountant/StockTaker/Professional Fees',
        'Bank Charges/Credit Card Commission',
        'Equipment Hire',
        'Sundries/Consumables',
        'Drinks Gas'
      )
    );

COMMIT;
-- End 20251015150000_update_receipt_expense_categories.sql


-- Begin 20251015151000_receipt_bulk_grouping.sql
-- Detail-based receipt grouping for bulk classification
BEGIN;

CREATE OR REPLACE FUNCTION get_receipt_detail_groups(
  limit_groups INTEGER DEFAULT 100,
  include_statuses TEXT[] DEFAULT ARRAY['pending','auto_completed','completed','no_receipt_required'],
  only_unclassified BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  details TEXT,
  transaction_ids UUID[],
  transaction_count BIGINT,
  needs_vendor_count BIGINT,
  needs_expense_count BIGINT,
  total_in NUMERIC(14, 2),
  total_out NUMERIC(14, 2),
  first_date DATE,
  last_date DATE,
  dominant_vendor TEXT,
  dominant_expense TEXT,
  sample_transaction JSONB
) AS $$
  WITH filtered AS (
    SELECT *
    FROM receipt_transactions
    WHERE details IS NOT NULL
      AND details <> ''
      AND (include_statuses IS NULL OR status::text = ANY(include_statuses))
      AND (
        NOT only_unclassified
        OR vendor_name IS NULL
        OR expense_category IS NULL
      )
  ), grouped AS (
    SELECT
      details,
      ARRAY_AGG(id ORDER BY transaction_date DESC) AS transaction_ids,
      COUNT(*) AS transaction_count,
      COUNT(*) FILTER (WHERE vendor_name IS NULL) AS needs_vendor_count,
      COUNT(*) FILTER (WHERE expense_category IS NULL) AS needs_expense_count,
      SUM(COALESCE(amount_in, 0))::NUMERIC(14, 2) AS total_in,
      SUM(COALESCE(amount_out, 0))::NUMERIC(14, 2) AS total_out,
      MIN(transaction_date)::DATE AS first_date,
      MAX(transaction_date)::DATE AS last_date,
      MODE() WITHIN GROUP (ORDER BY vendor_name) FILTER (WHERE vendor_name IS NOT NULL) AS dominant_vendor,
      MODE() WITHIN GROUP (ORDER BY expense_category) FILTER (WHERE expense_category IS NOT NULL) AS dominant_expense,
      (
        SELECT jsonb_build_object(
          'id', t.id,
          'transaction_date', t.transaction_date,
          'transaction_type', t.transaction_type,
          'amount_in', t.amount_in,
          'amount_out', t.amount_out,
          'vendor_name', t.vendor_name,
          'vendor_source', t.vendor_source,
          'expense_category', t.expense_category,
          'expense_category_source', t.expense_category_source
        )
        FROM filtered t
        WHERE t.details = rt.details
        ORDER BY
          CASE
            WHEN t.vendor_name IS NULL OR t.expense_category IS NULL THEN 0
            ELSE 1
          END,
          t.transaction_date DESC
        LIMIT 1
      ) AS sample_transaction
    FROM filtered rt
    GROUP BY details
    ORDER BY transaction_count DESC, details ASC
    LIMIT GREATEST(limit_groups, 1)
  )
  SELECT * FROM grouped;
$$ LANGUAGE SQL STABLE;

COMMIT;
-- End 20251015151000_receipt_bulk_grouping.sql


-- Begin 20251015154500_fix_vendor_trends_grouping.sql
BEGIN;

CREATE OR REPLACE FUNCTION get_receipt_vendor_trends(month_window INTEGER DEFAULT 12)
RETURNS TABLE (
  vendor_label TEXT,
  month_start DATE,
  total_outgoing NUMERIC(14, 2),
  total_income NUMERIC(14, 2),
  transaction_count BIGINT
) AS $$
  WITH classified AS (
    SELECT
      CASE
        WHEN transaction_date IS NULL THEN NULL
        WHEN vendor_name IS NULL OR TRIM(vendor_name) = '' THEN NULL
        ELSE LOWER(REGEXP_REPLACE(TRIM(vendor_name), '\\s+', ' ', 'g'))
      END AS vendor_key,
      CASE
        WHEN vendor_name IS NULL OR TRIM(vendor_name) = '' THEN NULL
        ELSE REGEXP_REPLACE(TRIM(vendor_name), '\\s+', ' ', 'g')
      END AS vendor_label,
      date_trunc('month', transaction_date)::date AS month_start,
      COALESCE(amount_out, 0)::NUMERIC(14, 2) AS amount_out,
      COALESCE(amount_in, 0)::NUMERIC(14, 2) AS amount_in
    FROM receipt_transactions
    WHERE transaction_date IS NOT NULL
  ), filtered AS (
    SELECT *
    FROM classified
    WHERE month_start >= (date_trunc('month', NOW())::date - ((GREATEST(month_window, 1) - 1) || ' months')::interval)
  ), summarized AS (
    SELECT
      COALESCE(vendor_key, '__uncategorised__') AS vendor_key,
      month_start,
      SUM(amount_out)::NUMERIC(14, 2) AS total_outgoing,
      SUM(amount_in)::NUMERIC(14, 2) AS total_income,
      COUNT(*) AS transaction_count
    FROM filtered
    GROUP BY COALESCE(vendor_key, '__uncategorised__'), month_start
  ), labels AS (
    SELECT
      COALESCE(vendor_key, '__uncategorised__') AS vendor_key,
      MIN(vendor_label) FILTER (WHERE vendor_label IS NOT NULL) AS vendor_label
    FROM classified
    GROUP BY COALESCE(vendor_key, '__uncategorised__')
  )
  SELECT
    CASE
      WHEN summarized.vendor_key = '__uncategorised__' THEN 'Uncategorised'
      ELSE COALESCE(labels.vendor_label, INITCAP(REGEXP_REPLACE(summarized.vendor_key, '_', ' ', 'g')))
    END AS vendor_label,
    summarized.month_start,
    summarized.total_outgoing,
    summarized.total_income,
    summarized.transaction_count
  FROM summarized
  LEFT JOIN labels ON labels.vendor_key = summarized.vendor_key
  ORDER BY vendor_label, month_start;
$$ LANGUAGE SQL STABLE;

COMMIT;
-- End 20251015154500_fix_vendor_trends_grouping.sql


-- Begin 20251015160000_vendor_trends_use_canonical_names.sql
BEGIN;

CREATE OR REPLACE FUNCTION get_receipt_vendor_trends(month_window INTEGER DEFAULT 12)
RETURNS TABLE (
  vendor_label TEXT,
  month_start DATE,
  total_outgoing NUMERIC(14, 2),
  total_income NUMERIC(14, 2),
  transaction_count BIGINT
) AS $$
  WITH source AS (
    SELECT
      rt.transaction_date,
      COALESCE(NULLIF(TRIM(rr.set_vendor_name), ''), NULLIF(TRIM(rt.vendor_name), '')) AS vendor_value,
      COALESCE(rt.amount_out, 0)::NUMERIC(14, 2) AS amount_out,
      COALESCE(rt.amount_in, 0)::NUMERIC(14, 2) AS amount_in
    FROM receipt_transactions rt
    LEFT JOIN receipt_rules rr ON rr.id = rt.vendor_rule_id
    WHERE rt.transaction_date IS NOT NULL
  ), canonical AS (
    SELECT
      LOWER(REGEXP_REPLACE(vendor_value, '\\s+', ' ', 'g')) AS vendor_key,
      vendor_value,
      date_trunc('month', transaction_date)::DATE AS month_start,
      amount_out,
      amount_in
    FROM source
    WHERE vendor_value IS NOT NULL
  ), filtered AS (
    SELECT *
    FROM canonical
    WHERE month_start >= (date_trunc('month', NOW())::date - ((GREATEST(month_window, 1) - 1) || ' months')::interval)
  ), summarized AS (
    SELECT
      vendor_key,
      month_start,
      SUM(amount_out)::NUMERIC(14, 2) AS total_outgoing,
      SUM(amount_in)::NUMERIC(14, 2) AS total_income,
      COUNT(*) AS transaction_count,
      MIN(vendor_value) AS vendor_label
    FROM filtered
    GROUP BY vendor_key, month_start
  )
  SELECT
    summarized.vendor_label,
    summarized.month_start,
    summarized.total_outgoing,
    summarized.total_income,
    summarized.transaction_count
  FROM summarized
  ORDER BY summarized.vendor_label, summarized.month_start;
$$ LANGUAGE SQL STABLE;

COMMIT;
-- End 20251015160000_vendor_trends_use_canonical_names.sql


-- Begin 20251015170000_secure_views.sql
-- Harden sensitive views flagged by Supabase security lint
BEGIN;

-- Restrict access to auth-derived admin view
REVOKE ALL ON public.admin_users_view FROM PUBLIC;
REVOKE ALL ON public.admin_users_view FROM anon;
REVOKE ALL ON public.admin_users_view FROM authenticated;
GRANT SELECT ON public.admin_users_view TO service_role;
ALTER VIEW public.admin_users_view SET (security_invoker = true);

-- Ensure other sensitive views respect invoker privileges and are not exposed to anon role
ALTER VIEW public.message_templates_with_timing SET (security_invoker = true);
REVOKE ALL ON public.message_templates_with_timing FROM anon;
GRANT SELECT ON public.message_templates_with_timing TO authenticated;
GRANT SELECT ON public.message_templates_with_timing TO service_role;

ALTER VIEW public.recent_reminder_activity SET (security_invoker = true);
REVOKE ALL ON public.recent_reminder_activity FROM anon;
GRANT SELECT ON public.recent_reminder_activity TO authenticated;
GRANT SELECT ON public.recent_reminder_activity TO service_role;

ALTER VIEW public.reminder_timing_debug SET (security_invoker = true);
REVOKE ALL ON public.reminder_timing_debug FROM anon;
GRANT SELECT ON public.reminder_timing_debug TO authenticated;
GRANT SELECT ON public.reminder_timing_debug TO service_role;

ALTER VIEW public.employee_version_history SET (security_invoker = true);
REVOKE ALL ON public.employee_version_history FROM anon;
GRANT SELECT ON public.employee_version_history TO authenticated;
GRANT SELECT ON public.employee_version_history TO service_role;

ALTER VIEW public.private_booking_sms_reminders SET (security_invoker = true);
REVOKE ALL ON public.private_booking_sms_reminders FROM anon;
GRANT SELECT ON public.private_booking_sms_reminders TO authenticated;
GRANT SELECT ON public.private_booking_sms_reminders TO service_role;

ALTER VIEW public.private_booking_summary SET (security_invoker = true);
REVOKE ALL ON public.private_booking_summary FROM anon;
GRANT SELECT ON public.private_booking_summary TO authenticated;
GRANT SELECT ON public.private_booking_summary TO service_role;

ALTER VIEW public.customer_messaging_health SET (security_invoker = true);
REVOKE ALL ON public.customer_messaging_health FROM anon;
GRANT SELECT ON public.customer_messaging_health TO authenticated;
GRANT SELECT ON public.customer_messaging_health TO service_role;

ALTER VIEW public.private_bookings_with_details SET (security_invoker = true);
REVOKE ALL ON public.private_bookings_with_details FROM anon;
GRANT SELECT ON public.private_bookings_with_details TO authenticated;
GRANT SELECT ON public.private_bookings_with_details TO service_role;

ALTER VIEW public.short_link_daily_stats SET (security_invoker = true);
REVOKE ALL ON public.short_link_daily_stats FROM anon;
GRANT SELECT ON public.short_link_daily_stats TO authenticated;
GRANT SELECT ON public.short_link_daily_stats TO service_role;

COMMIT;
-- End 20251015170000_secure_views.sql


-- Begin 20251015171000_enable_rls_misc_tables.sql
-- Enable row level security and add policies for tables flagged by database lint
BEGIN;

-- 1. AI usage events should only be written by trusted service processes
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages ai_usage_events" ON public.ai_usage_events;
CREATE POLICY "Service role manages ai_usage_events"
  ON public.ai_usage_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
REVOKE ALL ON public.ai_usage_events FROM anon;
REVOKE ALL ON public.ai_usage_events FROM authenticated;

-- 2. P&L targets are managed by receipts team
ALTER TABLE public.pl_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Receipts users can view pl_targets" ON public.pl_targets;
DROP POLICY IF EXISTS "Receipts managers can modify pl_targets" ON public.pl_targets;
CREATE POLICY "Receipts users can view pl_targets"
  ON public.pl_targets
  FOR SELECT TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'receipts', 'view')
  );
CREATE POLICY "Receipts managers can modify pl_targets"
  ON public.pl_targets
  FOR ALL TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'receipts', 'manage')
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'receipts', 'manage')
  );
REVOKE ALL ON public.pl_targets FROM anon;

-- 3. P&L manual actuals follow the same rule set
ALTER TABLE public.pl_manual_actuals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Receipts users can view pl_manual_actuals" ON public.pl_manual_actuals;
DROP POLICY IF EXISTS "Receipts managers can modify pl_manual_actuals" ON public.pl_manual_actuals;
CREATE POLICY "Receipts users can view pl_manual_actuals"
  ON public.pl_manual_actuals
  FOR SELECT TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'receipts', 'view')
  );
CREATE POLICY "Receipts managers can modify pl_manual_actuals"
  ON public.pl_manual_actuals
  FOR ALL TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'receipts', 'manage')
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'receipts', 'manage')
  );
REVOKE ALL ON public.pl_manual_actuals FROM anon;

-- 4. Phone standardization issues are diagnostic and should stay internal
ALTER TABLE public.phone_standardization_issues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages phone_standardization_issues" ON public.phone_standardization_issues;
CREATE POLICY "Service role manages phone_standardization_issues"
  ON public.phone_standardization_issues
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
REVOKE ALL ON public.phone_standardization_issues FROM anon;
REVOKE ALL ON public.phone_standardization_issues FROM authenticated;

-- 5. Service slot configuration overrides are maintained by table bookings staff
ALTER TABLE public.service_slot_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Table bookings users can view service_slot_config" ON public.service_slot_config;
DROP POLICY IF EXISTS "Table bookings managers manage service_slot_config" ON public.service_slot_config;
CREATE POLICY "Table bookings users can view service_slot_config"
  ON public.service_slot_config
  FOR SELECT TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'table_bookings', 'view')
  );
CREATE POLICY "Table bookings managers manage service_slot_config"
  ON public.service_slot_config
  FOR ALL TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'table_bookings', 'manage')
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'table_bookings', 'manage')
  );
REVOKE ALL ON public.service_slot_config FROM anon;

ALTER TABLE public.service_slot_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Table bookings users can view service_slot_overrides" ON public.service_slot_overrides;
DROP POLICY IF EXISTS "Table bookings managers manage service_slot_overrides" ON public.service_slot_overrides;
CREATE POLICY "Table bookings users can view service_slot_overrides"
  ON public.service_slot_overrides
  FOR SELECT TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'table_bookings', 'view')
  );
CREATE POLICY "Table bookings managers manage service_slot_overrides"
  ON public.service_slot_overrides
  FOR ALL TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'table_bookings', 'manage')
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'table_bookings', 'manage')
  );
REVOKE ALL ON public.service_slot_overrides FROM anon;

-- 6. Attachment categories are used when managing employee files
ALTER TABLE public.attachment_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Employees can view attachment_categories" ON public.attachment_categories;
DROP POLICY IF EXISTS "Employees can insert attachment_categories" ON public.attachment_categories;
DROP POLICY IF EXISTS "Employees can update attachment_categories" ON public.attachment_categories;
DROP POLICY IF EXISTS "Employees can delete attachment_categories" ON public.attachment_categories;
CREATE POLICY "Employees can view attachment_categories"
  ON public.attachment_categories
  FOR SELECT TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'employees', 'view_documents')
  );
CREATE POLICY "Employees can insert attachment_categories"
  ON public.attachment_categories
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'employees', 'upload_documents')
  );
CREATE POLICY "Employees can update attachment_categories"
  ON public.attachment_categories
  FOR UPDATE TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'employees', 'upload_documents')
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'employees', 'upload_documents')
  );
CREATE POLICY "Employees can delete attachment_categories"
  ON public.attachment_categories
  FOR DELETE TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'employees', 'delete_documents')
  );
REVOKE ALL ON public.attachment_categories FROM anon;

-- 7. Invoice number series must honour invoice permissions
ALTER TABLE public.invoice_series ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Invoice users can view invoice_series" ON public.invoice_series;
DROP POLICY IF EXISTS "Invoice users can modify invoice_series" ON public.invoice_series;
DROP POLICY IF EXISTS "Invoice users can insert invoice_series" ON public.invoice_series;
DROP POLICY IF EXISTS "Invoice users can delete invoice_series" ON public.invoice_series;
CREATE POLICY "Invoice users can view invoice_series"
  ON public.invoice_series
  FOR SELECT TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'invoices', 'view')
  );
CREATE POLICY "Invoice users can modify invoice_series"
  ON public.invoice_series
  FOR UPDATE TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'invoices', 'edit')
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'invoices', 'edit')
  );
CREATE POLICY "Invoice users can insert invoice_series"
  ON public.invoice_series
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'invoices', 'edit')
  );
CREATE POLICY "Invoice users can delete invoice_series"
  ON public.invoice_series
  FOR DELETE TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'invoices', 'edit')
  );
REVOKE ALL ON public.invoice_series FROM anon;

-- 8. Vendor contacts align with invoice permissions
ALTER TABLE public.invoice_vendor_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Invoice users can view vendor contacts" ON public.invoice_vendor_contacts;
DROP POLICY IF EXISTS "Invoice users can manage vendor contacts" ON public.invoice_vendor_contacts;
CREATE POLICY "Invoice users can view vendor contacts"
  ON public.invoice_vendor_contacts
  FOR SELECT TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'invoices', 'view')
  );
CREATE POLICY "Invoice users can manage vendor contacts"
  ON public.invoice_vendor_contacts
  FOR ALL TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'invoices', 'edit')
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'invoices', 'edit')
  );
REVOKE ALL ON public.invoice_vendor_contacts FROM anon;

COMMIT;
-- End 20251015171000_enable_rls_misc_tables.sql


-- Begin 20251015172000_fix_lint_functions.sql
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
-- End 20251015172000_fix_lint_functions.sql


-- Begin 20251021120000_add_display_order_private_booking_items.sql
-- Add display_order column to private_booking_items and backfill values
ALTER TABLE public.private_booking_items
ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

-- Backfill existing rows so order defaults to created_at sequence per booking
WITH ordered_items AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY booking_id ORDER BY created_at, id) - 1 AS order_index
  FROM public.private_booking_items
)
UPDATE public.private_booking_items pbi
SET display_order = oi.order_index
FROM ordered_items oi
WHERE oi.id = pbi.id;

-- Ensure future inserts default to placing items after existing ones by keeping default 0
-- (application layer will manage incremental assignment).

CREATE INDEX IF NOT EXISTS idx_private_booking_items_booking_order
  ON public.private_booking_items (booking_id, display_order);
-- End 20251021120000_add_display_order_private_booking_items.sql


-- Begin 20251025120000_add_booking_reminder_flag.sql
-- Add explicit reminder flag to bookings so we no longer rely on seats === 0
ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS is_reminder_only boolean NOT NULL DEFAULT false;

-- Backfill existing data: any booking without seats counts as a reminder
UPDATE public.bookings
SET is_reminder_only = COALESCE(seats, 0) = 0
WHERE is_reminder_only = false;

-- Helpful index for reminder-specific queries
CREATE INDEX IF NOT EXISTS idx_bookings_is_reminder_only
  ON public.bookings (is_reminder_only);
-- End 20251025120000_add_booking_reminder_flag.sql


-- Begin 20251104153000_add_cron_job_runs.sql
-- Guard table for cron executions to prevent duplicate reminder sends

CREATE TABLE IF NOT EXISTS cron_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  run_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  finished_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cron_job_runs_job_key
  ON cron_job_runs (job_name, run_key);

CREATE OR REPLACE FUNCTION cron_job_runs_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cron_job_runs_set_updated_at_trigger ON cron_job_runs;
CREATE TRIGGER cron_job_runs_set_updated_at_trigger
  BEFORE UPDATE ON cron_job_runs
  FOR EACH ROW
  EXECUTE FUNCTION cron_job_runs_set_updated_at();

ALTER TABLE cron_job_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages cron job runs"
  ON cron_job_runs
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
-- End 20251104153000_add_cron_job_runs.sql


-- Begin 20251120000000_optimize_performance.sql
-- Description: Add performance indexes for table bookings and service slots to optimize availability checks

-- ========================================
-- 1. TABLE BOOKINGS INDEXES
-- ========================================
-- Optimize availability checks which query by date, status and time
CREATE INDEX IF NOT EXISTS idx_table_bookings_availability 
  ON table_bookings(booking_date, status, booking_time)
  WHERE status IN ('confirmed', 'pending_payment');

-- ========================================
-- 2. SERVICE SLOTS INDEXES
-- ========================================
-- Optimize slot lookups which query by date, type and start time
CREATE INDEX IF NOT EXISTS idx_service_slots_lookup
  ON service_slots(service_date, booking_type, starts_at)
  WHERE is_active = true;
-- End 20251120000000_optimize_performance.sql


-- Begin 20251120010000_fix_invoice_rls_policies.sql
-- Description: Fix RLS policies for Invoices module to allow access based on RBAC permissions
-- Previously only super_admin had access via policies in the dump.

-- ==============================================================================
-- 1. INVOICES TABLE
-- ==============================================================================

-- Ensure RLS is enabled
ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;

-- View Policy
CREATE POLICY "Users with invoices view permission can view invoices" 
ON "public"."invoices" 
FOR SELECT 
TO "authenticated" 
USING (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'view')
);

-- Create Policy
CREATE POLICY "Users with invoices create permission can create invoices" 
ON "public"."invoices" 
FOR INSERT 
TO "authenticated" 
WITH CHECK (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'create')
);

-- Update Policy
CREATE POLICY "Users with invoices edit permission can update invoices" 
ON "public"."invoices" 
FOR UPDATE 
TO "authenticated" 
USING (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'edit')
)
WITH CHECK (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'edit')
);

-- Delete Policy
CREATE POLICY "Users with invoices delete permission can delete invoices" 
ON "public"."invoices" 
FOR DELETE 
TO "authenticated" 
USING (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'delete')
);


-- ==============================================================================
-- 2. INVOICE LINE ITEMS TABLE
-- ==============================================================================

ALTER TABLE "public"."invoice_line_items" ENABLE ROW LEVEL SECURITY;

-- View Policy (Inherit 'view' from invoices module)
CREATE POLICY "Users with invoices view permission can view line items" 
ON "public"."invoice_line_items" 
FOR SELECT 
TO "authenticated" 
USING (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'view')
);

-- Create Policy (Inherit 'create' or 'edit' - users need to add lines when creating OR editing)
CREATE POLICY "Users with invoices create/edit permission can add line items" 
ON "public"."invoice_line_items" 
FOR INSERT 
TO "authenticated" 
WITH CHECK (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'create') OR
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'edit')
);

-- Update Policy
CREATE POLICY "Users with invoices edit permission can update line items" 
ON "public"."invoice_line_items" 
FOR UPDATE 
TO "authenticated" 
USING (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'edit')
)
WITH CHECK (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'edit')
);

-- Delete Policy
CREATE POLICY "Users with invoices edit/delete permission can delete line items" 
ON "public"."invoice_line_items" 
FOR DELETE 
TO "authenticated" 
USING (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'edit') OR
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'delete')
);


-- ==============================================================================
-- 3. INVOICE PAYMENTS TABLE
-- ==============================================================================

ALTER TABLE "public"."invoice_payments" ENABLE ROW LEVEL SECURITY;

-- View Policy
CREATE POLICY "Users with invoices view permission can view payments" 
ON "public"."invoice_payments" 
FOR SELECT 
TO "authenticated" 
USING (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'view')
);

-- Create Policy (Recording a payment is considered an 'edit' to the invoice state)
CREATE POLICY "Users with invoices edit permission can record payments" 
ON "public"."invoice_payments" 
FOR INSERT 
TO "authenticated" 
WITH CHECK (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'edit')
);

-- Update Policy
CREATE POLICY "Users with invoices edit permission can update payments" 
ON "public"."invoice_payments" 
FOR UPDATE 
TO "authenticated" 
USING (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'edit')
)
WITH CHECK (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'edit')
);

-- Delete Policy
CREATE POLICY "Users with invoices edit permission can delete payments" 
ON "public"."invoice_payments" 
FOR DELETE 
TO "authenticated" 
USING (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'edit')
);
-- End 20251120010000_fix_invoice_rls_policies.sql


-- Begin 20251122000000_cashing_up_module.sql
-- Create sites table if it doesn't exist (as per spec requirements)
CREATE TABLE IF NOT EXISTS sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default site if not exists
INSERT INTO sites (name)
SELECT 'The Anchor'
WHERE NOT EXISTS (SELECT 1 FROM sites);

-- 3.1.1 cashup_sessions
CREATE TABLE cashup_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES sites(id),
    session_date DATE NOT NULL,
    shift_code TEXT NULL,

    status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'approved', 'locked')),

    prepared_by_user_id UUID NOT NULL,
    approved_by_user_id UUID NULL,

    total_expected_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_counted_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_variance_amount NUMERIC(12,2) NOT NULL DEFAULT 0,

    notes TEXT NULL,

    workbook_payload JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_user_id UUID NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by_user_id UUID NOT NULL
);

-- Unique index to handle NULL shift_code as distinct value 'NONE' for uniqueness
CREATE UNIQUE INDEX cashup_sessions_site_date_shift_idx ON cashup_sessions (site_id, session_date, COALESCE(shift_code, 'NONE'));

-- 3.1.2 cashup_payment_breakdowns
CREATE TABLE cashup_payment_breakdowns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cashup_session_id UUID NOT NULL REFERENCES cashup_sessions(id) ON DELETE CASCADE,

    payment_type_code TEXT NOT NULL,
    payment_type_label TEXT NOT NULL,

    expected_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    counted_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    variance_amount NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- 3.1.3 cashup_cash_counts
CREATE TABLE cashup_cash_counts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cashup_session_id UUID NOT NULL REFERENCES cashup_sessions(id) ON DELETE CASCADE,

    denomination NUMERIC(6,2) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- 3.1.4 cashup_config
CREATE TABLE cashup_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL
);

-- 3.1.5 cashup_weekly_view
CREATE OR REPLACE VIEW cashup_weekly_view AS
SELECT
    cs.site_id,
    date_trunc('week', cs.session_date)::date AS week_start_date,
    cs.session_date,
    cs.shift_code,
    cs.status,
    cs.total_expected_amount,
    cs.total_counted_amount,
    cs.total_variance_amount
FROM cashup_sessions cs;

-- RLS Policies
ALTER TABLE cashup_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashup_payment_breakdowns ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashup_cash_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashup_config ENABLE ROW LEVEL SECURITY;

-- Basic permissive policies for authenticated users (to be refined)
CREATE POLICY "Authenticated users can view sites" ON sites FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can view sessions" ON cashup_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert sessions" ON cashup_sessions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update sessions" ON cashup_sessions FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can view breakdowns" ON cashup_payment_breakdowns FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert breakdowns" ON cashup_payment_breakdowns FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update breakdowns" ON cashup_payment_breakdowns FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete breakdowns" ON cashup_payment_breakdowns FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can view counts" ON cashup_cash_counts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert counts" ON cashup_cash_counts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update counts" ON cashup_cash_counts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete counts" ON cashup_cash_counts FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can view config" ON cashup_config FOR SELECT TO authenticated USING (true);
-- End 20251122000000_cashing_up_module.sql


-- Begin 20251122000001_add_cashing_up_permissions.sql
-- Migration to add cashing_up module permissions

-- First, check if permissions already exist
DO $$
BEGIN
    -- Only insert if no cashing_up permissions exist
    IF NOT EXISTS (
        SELECT 1 FROM permissions WHERE module_name = 'cashing_up'
    ) THEN
        INSERT INTO permissions (module_name, action, description) VALUES
            ('cashing_up', 'view', 'View cashing up sessions'),
            ('cashing_up', 'create', 'Create new cashing up sessions'),
            ('cashing_up', 'edit', 'Edit cashing up sessions'),
            ('cashing_up', 'delete', 'Delete cashing up sessions'),
            ('cashing_up', 'submit', 'Submit cashing up sessions for approval'),
            ('cashing_up', 'approve', 'Approve cashing up sessions'),
            ('cashing_up', 'lock', 'Lock cashing up sessions'),
            ('cashing_up', 'unlock', 'Unlock locked cashing up sessions');

        RAISE NOTICE 'Cashing Up permissions added successfully';
    ELSE
        RAISE NOTICE 'Cashing Up permissions already exist, skipping';
    END IF;
END $$;

-- Assign permissions to roles
DO $$
DECLARE
    v_admin_role_id UUID;
    v_super_admin_role_id UUID;
    v_manager_role_id UUID;
    v_permission_id UUID;
BEGIN
    -- Get role IDs (adjust role names if your DB uses different ones)
    SELECT id INTO v_admin_role_id FROM roles WHERE name = 'admin';
    SELECT id INTO v_super_admin_role_id FROM roles WHERE name = 'super_admin';
    SELECT id INTO v_manager_role_id FROM roles WHERE name = 'manager';

    -- Assign permissions
    FOR v_permission_id IN 
        SELECT id FROM permissions WHERE module_name = 'cashing_up'
    LOOP
        -- Super Admin & Admin get ALL permissions
        IF v_super_admin_role_id IS NOT NULL THEN
            INSERT INTO role_permissions (role_id, permission_id)
            VALUES (v_super_admin_role_id, v_permission_id)
            ON CONFLICT DO NOTHING;
        END IF;

        IF v_admin_role_id IS NOT NULL THEN
            INSERT INTO role_permissions (role_id, permission_id)
            VALUES (v_admin_role_id, v_permission_id)
            ON CONFLICT DO NOTHING;
        END IF;

        -- Manager gets View, Create, Edit, Submit (NOT Approve, Lock, Unlock)
        IF v_manager_role_id IS NOT NULL THEN
            IF EXISTS (
                SELECT 1 FROM permissions 
                WHERE id = v_permission_id 
                AND action IN ('view', 'create', 'edit', 'submit')
            ) THEN
                INSERT INTO role_permissions (role_id, permission_id)
                VALUES (v_manager_role_id, v_permission_id)
                ON CONFLICT DO NOTHING;
            END IF;
        END IF;
    END LOOP;

    RAISE NOTICE 'Cashing Up permissions assigned to roles successfully';
END $$;
-- End 20251122000001_add_cashing_up_permissions.sql


-- Begin 20251122000002_cashing_up_rls.sql
-- Update RLS policies for cashing_up module to use permission checks

-- cashup_sessions
DROP POLICY IF EXISTS "Authenticated users can view sessions" ON cashup_sessions;
DROP POLICY IF EXISTS "Authenticated users can insert sessions" ON cashup_sessions;
DROP POLICY IF EXISTS "Authenticated users can update sessions" ON cashup_sessions;

CREATE POLICY "Users can view sessions with permission" ON cashup_sessions
    FOR SELECT TO authenticated
    USING (public.user_has_permission(auth.uid(), 'cashing_up', 'view'));

CREATE POLICY "Users can insert sessions with permission" ON cashup_sessions
    FOR INSERT TO authenticated
    WITH CHECK (public.user_has_permission(auth.uid(), 'cashing_up', 'create'));

CREATE POLICY "Users can update sessions with permission" ON cashup_sessions
    FOR UPDATE TO authenticated
    USING (
        public.user_has_permission(auth.uid(), 'cashing_up', 'edit') OR
        public.user_has_permission(auth.uid(), 'cashing_up', 'submit') OR
        public.user_has_permission(auth.uid(), 'cashing_up', 'approve') OR
        public.user_has_permission(auth.uid(), 'cashing_up', 'lock') OR
        public.user_has_permission(auth.uid(), 'cashing_up', 'unlock')
    );

-- cashup_payment_breakdowns
DROP POLICY IF EXISTS "Authenticated users can view breakdowns" ON cashup_payment_breakdowns;
DROP POLICY IF EXISTS "Authenticated users can insert breakdowns" ON cashup_payment_breakdowns;
DROP POLICY IF EXISTS "Authenticated users can update breakdowns" ON cashup_payment_breakdowns;
DROP POLICY IF EXISTS "Authenticated users can delete breakdowns" ON cashup_payment_breakdowns;

CREATE POLICY "Users can view breakdowns with permission" ON cashup_payment_breakdowns
    FOR SELECT TO authenticated
    USING (public.user_has_permission(auth.uid(), 'cashing_up', 'view'));

CREATE POLICY "Users can insert breakdowns with permission" ON cashup_payment_breakdowns
    FOR INSERT TO authenticated
    WITH CHECK (public.user_has_permission(auth.uid(), 'cashing_up', 'create') OR public.user_has_permission(auth.uid(), 'cashing_up', 'edit'));

CREATE POLICY "Users can update breakdowns with permission" ON cashup_payment_breakdowns
    FOR UPDATE TO authenticated
    USING (public.user_has_permission(auth.uid(), 'cashing_up', 'edit'));

CREATE POLICY "Users can delete breakdowns with permission" ON cashup_payment_breakdowns
    FOR DELETE TO authenticated
    USING (public.user_has_permission(auth.uid(), 'cashing_up', 'edit')); -- Deleting breakdowns happens during update/upsert

-- cashup_cash_counts
DROP POLICY IF EXISTS "Authenticated users can view counts" ON cashup_cash_counts;
DROP POLICY IF EXISTS "Authenticated users can insert counts" ON cashup_cash_counts;
DROP POLICY IF EXISTS "Authenticated users can update counts" ON cashup_cash_counts;
DROP POLICY IF EXISTS "Authenticated users can delete counts" ON cashup_cash_counts;

CREATE POLICY "Users can view counts with permission" ON cashup_cash_counts
    FOR SELECT TO authenticated
    USING (public.user_has_permission(auth.uid(), 'cashing_up', 'view'));

CREATE POLICY "Users can insert counts with permission" ON cashup_cash_counts
    FOR INSERT TO authenticated
    WITH CHECK (public.user_has_permission(auth.uid(), 'cashing_up', 'create') OR public.user_has_permission(auth.uid(), 'cashing_up', 'edit'));

CREATE POLICY "Users can update counts with permission" ON cashup_cash_counts
    FOR UPDATE TO authenticated
    USING (public.user_has_permission(auth.uid(), 'cashing_up', 'edit'));

CREATE POLICY "Users can delete counts with permission" ON cashup_cash_counts
    FOR DELETE TO authenticated
    USING (public.user_has_permission(auth.uid(), 'cashing_up', 'edit'));

-- cashup_config
DROP POLICY IF EXISTS "Authenticated users can view config" ON cashup_config;
CREATE POLICY "Users can view config with permission" ON cashup_config
    FOR SELECT TO authenticated
    USING (public.user_has_permission(auth.uid(), 'cashing_up', 'view'));
-- End 20251122000002_cashing_up_rls.sql


-- Begin 20251122000010_redesign_business_hours.sql
-- Migration: Redesign Business Hours
-- Description: Adds schedule_config to business_hours and special_hours, and migrates existing slot configs.

-- 1. Add schedule_config column to business_hours
ALTER TABLE business_hours 
ADD COLUMN IF NOT EXISTS schedule_config JSONB DEFAULT '[]'::JSONB;

-- 2. Add schedule_config column to special_hours
ALTER TABLE special_hours 
ADD COLUMN IF NOT EXISTS schedule_config JSONB DEFAULT '[]'::JSONB;

-- 3. Data Migration: Move service_slot_config data to business_hours
-- We aggregate the active configs for each day into the JSON structure
WITH configs AS (
  SELECT 
    day_of_week,
    jsonb_agg(jsonb_build_object(
      'name', slot_type,
      'starts_at', to_char(starts_at, 'HH24:MI'),
      'ends_at', to_char(ends_at, 'HH24:MI'),
      'capacity', capacity,
      'booking_type', booking_type
    ) ORDER BY starts_at) as config
  FROM service_slot_config
  WHERE is_active = true
  GROUP BY day_of_week
)
UPDATE business_hours bh
SET schedule_config = c.config
FROM configs c
WHERE bh.day_of_week = c.day_of_week;

-- 4. Ensure special_hours also has a default structure (optional, strictly it can be null or empty to imply "Closed" or "Use Default"?)
-- For now, we leave it empty. The logic will be: if special_hours exists, use its config. If its config is empty array, it means closed? 
-- No, special_hours has `is_closed`. If `is_closed` is false, we expect a schedule.
-- We don't have easy data to migrate for special_hours, so we leave them as is. 
-- Future special hours will need to include the config.

-- 5. Grant permissions (standard practice)
GRANT ALL ON TABLE business_hours TO service_role;
GRANT ALL ON TABLE special_hours TO service_role;
-- End 20251122000010_redesign_business_hours.sql


-- Begin 20251122000011_add_slot_generator_function.sql
-- Migration: Add Slot Generator Function
-- Description: Implements the smart slot generation logic using business_hours as the source of truth.

CREATE OR REPLACE FUNCTION generate_slots_from_business_hours(
  p_start_date DATE DEFAULT CURRENT_DATE,
  p_days_ahead INTEGER DEFAULT 90
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_date DATE;
  v_end_date DATE;
  v_day_of_week INTEGER;
  v_special_config JSONB;
  v_regular_config JSONB;
  v_active_config JSONB;
  v_is_closed BOOLEAN;
  v_slot RECORD;
  v_slots_generated INTEGER := 0;
  v_slots_deactivated INTEGER := 0;
BEGIN
  v_end_date := p_start_date + p_days_ahead;
  v_current_date := p_start_date;

  -- Loop through each day in the range
  WHILE v_current_date <= v_end_date LOOP
    v_day_of_week := EXTRACT(DOW FROM v_current_date);
    v_active_config := NULL;
    v_is_closed := false;

    -- 1. Check Special Hours (Exceptions)
    SELECT schedule_config, is_closed INTO v_special_config, v_is_closed
    FROM special_hours
    WHERE date = v_current_date;

    IF FOUND THEN
      -- If special hours exist for this date, they take ABSOLUTE precedence
      IF v_is_closed THEN
        v_active_config := '[]'::JSONB;
      ELSE
        v_active_config := v_special_config;
      END IF;
    ELSE
      -- 2. Fallback to Business Hours (Standard Schedule)
      SELECT schedule_config, is_closed INTO v_regular_config, v_is_closed
      FROM business_hours
      WHERE day_of_week = v_day_of_week;

      IF FOUND AND NOT v_is_closed THEN
        v_active_config := v_regular_config;
      ELSE
        v_active_config := '[]'::JSONB;
      END IF;
    END IF;

    -- 3. Apply to Service Slots
    
    -- A. If config is empty, deactivate all slots for this day
    IF v_active_config IS NULL OR jsonb_array_length(v_active_config) = 0 THEN
      WITH deactivated AS (
        UPDATE service_slots
        SET is_active = false, updated_at = NOW()
        WHERE service_date = v_current_date AND is_active = true
        RETURNING 1
      )
      SELECT count(*) INTO v_slots_deactivated FROM deactivated;
      
    ELSE
      -- B. Upsert slots from config
      FOR v_slot IN SELECT * FROM jsonb_to_recordset(v_active_config) AS x(
        starts_at TIME,
        ends_at TIME,
        capacity INTEGER,
        booking_type table_booking_type
      )
      LOOP
        INSERT INTO service_slots (
          service_date,
          starts_at,
          ends_at,
          capacity,
          booking_type,
          is_active
        ) VALUES (
          v_current_date,
          v_slot.starts_at,
          v_slot.ends_at,
          v_slot.capacity,
          v_slot.booking_type,
          true
        )
        ON CONFLICT (service_date, starts_at, booking_type) DO UPDATE
        SET 
          ends_at = EXCLUDED.ends_at,
          capacity = EXCLUDED.capacity,
          is_active = true,
          updated_at = NOW();
          
        v_slots_generated := v_slots_generated + 1;
      END LOOP;
      
      -- C. Cleanup: Deactivate slots that exist for this date but are NOT in the current config
      -- This handles cases where shifts change (e.g. Lunch was 12:00, now it is 12:30)
      WITH active_starts AS (
        SELECT (x.starts_at)::TIME as s, (x.booking_type)::table_booking_type as b
        FROM jsonb_to_recordset(v_active_config) AS x(starts_at TIME, booking_type text)
      )
      UPDATE service_slots s
      SET is_active = false, updated_at = NOW()
      WHERE s.service_date = v_current_date 
      AND s.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM active_starts a WHERE a.s = s.starts_at AND a.b = s.booking_type
      );
      
    END IF;

    v_current_date := v_current_date + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'message', format('Generated slots from %s to %s', p_start_date, v_end_date),
    'slots_processed', v_slots_generated,
    'slots_deactivated', v_slots_deactivated
  );
END;
$$;

-- Update the legacy wrapper to use the new logic
CREATE OR REPLACE FUNCTION auto_generate_weekly_slots()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Generate slots for the next 90 days using the new unified logic
  v_result := generate_slots_from_business_hours(CURRENT_DATE, 90);
  
  -- Log audit
  INSERT INTO audit_logs (
    entity_type,
    entity_id,
    operation_type,
    operation_status,
    additional_info
  ) VALUES (
    'service_slots',
    NULL,
    'auto_generate_unified',
    'success',
    v_result
  );
  
  RETURN v_result;
END;
$$;
-- End 20251122000011_add_slot_generator_function.sql


-- Begin 20251123120000_fix_private_booking_rls.sql
-- Fix RLS policies for private bookings
BEGIN;

-- 1. Private Bookings Table
ALTER TABLE public.private_bookings ENABLE ROW LEVEL SECURITY;

-- View Policy
DROP POLICY IF EXISTS "Users can view private bookings" ON public.private_bookings;
CREATE POLICY "Users can view private bookings"
  ON public.private_bookings
  FOR SELECT TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'view')
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'manage')
  );

-- Manage Policy (Insert, Update, Delete)
DROP POLICY IF EXISTS "Users can manage private bookings" ON public.private_bookings;
CREATE POLICY "Users can manage private bookings"
  ON public.private_bookings
  FOR ALL TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'manage')
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'edit')
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'create')
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'manage')
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'edit')
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'create')
  );

-- 2. Private Booking Items Table
ALTER TABLE public.private_booking_items ENABLE ROW LEVEL SECURITY;

-- View Policy
DROP POLICY IF EXISTS "Users can view private booking items" ON public.private_booking_items;
CREATE POLICY "Users can view private booking items"
  ON public.private_booking_items
  FOR SELECT TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'view')
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'manage')
  );

-- Manage Policy
DROP POLICY IF EXISTS "Users can manage private booking items" ON public.private_booking_items;
CREATE POLICY "Users can manage private booking items"
  ON public.private_booking_items
  FOR ALL TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'manage')
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'edit')
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'create')
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'manage')
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'edit')
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'create')
  );

COMMIT;
-- End 20251123120000_fix_private_booking_rls.sql


-- Begin 20251205120000_receipt_bulk_require_manual_filter.sql
-- Tune receipt bulk grouping to focus on fully unclassified rows
BEGIN;

CREATE OR REPLACE FUNCTION get_receipt_detail_groups(
  limit_groups INTEGER DEFAULT 100,
  include_statuses TEXT[] DEFAULT ARRAY['pending','auto_completed','completed','no_receipt_required','cant_find'],
  only_unclassified BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  details TEXT,
  transaction_ids UUID[],
  transaction_count BIGINT,
  needs_vendor_count BIGINT,
  needs_expense_count BIGINT,
  total_in NUMERIC(14, 2),
  total_out NUMERIC(14, 2),
  first_date DATE,
  last_date DATE,
  dominant_vendor TEXT,
  dominant_expense TEXT,
  sample_transaction JSONB
) AS $$
  WITH filtered AS (
    SELECT *
    FROM receipt_transactions
    WHERE details IS NOT NULL
      AND details <> ''
      AND (include_statuses IS NULL OR status::text = ANY(include_statuses))
      AND (
        NOT only_unclassified
        OR (
          (vendor_name IS NULL OR btrim(vendor_name) = '')
          AND expense_category IS NULL
        )
      )
  ), grouped AS (
    SELECT
      details,
      ARRAY_AGG(id ORDER BY transaction_date DESC) AS transaction_ids,
      COUNT(*) AS transaction_count,
      COUNT(*) FILTER (WHERE vendor_name IS NULL OR btrim(vendor_name) = '') AS needs_vendor_count,
      COUNT(*) FILTER (WHERE expense_category IS NULL) AS needs_expense_count,
      SUM(COALESCE(amount_in, 0))::NUMERIC(14, 2) AS total_in,
      SUM(COALESCE(amount_out, 0))::NUMERIC(14, 2) AS total_out,
      MIN(transaction_date)::DATE AS first_date,
      MAX(transaction_date)::DATE AS last_date,
      MODE() WITHIN GROUP (ORDER BY vendor_name) FILTER (WHERE vendor_name IS NOT NULL AND btrim(vendor_name) <> '') AS dominant_vendor,
      MODE() WITHIN GROUP (ORDER BY expense_category) FILTER (WHERE expense_category IS NOT NULL) AS dominant_expense,
      (
        SELECT jsonb_build_object(
          'id', t.id,
          'transaction_date', t.transaction_date,
          'transaction_type', t.transaction_type,
          'amount_in', t.amount_in,
          'amount_out', t.amount_out,
          'vendor_name', t.vendor_name,
          'vendor_source', t.vendor_source,
          'expense_category', t.expense_category,
          'expense_category_source', t.expense_category_source
        )
        FROM filtered t
        WHERE t.details = rt.details
        ORDER BY
          CASE
            WHEN (t.vendor_name IS NULL OR btrim(t.vendor_name) = '') AND t.expense_category IS NULL THEN 0
            WHEN (t.vendor_name IS NULL OR btrim(t.vendor_name) = '') OR t.expense_category IS NULL THEN 1
            ELSE 2
          END,
          t.transaction_date DESC
        LIMIT 1
      ) AS sample_transaction
    FROM filtered rt
    GROUP BY details
    ORDER BY transaction_count DESC, details ASC
    LIMIT GREATEST(limit_groups, 1)
  )
  SELECT * FROM grouped;
$$ LANGUAGE SQL STABLE;

COMMIT;
-- End 20251205120000_receipt_bulk_require_manual_filter.sql


-- Begin 20251215123000_update_invoice_transaction.sql
create or replace function update_invoice_with_line_items(
  p_invoice_id uuid,
  p_invoice_data jsonb,
  p_line_items jsonb
)
returns invoices
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  existing_invoice invoices%rowtype;
  updated_invoice invoices%rowtype;
begin
  if p_invoice_id is null then
    raise exception 'invoice_id is required';
  end if;

  if p_line_items is null
     or jsonb_typeof(p_line_items) <> 'array'
     or jsonb_array_length(p_line_items) = 0 then
    raise exception 'line_items must be a non-empty array';
  end if;

  select *
  into existing_invoice
  from invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice % not found', p_invoice_id;
  end if;

  if existing_invoice.status <> 'draft' then
    raise exception 'Only draft invoices can be edited';
  end if;

  update invoices
  set
    vendor_id = coalesce((p_invoice_data->>'vendor_id')::uuid, existing_invoice.vendor_id),
    invoice_date = coalesce((p_invoice_data->>'invoice_date')::date, existing_invoice.invoice_date),
    due_date = coalesce((p_invoice_data->>'due_date')::date, existing_invoice.due_date),
    reference = nullif(p_invoice_data->>'reference', ''),
    invoice_discount_percentage = coalesce(
      (p_invoice_data->>'invoice_discount_percentage')::numeric,
      existing_invoice.invoice_discount_percentage
    ),
    subtotal_amount = coalesce((p_invoice_data->>'subtotal_amount')::numeric, existing_invoice.subtotal_amount),
    discount_amount = coalesce((p_invoice_data->>'discount_amount')::numeric, existing_invoice.discount_amount),
    vat_amount = coalesce((p_invoice_data->>'vat_amount')::numeric, existing_invoice.vat_amount),
    total_amount = coalesce((p_invoice_data->>'total_amount')::numeric, existing_invoice.total_amount),
    notes = case
      when p_invoice_data ? 'notes' then nullif(p_invoice_data->>'notes', '')
      else existing_invoice.notes
    end,
    internal_notes = case
      when p_invoice_data ? 'internal_notes' then nullif(p_invoice_data->>'internal_notes', '')
      else existing_invoice.internal_notes
    end,
    updated_at = timezone('utc', now())
  where id = p_invoice_id
  returning * into updated_invoice;

  delete from invoice_line_items
  where invoice_id = p_invoice_id;

  insert into invoice_line_items (
    invoice_id,
    catalog_item_id,
    description,
    quantity,
    unit_price,
    discount_percentage,
    vat_rate
  )
  select
    p_invoice_id,
    nullif(item->>'catalog_item_id', '')::uuid,
    coalesce(item->>'description', ''),
    coalesce((item->>'quantity')::numeric, 0),
    coalesce((item->>'unit_price')::numeric, 0),
    coalesce((item->>'discount_percentage')::numeric, 0),
    coalesce((item->>'vat_rate')::numeric, 0)
  from jsonb_array_elements(p_line_items) as item;

  return updated_invoice;
end;
$$;

grant execute on function update_invoice_with_line_items(uuid, jsonb, jsonb) to service_role;
-- End 20251215123000_update_invoice_transaction.sql


-- Begin 20251215124000_add_event_brief.sql
alter table public.events
add column if not exists brief text;
-- End 20251215124000_add_event_brief.sql


-- Begin 20251215124500_add_event_promotion_copy.sql
alter table public.events
add column if not exists facebook_event_name text,
add column if not exists facebook_event_description text,
add column if not exists gbp_event_title text,
add column if not exists gbp_event_description text;
-- End 20251215124500_add_event_promotion_copy.sql


-- Begin 20251216120000_add_booking_update_sms_templates.sql
-- Description: Add SMS templates for booking updates

INSERT INTO public.table_booking_sms_templates (template_key, booking_type, template_text, variables, is_active)
VALUES
  (
    'booking_update_regular',
    'regular',
    'Hi {{customer_name}}, we''ve updated your booking {{reference}} to {{date}} at {{time}} for {{party_size}} guests. Call {{contact_phone}} if you need to make further changes. The Anchor',
    ARRAY['customer_name', 'reference', 'date', 'time', 'party_size', 'contact_phone'],
    true
  ),
  (
    'booking_update_sunday_lunch',
    'sunday_lunch',
    'Hi {{customer_name}}, we''ve updated your Sunday Lunch booking {{reference}} to {{date}} at {{time}} for {{party_size}} guests. Call {{contact_phone}} if you need to make further changes. The Anchor',
    ARRAY['customer_name', 'reference', 'date', 'time', 'party_size', 'contact_phone'],
    true
  )
ON CONFLICT (template_key) DO UPDATE SET
  template_text = EXCLUDED.template_text,
  variables = EXCLUDED.variables,
  updated_at = NOW()
WHERE table_booking_sms_templates.is_active = true;

-- End 20251216120000_add_booking_update_sms_templates.sql


-- Begin 20260110120000_menu_management.sql
-- Menu management schema unification

-- Create enum types
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'menu_unit') THEN
    CREATE TYPE menu_unit AS ENUM (
      'each',
      'portion',
      'gram',
      'kilogram',
      'millilitre',
      'litre',
      'ounce',
      'pound',
      'teaspoon',
      'tablespoon',
      'cup',
      'slice',
      'piece'
    );
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'menu_storage_type') THEN
    CREATE TYPE menu_storage_type AS ENUM (
      'ambient',
      'chilled',
      'frozen',
      'dry',
      'other'
    );
  END IF;
END$$;

-- Ingredients
CREATE TABLE IF NOT EXISTS menu_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  default_unit menu_unit NOT NULL DEFAULT 'each',
  storage_type menu_storage_type NOT NULL DEFAULT 'ambient',
  supplier_name TEXT,
  supplier_sku TEXT,
  brand TEXT,
  pack_size NUMERIC(12,4),
  pack_size_unit menu_unit,
  pack_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  portions_per_pack NUMERIC(12,4),
  wastage_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
  shelf_life_days INTEGER,
  allergens TEXT[] NOT NULL DEFAULT '{}',
  dietary_flags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE menu_ingredients IS 'Core ingredients used for menu dishes with costing metadata';

CREATE INDEX IF NOT EXISTS idx_menu_ingredients_active ON menu_ingredients(is_active);
CREATE INDEX IF NOT EXISTS idx_menu_ingredients_supplier ON menu_ingredients(LOWER(supplier_name));

-- Ingredient price history
CREATE TABLE IF NOT EXISTS menu_ingredient_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id UUID NOT NULL REFERENCES menu_ingredients(id) ON DELETE CASCADE,
  pack_cost NUMERIC(12,4) NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  supplier_name TEXT,
  supplier_sku TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE menu_ingredient_prices IS 'Historical price records for ingredients';

CREATE INDEX IF NOT EXISTS idx_menu_ingredient_prices_ingredient ON menu_ingredient_prices(ingredient_id, effective_from DESC);

-- Menus (e.g. website food, Sunday lunch)
CREATE TABLE IF NOT EXISTS menu_menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE menu_menus IS 'Named menus that dishes can be assigned to (e.g. website food menu, Sunday lunch)';

-- Menu categories
CREATE TABLE IF NOT EXISTS menu_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE menu_categories IS 'Standardised categories for organising dishes';

-- Menu/category mapping
CREATE TABLE IF NOT EXISTS menu_category_menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id UUID NOT NULL REFERENCES menu_menus(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (menu_id, category_id)
);

COMMENT ON TABLE menu_category_menus IS 'Associates categories with specific menus';

-- Dishes
CREATE TABLE IF NOT EXISTS menu_dishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  description TEXT,
  selling_price NUMERIC(12,4) NOT NULL DEFAULT 0,
  target_gp_pct NUMERIC(6,4) NOT NULL DEFAULT 0.70,
  portion_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  gp_pct NUMERIC(6,4),
  allergen_flags TEXT[] NOT NULL DEFAULT '{}',
  dietary_flags TEXT[] NOT NULL DEFAULT '{}',
  calories INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_sunday_lunch BOOLEAN NOT NULL DEFAULT false,
  image_url TEXT,
  notes TEXT,
  is_gp_alert BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE menu_dishes IS 'Menu-ready dishes composed of ingredients and attached to menus/categories';

CREATE INDEX IF NOT EXISTS idx_menu_dishes_active ON menu_dishes(is_active);
CREATE INDEX IF NOT EXISTS idx_menu_dishes_sunday_lunch ON menu_dishes(is_sunday_lunch);

-- Dish ingredients
CREATE TABLE IF NOT EXISTS menu_dish_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id UUID NOT NULL REFERENCES menu_dishes(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES menu_ingredients(id),
  quantity NUMERIC(12,4) NOT NULL DEFAULT 0,
  unit menu_unit NOT NULL,
  yield_pct NUMERIC(6,3) NOT NULL DEFAULT 100,
  wastage_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
  cost_override NUMERIC(12,4),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dish_id, ingredient_id)
);

COMMENT ON TABLE menu_dish_ingredients IS 'Join table defining ingredient quantities for a dish';

CREATE INDEX IF NOT EXISTS idx_menu_dish_ingredients_dish ON menu_dish_ingredients(dish_id);
CREATE INDEX IF NOT EXISTS idx_menu_dish_ingredients_ingredient ON menu_dish_ingredients(ingredient_id);

-- Dish assignments to menus/categories
CREATE TABLE IF NOT EXISTS menu_dish_menu_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id UUID NOT NULL REFERENCES menu_dishes(id) ON DELETE CASCADE,
  menu_id UUID NOT NULL REFERENCES menu_menus(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES menu_categories(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  available_from DATE,
  available_until DATE,
  is_special BOOLEAN NOT NULL DEFAULT false,
  is_default_side BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dish_id, menu_id, category_id)
);

COMMENT ON TABLE menu_dish_menu_assignments IS 'Placement of dishes within menus and categories';

CREATE INDEX IF NOT EXISTS idx_menu_dish_menu_assignments_menu ON menu_dish_menu_assignments(menu_id, category_id, sort_order);

-- Helper function to fetch latest ingredient price (pack cost)
CREATE OR REPLACE FUNCTION menu_get_latest_pack_cost(p_ingredient_id UUID)
RETURNS NUMERIC LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(
    (
      SELECT mip.pack_cost
      FROM menu_ingredient_prices mip
      WHERE mip.ingredient_id = p_ingredient_id
      ORDER BY mip.effective_from DESC
      LIMIT 1
    ),
    mi.pack_cost
  )
  FROM menu_ingredients mi
  WHERE mi.id = p_ingredient_id;
$$;

COMMENT ON FUNCTION menu_get_latest_pack_cost(UUID) IS 'Returns the most recent pack cost for an ingredient, falling back to the base pack_cost column';

-- Helper to determine unit cost based on portions per pack or pack size
CREATE OR REPLACE FUNCTION menu_get_latest_unit_cost(p_ingredient_id UUID)
RETURNS NUMERIC LANGUAGE SQL STABLE AS $$
  SELECT 
    CASE
      WHEN mi.portions_per_pack IS NOT NULL AND mi.portions_per_pack > 0
        THEN COALESCE(menu_get_latest_pack_cost(mi.id) / mi.portions_per_pack, 0)
      WHEN mi.pack_size IS NOT NULL AND mi.pack_size > 0
        THEN COALESCE(menu_get_latest_pack_cost(mi.id) / mi.pack_size, 0)
      ELSE COALESCE(menu_get_latest_pack_cost(mi.id), 0)
    END
  FROM menu_ingredients mi
  WHERE mi.id = p_ingredient_id;
$$;

COMMENT ON FUNCTION menu_get_latest_unit_cost(UUID) IS 'Returns the cost per base unit/portion for an ingredient';

-- Refresh dish costing and dietary/allergen aggregates
CREATE OR REPLACE FUNCTION menu_refresh_dish_calculations(p_dish_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_portion_cost NUMERIC(12,4) := 0;
  v_selling_price NUMERIC(12,4) := 0;
  v_target_gp NUMERIC(6,4) := 0.70;
  v_gp NUMERIC(6,4);
  v_allergens TEXT[];
  v_dietary TEXT[];
BEGIN
  WITH ingredient_rows AS (
    SELECT
      di.quantity,
      COALESCE(NULLIF(di.yield_pct, 0), 100)::NUMERIC AS yield_pct,
      COALESCE(di.wastage_pct, 0)::NUMERIC AS dish_wastage_pct,
      mi.wastage_pct AS ingredient_wastage_pct,
      COALESCE(di.cost_override, menu_get_latest_unit_cost(mi.id)) AS unit_cost,
      mi.allergens,
      mi.dietary_flags
    FROM menu_dish_ingredients di
    JOIN menu_ingredients mi ON mi.id = di.ingredient_id
    WHERE di.dish_id = p_dish_id
  ),
  cost_rows AS (
    SELECT
      COALESCE(SUM(
        (
          ir.quantity
          * ir.unit_cost
          * 100 / NULLIF(ir.yield_pct, 0)
          * (1 + (COALESCE(ir.dish_wastage_pct, ir.ingredient_wastage_pct, 0) / 100))
        )
      ), 0) AS portion_cost,
      COALESCE(ARRAY(
        SELECT DISTINCT TRIM(allergen)
        FROM ingredient_rows ir2,
        LATERAL UNNEST(ir2.allergens) AS allergen
        WHERE allergen IS NOT NULL AND allergen <> ''
      ), '{}'::TEXT[]) AS allergens,
      COALESCE(ARRAY(
        SELECT DISTINCT TRIM(flag)
        FROM ingredient_rows ir3,
        LATERAL UNNEST(ir3.dietary_flags) AS flag
        WHERE flag IS NOT NULL AND flag <> ''
      ), '{}'::TEXT[]) AS dietary_flags
    FROM ingredient_rows ir
  )
  SELECT
    cr.portion_cost,
    cr.allergens,
    cr.dietary_flags
  INTO
    v_portion_cost,
    v_allergens,
    v_dietary
  FROM cost_rows cr;

  SELECT selling_price, target_gp_pct
  INTO v_selling_price, v_target_gp
  FROM menu_dishes
  WHERE id = p_dish_id;

  IF v_selling_price IS NOT NULL AND v_selling_price > 0 THEN
    v_gp := (v_selling_price - v_portion_cost) / v_selling_price;
  ELSE
    v_gp := NULL;
  END IF;

  UPDATE menu_dishes
  SET
    portion_cost = ROUND(COALESCE(v_portion_cost, 0)::NUMERIC, 4),
    gp_pct = v_gp,
    allergen_flags = COALESCE(v_allergens, '{}'::TEXT[]),
    dietary_flags = COALESCE(v_dietary, '{}'::TEXT[]),
    is_gp_alert = CASE
      WHEN v_gp IS NOT NULL AND v_target_gp IS NOT NULL AND v_gp < v_target_gp THEN TRUE
      ELSE FALSE
    END,
    updated_at = NOW()
  WHERE id = p_dish_id;
END;
$$;

COMMENT ON FUNCTION menu_refresh_dish_calculations(UUID) IS 'Recalculates dish costing, GP percentage, and aggregated allergen/dietary flags';

-- Trigger wrapper to refresh after dish ingredient changes
CREATE OR REPLACE FUNCTION menu_trigger_refresh_dish_calculations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM menu_refresh_dish_calculations(OLD.dish_id);
  ELSE
    PERFORM menu_refresh_dish_calculations(NEW.dish_id);
  END IF;
  RETURN NULL;
END;
$$;

-- Trigger to refresh when selling price or target GP changes
CREATE OR REPLACE FUNCTION menu_trigger_refresh_after_dish_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM menu_refresh_dish_calculations(NEW.id);
  RETURN NEW;
END;
$$;

-- Trigger to refresh when ingredient pricing changes
CREATE OR REPLACE FUNCTION menu_trigger_refresh_after_price_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_dish_id UUID;
  v_ingredient_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'menu_ingredients' THEN
    v_ingredient_id := COALESCE(NEW.id, OLD.id);
  ELSE
    v_ingredient_id := COALESCE(NEW.ingredient_id, OLD.ingredient_id);
  END IF;

  IF v_ingredient_id IS NULL THEN
    RETURN NULL;
  END IF;

  FOR v_dish_id IN
    SELECT DISTINCT di.dish_id
    FROM menu_dish_ingredients di
    WHERE di.ingredient_id = v_ingredient_id
  LOOP
    PERFORM menu_refresh_dish_calculations(v_dish_id);
  END LOOP;
  RETURN NULL;
END;
$$;

-- Attach triggers
DROP TRIGGER IF EXISTS trg_menu_dish_ingredients_refresh ON menu_dish_ingredients;
CREATE TRIGGER trg_menu_dish_ingredients_refresh
AFTER INSERT OR UPDATE OR DELETE ON menu_dish_ingredients
FOR EACH ROW EXECUTE FUNCTION menu_trigger_refresh_dish_calculations();

DROP TRIGGER IF EXISTS trg_menu_dishes_refresh ON menu_dishes;
CREATE TRIGGER trg_menu_dishes_refresh
AFTER INSERT OR UPDATE OF selling_price, target_gp_pct ON menu_dishes
FOR EACH ROW EXECUTE FUNCTION menu_trigger_refresh_after_dish_update();

DROP TRIGGER IF EXISTS trg_menu_ingredient_prices_refresh ON menu_ingredient_prices;
CREATE TRIGGER trg_menu_ingredient_prices_refresh
AFTER INSERT OR UPDATE ON menu_ingredient_prices
FOR EACH ROW EXECUTE FUNCTION menu_trigger_refresh_after_price_change();

DROP TRIGGER IF EXISTS trg_menu_ingredients_refresh ON menu_ingredients;
CREATE TRIGGER trg_menu_ingredients_refresh
AFTER UPDATE ON menu_ingredients
FOR EACH ROW EXECUTE FUNCTION menu_trigger_refresh_after_price_change();

-- Updated_at triggers
DROP TRIGGER IF EXISTS update_menu_ingredients_updated_at ON menu_ingredients;
CREATE TRIGGER update_menu_ingredients_updated_at
  BEFORE UPDATE ON menu_ingredients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_menu_menus_updated_at ON menu_menus;
CREATE TRIGGER update_menu_menus_updated_at
  BEFORE UPDATE ON menu_menus
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_menu_categories_updated_at ON menu_categories;
CREATE TRIGGER update_menu_categories_updated_at
  BEFORE UPDATE ON menu_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_menu_dishes_updated_at ON menu_dishes;
CREATE TRIGGER update_menu_dishes_updated_at
  BEFORE UPDATE ON menu_dishes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_menu_dish_ingredients_updated_at ON menu_dish_ingredients;
CREATE TRIGGER update_menu_dish_ingredients_updated_at
  BEFORE UPDATE ON menu_dish_ingredients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_menu_dish_menu_assignments_updated_at ON menu_dish_menu_assignments;
CREATE TRIGGER update_menu_dish_menu_assignments_updated_at
  BEFORE UPDATE ON menu_dish_menu_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Views
CREATE OR REPLACE VIEW menu_dishes_with_costs AS
  SELECT
    d.id AS dish_id,
    d.name,
    d.slug,
    d.description,
    d.selling_price,
    d.target_gp_pct,
    d.portion_cost,
    d.gp_pct,
    d.allergen_flags,
    d.dietary_flags,
    d.calories,
    d.is_active,
    d.is_sunday_lunch,
    d.is_gp_alert,
    d.image_url,
    d.notes,
    dma.menu_id,
    m.code AS menu_code,
    m.name AS menu_name,
    dma.category_id,
    c.code AS category_code,
    c.name AS category_name,
    dma.sort_order,
    dma.is_special,
    dma.is_default_side,
    dma.available_from,
    dma.available_until
  FROM menu_dishes d
  JOIN menu_dish_menu_assignments dma ON dma.dish_id = d.id
  JOIN menu_menus m ON m.id = dma.menu_id
  JOIN menu_categories c ON c.id = dma.category_id;

COMMENT ON VIEW menu_dishes_with_costs IS 'Flattened view exposing dishes with menu/category placement and costing';

CREATE OR REPLACE VIEW menu_ingredients_with_prices AS
  SELECT
    mi.*,
    menu_get_latest_pack_cost(mi.id) AS latest_pack_cost,
    menu_get_latest_unit_cost(mi.id) AS latest_unit_cost,
    (
      SELECT mip.effective_from
      FROM menu_ingredient_prices mip
      WHERE mip.ingredient_id = mi.id
      ORDER BY mip.effective_from DESC
      LIMIT 1
    ) AS latest_price_effective_from
  FROM menu_ingredients mi;

COMMENT ON VIEW menu_ingredients_with_prices IS 'Ingredients with derived latest costing information';

-- Row Level Security
ALTER TABLE menu_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_ingredient_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_category_menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_dishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_dish_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_dish_menu_assignments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if script rerun
DO $$
BEGIN
  PERFORM 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'menu_ingredients';
  IF FOUND THEN
    DROP POLICY IF EXISTS "Menu ingredients view" ON menu_ingredients;
    DROP POLICY IF EXISTS "Menu ingredients manage" ON menu_ingredients;
  END IF;

  PERFORM 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'menu_ingredient_prices';
  IF FOUND THEN
    DROP POLICY IF EXISTS "Menu ingredient prices view" ON menu_ingredient_prices;
    DROP POLICY IF EXISTS "Menu ingredient prices manage" ON menu_ingredient_prices;
  END IF;

  PERFORM 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'menu_menus';
  IF FOUND THEN
    DROP POLICY IF EXISTS "Menu menus view" ON menu_menus;
    DROP POLICY IF EXISTS "Menu menus manage" ON menu_menus;
  END IF;

  PERFORM 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'menu_categories';
  IF FOUND THEN
    DROP POLICY IF EXISTS "Menu categories view" ON menu_categories;
    DROP POLICY IF EXISTS "Menu categories manage" ON menu_categories;
  END IF;

  PERFORM 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'menu_category_menus';
  IF FOUND THEN
    DROP POLICY IF EXISTS "Menu category menus view" ON menu_category_menus;
    DROP POLICY IF EXISTS "Menu category menus manage" ON menu_category_menus;
  END IF;

  PERFORM 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'menu_dishes';
  IF FOUND THEN
    DROP POLICY IF EXISTS "Menu dishes view" ON menu_dishes;
    DROP POLICY IF EXISTS "Menu dishes manage" ON menu_dishes;
  END IF;

  PERFORM 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'menu_dish_ingredients';
  IF FOUND THEN
    DROP POLICY IF EXISTS "Menu dish ingredients view" ON menu_dish_ingredients;
    DROP POLICY IF EXISTS "Menu dish ingredients manage" ON menu_dish_ingredients;
  END IF;

  PERFORM 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'menu_dish_menu_assignments';
  IF FOUND THEN
    DROP POLICY IF EXISTS "Menu dish assignments view" ON menu_dish_menu_assignments;
    DROP POLICY IF EXISTS "Menu dish assignments manage" ON menu_dish_menu_assignments;
  END IF;
END$$;

-- Policies
CREATE POLICY "Menu ingredients view" ON menu_ingredients
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

CREATE POLICY "Menu ingredients manage" ON menu_ingredients
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

CREATE POLICY "Menu ingredient prices view" ON menu_ingredient_prices
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

CREATE POLICY "Menu ingredient prices manage" ON menu_ingredient_prices
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

CREATE POLICY "Menu menus view" ON menu_menus
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Menu menus manage" ON menu_menus
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

CREATE POLICY "Menu categories view" ON menu_categories
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Menu categories manage" ON menu_categories
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

CREATE POLICY "Menu category menus view" ON menu_category_menus
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Menu category menus manage" ON menu_category_menus
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

CREATE POLICY "Menu dishes view" ON menu_dishes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

CREATE POLICY "Menu dishes manage" ON menu_dishes
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

CREATE POLICY "Menu dish ingredients view" ON menu_dish_ingredients
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

CREATE POLICY "Menu dish ingredients manage" ON menu_dish_ingredients
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

CREATE POLICY "Menu dish assignments view" ON menu_dish_menu_assignments
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Menu dish assignments manage" ON menu_dish_menu_assignments
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

-- Seed menus
INSERT INTO menu_menus (code, name, description)
VALUES
  ('website_food', 'Website Food Menu', 'Primary menu for the public website'),
  ('sunday_lunch', 'Sunday Lunch', 'Pre-orderable Sunday lunch menu'),
  ('drinks', 'Drinks Menu', 'Hot and cold drink offerings')
ON CONFLICT (code) DO NOTHING;

-- Seed categories
INSERT INTO menu_categories (code, name, description, sort_order)
VALUES
  ('starters', 'Starters', 'Light dishes to start the meal', 10),
  ('light_bites', 'Light Bites', 'Smaller plates and sharers', 20),
  ('snack_pots', 'Snack Pots', 'Snacks and sharing pots', 30),
  ('burgers', 'Burgers', 'Burger selection', 40),
  ('pizza', 'Pizza', 'Stone baked pizza range', 50),
  ('chip_shop', 'Chip Shop', 'Chip shop classics', 60),
  ('mains', 'Mains', 'Main dishes', 70),
  ('sunday_lunch_mains', 'Sunday Lunch Mains', 'Sunday lunch main courses', 80),
  ('sunday_lunch_sides', 'Sunday Lunch Sides', 'Included and extra sides for Sunday lunch', 90),
  ('desserts', 'Desserts', 'Sweet finishes', 100),
  ('kids', 'Kids', 'Children''s dishes', 110),
  ('hot_drinks', 'Hot Drinks', 'Teas, coffees, and hot drinks', 120),
  ('drinks', 'Drinks', 'Cold drinks and soft drinks', 130)
ON CONFLICT (code) DO NOTHING;

-- Map categories to menus
INSERT INTO menu_category_menus (menu_id, category_id, sort_order)
SELECT m.id, c.id, c.sort_order
FROM menu_menus m
JOIN menu_categories c ON (
  (m.code = 'website_food' AND c.code IN ('starters','light_bites','snack_pots','burgers','pizza','chip_shop','mains','desserts','kids','hot_drinks','drinks')) OR
  (m.code = 'sunday_lunch' AND c.code IN ('sunday_lunch_mains','sunday_lunch_sides','desserts','drinks','hot_drinks')) OR
  (m.code = 'drinks' AND c.code IN ('drinks','hot_drinks'))
)
ON CONFLICT (menu_id, category_id) DO NOTHING;

-- Seed default ingredients for legacy mapping (placeholder, optional)
-- None for now

-- Migrate existing Sunday lunch menu items into new tables (if present)
INSERT INTO menu_dishes (
  name,
  description,
  selling_price,
  target_gp_pct,
  portion_cost,
  gp_pct,
  allergen_flags,
  dietary_flags,
  calories,
  is_active,
  is_sunday_lunch,
  image_url,
  notes,
  is_gp_alert
)
SELECT
  slmi.name,
  slmi.description,
  slmi.price,
  0.70,
  0,
  NULL,
  COALESCE(slmi.allergens, '{}'::TEXT[]),
  COALESCE(slmi.dietary_info, '{}'::TEXT[]),
  NULL,
  slmi.is_active,
  true,
  NULL,
  NULL,
  false
FROM sunday_lunch_menu_items slmi
WHERE NOT EXISTS (
  SELECT 1
  FROM menu_dishes md
  WHERE md.name = slmi.name
);

-- Assign migrated dishes to Sunday lunch menu/categories
INSERT INTO menu_dish_menu_assignments (
  dish_id,
  menu_id,
  category_id,
  sort_order,
  is_special,
  is_default_side
)
SELECT
  d.id,
  (SELECT id FROM menu_menus WHERE code = 'sunday_lunch'),
  CASE 
    WHEN slmi.category = 'main' THEN (SELECT id FROM menu_categories WHERE code = 'sunday_lunch_mains')
    WHEN slmi.category IN ('side', 'extra') THEN (SELECT id FROM menu_categories WHERE code = 'sunday_lunch_sides')
    ELSE (SELECT id FROM menu_categories WHERE code = 'sunday_lunch_mains')
  END,
  slmi.display_order,
  false,
  CASE 
    WHEN slmi.category = 'side' AND slmi.price = 0 THEN true
    ELSE false
  END
FROM sunday_lunch_menu_items slmi
JOIN menu_dishes d ON d.name = slmi.name
LEFT JOIN menu_dish_menu_assignments existing ON existing.dish_id = d.id
WHERE existing.id IS NULL;

DO $$
DECLARE
  v_dish_id UUID;
BEGIN
  FOR v_dish_id IN
    SELECT id FROM menu_dishes WHERE is_sunday_lunch = true
  LOOP
    PERFORM menu_refresh_dish_calculations(v_dish_id);
  END LOOP;
END $$;

-- Permissions for menu management
INSERT INTO permissions (module_name, action, description)
VALUES
  ('menu_management', 'view', 'View menu management tools'),
  ('menu_management', 'manage', 'Manage menu ingredients, dishes, and assignments')
ON CONFLICT (module_name, action) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.module_name = 'menu_management' AND p.action IN ('view', 'manage')
WHERE r.name IN ('super_admin', 'manager')
ON CONFLICT DO NOTHING;
-- End 20260110120000_menu_management.sql


-- Begin 20260115120000_add_menu_recipes.sql
-- Menu recipes: group ingredients into reusable prep items that can be dropped into dishes

-- Core recipe table
CREATE TABLE IF NOT EXISTS menu_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  instructions TEXT,
  yield_quantity NUMERIC(12,4) NOT NULL DEFAULT 1,
  yield_unit menu_unit NOT NULL DEFAULT 'portion',
  portion_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  allergen_flags TEXT[] NOT NULL DEFAULT '{}',
  dietary_flags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE menu_recipes IS 'Reusable prep items built from ingredients that can be embedded into dishes';

CREATE INDEX IF NOT EXISTS idx_menu_recipes_active ON menu_recipes(is_active);

-- Ingredients that make up a recipe
CREATE TABLE IF NOT EXISTS menu_recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES menu_recipes(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES menu_ingredients(id),
  quantity NUMERIC(12,4) NOT NULL DEFAULT 0,
  unit menu_unit NOT NULL,
  yield_pct NUMERIC(6,3) NOT NULL DEFAULT 100,
  wastage_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
  cost_override NUMERIC(12,4),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (recipe_id, ingredient_id)
);

COMMENT ON TABLE menu_recipe_ingredients IS 'Join table linking recipes to the raw ingredients they require';

CREATE INDEX IF NOT EXISTS idx_menu_recipe_ingredients_recipe ON menu_recipe_ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS idx_menu_recipe_ingredients_ingredient ON menu_recipe_ingredients(ingredient_id);

-- Link table assigning recipes to dishes
CREATE TABLE IF NOT EXISTS menu_dish_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id UUID NOT NULL REFERENCES menu_dishes(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES menu_recipes(id),
  quantity NUMERIC(12,4) NOT NULL DEFAULT 0,
  yield_pct NUMERIC(6,3) NOT NULL DEFAULT 100,
  wastage_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
  cost_override NUMERIC(12,4),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dish_id, recipe_id)
);

COMMENT ON TABLE menu_dish_recipes IS 'Associates prepared recipes with dishes alongside direct ingredients';

CREATE INDEX IF NOT EXISTS idx_menu_dish_recipes_dish ON menu_dish_recipes(dish_id);
CREATE INDEX IF NOT EXISTS idx_menu_dish_recipes_recipe ON menu_dish_recipes(recipe_id);

-- Updated costing + aggregation for recipes
CREATE OR REPLACE FUNCTION menu_refresh_recipe_calculations(p_recipe_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_cost NUMERIC(12,4) := 0;
  v_yield_quantity NUMERIC(12,4) := 1;
  v_allergens TEXT[];
  v_dietary TEXT[];
BEGIN
  SELECT COALESCE(yield_quantity, 1)
  INTO v_yield_quantity
  FROM menu_recipes
  WHERE id = p_recipe_id
  FOR UPDATE;

  WITH ingredient_rows AS (
    SELECT
      ri.quantity,
      COALESCE(NULLIF(ri.yield_pct, 0), 100)::NUMERIC AS yield_pct,
      COALESCE(ri.wastage_pct, mi.wastage_pct, 0)::NUMERIC AS wastage_pct,
      COALESCE(ri.cost_override, menu_get_latest_unit_cost(mi.id)) AS unit_cost,
      mi.allergens,
      mi.dietary_flags
    FROM menu_recipe_ingredients ri
    JOIN menu_ingredients mi ON mi.id = ri.ingredient_id
    WHERE ri.recipe_id = p_recipe_id
  ),
  aggregate_rows AS (
    SELECT
      COALESCE(SUM(
        ir.quantity
        * ir.unit_cost
        * 100 / NULLIF(ir.yield_pct, 0)
        * (1 + (COALESCE(ir.wastage_pct, 0) / 100))
      ), 0) AS total_cost,
      COALESCE(ARRAY(
        SELECT DISTINCT TRIM(flag)
        FROM ingredient_rows ir2,
        LATERAL UNNEST(ir2.allergens) AS flag
        WHERE flag IS NOT NULL AND flag <> ''
      ), '{}'::TEXT[]) AS allergens,
      COALESCE(ARRAY(
        SELECT DISTINCT TRIM(flag)
        FROM ingredient_rows ir3,
        LATERAL UNNEST(ir3.dietary_flags) AS flag
        WHERE flag IS NOT NULL AND flag <> ''
      ), '{}'::TEXT[]) AS dietary_flags
    FROM ingredient_rows ir
  )
  SELECT
    ar.total_cost,
    ar.allergens,
    ar.dietary_flags
  INTO
    v_total_cost,
    v_allergens,
    v_dietary
  FROM aggregate_rows ar;

  UPDATE menu_recipes
  SET
    portion_cost = ROUND(
      COALESCE(
        v_total_cost / NULLIF(v_yield_quantity, 0),
        v_total_cost,
        0
      )::NUMERIC,
      4
    ),
    allergen_flags = COALESCE(v_allergens, '{}'::TEXT[]),
    dietary_flags = COALESCE(v_dietary, '{}'::TEXT[]),
    updated_at = NOW()
  WHERE id = p_recipe_id;
END;
$$;

COMMENT ON FUNCTION menu_refresh_recipe_calculations(UUID) IS 'Calculates cost-per-yield and allergen/dietary aggregates for a recipe';

-- Replace dish refresh logic to include recipes
CREATE OR REPLACE FUNCTION menu_refresh_dish_calculations(p_dish_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_portion_cost NUMERIC(12,4) := 0;
  v_selling_price NUMERIC(12,4) := 0;
  v_target_gp NUMERIC(6,4) := 0.70;
  v_gp NUMERIC(6,4);
  v_allergens TEXT[];
  v_dietary TEXT[];
BEGIN
  WITH ingredient_rows AS (
    SELECT
      di.quantity,
      COALESCE(NULLIF(di.yield_pct, 0), 100)::NUMERIC AS yield_pct,
      COALESCE(di.wastage_pct, 0)::NUMERIC AS dish_wastage_pct,
      mi.wastage_pct AS ingredient_wastage_pct,
      COALESCE(di.cost_override, menu_get_latest_unit_cost(mi.id)) AS unit_cost,
      mi.allergens,
      mi.dietary_flags
    FROM menu_dish_ingredients di
    JOIN menu_ingredients mi ON mi.id = di.ingredient_id
    WHERE di.dish_id = p_dish_id
  ),
  recipe_rows AS (
    SELECT
      dr.quantity,
      COALESCE(NULLIF(dr.yield_pct, 0), 100)::NUMERIC AS yield_pct,
      COALESCE(dr.wastage_pct, 0)::NUMERIC AS dish_wastage_pct,
      COALESCE(dr.cost_override, mr.portion_cost) AS unit_cost,
      mr.allergen_flags AS allergens,
      mr.dietary_flags
    FROM menu_dish_recipes dr
    JOIN menu_recipes mr ON mr.id = dr.recipe_id
    WHERE dr.dish_id = p_dish_id
  ),
  combined_rows AS (
    SELECT
      ir.quantity,
      ir.yield_pct,
      ir.dish_wastage_pct,
      ir.ingredient_wastage_pct,
      ir.unit_cost,
      ir.allergens,
      ir.dietary_flags
    FROM ingredient_rows ir
    UNION ALL
    SELECT
      rr.quantity,
      rr.yield_pct,
      rr.dish_wastage_pct,
      0::NUMERIC AS ingredient_wastage_pct,
      rr.unit_cost,
      rr.allergens,
      rr.dietary_flags
    FROM recipe_rows rr
  ),
  cost_rows AS (
    SELECT
      COALESCE(SUM(
        cr.quantity
        * cr.unit_cost
        * 100 / NULLIF(cr.yield_pct, 0)
        * (1 + (COALESCE(cr.dish_wastage_pct, cr.ingredient_wastage_pct, 0) / 100))
      ), 0) AS portion_cost,
      COALESCE(ARRAY(
        SELECT DISTINCT TRIM(flag)
        FROM combined_rows cr2,
        LATERAL UNNEST(cr2.allergens) AS flag
        WHERE flag IS NOT NULL AND flag <> ''
      ), '{}'::TEXT[]) AS allergens,
      COALESCE(ARRAY(
        SELECT DISTINCT TRIM(flag)
        FROM combined_rows cr3,
        LATERAL UNNEST(cr3.dietary_flags) AS flag
        WHERE flag IS NOT NULL AND flag <> ''
      ), '{}'::TEXT[]) AS dietary_flags
    FROM combined_rows cr
  )
  SELECT
    cr.portion_cost,
    cr.allergens,
    cr.dietary_flags
  INTO
    v_portion_cost,
    v_allergens,
    v_dietary
  FROM cost_rows cr;

  SELECT selling_price, target_gp_pct
  INTO v_selling_price, v_target_gp
  FROM menu_dishes
  WHERE id = p_dish_id;

  IF v_selling_price IS NOT NULL AND v_selling_price > 0 THEN
    v_gp := (v_selling_price - v_portion_cost) / v_selling_price;
  ELSE
    v_gp := NULL;
  END IF;

  UPDATE menu_dishes
  SET
    portion_cost = ROUND(COALESCE(v_portion_cost, 0)::NUMERIC, 4),
    gp_pct = v_gp,
    allergen_flags = COALESCE(v_allergens, '{}'::TEXT[]),
    dietary_flags = COALESCE(v_dietary, '{}'::TEXT[]),
    is_gp_alert = CASE
      WHEN v_gp IS NOT NULL AND v_target_gp IS NOT NULL AND v_gp < v_target_gp THEN TRUE
      ELSE FALSE
    END,
    updated_at = NOW()
  WHERE id = p_dish_id;
END;
$$;

-- Trigger helpers
CREATE OR REPLACE FUNCTION menu_trigger_refresh_recipe_calculations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM menu_refresh_recipe_calculations(OLD.recipe_id);
  ELSE
    PERFORM menu_refresh_recipe_calculations(NEW.recipe_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION menu_trigger_refresh_after_recipe_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_recipe_id UUID := COALESCE(NEW.id, OLD.id);
  v_dish_id UUID;
BEGIN
  IF v_recipe_id IS NULL THEN
    RETURN NULL;
  END IF;

  FOR v_dish_id IN
    SELECT DISTINCT dr.dish_id
    FROM menu_dish_recipes dr
    WHERE dr.recipe_id = v_recipe_id
  LOOP
    PERFORM menu_refresh_dish_calculations(v_dish_id);
  END LOOP;

  RETURN NULL;
END;
$$;

-- Refresh dishes if their recipe linkage changes
DROP TRIGGER IF EXISTS trg_menu_dish_recipes_refresh ON menu_dish_recipes;
CREATE TRIGGER trg_menu_dish_recipes_refresh
  AFTER INSERT OR UPDATE OR DELETE ON menu_dish_recipes
  FOR EACH ROW EXECUTE FUNCTION menu_trigger_refresh_dish_calculations();

-- Refresh recipes when their ingredients change
DROP TRIGGER IF EXISTS trg_menu_recipe_ingredients_refresh ON menu_recipe_ingredients;
CREATE TRIGGER trg_menu_recipe_ingredients_refresh
  AFTER INSERT OR UPDATE OR DELETE ON menu_recipe_ingredients
  FOR EACH ROW EXECUTE FUNCTION menu_trigger_refresh_recipe_calculations();

-- Propagate recipe cost changes to dishes
DROP TRIGGER IF EXISTS trg_menu_recipes_refresh_dishes ON menu_recipes;
CREATE TRIGGER trg_menu_recipes_refresh_dishes
  AFTER UPDATE ON menu_recipes
  FOR EACH ROW EXECUTE FUNCTION menu_trigger_refresh_after_recipe_update();

-- Updated price change trigger to recalc recipes that include the ingredient
CREATE OR REPLACE FUNCTION menu_trigger_refresh_after_price_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_dish_id UUID;
  v_recipe_id UUID;
  v_ingredient_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'menu_ingredients' THEN
    v_ingredient_id := COALESCE(NEW.id, OLD.id);
  ELSE
    v_ingredient_id := COALESCE(NEW.ingredient_id, OLD.ingredient_id);
  END IF;

  IF v_ingredient_id IS NULL THEN
    RETURN NULL;
  END IF;

  FOR v_recipe_id IN
    SELECT DISTINCT ri.recipe_id
    FROM menu_recipe_ingredients ri
    WHERE ri.ingredient_id = v_ingredient_id
  LOOP
    PERFORM menu_refresh_recipe_calculations(v_recipe_id);
  END LOOP;

  FOR v_dish_id IN
    SELECT DISTINCT di.dish_id
    FROM menu_dish_ingredients di
    WHERE di.ingredient_id = v_ingredient_id
  LOOP
    PERFORM menu_refresh_dish_calculations(v_dish_id);
  END LOOP;

  RETURN NULL;
END;
$$;

-- Enable RLS and copy policy model
ALTER TABLE menu_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_dish_recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Menu recipes view" ON menu_recipes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

CREATE POLICY "Menu recipes manage" ON menu_recipes
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

CREATE POLICY "Menu recipe ingredients view" ON menu_recipe_ingredients
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

CREATE POLICY "Menu recipe ingredients manage" ON menu_recipe_ingredients
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

CREATE POLICY "Menu dish recipes view" ON menu_dish_recipes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

CREATE POLICY "Menu dish recipes manage" ON menu_dish_recipes
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

-- Keep updated_at columns current
DROP TRIGGER IF EXISTS update_menu_recipes_updated_at ON menu_recipes;
CREATE TRIGGER update_menu_recipes_updated_at
  BEFORE UPDATE ON menu_recipes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_menu_recipe_ingredients_updated_at ON menu_recipe_ingredients;
CREATE TRIGGER update_menu_recipe_ingredients_updated_at
  BEFORE UPDATE ON menu_recipe_ingredients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_menu_dish_recipes_updated_at ON menu_dish_recipes;
CREATE TRIGGER update_menu_dish_recipes_updated_at
  BEFORE UPDATE ON menu_dish_recipes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- End 20260115120000_add_menu_recipes.sql


-- Begin 20260315120000_manage_sunday_lunch_service.sql
-- Description: Manage Sunday lunch service availability and integrate with slot generation

-- ========================================
-- 1. SERVICE STATUS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS service_statuses (
  service_code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE service_statuses ENABLE ROW LEVEL SECURITY;

-- Allow service role full access; other roles will be governed via Supabase policies in app
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'service_statuses'
      AND policyname = 'Service role manage service statuses'
  ) THEN
    CREATE POLICY "Service role manage service statuses"
      ON service_statuses
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$$;

-- Seed Sunday lunch status if it does not already exist
INSERT INTO service_statuses (service_code, display_name, is_enabled, message)
VALUES (
  'sunday_lunch',
  'Sunday Lunch Service',
  true,
  'Sunday lunch bookings require pre-order with £5 per person deposit by 1pm Saturday.'
)
ON CONFLICT (service_code) DO NOTHING;

-- ========================================
-- 1B. SERVICE STATUS OVERRIDES TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS service_status_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_code TEXT NOT NULL REFERENCES service_statuses(service_code) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  message TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT service_status_overrides_date_check CHECK (end_date >= start_date),
  UNIQUE (service_code, start_date, end_date)
);

CREATE INDEX IF NOT EXISTS idx_service_status_overrides_service_date
  ON service_status_overrides(service_code, start_date, end_date);

ALTER TABLE service_status_overrides ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'service_status_overrides'
      AND policyname = 'Service role manage service status overrides'
  ) THEN
    CREATE POLICY "Service role manage service status overrides"
      ON service_status_overrides
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$$;

-- ========================================
-- 2. UPDATE SLOT GENERATION FUNCTIONS TO RESPECT SERVICE STATUS
-- ========================================
CREATE OR REPLACE FUNCTION generate_service_slots_for_period(
  start_date DATE DEFAULT CURRENT_DATE,
  days_ahead INTEGER DEFAULT 90
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_end_date DATE;
  v_current_date DATE;
  v_day_of_week INTEGER;
  v_slots_created INTEGER := 0;
  v_sunday_enabled BOOLEAN := true;
  v_override_enabled BOOLEAN;
  v_effective_enabled BOOLEAN;
BEGIN
  -- Determine if Sunday lunch service is currently enabled
  SELECT COALESCE(is_enabled, true)
    INTO v_sunday_enabled
  FROM service_statuses
  WHERE service_code = 'sunday_lunch';

  v_end_date := start_date + days_ahead;
  v_current_date := start_date;
    
  WHILE v_current_date <= v_end_date LOOP
    v_day_of_week := EXTRACT(DOW FROM v_current_date);
    v_override_enabled := NULL;
    v_effective_enabled := v_sunday_enabled;
    
    IF v_day_of_week = 0 THEN
      SELECT is_enabled
        INTO v_override_enabled
      FROM service_status_overrides
      WHERE service_code = 'sunday_lunch'
        AND start_date <= v_current_date
        AND end_date >= v_current_date
      ORDER BY start_date DESC, end_date DESC
      LIMIT 1;
      
      IF v_override_enabled IS NOT NULL THEN
        v_effective_enabled := v_override_enabled;
      END IF;
    END IF;
    
    -- Sunday lunch slots (Sunday = 0)
    IF v_day_of_week = 0 AND v_effective_enabled THEN
      -- Early Sunday lunch sitting
      INSERT INTO service_slots (
        service_date,
        starts_at,
        ends_at,
        capacity,
        booking_type,
        is_active
      ) VALUES (
        v_current_date,
        '12:00:00'::TIME,
        '14:30:00'::TIME,
        50,
        'sunday_lunch'::table_booking_type,
        true
      ) ON CONFLICT (service_date, starts_at, booking_type) DO NOTHING;
      
      -- Late Sunday lunch sitting
      INSERT INTO service_slots (
        service_date,
        starts_at,
        ends_at,
        capacity,
        booking_type,
        is_active
      ) VALUES (
        v_current_date,
        '14:30:00'::TIME,
        '17:00:00'::TIME,
        50,
        'sunday_lunch'::table_booking_type,
        true
      ) ON CONFLICT (service_date, starts_at, booking_type) DO NOTHING;
      
      v_slots_created := v_slots_created + 2;
    END IF;
    
    -- Regular dinner service (Tuesday = 2 to Saturday = 6)
    IF v_day_of_week >= 2 AND v_day_of_week <= 6 THEN
      INSERT INTO service_slots (
        service_date,
        starts_at,
        ends_at,
        capacity,
        booking_type,
        is_active
      ) VALUES (
        v_current_date,
        '17:00:00'::TIME,
        '21:00:00'::TIME,
        50,
        'regular'::table_booking_type,
        true
      ) ON CONFLICT (service_date, starts_at, booking_type) DO NOTHING;
      
      v_slots_created := v_slots_created + 1;
    END IF;
    
    -- Friday and Saturday lunch (Friday = 5, Saturday = 6)
    IF v_day_of_week = 5 OR v_day_of_week = 6 THEN
      INSERT INTO service_slots (
        service_date,
        starts_at,
        ends_at,
        capacity,
        booking_type,
        is_active
      ) VALUES (
        v_current_date,
        '12:00:00'::TIME,
        '14:30:00'::TIME,
        50,
        'regular'::table_booking_type,
        true
      ) ON CONFLICT (service_date, starts_at, booking_type) DO NOTHING;
      
      v_slots_created := v_slots_created + 1;
    END IF;
    
    v_current_date := v_current_date + 1;
  END LOOP;
  
  RETURN v_slots_created;
END;
$$;

CREATE OR REPLACE FUNCTION generate_service_slots_from_config(
  start_date DATE DEFAULT CURRENT_DATE,
  days_ahead INTEGER DEFAULT 90
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_end_date DATE;
  v_current_date DATE;
  v_day_of_week INTEGER;
  v_config RECORD;
  v_slots_created INTEGER := 0;
  v_sunday_enabled BOOLEAN := true;
  v_override_enabled BOOLEAN;
  v_effective_enabled BOOLEAN;
BEGIN
  -- Determine if Sunday lunch service is currently enabled
  SELECT COALESCE(is_enabled, true)
    INTO v_sunday_enabled
  FROM service_statuses
  WHERE service_code = 'sunday_lunch';

  v_end_date := start_date + days_ahead;
  v_current_date := start_date;
    
  WHILE v_current_date <= v_end_date LOOP
    v_day_of_week := EXTRACT(DOW FROM v_current_date);
    v_override_enabled := NULL;
    v_effective_enabled := v_sunday_enabled;
    
    IF v_day_of_week = 0 THEN
      SELECT is_enabled
        INTO v_override_enabled
      FROM service_status_overrides
      WHERE service_code = 'sunday_lunch'
        AND start_date <= v_current_date
        AND end_date >= v_current_date
      ORDER BY start_date DESC, end_date DESC
      LIMIT 1;
      
      IF v_override_enabled IS NOT NULL THEN
        v_effective_enabled := v_override_enabled;
      END IF;
    END IF;
    
    -- Get all configs for this day of week
    FOR v_config IN 
      SELECT * FROM service_slot_config 
      WHERE day_of_week = v_day_of_week 
      AND is_active = true
    LOOP
      -- Skip Sunday lunch templates when service is disabled
      IF v_config.booking_type = 'sunday_lunch'::table_booking_type AND NOT v_effective_enabled THEN
        CONTINUE;
      END IF;

      INSERT INTO service_slots (
        service_date,
        starts_at,
        ends_at,
        capacity,
        booking_type,
        is_active
      ) VALUES (
        v_current_date,
        v_config.starts_at,
        v_config.ends_at,
        v_config.capacity,
        v_config.booking_type,
        true
      ) ON CONFLICT (service_date, starts_at, booking_type) DO UPDATE
      SET capacity = EXCLUDED.capacity,
          ends_at = EXCLUDED.ends_at,
          updated_at = NOW();
      
      v_slots_created := v_slots_created + 1;
    END LOOP;
    
    v_current_date := v_current_date + 1;
  END LOOP;
  
  RETURN v_slots_created;
END;
$$;
-- End 20260315120000_manage_sunday_lunch_service.sql


-- Begin 20260320123000_update_invoice_summary_stats.sql
-- Ensure outstanding totals include every invoice that is not fully paid
CREATE OR REPLACE FUNCTION public.get_invoice_summary_stats()
RETURNS TABLE(
  total_outstanding numeric,
  total_overdue numeric,
  total_draft numeric,
  total_this_month numeric,
  count_outstanding integer,
  count_overdue integer,
  count_draft integer
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE 
      WHEN i.status NOT IN ('paid', 'void', 'written_off')
        THEN i.total_amount - i.paid_amount 
      ELSE 0 
    END), 0) AS total_outstanding,
    COALESCE(SUM(CASE 
      WHEN i.status = 'overdue' 
        THEN i.total_amount - i.paid_amount 
      ELSE 0 
    END), 0) AS total_overdue,
    COALESCE(SUM(CASE 
      WHEN i.status = 'draft' 
        THEN i.total_amount 
      ELSE 0 
    END), 0) AS total_draft,
    COALESCE(SUM(CASE 
      WHEN i.status = 'paid' 
        AND DATE_TRUNC('month', i.invoice_date) = DATE_TRUNC('month', CURRENT_DATE)
        THEN i.total_amount 
      ELSE 0 
    END), 0) AS total_this_month,
    COUNT(CASE 
      WHEN i.status NOT IN ('paid', 'void', 'written_off') 
        THEN 1 
    END)::INTEGER AS count_outstanding,
    COUNT(CASE 
      WHEN i.status = 'overdue' 
        THEN 1 
    END)::INTEGER AS count_overdue,
    COUNT(CASE 
      WHEN i.status = 'draft' 
        THEN 1 
    END)::INTEGER AS count_draft
  FROM invoices i
  WHERE i.deleted_at IS NULL;
END;
$$;
-- End 20260320123000_update_invoice_summary_stats.sql


-- Begin 20260401120000_create_booking_transaction.sql
-- Function to handle atomic creation of table bookings with items and payment
CREATE OR REPLACE FUNCTION create_table_booking_transaction(
  p_booking_data JSONB,
  p_menu_items JSONB DEFAULT '[]'::JSONB,
  p_payment_data JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking_id UUID;
  v_booking_record JSONB;
  v_item JSONB;
  v_total_deposit DECIMAL(10,2);
BEGIN
  -- 1. Insert Booking
  INSERT INTO table_bookings (
    customer_id,
    booking_date,
    booking_time,
    party_size,
    booking_type,
    special_requirements,
    dietary_requirements,
    allergies,
    celebration_type,
    duration_minutes,
    source,
    status
  ) VALUES (
    (p_booking_data->>'customer_id')::UUID,
    (p_booking_data->>'booking_date')::DATE,
    (p_booking_data->>'booking_time')::TIME,
    (p_booking_data->>'party_size')::INTEGER,
    (p_booking_data->>'booking_type')::text,
    p_booking_data->>'special_requirements',
    CASE 
      WHEN p_booking_data->>'dietary_requirements' IS NULL THEN NULL 
      ELSE (p_booking_data->'dietary_requirements') 
    END,
    CASE 
      WHEN p_booking_data->>'allergies' IS NULL THEN NULL 
      ELSE (p_booking_data->'allergies') 
    END,
    p_booking_data->>'celebration_type',
    COALESCE((p_booking_data->>'duration_minutes')::INTEGER, 120),
    COALESCE(p_booking_data->>'source', 'phone'),
    COALESCE(p_booking_data->>'status', 'confirmed')
  )
  RETURNING id INTO v_booking_id;

  -- 2. Insert Menu Items (if any)
  IF jsonb_array_length(p_menu_items) > 0 THEN
    INSERT INTO table_booking_items (
      booking_id,
      custom_item_name,
      item_type,
      quantity,
      guest_name,
      price_at_booking,
      special_requests
    )
    SELECT
      v_booking_id,
      item->>'custom_item_name',
      (item->>'item_type')::text, -- cast to custom enum if needed, assuming text matches
      (item->>'quantity')::INTEGER,
      item->>'guest_name',
      (item->>'price_at_booking')::DECIMAL(10,2),
      item->>'special_requests'
    FROM jsonb_array_elements(p_menu_items) AS item;
  END IF;

  -- 3. Insert Payment (if provided)
  IF p_payment_data IS NOT NULL THEN
    INSERT INTO table_booking_payments (
      booking_id,
      amount,
      payment_method,
      status,
      paid_at,
      payment_metadata
    ) VALUES (
      v_booking_id,
      (p_payment_data->>'amount')::DECIMAL(10,2),
      p_payment_data->>'payment_method',
      p_payment_data->>'status',
      (p_payment_data->>'paid_at')::TIMESTAMPTZ,
      p_payment_data->'payment_metadata'
    );
  END IF;

  -- 4. Return the created booking with customer details
  SELECT to_jsonb(tb) || jsonb_build_object('customer', to_jsonb(c))
  INTO v_booking_record
  FROM table_bookings tb
  JOIN customers c ON c.id = tb.customer_id
  WHERE tb.id = v_booking_id;

  RETURN v_booking_record;

EXCEPTION WHEN OTHERS THEN
  -- Propagate error to caller
  RAISE;
END;
$$;
-- End 20260401120000_create_booking_transaction.sql


-- Begin 20260401130000_create_invoice_transactions.sql
-- Function to handle atomic creation of invoices with line items
CREATE OR REPLACE FUNCTION create_invoice_transaction(
  p_invoice_data JSONB,
  p_line_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invoice_id UUID;
  v_invoice_record JSONB;
BEGIN
  -- 1. Insert Invoice
  INSERT INTO invoices (
    invoice_number,
    vendor_id,
    invoice_date,
    due_date,
    reference,
    invoice_discount_percentage,
    subtotal_amount,
    discount_amount,
    vat_amount,
    total_amount,
    notes,
    internal_notes,
    status
  ) VALUES (
    p_invoice_data->>'invoice_number',
    (p_invoice_data->>'vendor_id')::UUID,
    (p_invoice_data->>'invoice_date')::DATE,
    (p_invoice_data->>'due_date')::DATE,
    p_invoice_data->>'reference',
    (p_invoice_data->>'invoice_discount_percentage')::DECIMAL,
    (p_invoice_data->>'subtotal_amount')::DECIMAL,
    (p_invoice_data->>'discount_amount')::DECIMAL,
    (p_invoice_data->>'vat_amount')::DECIMAL,
    (p_invoice_data->>'total_amount')::DECIMAL,
    p_invoice_data->>'notes',
    p_invoice_data->>'internal_notes',
    (p_invoice_data->>'status') -- status is text/varchar, not an enum
  )
  RETURNING id INTO v_invoice_id;

  -- 2. Insert Line Items
  IF jsonb_array_length(p_line_items) > 0 THEN
    INSERT INTO invoice_line_items (
      invoice_id,
      catalog_item_id,
      description,
      quantity,
      unit_price,
      discount_percentage,
      vat_rate
    )
    SELECT
      v_invoice_id,
      (item->>'catalog_item_id')::UUID,
      item->>'description',
      (item->>'quantity')::DECIMAL,
      (item->>'unit_price')::DECIMAL,
      (item->>'discount_percentage')::DECIMAL,
      (item->>'vat_rate')::DECIMAL
    FROM jsonb_array_elements(p_line_items) AS item;
  END IF;

  -- 3. Return the created invoice
  SELECT to_jsonb(i) INTO v_invoice_record
  FROM invoices i
  WHERE i.id = v_invoice_id;

  RETURN v_invoice_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- Function to record payment and update invoice status
CREATE OR REPLACE FUNCTION record_invoice_payment_transaction(
  p_payment_data JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payment_id UUID;
  v_invoice_id UUID;
  v_amount DECIMAL;
  v_current_paid DECIMAL;
  v_total DECIMAL;
  v_new_paid DECIMAL;
  v_new_status text; -- Changed from invoice_status to text
  v_payment_record JSONB;
BEGIN
  v_invoice_id := (p_payment_data->>'invoice_id')::UUID;
  v_amount := (p_payment_data->>'amount')::DECIMAL;

  -- 1. Get current invoice details
  SELECT paid_amount, total_amount, status 
  INTO v_current_paid, v_total, v_new_status
  FROM invoices 
  WHERE id = v_invoice_id
  FOR UPDATE; -- Lock the row

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_amount > (v_total - v_current_paid) THEN
    RAISE EXCEPTION 'Payment amount exceeds outstanding balance';
  END IF;

  -- 2. Insert Payment
  INSERT INTO invoice_payments (
    invoice_id,
    payment_date,
    amount,
    payment_method,
    reference,
    notes
  ) VALUES (
    v_invoice_id,
    (p_payment_data->>'payment_date')::DATE,
    v_amount,
    p_payment_data->>'payment_method',
    p_payment_data->>'reference',
    p_payment_data->>'notes'
  )
  RETURNING id INTO v_payment_id;

  -- 3. Update Invoice Status
  v_new_paid := v_current_paid + v_amount;
  
  IF v_new_paid >= v_total THEN
    v_new_status := 'paid';
  ELSIF v_new_paid > 0 AND v_new_status NOT IN ('void', 'written_off') THEN
    v_new_status := 'partially_paid';
  END IF;

  UPDATE invoices
  SET 
    paid_amount = v_new_paid,
    status = v_new_status,
    updated_at = NOW()
  WHERE id = v_invoice_id;

  -- 4. Return Payment Record
  SELECT to_jsonb(ip) INTO v_payment_record
  FROM invoice_payments ip
  WHERE ip.id = v_payment_id;

  RETURN v_payment_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
-- End 20260401130000_create_invoice_transactions.sql


-- Begin 20260401140000_create_event_transactions.sql
-- Function to handle atomic creation of events with FAQs
CREATE OR REPLACE FUNCTION create_event_transaction(
  p_event_data JSONB,
  p_faqs JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_id UUID;
  v_event_record JSONB;
BEGIN
  -- 1. Insert Event
  INSERT INTO events (
    name,
    date,
    time,
    capacity,
    category_id,
    short_description,
    long_description,
    brief,
    highlights,
    keywords,
    slug,
    meta_title,
    meta_description,
    end_time,
    duration_minutes,
    doors_time,
    last_entry_time,
    event_status,
    performer_name,
    performer_type,
    price,
    is_free,
    booking_url,
    hero_image_url,
    thumbnail_image_url,
    poster_image_url,
    promo_video_url,
    highlight_video_urls,
    gallery_image_urls
  ) VALUES (
    p_event_data->>'name',
    (p_event_data->>'date')::DATE,
    (p_event_data->>'time')::TIME,
    (p_event_data->>'capacity')::INTEGER,
    (p_event_data->>'category_id')::UUID,
    p_event_data->>'short_description',
    p_event_data->>'long_description',
    p_event_data->>'brief',
    COALESCE(p_event_data->'highlights', '[]'::JSONB)::TEXT[],
    COALESCE(p_event_data->'keywords', '[]'::JSONB)::TEXT[],
    p_event_data->>'slug',
    p_event_data->>'meta_title',
    p_event_data->>'meta_description',
    (p_event_data->>'end_time')::TIME,
    (p_event_data->>'duration_minutes')::INTEGER,
    (p_event_data->>'doors_time')::TIME,
    (p_event_data->>'last_entry_time')::TIME,
    COALESCE(p_event_data->>'event_status', 'scheduled'),
    p_event_data->>'performer_name',
    p_event_data->>'performer_type',
    COALESCE((p_event_data->>'price')::DECIMAL, 0),
    COALESCE((p_event_data->>'is_free')::BOOLEAN, false),
    p_event_data->>'booking_url',
    p_event_data->>'hero_image_url',
    p_event_data->>'thumbnail_image_url',
    p_event_data->>'poster_image_url',
    p_event_data->>'promo_video_url',
    COALESCE(p_event_data->'highlight_video_urls', '[]'::JSONB)::TEXT[],
    COALESCE(p_event_data->'gallery_image_urls', '[]'::JSONB)::TEXT[]
  )
  RETURNING id INTO v_event_id;

  -- 2. Insert FAQs (if any)
  IF jsonb_array_length(p_faqs) > 0 THEN
    INSERT INTO event_faqs (
      event_id,
      question,
      answer,
      sort_order
    )
    SELECT
      v_event_id,
      item->>'question',
      item->>'answer',
      COALESCE((item->>'sort_order')::INTEGER, 0)
    FROM jsonb_array_elements(p_faqs) AS item;
  END IF;

  -- 3. Return the created event
  SELECT to_jsonb(e) INTO v_event_record
  FROM events e
  WHERE e.id = v_event_id;

  RETURN v_event_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- Function to handle atomic update of events with FAQs
CREATE OR REPLACE FUNCTION update_event_transaction(
  p_event_id UUID,
  p_event_data JSONB,
  p_faqs JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_record JSONB;
BEGIN
  -- 1. Update Event
  UPDATE events SET
    name = COALESCE(p_event_data->>'name', name),
    date = COALESCE((p_event_data->>'date')::DATE, date),
    -- Column `time` is stored as text, so avoid mixing TIME/text in COALESCE
    time = COALESCE(p_event_data->>'time', time),
    capacity = (p_event_data->>'capacity')::INTEGER, -- Allow null
    category_id = (p_event_data->>'category_id')::UUID, -- Allow null
    short_description = p_event_data->>'short_description',
    long_description = p_event_data->>'long_description',
    brief = p_event_data->>'brief',
    highlights = COALESCE(p_event_data->'highlights', to_jsonb(highlights))::TEXT[],
    keywords = COALESCE(p_event_data->'keywords', to_jsonb(keywords))::TEXT[],
    slug = COALESCE(p_event_data->>'slug', slug),
    meta_title = p_event_data->>'meta_title',
    meta_description = p_event_data->>'meta_description',
    end_time = (p_event_data->>'end_time')::TIME,
    duration_minutes = (p_event_data->>'duration_minutes')::INTEGER,
    doors_time = (p_event_data->>'doors_time')::TIME,
    last_entry_time = (p_event_data->>'last_entry_time')::TIME,
    event_status = COALESCE(p_event_data->>'event_status', event_status),
    performer_name = p_event_data->>'performer_name',
    performer_type = p_event_data->>'performer_type',
    price = COALESCE((p_event_data->>'price')::DECIMAL, price),
    is_free = COALESCE((p_event_data->>'is_free')::BOOLEAN, is_free),
    booking_url = p_event_data->>'booking_url',
    hero_image_url = p_event_data->>'hero_image_url',
    thumbnail_image_url = p_event_data->>'thumbnail_image_url',
    poster_image_url = p_event_data->>'poster_image_url',
    promo_video_url = p_event_data->>'promo_video_url',
    highlight_video_urls = COALESCE(p_event_data->'highlight_video_urls', to_jsonb(highlight_video_urls))::TEXT[],
    gallery_image_urls = COALESCE(p_event_data->'gallery_image_urls', to_jsonb(gallery_image_urls))::TEXT[]
  WHERE id = p_event_id;

  -- 2. Update FAQs (if provided)
  -- This replaces all FAQs for the event if the parameter is not null
  IF p_faqs IS NOT NULL THEN
    DELETE FROM event_faqs WHERE event_id = p_event_id;
    
    IF jsonb_array_length(p_faqs) > 0 THEN
      INSERT INTO event_faqs (
        event_id,
        question,
        answer,
        sort_order
      )
      SELECT
        p_event_id,
        item->>'question',
        item->>'answer',
        COALESCE((item->>'sort_order')::INTEGER, 0)
      FROM jsonb_array_elements(p_faqs) AS item;
    END IF;
  END IF;

  -- 3. Return the updated event
  SELECT to_jsonb(e) INTO v_event_record
  FROM events e
  WHERE e.id = p_event_id;

  RETURN v_event_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
-- End 20260401140000_create_event_transactions.sql


-- Begin 20260401150000_create_private_booking_transaction.sql
-- Function to handle atomic creation of private bookings with items
CREATE OR REPLACE FUNCTION create_private_booking_transaction(
  p_booking_data JSONB,
  p_items JSONB DEFAULT '[]'::JSONB,
  p_customer_data JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking_id UUID;
  v_customer_id UUID;
  v_booking_record JSONB;
BEGIN
  -- 1. Handle Customer (Find or Create)
  IF p_customer_data IS NOT NULL THEN
    -- Try to find by ID if provided
    IF (p_customer_data->>'id') IS NOT NULL THEN
      v_customer_id := (p_customer_data->>'id')::UUID;
    ELSE
      -- Try to find by phone number
      SELECT id INTO v_customer_id
      FROM customers
      WHERE mobile_number = p_customer_data->>'mobile_number'
      LIMIT 1;

      -- Create if not found
      IF v_customer_id IS NULL THEN
        INSERT INTO customers (
          first_name,
          last_name,
          mobile_number,
          email,
          sms_opt_in
        ) VALUES (
          p_customer_data->>'first_name',
          p_customer_data->>'last_name',
          p_customer_data->>'mobile_number',
          p_customer_data->>'email',
          COALESCE((p_customer_data->>'sms_opt_in')::BOOLEAN, true)
        )
        RETURNING id INTO v_customer_id;
      END IF;
    END IF;
  ELSE
    v_customer_id := (p_booking_data->>'customer_id')::UUID;
  END IF;

  -- 2. Insert Private Booking
  INSERT INTO private_bookings (
    customer_id,
    event_date,
    start_time,
    end_time,
    setup_date,
    setup_time,
    guest_count,
    event_type,
    status,
    deposit_amount,
    balance_due_date,
    internal_notes,
    customer_requests,
    special_requirements,
    accessibility_needs,
    source,
    customer_first_name,
    customer_last_name,
    customer_name,
    contact_phone,
    contact_email,
    created_by
  ) VALUES (
    v_customer_id,
    (p_booking_data->>'event_date')::DATE,
    (p_booking_data->>'start_time')::TIME,
    (p_booking_data->>'end_time')::TIME,
    (p_booking_data->>'setup_date')::DATE,
    (p_booking_data->>'setup_time')::TIME,
    (p_booking_data->>'guest_count')::INTEGER,
    p_booking_data->>'event_type',
    COALESCE(p_booking_data->>'status', 'draft'),
    COALESCE((p_booking_data->>'deposit_amount')::DECIMAL, 0),
    (p_booking_data->>'balance_due_date')::DATE,
    p_booking_data->>'internal_notes',
    p_booking_data->>'customer_requests',
    p_booking_data->>'special_requirements',
    p_booking_data->>'accessibility_needs',
    p_booking_data->>'source',
    p_booking_data->>'customer_first_name',
    p_booking_data->>'customer_last_name',
    p_booking_data->>'customer_name',
    p_booking_data->>'contact_phone',
    p_booking_data->>'contact_email',
    (p_booking_data->>'created_by')::UUID
  )
  RETURNING id INTO v_booking_id;

  -- 3. Insert Booking Items (if any)
  IF jsonb_array_length(p_items) > 0 THEN
    INSERT INTO private_booking_items (
      booking_id,
      item_type,
      item_name,
      quantity,
      unit_price,
      total_price,
      notes,
      display_order
    )
    SELECT
      v_booking_id,
      item->>'item_type',
      item->>'item_name',
      (item->>'quantity')::INTEGER,
      (item->>'unit_price')::DECIMAL,
      (item->>'total_price')::DECIMAL,
      item->>'notes',
      COALESCE((item->>'display_order')::INTEGER, 0)
    FROM jsonb_array_elements(p_items) AS item;
  END IF;

  -- 4. Return the created booking
  SELECT to_jsonb(pb) || jsonb_build_object('customer_id', v_customer_id)
  INTO v_booking_record
  FROM private_bookings pb
  WHERE pb.id = v_booking_id;

  RETURN v_booking_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
-- End 20260401150000_create_private_booking_transaction.sql


-- Begin 20260401160000_create_receipt_transaction.sql
-- Function to handle atomic creation of receipt batch and transactions
CREATE OR REPLACE FUNCTION import_receipt_batch_transaction(
  p_batch_data JSONB,
  p_transactions JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_batch_id UUID;
  v_batch_record JSONB;
BEGIN
  -- 1. Insert Receipt Batch
  INSERT INTO receipt_batches (
    original_filename,
    source_hash,
    row_count,
    notes,
    uploaded_by
  ) VALUES (
    p_batch_data->>'original_filename',
    p_batch_data->>'source_hash',
    (p_batch_data->>'row_count')::INTEGER,
    p_batch_data->>'notes',
    (p_batch_data->>'uploaded_by')::UUID
  )
  RETURNING id INTO v_batch_id;

  -- 2. Insert Transactions
  IF jsonb_array_length(p_transactions) > 0 THEN
    INSERT INTO receipt_transactions (
      batch_id,
      transaction_date,
      details,
      transaction_type,
      amount_in,
      amount_out,
      balance,
      dedupe_hash,
      status,
      receipt_required,
      vendor_name,
      vendor_source,
      expense_category,
      expense_category_source
    )
    SELECT
      v_batch_id,
      (item->>'transaction_date')::DATE,
      item->>'details',
      item->>'transaction_type',
      (item->>'amount_in')::DECIMAL,
      (item->>'amount_out')::DECIMAL,
      (item->>'balance')::DECIMAL,
      item->>'dedupe_hash',
      (item->>'status')::receipt_transaction_status,
      COALESCE((item->>'receipt_required')::BOOLEAN, true),
      item->>'vendor_name',
      (item->>'vendor_source')::receipt_classification_source,
      (item->>'expense_category')::receipt_expense_category,
      (item->>'expense_category_source')::receipt_classification_source
    FROM jsonb_array_elements(p_transactions) AS item;
  END IF;

  -- 3. Return the created batch record
  SELECT to_jsonb(rb) INTO v_batch_record
  FROM receipt_batches rb
  WHERE rb.id = v_batch_id;

  RETURN v_batch_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
-- End 20260401160000_create_receipt_transaction.sql


-- Begin 20260401170000_create_employee_transaction.sql
-- Function to handle atomic creation of employee with details
CREATE OR REPLACE FUNCTION create_employee_transaction(
  p_employee_data JSONB,
  p_financial_data JSONB DEFAULT NULL,
  p_health_data JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_employee_id UUID;
  v_employee_record JSONB;
BEGIN
  -- 1. Insert Employee
  INSERT INTO employees (
    first_name,
    last_name,
    email_address,
    job_title,
    employment_start_date,
    status,
    date_of_birth,
    address,
    phone_number,
    employment_end_date
  ) VALUES (
    p_employee_data->>'first_name',
    p_employee_data->>'last_name',
    p_employee_data->>'email_address',
    p_employee_data->>'job_title',
    (p_employee_data->>'employment_start_date')::DATE,
    p_employee_data->>'status',
    (p_employee_data->>'date_of_birth')::DATE,
    p_employee_data->>'address',
    p_employee_data->>'phone_number',
    (p_employee_data->>'employment_end_date')::DATE
  )
  RETURNING employee_id INTO v_employee_id;

  -- 2. Insert Financial Details (if provided)
  IF p_financial_data IS NOT NULL THEN
    INSERT INTO employee_financial_details (
      employee_id,
      ni_number,
      bank_account_number,
      bank_sort_code,
      bank_name,
      payee_name,
      branch_address
    ) VALUES (
      v_employee_id,
      p_financial_data->>'ni_number',
      p_financial_data->>'bank_account_number',
      p_financial_data->>'bank_sort_code',
      p_financial_data->>'bank_name',
      p_financial_data->>'payee_name',
      p_financial_data->>'branch_address'
    );
  END IF;

  -- 3. Insert Health Records (if provided)
  IF p_health_data IS NOT NULL THEN
    INSERT INTO employee_health_records (
      employee_id,
      doctor_name,
      doctor_address,
      allergies,
      illness_history,
      recent_treatment,
      has_diabetes,
      has_epilepsy,
      has_skin_condition,
      has_depressive_illness,
      has_bowel_problems,
      has_ear_problems,
      is_registered_disabled,
      disability_reg_number,
      disability_reg_expiry_date,
      disability_details
    ) VALUES (
      v_employee_id,
      p_health_data->>'doctor_name',
      p_health_data->>'doctor_address',
      p_health_data->>'allergies',
      p_health_data->>'illness_history',
      p_health_data->>'recent_treatment',
      COALESCE((p_health_data->>'has_diabetes')::BOOLEAN, false),
      COALESCE((p_health_data->>'has_epilepsy')::BOOLEAN, false),
      COALESCE((p_health_data->>'has_skin_condition')::BOOLEAN, false),
      COALESCE((p_health_data->>'has_depressive_illness')::BOOLEAN, false),
      COALESCE((p_health_data->>'has_bowel_problems')::BOOLEAN, false),
      COALESCE((p_health_data->>'has_ear_problems')::BOOLEAN, false),
      COALESCE((p_health_data->>'is_registered_disabled')::BOOLEAN, false),
      p_health_data->>'disability_reg_number',
      (p_health_data->>'disability_reg_expiry_date')::DATE,
      p_health_data->>'disability_details'
    );
  END IF;

  -- 4. Return the created employee record
  SELECT to_jsonb(e) INTO v_employee_record
  FROM employees e
  WHERE e.employee_id = v_employee_id;

  RETURN v_employee_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
-- End 20260401170000_create_employee_transaction.sql


-- Begin 20260401180000_create_parking_transaction.sql
-- Function to handle atomic creation of parking booking and payment order
CREATE OR REPLACE FUNCTION create_parking_booking_transaction(
  p_booking_data JSONB,
  p_payment_order_data JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking_id UUID;
  v_booking_record JSONB;
  v_order_id UUID;
BEGIN
  -- 1. Insert Parking Booking
  INSERT INTO parking_bookings (
    customer_id,
    vehicle_registration,
    vehicle_make,
    vehicle_model,
    vehicle_colour,
    start_at,
    end_at,
    status,
    total_price,
    notes,
    override_price,
    override_reason,
    capacity_override,
    capacity_override_reason
  ) VALUES (
    (p_booking_data->>'customer_id')::UUID,
    p_booking_data->>'vehicle_registration',
    p_booking_data->>'vehicle_make',
    p_booking_data->>'vehicle_model',
    p_booking_data->>'vehicle_colour',
    (p_booking_data->>'start_at')::TIMESTAMPTZ,
    (p_booking_data->>'end_at')::TIMESTAMPTZ,
    (p_booking_data->>'status')::parking_booking_status,
    (p_booking_data->>'total_price')::DECIMAL,
    p_booking_data->>'notes',
    (p_booking_data->>'override_price')::DECIMAL,
    p_booking_data->>'override_reason',
    COALESCE((p_booking_data->>'capacity_override')::BOOLEAN, false),
    p_booking_data->>'capacity_override_reason'
  )
  RETURNING id INTO v_booking_id;

  -- 2. Insert Payment Order (if provided)
  IF p_payment_order_data IS NOT NULL THEN
    INSERT INTO parking_payment_orders (
      booking_id,
      amount,
      status,
      order_reference,
      expires_at
    ) VALUES (
      v_booking_id,
      (p_payment_order_data->>'amount')::DECIMAL,
      (p_payment_order_data->>'status')::parking_payment_status,
      p_payment_order_data->>'order_reference',
      (p_payment_order_data->>'expires_at')::TIMESTAMPTZ
    )
    RETURNING id INTO v_order_id;
  END IF;

  -- 3. Return the created booking record (with payment order ID if created)
  SELECT to_jsonb(pb) || 
    CASE WHEN v_order_id IS NOT NULL 
      THEN jsonb_build_object('payment_order_id', v_order_id) 
      ELSE '{}'::JSONB 
    END
  INTO v_booking_record
  FROM parking_bookings pb
  WHERE pb.id = v_booking_id;

  RETURN v_booking_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
-- End 20260401180000_create_parking_transaction.sql


-- Begin 20260401190000_create_quote_transaction.sql
-- Function to handle atomic creation of quote with line items
CREATE OR REPLACE FUNCTION create_quote_transaction(
  p_quote_data JSONB,
  p_line_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_quote_id UUID;
  v_quote_record JSONB;
BEGIN
  -- 1. Insert Quote
  INSERT INTO quotes (
    quote_number,
    vendor_id,
    quote_date,
    valid_until,
    reference,
    quote_discount_percentage,
    subtotal_amount,
    discount_amount,
    vat_amount,
    total_amount,
    notes,
    internal_notes,
    status
  ) VALUES (
    p_quote_data->>'quote_number',
    (p_quote_data->>'vendor_id')::UUID,
    (p_quote_data->>'quote_date')::DATE,
    (p_quote_data->>'valid_until')::DATE,
    p_quote_data->>'reference',
    (p_quote_data->>'quote_discount_percentage')::DECIMAL,
    (p_quote_data->>'subtotal_amount')::DECIMAL,
    (p_quote_data->>'discount_amount')::DECIMAL,
    (p_quote_data->>'vat_amount')::DECIMAL,
    (p_quote_data->>'total_amount')::DECIMAL,
    p_quote_data->>'notes',
    p_quote_data->>'internal_notes',
    (p_quote_data->>'status')::quote_status
  )
  RETURNING id INTO v_quote_id;

  -- 2. Insert Line Items
  IF jsonb_array_length(p_line_items) > 0 THEN
    INSERT INTO quote_line_items (
      quote_id,
      catalog_item_id,
      description,
      quantity,
      unit_price,
      discount_percentage,
      vat_rate
    )
    SELECT
      v_quote_id,
      (item->>'catalog_item_id')::UUID,
      item->>'description',
      (item->>'quantity')::DECIMAL,
      (item->>'unit_price')::DECIMAL,
      (item->>'discount_percentage')::DECIMAL,
      (item->>'vat_rate')::DECIMAL
    FROM jsonb_array_elements(p_line_items) AS item;
  END IF;

  -- 3. Return the created quote record
  SELECT to_jsonb(q) INTO v_quote_record
  FROM quotes q
  WHERE q.id = v_quote_id;

  RETURN v_quote_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
-- End 20260401190000_create_quote_transaction.sql


-- Begin 20260401200000_create_menu_transactions.sql
-- Function to handle atomic creation of recipes with ingredients
CREATE OR REPLACE FUNCTION create_recipe_transaction(
  p_recipe_data JSONB,
  p_ingredients JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recipe_id UUID;
  v_recipe_record JSONB;
BEGIN
  -- 1. Insert Recipe
  INSERT INTO menu_recipes (
    name,
    description,
    instructions,
    yield_quantity,
    yield_unit,
    notes,
    is_active
  ) VALUES (
    p_recipe_data->>'name',
    p_recipe_data->>'description',
    p_recipe_data->>'instructions',
    (p_recipe_data->>'yield_quantity')::DECIMAL,
    p_recipe_data->>'yield_unit',
    p_recipe_data->>'notes',
    COALESCE((p_recipe_data->>'is_active')::BOOLEAN, true)
  )
  RETURNING id INTO v_recipe_id;

  -- 2. Insert Recipe Ingredients
  IF jsonb_array_length(p_ingredients) > 0 THEN
    INSERT INTO menu_recipe_ingredients (
      recipe_id,
      ingredient_id,
      quantity,
      unit,
      yield_pct,
      wastage_pct,
      cost_override,
      notes
    )
    SELECT
      v_recipe_id,
      (item->>'ingredient_id')::UUID,
      (item->>'quantity')::DECIMAL,
      item->>'unit',
      (item->>'yield_pct')::DECIMAL,
      (item->>'wastage_pct')::DECIMAL,
      (item->>'cost_override')::DECIMAL,
      item->>'notes'
    FROM jsonb_array_elements(p_ingredients) AS item;
  END IF;

  -- 3. Trigger calculation refresh (if needed, otherwise rely on triggers)
  -- Assuming 'menu_refresh_recipe_calculations' is a separate function or trigger
  -- We can call it here if it exists and is safe
  PERFORM menu_refresh_recipe_calculations(v_recipe_id);

  -- 4. Return the created recipe
  SELECT to_jsonb(r) INTO v_recipe_record
  FROM menu_recipes r
  WHERE r.id = v_recipe_id;

  RETURN v_recipe_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- Function to handle atomic creation of dishes with ingredients, recipes, and assignments
CREATE OR REPLACE FUNCTION create_dish_transaction(
  p_dish_data JSONB,
  p_ingredients JSONB DEFAULT '[]'::JSONB,
  p_recipes JSONB DEFAULT '[]'::JSONB,
  p_assignments JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_dish_id UUID;
  v_dish_record JSONB;
BEGIN
  -- 1. Insert Dish
  INSERT INTO menu_dishes (
    name,
    description,
    selling_price,
    target_gp_pct,
    calories,
    is_active,
    is_sunday_lunch,
    image_url,
    notes
  ) VALUES (
    p_dish_data->>'name',
    p_dish_data->>'description',
    (p_dish_data->>'selling_price')::DECIMAL,
    (p_dish_data->>'target_gp_pct')::DECIMAL,
    (p_dish_data->>'calories')::INTEGER,
    COALESCE((p_dish_data->>'is_active')::BOOLEAN, true),
    COALESCE((p_dish_data->>'is_sunday_lunch')::BOOLEAN, false),
    p_dish_data->>'image_url',
    p_dish_data->>'notes'
  )
  RETURNING id INTO v_dish_id;

  -- 2. Insert Dish Ingredients
  IF jsonb_array_length(p_ingredients) > 0 THEN
    INSERT INTO menu_dish_ingredients (
      dish_id,
      ingredient_id,
      quantity,
      unit,
      yield_pct,
      wastage_pct,
      cost_override,
      notes
    )
    SELECT
      v_dish_id,
      (item->>'ingredient_id')::UUID,
      (item->>'quantity')::DECIMAL,
      item->>'unit',
      (item->>'yield_pct')::DECIMAL,
      (item->>'wastage_pct')::DECIMAL,
      (item->>'cost_override')::DECIMAL,
      item->>'notes'
    FROM jsonb_array_elements(p_ingredients) AS item;
  END IF;

  -- 3. Insert Dish Recipes
  IF jsonb_array_length(p_recipes) > 0 THEN
    INSERT INTO menu_dish_recipes (
      dish_id,
      recipe_id,
      quantity,
      yield_pct,
      wastage_pct,
      cost_override,
      notes
    )
    SELECT
      v_dish_id,
      (item->>'recipe_id')::UUID,
      (item->>'quantity')::DECIMAL,
      (item->>'yield_pct')::DECIMAL,
      (item->>'wastage_pct')::DECIMAL,
      (item->>'cost_override')::DECIMAL,
      item->>'notes'
    FROM jsonb_array_elements(p_recipes) AS item;
  END IF;

  -- 4. Insert Assignments
  IF jsonb_array_length(p_assignments) > 0 THEN
    INSERT INTO menu_dish_menu_assignments (
      dish_id,
      menu_id,
      category_id,
      sort_order,
      is_special,
      is_default_side,
      available_from,
      available_until
    )
    SELECT
      v_dish_id,
      (item->>'menu_id')::UUID,
      (item->>'category_id')::UUID,
      COALESCE((item->>'sort_order')::INTEGER, 0),
      COALESCE((item->>'is_special')::BOOLEAN, false),
      COALESCE((item->>'is_default_side')::BOOLEAN, false),
      (item->>'available_from')::DATE,
      (item->>'available_until')::DATE
    FROM jsonb_array_elements(p_assignments) AS item;
  END IF;

  -- 5. Refresh calculations
  PERFORM menu_refresh_dish_calculations(v_dish_id);

  -- 6. Return the created dish
  SELECT to_jsonb(d) INTO v_dish_record
  FROM menu_dishes d
  WHERE d.id = v_dish_id;

  RETURN v_dish_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
-- End 20260401200000_create_menu_transactions.sql


-- Begin 20260401210000_create_event_check_in_transaction.sql
-- Function to handle atomic event check-in (Customer Upsert + Booking + Check-in + Labels)
CREATE OR REPLACE FUNCTION register_guest_transaction(
  p_event_id UUID,
  p_customer_data JSONB,
  p_staff_id UUID,
  p_labels JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_customer_id UUID;
  v_booking_id UUID;
  v_check_in_id UUID;
  v_customer_record JSONB;
  v_check_in_record JSONB;
BEGIN
  -- 1. Upsert Customer
  IF (p_customer_data->>'id') IS NOT NULL THEN
    v_customer_id := (p_customer_data->>'id')::UUID;
    -- Update email if provided and different
    UPDATE customers 
    SET email = COALESCE(p_customer_data->>'email', email)
    WHERE id = v_customer_id;
  ELSE
    -- Try to find by phone number first
    SELECT id INTO v_customer_id
    FROM customers
    WHERE mobile_number = p_customer_data->>'mobile_number';

    IF v_customer_id IS NULL THEN
      -- Create new customer
      INSERT INTO customers (
        first_name,
        last_name,
        mobile_number,
        email,
        sms_opt_in
      ) VALUES (
        p_customer_data->>'first_name',
        p_customer_data->>'last_name',
        p_customer_data->>'mobile_number',
        p_customer_data->>'email',
        COALESCE((p_customer_data->>'sms_opt_in')::BOOLEAN, true)
      )
      RETURNING id INTO v_customer_id;
    ELSE
      -- Update existing customer email/name if needed?
      -- For now, only email updates on "register existing" are common.
      NULL; 
    END IF;
  END IF;

  -- 2. Ensure Booking Exists
  SELECT id INTO v_booking_id
  FROM bookings
  WHERE event_id = p_event_id AND customer_id = v_customer_id
  LIMIT 1;

  IF v_booking_id IS NULL THEN
    INSERT INTO bookings (
      event_id,
      customer_id,
      seats,
      booking_source,
      notes
    ) VALUES (
      p_event_id,
      v_customer_id,
      1,
      'bulk_add', -- or 'check_in'
      'Created via event check-in'
    )
    RETURNING id INTO v_booking_id;
  END IF;

  -- 3. Record Check-in
  -- Check if already checked in
  SELECT id INTO v_check_in_id
  FROM event_check_ins
  WHERE event_id = p_event_id AND customer_id = v_customer_id
  LIMIT 1;

  IF v_check_in_id IS NULL THEN
    INSERT INTO event_check_ins (
      event_id,
      customer_id,
      booking_id,
      check_in_method,
      staff_id
    ) VALUES (
      p_event_id,
      v_customer_id,
      v_booking_id,
      'manual',
      p_staff_id
    )
    RETURNING id INTO v_check_in_id;
  ELSE
    -- Already checked in, but we can return success/data anyway
    -- or raise error if we want strict prevention.
    -- The previous logic returned error 'Guest is already checked in'.
    -- Let's raise an exception to match previous behavior if that is desired, 
    -- OR return existing record. The action handled 23505 error.
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Guest is already checked in for this event';
  END IF;

  -- 4. Assign Labels
  IF jsonb_array_length(p_labels) > 0 THEN
    INSERT INTO customer_label_assignments (
      customer_id,
      label_id,
      auto_assigned,
      assigned_by,
      notes
    )
    SELECT
      v_customer_id,
      (label->>'id')::UUID,
      true,
      p_staff_id,
      label->>'notes'
    FROM jsonb_array_elements(p_labels) AS label
    ON CONFLICT (customer_id, label_id) DO NOTHING;
  END IF;

  -- 5. Return Data
  SELECT to_jsonb(c) INTO v_customer_record FROM customers c WHERE c.id = v_customer_id;
  
  RETURN jsonb_build_object(
    'check_in_id', v_check_in_id,
    'booking_id', v_booking_id,
    'customer', v_customer_record
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
-- End 20260401210000_create_event_check_in_transaction.sql


-- Begin 20260401220000_update_menu_target_gp_transaction.sql
-- Function to atomically update menu target GP and propagate to dishes
CREATE OR REPLACE FUNCTION update_menu_target_gp_transaction(
  p_new_target_gp NUMERIC,
  p_user_id UUID DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_setting_key TEXT := 'menu_target_gp_pct';
  v_old_setting_value JSONB;
  v_new_setting_value JSONB;
  v_log_id UUID;
BEGIN
  -- 1. Upsert (Update or Insert) the system setting
  INSERT INTO system_settings (key, value, description)
  VALUES (v_setting_key, jsonb_build_object('target_gp_pct', p_new_target_gp), 'Standard gross profit target applied to all dishes.')
  ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = NOW()
  RETURNING value INTO v_old_setting_value; -- Retrieve old value if it was an update

  v_new_setting_value := jsonb_build_object('target_gp_pct', p_new_target_gp);

  -- 2. Propagate the new target to all active menu_dishes
  UPDATE menu_dishes
  SET target_gp_pct = p_new_target_gp,
      updated_at = NOW()
  WHERE is_active = TRUE;

  -- 3. Log audit event (similar to log_audit_event in JS, but simpler here)
  INSERT INTO audit_logs (
    user_id,
    user_email,
    operation_type,
    resource_type,
    resource_id,
    operation_status,
    old_values,
    new_values,
    additional_info
  ) VALUES (
    p_user_id,
    p_user_email,
    'update',
    'system_setting',
    v_setting_key,
    'success',
    v_old_setting_value,
    v_new_setting_value,
    jsonb_build_object('setting_name', 'Menu Target GP', 'propagated_to_dishes', TRUE)
  )
  RETURNING id INTO v_log_id;

  -- 4. Return success status and the new target
  RETURN jsonb_build_object('success', TRUE, 'new_target_gp', p_new_target_gp);

EXCEPTION WHEN OTHERS THEN
  -- Log the error to audit_logs as a failure
  INSERT INTO audit_logs (
    user_id,
    user_email,
    operation_type,
    resource_type,
    resource_id,
    operation_status,
    error_message,
    additional_info
  ) VALUES (
    p_user_id,
    p_user_email,
    'update',
    'system_setting',
    v_setting_key,
    'failure',
    SQLERRM,
    jsonb_build_object('setting_name', 'Menu Target GP', 'propagated_to_dishes', TRUE)
  );
  RAISE;
END;
$$;
-- End 20260401220000_update_menu_target_gp_transaction.sql


-- Begin 20260401223000_fix_event_time_update.sql
-- Fix COALESCE type mismatch when updating event time (column is stored as text)
CREATE OR REPLACE FUNCTION update_event_transaction(
  p_event_id UUID,
  p_event_data JSONB,
  p_faqs JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_record JSONB;
BEGIN
  -- 1. Update Event
  UPDATE events SET
    name = COALESCE(p_event_data->>'name', name),
    date = COALESCE((p_event_data->>'date')::DATE, date),
    -- Column `time` is stored as text, so avoid mixing TIME/text in COALESCE
    time = COALESCE(p_event_data->>'time', time),
    capacity = (p_event_data->>'capacity')::INTEGER, -- Allow null
    category_id = (p_event_data->>'category_id')::UUID, -- Allow null
    short_description = p_event_data->>'short_description',
    long_description = p_event_data->>'long_description',
    brief = p_event_data->>'brief',
    highlights = COALESCE(p_event_data->'highlights', to_jsonb(highlights))::TEXT[],
    keywords = COALESCE(p_event_data->'keywords', to_jsonb(keywords))::TEXT[],
    slug = COALESCE(p_event_data->>'slug', slug),
    meta_title = p_event_data->>'meta_title',
    meta_description = p_event_data->>'meta_description',
    end_time = (p_event_data->>'end_time')::TIME,
    duration_minutes = (p_event_data->>'duration_minutes')::INTEGER,
    doors_time = (p_event_data->>'doors_time')::TIME,
    last_entry_time = (p_event_data->>'last_entry_time')::TIME,
    event_status = COALESCE(p_event_data->>'event_status', event_status),
    performer_name = p_event_data->>'performer_name',
    performer_type = p_event_data->>'performer_type',
    price = COALESCE((p_event_data->>'price')::DECIMAL, price),
    is_free = COALESCE((p_event_data->>'is_free')::BOOLEAN, is_free),
    booking_url = p_event_data->>'booking_url',
    hero_image_url = p_event_data->>'hero_image_url',
    thumbnail_image_url = p_event_data->>'thumbnail_image_url',
    poster_image_url = p_event_data->>'poster_image_url',
    promo_video_url = p_event_data->>'promo_video_url',
    highlight_video_urls = COALESCE(p_event_data->'highlight_video_urls', to_jsonb(highlight_video_urls))::TEXT[],
    gallery_image_urls = COALESCE(p_event_data->'gallery_image_urls', to_jsonb(gallery_image_urls))::TEXT[]
  WHERE id = p_event_id;

  -- 2. Update FAQs (if provided)
  -- This replaces all FAQs for the event if the parameter is not null
  IF p_faqs IS NOT NULL THEN
    DELETE FROM event_faqs WHERE event_id = p_event_id;
    
    IF jsonb_array_length(p_faqs) > 0 THEN
      INSERT INTO event_faqs (
        event_id,
        question,
        answer,
        sort_order
      )
      SELECT
        p_event_id,
        item->>'question',
        item->>'answer',
        COALESCE((item->>'sort_order')::INTEGER, 0)
      FROM jsonb_array_elements(p_faqs) AS item;
    END IF;
  END IF;

  -- 3. Return the updated event
  SELECT to_jsonb(e) INTO v_event_record
  FROM events e
  WHERE e.id = p_event_id;

  RETURN v_event_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
-- End 20260401223000_fix_event_time_update.sql
