

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


CREATE EXTENSION IF NOT EXISTS "pgsodium";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."booking_item_type" AS ENUM (
    'main',
    'side',
    'extra'
);


ALTER TYPE "public"."booking_item_type" OWNER TO "postgres";


CREATE TYPE "public"."payment_status" AS ENUM (
    'pending',
    'completed',
    'failed',
    'refunded',
    'partial_refund'
);


ALTER TYPE "public"."payment_status" OWNER TO "postgres";


CREATE TYPE "public"."table_booking_status" AS ENUM (
    'pending_payment',
    'confirmed',
    'cancelled',
    'no_show',
    'completed'
);


ALTER TYPE "public"."table_booking_status" OWNER TO "postgres";


CREATE TYPE "public"."table_booking_type" AS ENUM (
    'regular',
    'sunday_lunch'
);


ALTER TYPE "public"."table_booking_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_customer_labels_retroactively"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
  DECLARE
    regular_label_id UUID;
    vip_label_id UUID;
    new_customer_label_id UUID;
    at_risk_label_id UUID;
  BEGIN
    -- Get label IDs
    SELECT id INTO regular_label_id FROM customer_labels WHERE name = 'Regular';
    SELECT id INTO vip_label_id FROM customer_labels WHERE name = 'VIP';
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
        SELECT customer_id, SUM(times_attended) as total
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

    -- Apply VIP label (10+ events across 3+ categories)
    IF vip_label_id IS NOT NULL THEN
      INSERT INTO customer_label_assignments (customer_id, label_id, auto_assigned, notes)
      SELECT DISTINCT
        customer_id,
        vip_label_id,
        true,
        'Auto-applied: 10+ events across 3+ categories'
      FROM (
        SELECT customer_id
        FROM customer_category_stats
        GROUP BY customer_id
        HAVING COUNT(DISTINCT category_id) >= 3
        AND SUM(times_attended) >= 10
      ) qualified
      WHERE NOT EXISTS (
        SELECT 1 FROM customer_label_assignments
        WHERE customer_id = qualified.customer_id
        AND label_id = vip_label_id
      );
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
        SELECT customer_id, MAX(last_attended_date) as last_date, SUM(times_attended) as total
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


ALTER FUNCTION "public"."apply_customer_labels_retroactively"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_generate_weekly_slots"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."auto_generate_weekly_slots"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."calculate_event_points"("p_base_points" integer, "p_tier_id" "uuid", "p_event_id" "uuid", "p_member_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  tier_multiplier DECIMAL;
  campaign_bonus DECIMAL DEFAULT 1.0;
  final_points INTEGER;
BEGIN
  -- Get tier multiplier
  SELECT point_multiplier INTO tier_multiplier
  FROM loyalty_tiers
  WHERE id = p_tier_id;
  
  -- Check for active campaigns
  SELECT MAX(
    CASE 
      WHEN bonus_type = 'multiplier' THEN bonus_value
      ELSE 1.0
    END
  ) INTO campaign_bonus
  FROM loyalty_campaigns
  WHERE active = true
    AND CURRENT_DATE BETWEEN start_date AND end_date;
  
  -- Calculate final points
  final_points := ROUND(p_base_points * COALESCE(tier_multiplier, 1.0) * COALESCE(campaign_bonus, 1.0));
  
  RETURN final_points;
END;
$$;


ALTER FUNCTION "public"."calculate_event_points"("p_base_points" integer, "p_tier_id" "uuid", "p_event_id" "uuid", "p_member_id" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."calculate_next_generation_date"("p_frequency" character varying, "p_frequency_interval" integer, "p_current_date" "date", "p_day_of_month" integer DEFAULT NULL::integer, "p_day_of_week" integer DEFAULT NULL::integer) RETURNS "date"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_next_date DATE;
BEGIN
  CASE p_frequency
    WHEN 'weekly' THEN
      v_next_date := p_current_date + (p_frequency_interval * INTERVAL '1 week');
      IF p_day_of_week IS NOT NULL THEN
        -- Adjust to specific day of week
        v_next_date := v_next_date + ((p_day_of_week - EXTRACT(DOW FROM v_next_date))::INTEGER % 7);
      END IF;
      
    WHEN 'monthly' THEN
      v_next_date := p_current_date + (p_frequency_interval * INTERVAL '1 month');
      IF p_day_of_month IS NOT NULL THEN
        -- Adjust to specific day of month (handle month-end edge cases)
        v_next_date := DATE_TRUNC('month', v_next_date) + 
          LEAST(p_day_of_month - 1, DATE_PART('days', 
            DATE_TRUNC('month', v_next_date + INTERVAL '1 month') - INTERVAL '1 day')::INTEGER) * INTERVAL '1 day';
      END IF;
      
    WHEN 'quarterly' THEN
      v_next_date := p_current_date + (p_frequency_interval * 3 * INTERVAL '1 month');
      
    WHEN 'annually' THEN
      v_next_date := p_current_date + (p_frequency_interval * INTERVAL '1 year');
  END CASE;
  
  RETURN v_next_date;
END;
$$;


ALTER FUNCTION "public"."calculate_next_generation_date"("p_frequency" character varying, "p_frequency_interval" integer, "p_current_date" "date", "p_day_of_month" integer, "p_day_of_week" integer) OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."calculate_refund_amount"("p_booking_id" "uuid") RETURNS TABLE("refund_percentage" integer, "refund_amount" numeric, "refund_reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."calculate_refund_amount"("p_booking_id" "uuid") OWNER TO "postgres";


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



CREATE OR REPLACE FUNCTION "public"."can_edit_invoice"("invoice_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM invoices 
    WHERE id = invoice_id 
    AND status = 'draft' 
    AND deleted_at IS NULL
  );
END;
$$;


ALTER FUNCTION "public"."can_edit_invoice"("invoice_id" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."check_and_reserve_capacity"("p_service_date" "date", "p_booking_time" time without time zone, "p_party_size" integer, "p_booking_type" "public"."table_booking_type", "p_duration_minutes" integer DEFAULT 120) RETURNS TABLE("available" boolean, "available_capacity" integer, "message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."check_and_reserve_capacity"("p_service_date" "date", "p_booking_time" time without time zone, "p_party_size" integer, "p_booking_type" "public"."table_booking_type", "p_duration_minutes" integer) OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."check_expired_quotes"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE quotes
  SET status = 'expired'
  WHERE status IN ('sent', 'draft')
  AND expiry_date < CURRENT_DATE;
END;
$$;


ALTER FUNCTION "public"."check_expired_quotes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_overdue_invoices"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE invoices
  SET status = 'overdue'
  WHERE status IN ('sent', 'partially_paid')
  AND due_date < CURRENT_DATE
  AND paid_amount < total_amount;
END;
$$;


ALTER FUNCTION "public"."check_overdue_invoices"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_table_availability"("p_date" "date", "p_time" time without time zone, "p_party_size" integer, "p_duration_minutes" integer DEFAULT 120, "p_exclude_booking_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("available_capacity" integer, "tables_available" integer[], "is_available" boolean)
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


ALTER FUNCTION "public"."check_table_availability"("p_date" "date", "p_time" time without time zone, "p_party_size" integer, "p_duration_minutes" integer, "p_exclude_booking_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_table_availability"("p_date" "date", "p_time" time without time zone, "p_party_size" integer, "p_duration_minutes" integer, "p_exclude_booking_id" "uuid") IS 'Checks table booking availability using fixed restaurant capacity of 50 people';



CREATE OR REPLACE FUNCTION "public"."check_tier_upgrade"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  current_tier RECORD;
  next_tier RECORD;
BEGIN
  -- Get current tier
  SELECT * INTO current_tier 
  FROM loyalty_tiers 
  WHERE id = NEW.tier_id;
  
  -- Check if member qualifies for next tier
  SELECT * INTO next_tier
  FROM loyalty_tiers
  WHERE program_id = (SELECT program_id FROM loyalty_members WHERE id = NEW.id)
    AND level = current_tier.level + 1
    AND min_events <= NEW.lifetime_events;
  
  -- Update tier if qualified
  IF next_tier.id IS NOT NULL THEN
    UPDATE loyalty_members 
    SET tier_id = next_tier.id,
        updated_at = NOW()
    WHERE id = NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_tier_upgrade"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_expired_idempotency_keys"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."cleanup_expired_idempotency_keys"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."cleanup_old_rate_limits"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  DELETE FROM rate_limits
  WHERE updated_at < NOW() - INTERVAL '24 hours';
END;
$$;


ALTER FUNCTION "public"."cleanup_old_rate_limits"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_old_reminder_logs"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  DELETE FROM reminder_processing_logs
  WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '30 days';
END;
$$;


ALTER FUNCTION "public"."cleanup_old_reminder_logs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_old_service_slots"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."cleanup_old_service_slots"() OWNER TO "postgres";


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



CREATE OR REPLACE FUNCTION "public"."convert_quote_to_invoice"("p_quote_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_invoice_id UUID;
  v_quote RECORD;
  v_line_item RECORD;
  v_series_id UUID;
  v_next_sequence INTEGER;
  v_invoice_number VARCHAR(20);
BEGIN
  -- Get quote details
  SELECT * INTO v_quote
  FROM quotes
  WHERE id = p_quote_id
  AND status NOT IN ('converted', 'expired', 'rejected');
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found or cannot be converted';
  END IF;
  
  -- Get invoice series
  SELECT id, current_sequence + 1 
  INTO v_series_id, v_next_sequence
  FROM invoice_series
  WHERE series_code = 'INV'
  FOR UPDATE;
  
  -- Update series counter
  UPDATE invoice_series
  SET current_sequence = v_next_sequence
  WHERE id = v_series_id;
  
  -- Generate invoice number (base-36 encoding for disguised sequential)
  v_invoice_number := 'INV-' || UPPER(LPAD(TO_HEX(v_next_sequence + 5000), 5, '0'));
  
  -- Create invoice from quote
  INSERT INTO invoices (
    invoice_number,
    series_id,
    sequence_number,
    vendor_id,
    invoice_date,
    due_date,
    subtotal,
    total_amount,
    discount_type,
    discount_value,
    discount_reason,
    internal_notes,
    external_notes,
    converted_from_quote_id,
    created_by
  ) VALUES (
    v_invoice_number,
    v_series_id,
    v_next_sequence,
    v_quote.vendor_id,
    CURRENT_DATE,
    CURRENT_DATE + INTERVAL '30 days',
    v_quote.subtotal,
    v_quote.total_amount,
    v_quote.discount_type,
    v_quote.discount_value,
    v_quote.discount_reason,
    v_quote.internal_notes,
    v_quote.external_notes,
    p_quote_id,
    auth.uid()
  ) RETURNING id INTO v_invoice_id;
  
  -- Copy line items from quote to invoice
  FOR v_line_item IN 
    SELECT * FROM quote_line_items 
    WHERE quote_id = p_quote_id 
    ORDER BY line_order
  LOOP
    INSERT INTO invoice_line_items (
      invoice_id,
      catalog_item_id,
      description,
      quantity,
      unit_price,
      vat_rate,
      vat_type,
      discount_type,
      discount_value,
      discount_reason,
      line_order
    ) 
    SELECT
      v_invoice_id,
      v_line_item.catalog_item_id,
      v_line_item.description,
      v_line_item.quantity,
      v_line_item.unit_price,
      COALESCE(c.default_vat_rate, 20.00), -- Get VAT from catalog or default to 20%
      COALESCE(c.vat_type, 'standard'),
      v_line_item.discount_type,
      v_line_item.discount_value,
      v_line_item.discount_reason,
      v_line_item.line_order
    FROM quote_line_items q
    LEFT JOIN line_item_catalog c ON c.id = v_line_item.catalog_item_id
    WHERE q.id = v_line_item.id;
  END LOOP;
  
  -- Update quote status
  UPDATE quotes
  SET 
    status = 'converted',
    converted_to_invoice_id = v_invoice_id,
    converted_date = NOW(),
    converted_by = auth.uid()
  WHERE id = p_quote_id;
  
  RETURN v_invoice_id;
END;
$$;


ALTER FUNCTION "public"."convert_quote_to_invoice"("p_quote_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_short_link"("p_destination_url" "text", "p_link_type" character varying, "p_metadata" "jsonb" DEFAULT '{}'::"jsonb", "p_expires_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_custom_code" character varying DEFAULT NULL::character varying) RETURNS TABLE("short_code" character varying, "full_url" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."create_short_link"("p_destination_url" "text", "p_link_type" character varying, "p_metadata" "jsonb", "p_expires_at" timestamp with time zone, "p_custom_code" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_sunday_lunch_booking"("p_customer_id" "uuid", "p_booking_date" "date", "p_booking_time" time without time zone, "p_party_size" integer, "p_special_requirements" "text" DEFAULT NULL::"text", "p_dietary_requirements" "text"[] DEFAULT NULL::"text"[], "p_allergies" "text"[] DEFAULT NULL::"text"[], "p_correlation_id" "uuid" DEFAULT "gen_random_uuid"()) RETURNS TABLE("booking_id" "uuid", "booking_reference" character varying, "status" "public"."table_booking_status", "message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."create_sunday_lunch_booking"("p_customer_id" "uuid", "p_booking_date" "date", "p_booking_time" time without time zone, "p_party_size" integer, "p_special_requirements" "text", "p_dietary_requirements" "text"[], "p_allergies" "text"[], "p_correlation_id" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."generate_booking_reference"() RETURNS character varying
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."generate_booking_reference"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_invoice_from_recurring"("p_recurring_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_recurring RECORD;
  v_invoice_id UUID;
  v_series_id UUID;
  v_next_sequence INTEGER;
  v_invoice_number VARCHAR(20);
  v_line_item JSONB;
BEGIN
  -- Get recurring invoice details
  SELECT * INTO v_recurring
  FROM recurring_invoices
  WHERE id = p_recurring_id
  AND is_paused = false
  AND (end_date IS NULL OR end_date >= CURRENT_DATE);
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recurring invoice not found or is paused/ended';
  END IF;
  
  -- Get invoice series
  SELECT id, current_sequence + 1 
  INTO v_series_id, v_next_sequence
  FROM invoice_series
  WHERE series_code = 'INV'
  FOR UPDATE;
  
  -- Update series counter
  UPDATE invoice_series
  SET current_sequence = v_next_sequence
  WHERE id = v_series_id;
  
  -- Generate invoice number
  v_invoice_number := 'INV-' || UPPER(LPAD(TO_HEX(v_next_sequence + 5000), 5, '0'));
  
  -- Create invoice
  INSERT INTO invoices (
    invoice_number,
    series_id,
    sequence_number,
    vendor_id,
    invoice_date,
    due_date,
    internal_notes,
    external_notes,
    created_by
  ) VALUES (
    v_invoice_number,
    v_series_id,
    v_next_sequence,
    v_recurring.vendor_id,
    CURRENT_DATE,
    CURRENT_DATE + (v_recurring.payment_terms_days || ' days')::INTERVAL,
    v_recurring.internal_notes,
    v_recurring.external_notes,
    v_recurring.created_by
  ) RETURNING id INTO v_invoice_id;
  
  -- Create line items from template
  FOR v_line_item IN SELECT * FROM jsonb_array_elements(v_recurring.template_data->'line_items')
  LOOP
    INSERT INTO invoice_line_items (
      invoice_id,
      description,
      quantity,
      unit_price,
      vat_rate,
      vat_type,
      line_order
    ) VALUES (
      v_invoice_id,
      v_line_item->>'description',
      (v_line_item->>'quantity')::DECIMAL,
      (v_line_item->>'unit_price')::DECIMAL,
      COALESCE((v_line_item->>'vat_rate')::DECIMAL, 20.00),
      COALESCE(v_line_item->>'vat_type', 'standard'),
      COALESCE((v_line_item->>'line_order')::INTEGER, 0)
    );
  END LOOP;
  
  -- Update recurring invoice dates
  UPDATE recurring_invoices
  SET 
    last_generated_date = CURRENT_DATE,
    next_generation_date = calculate_next_generation_date(
      frequency, 
      frequency_interval, 
      CURRENT_DATE, 
      day_of_month, 
      day_of_week
    )
  WHERE id = p_recurring_id;
  
  -- Record in history
  INSERT INTO recurring_invoice_history (
    recurring_invoice_id,
    invoice_id,
    status
  ) VALUES (
    p_recurring_id,
    v_invoice_id,
    'success'
  );
  
  RETURN v_invoice_id;
EXCEPTION
  WHEN OTHERS THEN
    -- Record failure in history
    INSERT INTO recurring_invoice_history (
      recurring_invoice_id,
      status,
      error_message
    ) VALUES (
      p_recurring_id,
      'failed',
      SQLERRM
    );
    RAISE;
END;
$$;


ALTER FUNCTION "public"."generate_invoice_from_recurring"("p_recurring_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_invoice_reminder_digest"() RETURNS TABLE("category" "text", "invoice_id" "uuid", "invoice_number" character varying, "vendor_name" character varying, "amount" numeric, "due_date" "date", "days_until_due" integer)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Invoices due soon
  RETURN QUERY
  SELECT 
    'due_soon'::TEXT as category,
    i.id,
    i.invoice_number,
    v.name,
    i.total_amount,
    i.due_date,
    (i.due_date - CURRENT_DATE)::INTEGER as days_until_due
  FROM invoices i
  JOIN vendors v ON i.vendor_id = v.id
  WHERE i.status IN ('sent', 'partially_paid')
  AND i.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
  AND NOT (v.id = ANY(
    SELECT exclude_vendors FROM invoice_reminder_settings LIMIT 1
  ));
  
  -- Overdue invoices
  RETURN QUERY
  SELECT 
    'overdue'::TEXT as category,
    i.id,
    i.invoice_number,
    v.name,
    i.total_amount,
    i.due_date,
    (CURRENT_DATE - i.due_date)::INTEGER as days_until_due
  FROM invoices i
  JOIN vendors v ON i.vendor_id = v.id
  WHERE i.status = 'overdue'
  AND NOT (v.id = ANY(
    SELECT exclude_vendors FROM invoice_reminder_settings LIMIT 1
  ));
  
  -- Quotes expiring soon
  RETURN QUERY
  SELECT 
    'quote_expiring'::TEXT as category,
    q.id,
    q.quote_number,
    v.name,
    q.total_amount,
    q.expiry_date,
    (q.expiry_date - CURRENT_DATE)::INTEGER as days_until_due
  FROM quotes q
  JOIN vendors v ON q.vendor_id = v.id
  WHERE q.status IN ('sent', 'draft')
  AND q.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days';
  
  -- Recurring invoices ready
  RETURN QUERY
  SELECT 
    'recurring_ready'::TEXT as category,
    r.id,
    r.template_name::VARCHAR,
    v.name,
    0::DECIMAL,
    r.next_generation_date,
    0 as days_until_due
  FROM recurring_invoices r
  JOIN vendors v ON r.vendor_id = v.id
  WHERE r.next_generation_date <= CURRENT_DATE
  AND r.is_paused = false
  AND (r.end_date IS NULL OR r.end_date >= CURRENT_DATE);
END;
$$;


ALTER FUNCTION "public"."generate_invoice_reminder_digest"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_loyalty_access_token"() RETURNS character varying
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  token VARCHAR;
BEGIN
  -- Generate a URL-safe random token (32 characters)
  SELECT encode(gen_random_bytes(24), 'base64') INTO token;
  -- Replace URL-unsafe characters
  token := replace(replace(replace(token, '+', '-'), '/', '_'), '=', '');
  RETURN token;
END;
$$;


ALTER FUNCTION "public"."generate_loyalty_access_token"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_service_slots_for_period"("start_date" "date" DEFAULT CURRENT_DATE, "days_ahead" integer DEFAULT 90) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."generate_service_slots_for_period"("start_date" "date", "days_ahead" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_service_slots_from_config"("start_date" "date" DEFAULT CURRENT_DATE, "days_ahead" integer DEFAULT 90) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."generate_service_slots_from_config"("start_date" "date", "days_ahead" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_short_code"("length" integer DEFAULT 6) RETURNS character varying
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."generate_short_code"("length" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_slots_simple"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_slots_created INTEGER;
BEGIN
  -- Generate slots for the next 90 days
  v_slots_created := generate_service_slots_from_config(CURRENT_DATE, 90);
  
  RETURN format('Generated %s service slots', v_slots_created);
END;
$$;


ALTER FUNCTION "public"."generate_slots_simple"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_all_links_analytics"("p_days" integer DEFAULT 30) RETURNS TABLE("short_code" character varying, "link_type" character varying, "destination_url" "text", "click_dates" "date"[], "click_counts" bigint[], "total_clicks" bigint, "unique_visitors" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."get_all_links_analytics"("p_days" integer) OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."get_and_increment_invoice_series"("p_series_code" character varying) RETURNS TABLE("next_sequence" integer)
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_next_sequence INTEGER;
BEGIN
  -- Lock the row and get the next sequence
  UPDATE invoice_series
  SET current_sequence = current_sequence + 1
  WHERE series_code = p_series_code
  RETURNING current_sequence INTO v_next_sequence;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice series % not found', p_series_code;
  END IF;
  
  RETURN QUERY SELECT v_next_sequence;
END;
$$;


ALTER FUNCTION "public"."get_and_increment_invoice_series"("p_series_code" character varying) OWNER TO "postgres";


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



CREATE OR REPLACE FUNCTION "public"."get_customer_labels"("p_customer_id" "uuid") RETURNS TABLE("label_id" "uuid", "name" character varying, "color" character varying, "icon" character varying, "assigned_at" timestamp with time zone, "auto_assigned" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cl.id as label_id,
    cl.name,
    cl.color,
    cl.icon,
    cla.assigned_at,
    cla.auto_assigned
  FROM customer_labels cl
  JOIN customer_label_assignments cla ON cl.id = cla.label_id
  WHERE cla.customer_id = p_customer_id
  ORDER BY cl.name;
END;
$$;


ALTER FUNCTION "public"."get_customer_labels"("p_customer_id" "uuid") OWNER TO "postgres";


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



CREATE OR REPLACE FUNCTION "public"."get_invoice_summary_stats"() RETURNS TABLE("total_outstanding" numeric, "total_overdue" numeric, "total_draft" numeric, "total_this_month" numeric, "count_outstanding" integer, "count_overdue" integer, "count_draft" integer)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN i.status IN ('sent', 'partially_paid', 'overdue') 
      THEN i.total_amount - i.paid_amount ELSE 0 END), 0) as total_outstanding,
    COALESCE(SUM(CASE WHEN i.status = 'overdue' 
      THEN i.total_amount - i.paid_amount ELSE 0 END), 0) as total_overdue,
    COALESCE(SUM(CASE WHEN i.status = 'draft' 
      THEN i.total_amount ELSE 0 END), 0) as total_draft,
    COALESCE(SUM(CASE WHEN i.status = 'paid' 
      AND DATE_TRUNC('month', i.invoice_date) = DATE_TRUNC('month', CURRENT_DATE)
      THEN i.total_amount ELSE 0 END), 0) as total_this_month,
    COUNT(CASE WHEN i.status IN ('sent', 'partially_paid', 'overdue') THEN 1 END)::INTEGER as count_outstanding,
    COUNT(CASE WHEN i.status = 'overdue' THEN 1 END)::INTEGER as count_overdue,
    COUNT(CASE WHEN i.status = 'draft' THEN 1 END)::INTEGER as count_draft
  FROM invoices i
  WHERE i.deleted_at IS NULL;
END;
$$;


ALTER FUNCTION "public"."get_invoice_summary_stats"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."get_short_link_analytics"("p_short_code" character varying, "p_days" integer DEFAULT 30) RETURNS TABLE("click_date" "date", "total_clicks" bigint, "unique_visitors" bigint, "mobile_clicks" bigint, "desktop_clicks" bigint, "tablet_clicks" bigint, "top_countries" "jsonb", "top_browsers" "jsonb", "top_referrers" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."get_short_link_analytics"("p_short_code" character varying, "p_days" integer) OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."get_vendor_invoice_email"("p_vendor_id" "uuid") RETURNS character varying
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_email VARCHAR(255);
BEGIN
  -- First check for invoice-specific email
  SELECT invoice_email INTO v_email
  FROM vendors
  WHERE id = p_vendor_id
  AND invoice_email IS NOT NULL;
  
  IF v_email IS NOT NULL THEN
    RETURN v_email;
  END IF;
  
  -- Then check for primary contact who receives invoices
  SELECT email INTO v_email
  FROM vendor_contacts
  WHERE vendor_id = p_vendor_id
  AND receives_invoices = true
  AND is_primary = true
  LIMIT 1;
  
  IF v_email IS NOT NULL THEN
    RETURN v_email;
  END IF;
  
  -- Then any contact who receives invoices
  SELECT email INTO v_email
  FROM vendor_contacts
  WHERE vendor_id = p_vendor_id
  AND receives_invoices = true
  LIMIT 1;
  
  IF v_email IS NOT NULL THEN
    RETURN v_email;
  END IF;
  
  -- Finally fall back to main vendor email
  SELECT email INTO v_email
  FROM vendors
  WHERE id = p_vendor_id;
  
  RETURN v_email;
END;
$$;


ALTER FUNCTION "public"."get_vendor_invoice_email"("p_vendor_id" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."is_super_admin"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id
        AND r.name = 'super_admin'
    );
END;
$$;


ALTER FUNCTION "public"."is_super_admin"("p_user_id" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."log_invoice_audit"("p_invoice_id" "uuid", "p_action" character varying, "p_details" "jsonb" DEFAULT '{}'::"jsonb", "p_old_values" "jsonb" DEFAULT NULL::"jsonb", "p_new_values" "jsonb" DEFAULT NULL::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO invoice_audit (
    invoice_id,
    action,
    performed_by,
    performed_by_email,
    details,
    old_values,
    new_values
  ) VALUES (
    p_invoice_id,
    p_action,
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    p_details,
    p_old_values,
    p_new_values
  );
END;
$$;


ALTER FUNCTION "public"."log_invoice_audit"("p_invoice_id" "uuid", "p_action" character varying, "p_details" "jsonb", "p_old_values" "jsonb", "p_new_values" "jsonb") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."process_recurring_invoices"() RETURNS TABLE("recurring_id" "uuid", "invoice_id" "uuid", "status" "text")
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_recurring RECORD;
  v_invoice_id UUID;
BEGIN
  FOR v_recurring IN 
    SELECT id 
    FROM recurring_invoices
    WHERE next_generation_date <= CURRENT_DATE
    AND is_paused = false
    AND (end_date IS NULL OR end_date >= CURRENT_DATE)
  LOOP
    BEGIN
      v_invoice_id := generate_invoice_from_recurring(v_recurring.id);
      RETURN QUERY SELECT v_recurring.id, v_invoice_id, 'success'::TEXT;
    EXCEPTION
      WHEN OTHERS THEN
        RETURN QUERY SELECT v_recurring.id, NULL::UUID, 'failed'::TEXT;
    END;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."process_recurring_invoices"() OWNER TO "postgres";


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



CREATE OR REPLACE FUNCTION "public"."recalculate_invoice_totals"("p_invoice_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_subtotal DECIMAL(10,2);
  v_total_vat DECIMAL(10,2);
  v_discount_amount DECIMAL(10,2);
  v_total DECIMAL(10,2);
BEGIN
  -- Calculate totals from line items
  SELECT 
    COALESCE(SUM(final_net_amount), 0),
    COALESCE(SUM(final_vat_amount), 0)
  INTO v_subtotal, v_total_vat
  FROM invoice_line_items
  WHERE invoice_id = p_invoice_id;
  
  -- Get invoice discount
  SELECT 
    CASE 
      WHEN discount_type = 'percent' AND discount_value IS NOT NULL
      THEN ROUND((v_subtotal + v_total_vat) * discount_value / 100, 2)
      WHEN discount_type = 'amount' AND discount_value IS NOT NULL
      THEN discount_value
      ELSE 0
    END
  INTO v_discount_amount
  FROM invoices
  WHERE id = p_invoice_id;
  
  -- Calculate final total
  v_total := v_subtotal + v_total_vat - v_discount_amount;
  
  -- Update invoice
  UPDATE invoices
  SET 
    subtotal = v_subtotal,
    total_vat = v_total_vat,
    total_amount = v_total
  WHERE id = p_invoice_id;
END;
$$;


ALTER FUNCTION "public"."recalculate_invoice_totals"("p_invoice_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalculate_quote_totals"("p_quote_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_subtotal DECIMAL(10,2);
  v_discount_amount DECIMAL(10,2);
  v_total DECIMAL(10,2);
BEGIN
  -- Calculate subtotal from line items
  SELECT COALESCE(SUM(final_amount), 0)
  INTO v_subtotal
  FROM quote_line_items
  WHERE quote_id = p_quote_id;
  
  -- Get quote discount
  SELECT 
    CASE 
      WHEN discount_type = 'percent' AND discount_value IS NOT NULL
      THEN ROUND(v_subtotal * discount_value / 100, 2)
      WHEN discount_type = 'amount' AND discount_value IS NOT NULL
      THEN discount_value
      ELSE 0
    END
  INTO v_discount_amount
  FROM quotes
  WHERE id = p_quote_id;
  
  -- Calculate final total
  v_total := v_subtotal - v_discount_amount;
  
  -- Update quote
  UPDATE quotes
  SET 
    subtotal = v_subtotal,
    total_amount = v_total
  WHERE id = p_quote_id;
END;
$$;


ALTER FUNCTION "public"."recalculate_quote_totals"("p_quote_id" "uuid") OWNER TO "postgres";


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



CREATE OR REPLACE FUNCTION "public"."set_booking_reference"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.booking_reference IS NULL THEN
    NEW.booking_reference := generate_booking_reference();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_booking_reference"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_loyalty_access_token"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.access_token IS NULL THEN
    NEW.access_token := generate_loyalty_access_token();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_loyalty_access_token"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."trigger_log_invoice_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Log status changes
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      PERFORM log_invoice_audit(
        NEW.id,
        'status_changed',
        jsonb_build_object(
          'old_status', OLD.status,
          'new_status', NEW.status
        )
      );
    END IF;
    
    -- Log void/writeoff
    IF NEW.void_date IS NOT NULL AND OLD.void_date IS NULL THEN
      PERFORM log_invoice_audit(
        NEW.id,
        'invoice_voided',
        jsonb_build_object(
          'reason', NEW.void_reason,
          'voided_by', NEW.void_by
        )
      );
    END IF;
    
    IF NEW.writeoff_date IS NOT NULL AND OLD.writeoff_date IS NULL THEN
      PERFORM log_invoice_audit(
        NEW.id,
        'invoice_written_off',
        jsonb_build_object(
          'reason', NEW.writeoff_reason,
          'written_off_by', NEW.writeoff_by
        )
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_log_invoice_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_recalculate_invoice_totals"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalculate_invoice_totals(OLD.invoice_id);
  ELSE
    PERFORM recalculate_invoice_totals(NEW.invoice_id);
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."trigger_recalculate_invoice_totals"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_recalculate_quote_totals"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalculate_quote_totals(OLD.quote_id);
  ELSE
    PERFORM recalculate_quote_totals(NEW.quote_id);
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."trigger_recalculate_quote_totals"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_update_invoice_payment_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM update_invoice_payment_status(OLD.invoice_id);
  ELSE
    PERFORM update_invoice_payment_status(NEW.invoice_id);
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."trigger_update_invoice_payment_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_customer_booking_stats"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."update_customer_booking_stats"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."update_invoice_payment_status"("p_invoice_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_total_paid DECIMAL(10,2);
  v_total_amount DECIMAL(10,2);
  v_due_date DATE;
  v_new_status VARCHAR(20);
BEGIN
  -- Get total paid
  SELECT COALESCE(SUM(amount), 0)
  INTO v_total_paid
  FROM invoice_payments
  WHERE invoice_id = p_invoice_id;
  
  -- Get invoice total and due date
  SELECT total_amount, due_date
  INTO v_total_amount, v_due_date
  FROM invoices
  WHERE id = p_invoice_id;
  
  -- Determine new status
  IF v_total_paid >= v_total_amount THEN
    v_new_status := 'paid';
  ELSIF v_total_paid > 0 THEN
    v_new_status := 'partially_paid';
  ELSIF v_due_date < CURRENT_DATE THEN
    v_new_status := 'overdue';
  ELSE
    -- Keep current status if no payment and not overdue
    SELECT status INTO v_new_status
    FROM invoices
    WHERE id = p_invoice_id;
  END IF;
  
  -- Update invoice
  UPDATE invoices
  SET 
    paid_amount = v_total_paid,
    status = CASE 
      WHEN status IN ('void', 'written_off') THEN status -- Don't change these statuses
      ELSE v_new_status
    END
  WHERE id = p_invoice_id;
END;
$$;


ALTER FUNCTION "public"."update_invoice_payment_status"("p_invoice_id" "uuid") OWNER TO "postgres";


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
    -- First check if user is a superadmin
    IF EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id
        AND r.name = 'super_admin'
    ) THEN
        RETURN true;
    END IF;
    
    -- Otherwise check specific permissions
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


CREATE OR REPLACE FUNCTION "public"."validate_booking_against_policy"("p_booking_type" "public"."table_booking_type", "p_booking_date" "date", "p_booking_time" time without time zone, "p_party_size" integer) RETURNS TABLE("is_valid" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."validate_booking_against_policy"("p_booking_type" "public"."table_booking_type", "p_booking_date" "date", "p_booking_time" time without time zone, "p_party_size" integer) OWNER TO "postgres";


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

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."achievement_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid",
    "achievement_id" "uuid",
    "progress" "jsonb" DEFAULT '{}'::"jsonb",
    "current_value" integer DEFAULT 0,
    "target_value" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."achievement_progress" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."admin_users_view" AS
 SELECT "u"."id",
    "u"."email",
    "u"."created_at",
    "u"."last_sign_in_at"
   FROM "auth"."users" "u";


ALTER TABLE "public"."admin_users_view" OWNER TO "postgres";


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



CREATE TABLE IF NOT EXISTS "public"."booking_audit" (
    "id" bigint NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "event" character varying(50) NOT NULL,
    "old_status" character varying(50),
    "new_status" character varying(50),
    "meta" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."booking_audit" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."booking_audit_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE "public"."booking_audit_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."booking_audit_id_seq" OWNED BY "public"."booking_audit"."id";



CREATE TABLE IF NOT EXISTS "public"."booking_policies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_type" "public"."table_booking_type" NOT NULL,
    "full_refund_hours" integer DEFAULT 48 NOT NULL,
    "partial_refund_hours" integer DEFAULT 24 NOT NULL,
    "partial_refund_percentage" integer DEFAULT 50 NOT NULL,
    "modification_allowed" boolean DEFAULT true,
    "cancellation_fee" numeric(10,2) DEFAULT 0,
    "max_party_size" integer DEFAULT 20,
    "min_advance_hours" integer DEFAULT 0,
    "max_advance_days" integer DEFAULT 56,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."booking_policies" OWNER TO "postgres";


COMMENT ON COLUMN "public"."booking_policies"."min_advance_hours" IS 'Minimum hours in advance a booking must be made (0 = immediate bookings allowed)';



CREATE SEQUENCE IF NOT EXISTS "public"."booking_reference_seq"
    START WITH 1000
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE "public"."booking_reference_seq" OWNER TO "postgres";


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



CREATE TABLE IF NOT EXISTS "public"."booking_time_slots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "day_of_week" integer NOT NULL,
    "slot_time" time without time zone NOT NULL,
    "duration_minutes" integer DEFAULT 120,
    "max_covers" integer NOT NULL,
    "booking_type" "public"."table_booking_type",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "booking_time_slots_day_of_week_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6)))
);


ALTER TABLE "public"."booking_time_slots" OWNER TO "postgres";


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
    "is_kitchen_closed" boolean DEFAULT false,
    CONSTRAINT "business_hours_day_of_week_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6))),
    CONSTRAINT "check_kitchen_closed_consistency" CHECK (((("is_kitchen_closed" = true) AND ("kitchen_opens" IS NULL) AND ("kitchen_closes" IS NULL)) OR ("is_kitchen_closed" = false)))
);


ALTER TABLE "public"."business_hours" OWNER TO "postgres";


COMMENT ON COLUMN "public"."business_hours"."is_kitchen_closed" IS 'Explicitly marks if kitchen is closed on this day even if restaurant is open';



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
    "pricing_model" "text" DEFAULT 'per_head'::"text",
    CONSTRAINT "catering_packages_package_type_check" CHECK (("package_type" = ANY (ARRAY['buffet'::"text", 'sit-down'::"text", 'canapes'::"text", 'drinks'::"text", 'pizza'::"text", 'other'::"text"]))),
    CONSTRAINT "catering_packages_pricing_model_check" CHECK (("pricing_model" = ANY (ARRAY['per_head'::"text", 'total_value'::"text"])))
);


ALTER TABLE "public"."catering_packages" OWNER TO "postgres";


COMMENT ON TABLE "public"."catering_packages" IS 'Pre-configured catering options with per-head pricing';



COMMENT ON COLUMN "public"."catering_packages"."cost_per_head" IS 'Per-head cost when pricing_model=per_head, or total fixed price when pricing_model=total_value';



COMMENT ON COLUMN "public"."catering_packages"."pricing_model" IS 'Pricing model: per_head = price per guest, total_value = fixed total price';



CREATE TABLE IF NOT EXISTS "public"."customer_achievements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid",
    "achievement_id" "uuid",
    "earned_date" timestamp with time zone DEFAULT "now"(),
    "points_awarded" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."customer_achievements" OWNER TO "postgres";


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



CREATE TABLE IF NOT EXISTS "public"."customer_challenges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid",
    "challenge_id" "uuid",
    "progress" "jsonb" DEFAULT '{}'::"jsonb",
    "completed_count" integer DEFAULT 0,
    "last_completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."customer_challenges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_label_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "label_id" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"(),
    "assigned_by" "uuid",
    "auto_assigned" boolean DEFAULT false,
    "notes" "text"
);


ALTER TABLE "public"."customer_label_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_labels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" "text",
    "color" character varying(7) DEFAULT '#6B7280'::character varying,
    "icon" character varying(50),
    "auto_apply_rules" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."customer_labels" OWNER TO "postgres";


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
    "table_booking_count" integer DEFAULT 0,
    "no_show_count" integer DEFAULT 0,
    "last_table_booking_date" "date",
    "email" character varying(255),
    "mobile_e164" character varying(20),
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
    "priority" "text" DEFAULT 'Other'::"text",
    CONSTRAINT "chk_emergency_phone_format" CHECK ((("phone_number" IS NULL) OR ("phone_number" ~* '^(\+?44|0)?[0-9]{10,11}$'::"text"))),
    CONSTRAINT "employee_emergency_contacts_priority_check" CHECK (("priority" = ANY (ARRAY['Primary'::"text", 'Secondary'::"text", 'Other'::"text"])))
);


ALTER TABLE "public"."employee_emergency_contacts" OWNER TO "postgres";


COMMENT ON COLUMN "public"."employee_emergency_contacts"."priority" IS 'Contact priority: Primary, Secondary, or Other';



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


CREATE TABLE IF NOT EXISTS "public"."employee_onboarding_checklist" (
    "employee_id" "uuid" NOT NULL,
    "wheniwork_invite_sent" boolean DEFAULT false,
    "wheniwork_invite_date" "date",
    "private_whatsapp_added" boolean DEFAULT false,
    "private_whatsapp_date" "date",
    "team_whatsapp_added" boolean DEFAULT false,
    "team_whatsapp_date" "date",
    "till_system_setup" boolean DEFAULT false,
    "till_system_date" "date",
    "training_flow_setup" boolean DEFAULT false,
    "training_flow_date" "date",
    "employment_agreement_drafted" boolean DEFAULT false,
    "employment_agreement_date" "date",
    "employee_agreement_accepted" boolean DEFAULT false,
    "employee_agreement_accepted_date" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."employee_onboarding_checklist" OWNER TO "postgres";


COMMENT ON TABLE "public"."employee_onboarding_checklist" IS 'Tracks completion of employee onboarding tasks';



COMMENT ON COLUMN "public"."employee_onboarding_checklist"."wheniwork_invite_sent" IS 'Whether WhenIWork scheduling app invite has been sent';



COMMENT ON COLUMN "public"."employee_onboarding_checklist"."wheniwork_invite_date" IS 'Date WhenIWork invite was sent';



COMMENT ON COLUMN "public"."employee_onboarding_checklist"."private_whatsapp_added" IS 'Whether employee added to private WhatsApp group';



COMMENT ON COLUMN "public"."employee_onboarding_checklist"."private_whatsapp_date" IS 'Date added to private WhatsApp';



COMMENT ON COLUMN "public"."employee_onboarding_checklist"."team_whatsapp_added" IS 'Whether employee added to team WhatsApp group';



COMMENT ON COLUMN "public"."employee_onboarding_checklist"."team_whatsapp_date" IS 'Date added to team WhatsApp';



COMMENT ON COLUMN "public"."employee_onboarding_checklist"."till_system_setup" IS 'Whether employee has been set up on till system';



COMMENT ON COLUMN "public"."employee_onboarding_checklist"."till_system_date" IS 'Date set up on till system';



COMMENT ON COLUMN "public"."employee_onboarding_checklist"."training_flow_setup" IS 'Whether training has been set up in Flow system';



COMMENT ON COLUMN "public"."employee_onboarding_checklist"."training_flow_date" IS 'Date training was set up';



COMMENT ON COLUMN "public"."employee_onboarding_checklist"."employment_agreement_drafted" IS 'Whether employment agreement has been drafted';



COMMENT ON COLUMN "public"."employee_onboarding_checklist"."employment_agreement_date" IS 'Date employment agreement was drafted';



COMMENT ON COLUMN "public"."employee_onboarding_checklist"."employee_agreement_accepted" IS 'Whether employee has accepted the agreement';



COMMENT ON COLUMN "public"."employee_onboarding_checklist"."employee_agreement_accepted_date" IS 'Timestamp when employee accepted the agreement';



CREATE TABLE IF NOT EXISTS "public"."employee_right_to_work" (
    "employee_id" "uuid" NOT NULL,
    "document_type" "text" NOT NULL,
    "document_details" "text",
    "verification_date" "date" NOT NULL,
    "document_expiry_date" "date",
    "follow_up_date" "date",
    "verified_by_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "photo_storage_path" "text",
    CONSTRAINT "employee_right_to_work_document_type_check" CHECK (("document_type" = ANY (ARRAY['List A'::"text", 'List B'::"text"])))
);


ALTER TABLE "public"."employee_right_to_work" OWNER TO "postgres";


COMMENT ON TABLE "public"."employee_right_to_work" IS 'UK right to work documentation verification tracking';



COMMENT ON COLUMN "public"."employee_right_to_work"."document_type" IS 'List A (permanent right) or List B (temporary right)';



COMMENT ON COLUMN "public"."employee_right_to_work"."document_details" IS 'Specific document type details (e.g., "British Passport", "Biometric Residence Permit")';



COMMENT ON COLUMN "public"."employee_right_to_work"."verification_date" IS 'Date the documents were verified';



COMMENT ON COLUMN "public"."employee_right_to_work"."document_expiry_date" IS 'Expiry date of the document (if applicable)';



COMMENT ON COLUMN "public"."employee_right_to_work"."follow_up_date" IS 'Date for next verification check (for temporary rights)';



COMMENT ON COLUMN "public"."employee_right_to_work"."verified_by_user_id" IS 'User who performed the verification';



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
    "post_code" "text",
    "mobile_number" "text",
    "uniform_preference" "text",
    "keyholder_status" boolean DEFAULT false,
    "first_shift_date" "date",
    CONSTRAINT "chk_date_of_birth" CHECK ((("date_of_birth" IS NULL) OR (("date_of_birth" > '1900-01-01'::"date") AND ("date_of_birth" < CURRENT_DATE)))),
    CONSTRAINT "chk_email_length" CHECK ((("email_address" IS NULL) OR ("length"("email_address") <= 255))),
    CONSTRAINT "chk_employee_email_format" CHECK ((("email_address" IS NULL) OR ("email_address" ~* '^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::"text"))),
    CONSTRAINT "chk_employee_name_length" CHECK ((("length"("first_name") <= 100) AND ("length"("last_name") <= 100) AND (("job_title" IS NULL) OR ("length"("job_title") <= 100)))),
    CONSTRAINT "chk_employee_phone_format" CHECK ((("phone_number" IS NULL) OR ("phone_number" ~ '^\+[1-9]\d{7,14}$'::"text") OR ("phone_number" ~ '^0[1-9]\d{9,10}$'::"text"))),
    CONSTRAINT "chk_employee_status" CHECK (("status" = ANY (ARRAY['Active'::"text", 'Former'::"text"]))),
    CONSTRAINT "chk_employment_dates" CHECK ((("employment_end_date" IS NULL) OR ("employment_end_date" > "employment_start_date"))),
    CONSTRAINT "employees_mobile_number_check" CHECK ((("mobile_number" IS NULL) OR ("mobile_number" ~ '^(\+44|0)?7\d{9}$'::"text"))),
    CONSTRAINT "employees_status_check" CHECK (("status" = ANY (ARRAY['Active'::"text", 'Former'::"text", 'Prospective'::"text"])))
);


ALTER TABLE "public"."employees" OWNER TO "postgres";


COMMENT ON COLUMN "public"."employees"."status" IS 'Employee status: Active (currently employed), Former (no longer employed), or Prospective (potential future employee)';



COMMENT ON COLUMN "public"."employees"."post_code" IS 'UK post code (separate from address field)';



COMMENT ON COLUMN "public"."employees"."mobile_number" IS 'Mobile phone number (separate from main phone number)';



COMMENT ON COLUMN "public"."employees"."uniform_preference" IS 'Employee uniform or branded t-shirt preference';



COMMENT ON COLUMN "public"."employees"."keyholder_status" IS 'Whether employee has been granted keyholder status';



COMMENT ON COLUMN "public"."employees"."first_shift_date" IS 'Date of employee''s first scheduled shift';



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
    "default_performer_name" character varying(255),
    CONSTRAINT "check_default_event_status" CHECK ((("default_event_status")::"text" = ANY ((ARRAY['scheduled'::character varying, 'cancelled'::character varying, 'postponed'::character varying, 'rescheduled'::character varying])::"text"[]))),
    CONSTRAINT "check_default_performer_type" CHECK (((("default_performer_type")::"text" = ANY ((ARRAY['MusicGroup'::character varying, 'Person'::character varying, 'TheaterGroup'::character varying, 'DanceGroup'::character varying, 'ComedyGroup'::character varying, 'Organization'::character varying])::"text"[])) OR ("default_performer_type" IS NULL)))
);


ALTER TABLE "public"."event_categories" OWNER TO "postgres";


COMMENT ON TABLE "public"."event_categories" IS 'Event categories for organizing different types of events and tracking customer preferences';



COMMENT ON COLUMN "public"."event_categories"."name" IS 'Event category names. Updated 2025-01-19: Split "Drag Cabaret with Nikki Manfadge" into "Nikki''s Games Night" (Wednesdays) and "Nikki''s Karaoke Night" (Fridays)';



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



COMMENT ON COLUMN "public"."event_categories"."default_performer_name" IS 'Default performer name to use when creating events with this category';



CREATE TABLE IF NOT EXISTS "public"."event_check_ins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid",
    "customer_id" "uuid",
    "member_id" "uuid",
    "booking_id" "uuid",
    "check_in_time" timestamp with time zone DEFAULT "now"(),
    "check_in_method" character varying(50) DEFAULT 'qr'::character varying,
    "points_earned" integer DEFAULT 0,
    "staff_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "event_check_ins_check_in_method_check" CHECK ((("check_in_method")::"text" = ANY ((ARRAY['qr'::character varying, 'manual'::character varying, 'auto'::character varying])::"text"[])))
);


ALTER TABLE "public"."event_check_ins" OWNER TO "postgres";


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
    "end_time" time without time zone,
    "event_status" character varying(50) DEFAULT 'scheduled'::character varying,
    "performer_name" character varying(255),
    "performer_type" character varying(50),
    "price" numeric(10,2) DEFAULT 0,
    "is_free" boolean DEFAULT true,
    "booking_url" "text",
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



CREATE TABLE IF NOT EXISTS "public"."idempotency_keys" (
    "key" character varying(255) NOT NULL,
    "request_hash" character varying(64) NOT NULL,
    "response" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '24:00:00'::interval) NOT NULL
);


ALTER TABLE "public"."idempotency_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_id" "uuid",
    "action" character varying(50) NOT NULL,
    "performed_by" "uuid",
    "performed_by_email" character varying(255),
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "old_values" "jsonb",
    "new_values" "jsonb",
    "ip_address" "inet",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."invoice_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_email_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_id" "uuid",
    "quote_id" "uuid",
    "sent_at" timestamp with time zone DEFAULT "now"(),
    "sent_to" character varying(255),
    "sent_by" character varying(255),
    "subject" "text",
    "body" "text",
    "status" character varying(20),
    "error_message" "text",
    "message_id" character varying(255),
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "chk_one_reference" CHECK (((("invoice_id" IS NOT NULL) AND ("quote_id" IS NULL)) OR (("invoice_id" IS NULL) AND ("quote_id" IS NOT NULL)))),
    CONSTRAINT "invoice_email_logs_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['sent'::character varying, 'failed'::character varying, 'bounced'::character varying])::"text"[])))
);


ALTER TABLE "public"."invoice_email_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_email_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_type" character varying(50) NOT NULL,
    "subject_template" "text" NOT NULL,
    "body_template" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."invoice_email_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_emails" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_id" "uuid",
    "email_type" character varying(50) NOT NULL,
    "recipient_email" character varying(255) NOT NULL,
    "cc_emails" "text"[],
    "bcc_emails" "text"[],
    "subject" "text" NOT NULL,
    "body" "text" NOT NULL,
    "attachments" "jsonb" DEFAULT '[]'::"jsonb",
    "message_id" character varying(255),
    "sent_at" timestamp with time zone,
    "error_message" "text",
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "invoice_emails_email_type_check" CHECK ((("email_type")::"text" = ANY ((ARRAY['new_invoice'::character varying, 'reminder'::character varying, 'chase'::character varying, 'credit_note'::character varying, 'statement'::character varying, 'quote'::character varying])::"text"[]))),
    CONSTRAINT "invoice_emails_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'sent'::character varying, 'failed'::character varying])::"text"[])))
);


ALTER TABLE "public"."invoice_emails" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_line_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "catalog_item_id" "uuid",
    "description" "text" NOT NULL,
    "quantity" numeric(10,3) DEFAULT 1,
    "unit_price" numeric(10,2) DEFAULT 0,
    "discount_percentage" numeric(5,2) DEFAULT 0,
    "vat_rate" numeric(5,2) DEFAULT 20,
    "subtotal_amount" numeric(10,2) GENERATED ALWAYS AS (("quantity" * "unit_price")) STORED,
    "discount_amount" numeric(10,2) GENERATED ALWAYS AS (((("quantity" * "unit_price") * "discount_percentage") / (100)::numeric)) STORED,
    "vat_amount" numeric(10,2) GENERATED ALWAYS AS ((((("quantity" * "unit_price") - ((("quantity" * "unit_price") * "discount_percentage") / (100)::numeric)) * "vat_rate") / (100)::numeric)) STORED,
    "total_amount" numeric(10,2) GENERATED ALWAYS AS (((("quantity" * "unit_price") - ((("quantity" * "unit_price") * "discount_percentage") / (100)::numeric)) * ((1)::numeric + ("vat_rate" / (100)::numeric)))) STORED,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."invoice_line_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "payment_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "payment_method" character varying(50),
    "reference" character varying(200),
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "invoice_payments_payment_method_check" CHECK ((("payment_method")::"text" = ANY ((ARRAY['bank_transfer'::character varying, 'cash'::character varying, 'cheque'::character varying, 'card'::character varying, 'other'::character varying])::"text"[])))
);


ALTER TABLE "public"."invoice_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_reminder_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "enabled" boolean DEFAULT true,
    "reminder_email" character varying(255) DEFAULT 'peter@orangejelly.co.uk'::character varying,
    "days_before_due" integer[] DEFAULT ARRAY[7, 3, 1],
    "days_after_due" integer[] DEFAULT ARRAY[1, 7, 14, 30],
    "reminder_time" time without time zone DEFAULT '09:00:00'::time without time zone,
    "exclude_vendors" "uuid"[] DEFAULT '{}'::"uuid"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."invoice_reminder_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_series" (
    "series_code" character varying(10) NOT NULL,
    "current_sequence" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."invoice_series" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_vendors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(200) NOT NULL,
    "contact_name" character varying(200),
    "email" character varying(255),
    "phone" character varying(50),
    "address" "text",
    "vat_number" character varying(50),
    "payment_terms" integer DEFAULT 30,
    "notes" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."invoice_vendors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_number" character varying(50) NOT NULL,
    "vendor_id" "uuid",
    "invoice_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "due_date" "date" NOT NULL,
    "reference" character varying(200),
    "status" character varying(20) DEFAULT 'draft'::character varying,
    "invoice_discount_percentage" numeric(5,2) DEFAULT 0,
    "subtotal_amount" numeric(10,2) DEFAULT 0,
    "discount_amount" numeric(10,2) DEFAULT 0,
    "vat_amount" numeric(10,2) DEFAULT 0,
    "total_amount" numeric(10,2) DEFAULT 0,
    "paid_amount" numeric(10,2) DEFAULT 0,
    "notes" "text",
    "internal_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    CONSTRAINT "invoices_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['draft'::character varying, 'sent'::character varying, 'paid'::character varying, 'partially_paid'::character varying, 'overdue'::character varying, 'void'::character varying, 'written_off'::character varying])::"text"[])))
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" character varying(50) NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "attempts" integer DEFAULT 0,
    "max_attempts" integer DEFAULT 3,
    "scheduled_for" timestamp with time zone DEFAULT "now"(),
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "error_message" "text",
    "result" "jsonb",
    "priority" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "jobs_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying, 'cancelled'::character varying])::"text"[])))
);


ALTER TABLE "public"."jobs" OWNER TO "postgres";


COMMENT ON TABLE "public"."jobs" IS 'Unified job queue table for all background processing';



COMMENT ON COLUMN "public"."jobs"."type" IS 'Job type identifier (e.g., send_sms, process_booking, generate_report)';



COMMENT ON COLUMN "public"."jobs"."payload" IS 'Job data as JSONB';



COMMENT ON COLUMN "public"."jobs"."status" IS 'Current job status';



COMMENT ON COLUMN "public"."jobs"."result" IS 'Job execution result data';



COMMENT ON COLUMN "public"."jobs"."priority" IS 'Job priority (higher number = higher priority)';



CREATE TABLE IF NOT EXISTS "public"."line_item_catalog" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(200) NOT NULL,
    "description" "text",
    "default_price" numeric(10,2) DEFAULT 0,
    "default_vat_rate" numeric(5,2) DEFAULT 20,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."line_item_catalog" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_achievements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "program_id" "uuid",
    "name" character varying(255) NOT NULL,
    "description" "text",
    "icon" character varying(10),
    "points_value" integer DEFAULT 0,
    "criteria" "jsonb" NOT NULL,
    "category" character varying(50),
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."loyalty_achievements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "program_id" "uuid",
    "name" character varying(255) NOT NULL,
    "description" "text",
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "bonus_type" character varying(50) NOT NULL,
    "bonus_value" numeric(10,2) NOT NULL,
    "criteria" "jsonb" DEFAULT '{}'::"jsonb",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."loyalty_campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_challenges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "program_id" "uuid",
    "name" character varying(255) NOT NULL,
    "description" "text",
    "icon" character varying(10),
    "points_value" integer DEFAULT 0,
    "criteria" "jsonb" NOT NULL,
    "category" character varying(50),
    "start_date" timestamp with time zone NOT NULL,
    "end_date" timestamp with time zone NOT NULL,
    "max_completions" integer DEFAULT 1,
    "sort_order" integer DEFAULT 0,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."loyalty_challenges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid",
    "program_id" "uuid",
    "tier_id" "uuid",
    "total_points" integer DEFAULT 0,
    "available_points" integer DEFAULT 0,
    "lifetime_points" integer DEFAULT 0,
    "lifetime_events" integer DEFAULT 0,
    "join_date" "date" DEFAULT CURRENT_DATE,
    "last_visit_date" "date",
    "status" character varying(50) DEFAULT 'active'::character varying,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "access_token" character varying(255),
    CONSTRAINT "loyalty_members_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'inactive'::character varying])::"text"[])))
);


ALTER TABLE "public"."loyalty_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_point_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid",
    "points" integer NOT NULL,
    "transaction_type" character varying(50) NOT NULL,
    "description" "text",
    "reference_type" character varying(50),
    "reference_id" "uuid",
    "balance_after" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid"
);


ALTER TABLE "public"."loyalty_point_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_programs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "active" boolean DEFAULT true,
    "settings" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."loyalty_programs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_rewards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "program_id" "uuid",
    "name" character varying(255) NOT NULL,
    "description" "text",
    "points_cost" integer NOT NULL,
    "tier_required" "uuid",
    "category" character varying(50),
    "icon" character varying(10),
    "inventory" integer,
    "daily_limit" integer,
    "active" boolean DEFAULT true,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."loyalty_rewards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_tiers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "program_id" "uuid",
    "name" character varying(100) NOT NULL,
    "level" integer NOT NULL,
    "min_events" integer DEFAULT 0,
    "point_multiplier" numeric(3,2) DEFAULT 1.0,
    "color" character varying(7),
    "icon" character varying(10),
    "benefits" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."loyalty_tiers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."menu_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "section_id" "uuid" NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" "text",
    "price" numeric(10,2) NOT NULL,
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


CREATE TABLE IF NOT EXISTS "public"."pending_bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "mobile_number" character varying(20) NOT NULL,
    "customer_id" "uuid",
    "seats" integer,
    "expires_at" timestamp with time zone NOT NULL,
    "confirmed_at" timestamp with time zone,
    "booking_id" "uuid",
    "initiated_by_api_key" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb"
);


ALTER TABLE "public"."pending_bookings" OWNER TO "postgres";


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



CREATE TABLE IF NOT EXISTS "public"."quote_line_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quote_id" "uuid" NOT NULL,
    "catalog_item_id" "uuid",
    "description" "text" NOT NULL,
    "quantity" numeric(10,3) DEFAULT 1,
    "unit_price" numeric(10,2) DEFAULT 0,
    "discount_percentage" numeric(5,2) DEFAULT 0,
    "vat_rate" numeric(5,2) DEFAULT 20,
    "subtotal_amount" numeric(10,2) GENERATED ALWAYS AS (("quantity" * "unit_price")) STORED,
    "discount_amount" numeric(10,2) GENERATED ALWAYS AS (((("quantity" * "unit_price") * "discount_percentage") / (100)::numeric)) STORED,
    "vat_amount" numeric(10,2) GENERATED ALWAYS AS ((((("quantity" * "unit_price") - ((("quantity" * "unit_price") * "discount_percentage") / (100)::numeric)) * "vat_rate") / (100)::numeric)) STORED,
    "total_amount" numeric(10,2) GENERATED ALWAYS AS (((("quantity" * "unit_price") - ((("quantity" * "unit_price") * "discount_percentage") / (100)::numeric)) * ((1)::numeric + ("vat_rate" / (100)::numeric)))) STORED,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."quote_line_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quotes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quote_number" character varying(50) NOT NULL,
    "vendor_id" "uuid",
    "quote_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "valid_until" "date" NOT NULL,
    "reference" character varying(200),
    "status" character varying(20) DEFAULT 'draft'::character varying,
    "quote_discount_percentage" numeric(5,2) DEFAULT 0,
    "subtotal_amount" numeric(10,2) DEFAULT 0,
    "discount_amount" numeric(10,2) DEFAULT 0,
    "vat_amount" numeric(10,2) DEFAULT 0,
    "total_amount" numeric(10,2) DEFAULT 0,
    "notes" "text",
    "internal_notes" "text",
    "converted_to_invoice_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "quotes_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['draft'::character varying, 'sent'::character varying, 'accepted'::character varying, 'rejected'::character varying, 'expired'::character varying])::"text"[])))
);


ALTER TABLE "public"."quotes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rate_limits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" character varying(255) NOT NULL,
    "requests" "jsonb" DEFAULT '[]'::"jsonb",
    "window_ms" integer NOT NULL,
    "max_requests" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."rate_limits" OWNER TO "postgres";


COMMENT ON TABLE "public"."rate_limits" IS 'Stores rate limiting data for API endpoints';



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


CREATE TABLE IF NOT EXISTS "public"."recurring_invoice_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recurring_invoice_id" "uuid",
    "invoice_id" "uuid",
    "generation_date" timestamp with time zone DEFAULT "now"(),
    "status" character varying(20) DEFAULT 'success'::character varying,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."recurring_invoice_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recurring_invoice_line_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recurring_invoice_id" "uuid" NOT NULL,
    "catalog_item_id" "uuid",
    "description" "text" NOT NULL,
    "quantity" numeric(10,3) DEFAULT 1,
    "unit_price" numeric(10,2) DEFAULT 0,
    "discount_percentage" numeric(5,2) DEFAULT 0,
    "vat_rate" numeric(5,2) DEFAULT 20,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."recurring_invoice_line_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recurring_invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendor_id" "uuid",
    "frequency" character varying(20),
    "start_date" "date" NOT NULL,
    "end_date" "date",
    "next_invoice_date" "date" NOT NULL,
    "days_before_due" integer DEFAULT 30,
    "reference" character varying(200),
    "invoice_discount_percentage" numeric(5,2) DEFAULT 0,
    "notes" "text",
    "internal_notes" "text",
    "is_active" boolean DEFAULT true,
    "last_invoice_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "recurring_invoices_frequency_check" CHECK ((("frequency")::"text" = ANY ((ARRAY['weekly'::character varying, 'monthly'::character varying, 'quarterly'::character varying, 'yearly'::character varying])::"text"[])))
);


ALTER TABLE "public"."recurring_invoices" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."reward_redemptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid",
    "reward_id" "uuid",
    "redemption_code" character varying(20),
    "points_spent" integer NOT NULL,
    "generated_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone,
    "redeemed_at" timestamp with time zone,
    "redeemed_by" "uuid",
    "status" character varying(50) DEFAULT 'pending'::character varying,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "reward_redemptions_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'redeemed'::character varying, 'expired'::character varying, 'cancelled'::character varying])::"text"[])))
);


ALTER TABLE "public"."reward_redemptions" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."service_slot_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "day_of_week" integer NOT NULL,
    "slot_type" character varying(50) NOT NULL,
    "starts_at" time without time zone NOT NULL,
    "ends_at" time without time zone NOT NULL,
    "capacity" integer DEFAULT 50 NOT NULL,
    "booking_type" "public"."table_booking_type" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "service_slot_config_day_of_week_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6)))
);


ALTER TABLE "public"."service_slot_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_slot_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "override_date" "date" NOT NULL,
    "reason" character varying(255),
    "is_closed" boolean DEFAULT false,
    "custom_capacity" integer,
    "custom_hours" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."service_slot_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_slots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_date" "date" NOT NULL,
    "starts_at" time without time zone NOT NULL,
    "ends_at" time without time zone NOT NULL,
    "capacity" integer NOT NULL,
    "booking_type" "public"."table_booking_type" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "service_slots_capacity_check" CHECK (("capacity" > 0))
);


ALTER TABLE "public"."service_slots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."short_link_clicks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "short_link_id" "uuid",
    "clicked_at" timestamp with time zone DEFAULT "now"(),
    "user_agent" "text",
    "ip_address" "inet",
    "referrer" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "country" character varying(2),
    "city" character varying(100),
    "region" character varying(100),
    "device_type" character varying(20),
    "browser" character varying(50),
    "os" character varying(50),
    "utm_source" character varying(100),
    "utm_medium" character varying(100),
    "utm_campaign" character varying(100),
    CONSTRAINT "short_link_clicks_device_type_check" CHECK ((("device_type")::"text" = ANY ((ARRAY['mobile'::character varying, 'tablet'::character varying, 'desktop'::character varying, 'bot'::character varying, 'unknown'::character varying])::"text"[])))
);


ALTER TABLE "public"."short_link_clicks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."short_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "short_code" character varying(20) NOT NULL,
    "destination_url" "text" NOT NULL,
    "link_type" character varying(50) NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "expires_at" timestamp with time zone,
    "click_count" integer DEFAULT 0,
    "last_clicked_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "short_links_link_type_check" CHECK ((("link_type")::"text" = ANY ((ARRAY['loyalty_portal'::character varying, 'event_checkin'::character varying, 'promotion'::character varying, 'reward_redemption'::character varying, 'custom'::character varying])::"text"[])))
);


ALTER TABLE "public"."short_links" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."short_link_daily_stats" AS
 SELECT "sl"."id" AS "short_link_id",
    "sl"."short_code",
    "sl"."link_type",
    ("slc"."clicked_at")::"date" AS "click_date",
    "count"(*) AS "total_clicks",
    "count"(DISTINCT "slc"."ip_address") AS "unique_visitors",
    "count"(
        CASE
            WHEN (("slc"."device_type")::"text" = 'mobile'::"text") THEN 1
            ELSE NULL::integer
        END) AS "mobile_clicks",
    "count"(
        CASE
            WHEN (("slc"."device_type")::"text" = 'desktop'::"text") THEN 1
            ELSE NULL::integer
        END) AS "desktop_clicks",
    "count"(
        CASE
            WHEN (("slc"."device_type")::"text" = 'tablet'::"text") THEN 1
            ELSE NULL::integer
        END) AS "tablet_clicks"
   FROM ("public"."short_links" "sl"
     LEFT JOIN "public"."short_link_clicks" "slc" ON (("sl"."id" = "slc"."short_link_id")))
  WHERE ("slc"."clicked_at" IS NOT NULL)
  GROUP BY "sl"."id", "sl"."short_code", "sl"."link_type", (("slc"."clicked_at")::"date");


ALTER TABLE "public"."short_link_daily_stats" OWNER TO "postgres";


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
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_kitchen_closed" boolean DEFAULT false,
    CONSTRAINT "check_kitchen_closed_consistency" CHECK (((("is_kitchen_closed" = true) AND ("kitchen_opens" IS NULL) AND ("kitchen_closes" IS NULL)) OR ("is_kitchen_closed" = false)))
);


ALTER TABLE "public"."special_hours" OWNER TO "postgres";


COMMENT ON COLUMN "public"."special_hours"."is_kitchen_closed" IS 'Indicates if the kitchen is closed while the venue remains open';



CREATE TABLE IF NOT EXISTS "public"."sunday_lunch_menu_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" "text",
    "price" numeric(10,2) NOT NULL,
    "category" character varying(50) NOT NULL,
    "is_active" boolean DEFAULT true,
    "display_order" integer DEFAULT 0 NOT NULL,
    "allergens" "text"[] DEFAULT '{}'::"text"[],
    "dietary_info" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "sunday_lunch_menu_items_category_check" CHECK ((("category")::"text" = ANY ((ARRAY['main'::character varying, 'side'::character varying])::"text"[])))
);


ALTER TABLE "public"."sunday_lunch_menu_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sunday_lunch_menu_items"."price" IS 'Price for the item. Sides included with mains should be 0, extra sides should have a price';



CREATE TABLE IF NOT EXISTS "public"."system_settings" (
    "key" character varying(100) NOT NULL,
    "value" "jsonb" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."system_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."table_booking_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "menu_item_id" "uuid",
    "custom_item_name" character varying(255),
    "quantity" integer DEFAULT 1 NOT NULL,
    "special_requests" "text",
    "price_at_booking" numeric(10,2) NOT NULL,
    "guest_name" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "item_type" "public"."booking_item_type" DEFAULT 'main'::"public"."booking_item_type" NOT NULL,
    CONSTRAINT "item_name_required" CHECK ((("menu_item_id" IS NOT NULL) OR ("custom_item_name" IS NOT NULL))),
    CONSTRAINT "table_booking_items_quantity_check" CHECK (("quantity" > 0))
);


ALTER TABLE "public"."table_booking_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."table_booking_modifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "modified_by" "uuid",
    "modification_type" character varying(50) NOT NULL,
    "old_values" "jsonb",
    "new_values" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."table_booking_modifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."table_booking_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "payment_method" character varying(20) DEFAULT 'paypal'::character varying NOT NULL,
    "transaction_id" character varying(255),
    "amount" numeric(10,2) NOT NULL,
    "currency" character varying(3) DEFAULT 'GBP'::character varying,
    "status" "public"."payment_status" DEFAULT 'pending'::"public"."payment_status" NOT NULL,
    "refund_amount" numeric(10,2),
    "refund_transaction_id" character varying(255),
    "payment_metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "paid_at" timestamp with time zone,
    "refunded_at" timestamp with time zone
);


ALTER TABLE "public"."table_booking_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."table_booking_reminder_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "reminder_type" character varying(50) NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"(),
    "status" character varying(20) NOT NULL,
    "error_message" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."table_booking_reminder_history" OWNER TO "postgres";


COMMENT ON TABLE "public"."table_booking_reminder_history" IS 'History of reminders sent for table bookings';



CREATE TABLE IF NOT EXISTS "public"."table_booking_sms_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_key" character varying(100) NOT NULL,
    "booking_type" "public"."table_booking_type",
    "template_text" "text" NOT NULL,
    "variables" "text"[],
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."table_booking_sms_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."table_bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_reference" character varying(20) NOT NULL,
    "customer_id" "uuid",
    "booking_date" "date" NOT NULL,
    "booking_time" time without time zone NOT NULL,
    "party_size" integer NOT NULL,
    "tables_assigned" "jsonb",
    "booking_type" "public"."table_booking_type" NOT NULL,
    "status" "public"."table_booking_status" DEFAULT 'pending_payment'::"public"."table_booking_status" NOT NULL,
    "duration_minutes" integer DEFAULT 120,
    "special_requirements" "text",
    "dietary_requirements" "text"[],
    "allergies" "text"[],
    "celebration_type" character varying(50),
    "internal_notes" "text",
    "source" character varying(20) DEFAULT 'website'::character varying,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "confirmed_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "cancellation_reason" "text",
    "completed_at" timestamp with time zone,
    "no_show_at" timestamp with time zone,
    "modification_count" integer DEFAULT 0,
    "original_booking_data" "jsonb",
    "email_verification_token" "uuid",
    "email_verified_at" timestamp with time zone,
    "reminder_sent" boolean DEFAULT false,
    "correlation_id" "uuid" DEFAULT "gen_random_uuid"(),
    CONSTRAINT "table_bookings_party_size_check" CHECK (("party_size" > 0))
);


ALTER TABLE "public"."table_bookings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."table_bookings"."reminder_sent" IS 'Whether a reminder has been sent for this booking';



CREATE TABLE IF NOT EXISTS "public"."table_combination_tables" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "combination_id" "uuid" NOT NULL,
    "table_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."table_combination_tables" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."table_combinations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(100),
    "table_ids" "uuid"[] NOT NULL,
    "total_capacity" integer NOT NULL,
    "preferred_for_size" integer[],
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."table_combinations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."table_configuration" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "table_number" character varying(10) NOT NULL,
    "capacity" integer NOT NULL,
    "is_active" boolean DEFAULT true,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "table_configuration_capacity_check" CHECK (("capacity" > 0))
);


ALTER TABLE "public"."table_configuration" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tables" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "table_number" character varying(10) NOT NULL,
    "capacity" integer NOT NULL,
    "is_active" boolean DEFAULT true,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "tables_capacity_check" CHECK (("capacity" > 0))
);


ALTER TABLE "public"."tables" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "user_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"(),
    "assigned_by" "uuid"
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendor_id" "uuid",
    "name" character varying(255) NOT NULL,
    "role" character varying(100),
    "email" character varying(255),
    "phone" character varying(50),
    "is_primary" boolean DEFAULT false,
    "receives_invoices" boolean DEFAULT false,
    "receives_statements" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."vendor_contacts" OWNER TO "postgres";


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
    "invoice_email" character varying(255),
    "invoice_contact_name" character varying(255),
    "payment_terms" integer DEFAULT 30,
    "purchase_order_required" boolean DEFAULT false,
    "tax_exempt" boolean DEFAULT false,
    "tax_exempt_number" character varying(50),
    "preferred_delivery_method" character varying(20) DEFAULT 'email'::character varying,
    "credit_limit" numeric(10,2),
    "invoice_categories" "text"[] DEFAULT '{}'::"text"[],
    CONSTRAINT "chk_vendor_email" CHECK ((("contact_email" IS NULL) OR ("contact_email" ~* '^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::"text"))),
    CONSTRAINT "chk_vendor_phone" CHECK ((("contact_phone" IS NULL) OR ("contact_phone" ~* '^(\+?44|0)?[0-9]{10,11}$'::"text"))),
    CONSTRAINT "vendors_preferred_delivery_method_check" CHECK ((("preferred_delivery_method")::"text" = ANY ((ARRAY['email'::character varying, 'print'::character varying])::"text"[]))),
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


ALTER TABLE ONLY "public"."booking_audit" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."booking_audit_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."achievement_progress"
    ADD CONSTRAINT "achievement_progress_member_id_achievement_id_key" UNIQUE ("member_id", "achievement_id");



ALTER TABLE ONLY "public"."achievement_progress"
    ADD CONSTRAINT "achievement_progress_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."booking_audit"
    ADD CONSTRAINT "booking_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_policies"
    ADD CONSTRAINT "booking_policies_booking_type_key" UNIQUE ("booking_type");



ALTER TABLE ONLY "public"."booking_policies"
    ADD CONSTRAINT "booking_policies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_reminders"
    ADD CONSTRAINT "booking_reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_time_slots"
    ADD CONSTRAINT "booking_time_slots_day_of_week_slot_time_booking_type_key" UNIQUE ("day_of_week", "slot_time", "booking_type");



ALTER TABLE ONLY "public"."booking_time_slots"
    ADD CONSTRAINT "booking_time_slots_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."customer_achievements"
    ADD CONSTRAINT "customer_achievements_member_id_achievement_id_key" UNIQUE ("member_id", "achievement_id");



ALTER TABLE ONLY "public"."customer_achievements"
    ADD CONSTRAINT "customer_achievements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_category_stats"
    ADD CONSTRAINT "customer_category_stats_pkey" PRIMARY KEY ("customer_id", "category_id");



ALTER TABLE ONLY "public"."customer_challenges"
    ADD CONSTRAINT "customer_challenges_member_id_challenge_id_key" UNIQUE ("member_id", "challenge_id");



ALTER TABLE ONLY "public"."customer_challenges"
    ADD CONSTRAINT "customer_challenges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_label_assignments"
    ADD CONSTRAINT "customer_label_assignments_customer_id_label_id_key" UNIQUE ("customer_id", "label_id");



ALTER TABLE ONLY "public"."customer_label_assignments"
    ADD CONSTRAINT "customer_label_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_labels"
    ADD CONSTRAINT "customer_labels_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."customer_labels"
    ADD CONSTRAINT "customer_labels_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."employee_onboarding_checklist"
    ADD CONSTRAINT "employee_onboarding_checklist_pkey" PRIMARY KEY ("employee_id");



ALTER TABLE ONLY "public"."employee_right_to_work"
    ADD CONSTRAINT "employee_right_to_work_pkey" PRIMARY KEY ("employee_id");



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



ALTER TABLE ONLY "public"."event_check_ins"
    ADD CONSTRAINT "event_check_ins_event_id_customer_id_key" UNIQUE ("event_id", "customer_id");



ALTER TABLE ONLY "public"."event_check_ins"
    ADD CONSTRAINT "event_check_ins_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."invoice_audit"
    ADD CONSTRAINT "invoice_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_email_logs"
    ADD CONSTRAINT "invoice_email_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_email_templates"
    ADD CONSTRAINT "invoice_email_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_email_templates"
    ADD CONSTRAINT "invoice_email_templates_template_type_key" UNIQUE ("template_type");



ALTER TABLE ONLY "public"."invoice_emails"
    ADD CONSTRAINT "invoice_emails_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_line_items"
    ADD CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_payments"
    ADD CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_reminder_settings"
    ADD CONSTRAINT "invoice_reminder_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_series"
    ADD CONSTRAINT "invoice_series_pkey" PRIMARY KEY ("series_code");



ALTER TABLE ONLY "public"."invoice_vendors"
    ADD CONSTRAINT "invoice_vendors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_invoice_number_key" UNIQUE ("invoice_number");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_queue"
    ADD CONSTRAINT "job_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."line_item_catalog"
    ADD CONSTRAINT "line_item_catalog_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_achievements"
    ADD CONSTRAINT "loyalty_achievements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_campaigns"
    ADD CONSTRAINT "loyalty_campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_challenges"
    ADD CONSTRAINT "loyalty_challenges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_members"
    ADD CONSTRAINT "loyalty_members_access_token_key" UNIQUE ("access_token");



ALTER TABLE ONLY "public"."loyalty_members"
    ADD CONSTRAINT "loyalty_members_customer_id_program_id_key" UNIQUE ("customer_id", "program_id");



ALTER TABLE ONLY "public"."loyalty_members"
    ADD CONSTRAINT "loyalty_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_point_transactions"
    ADD CONSTRAINT "loyalty_point_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_programs"
    ADD CONSTRAINT "loyalty_programs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_rewards"
    ADD CONSTRAINT "loyalty_rewards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_tiers"
    ADD CONSTRAINT "loyalty_tiers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_tiers"
    ADD CONSTRAINT "loyalty_tiers_program_id_level_key" UNIQUE ("program_id", "level");



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



ALTER TABLE ONLY "public"."pending_bookings"
    ADD CONSTRAINT "pending_bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pending_bookings"
    ADD CONSTRAINT "pending_bookings_token_key" UNIQUE ("token");



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



ALTER TABLE ONLY "public"."quote_line_items"
    ADD CONSTRAINT "quote_line_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_quote_number_key" UNIQUE ("quote_number");



ALTER TABLE ONLY "public"."rate_limits"
    ADD CONSTRAINT "rate_limits_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."rate_limits"
    ADD CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recurring_invoice_history"
    ADD CONSTRAINT "recurring_invoice_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recurring_invoice_line_items"
    ADD CONSTRAINT "recurring_invoice_line_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recurring_invoices"
    ADD CONSTRAINT "recurring_invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminder_processing_logs"
    ADD CONSTRAINT "reminder_processing_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reward_redemptions"
    ADD CONSTRAINT "reward_redemptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reward_redemptions"
    ADD CONSTRAINT "reward_redemptions_redemption_code_key" UNIQUE ("redemption_code");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_slot_config"
    ADD CONSTRAINT "service_slot_config_day_of_week_starts_at_booking_type_key" UNIQUE ("day_of_week", "starts_at", "booking_type");



ALTER TABLE ONLY "public"."service_slot_config"
    ADD CONSTRAINT "service_slot_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_slot_overrides"
    ADD CONSTRAINT "service_slot_overrides_override_date_key" UNIQUE ("override_date");



ALTER TABLE ONLY "public"."service_slot_overrides"
    ADD CONSTRAINT "service_slot_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_slots"
    ADD CONSTRAINT "service_slots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_slots"
    ADD CONSTRAINT "service_slots_service_date_starts_at_booking_type_key" UNIQUE ("service_date", "starts_at", "booking_type");



ALTER TABLE ONLY "public"."short_link_clicks"
    ADD CONSTRAINT "short_link_clicks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."short_links"
    ADD CONSTRAINT "short_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."short_links"
    ADD CONSTRAINT "short_links_short_code_key" UNIQUE ("short_code");



ALTER TABLE ONLY "public"."special_hours"
    ADD CONSTRAINT "special_hours_date_key" UNIQUE ("date");



ALTER TABLE ONLY "public"."special_hours"
    ADD CONSTRAINT "special_hours_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sunday_lunch_menu_items"
    ADD CONSTRAINT "sunday_lunch_menu_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."table_booking_items"
    ADD CONSTRAINT "table_booking_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."table_booking_modifications"
    ADD CONSTRAINT "table_booking_modifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."table_booking_payments"
    ADD CONSTRAINT "table_booking_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."table_booking_payments"
    ADD CONSTRAINT "table_booking_payments_transaction_id_key" UNIQUE ("transaction_id");



ALTER TABLE ONLY "public"."table_booking_reminder_history"
    ADD CONSTRAINT "table_booking_reminder_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."table_booking_sms_templates"
    ADD CONSTRAINT "table_booking_sms_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."table_booking_sms_templates"
    ADD CONSTRAINT "table_booking_sms_templates_template_key_key" UNIQUE ("template_key");



ALTER TABLE ONLY "public"."table_bookings"
    ADD CONSTRAINT "table_bookings_booking_reference_key" UNIQUE ("booking_reference");



ALTER TABLE ONLY "public"."table_bookings"
    ADD CONSTRAINT "table_bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."table_combination_tables"
    ADD CONSTRAINT "table_combination_tables_combination_id_table_id_key" UNIQUE ("combination_id", "table_id");



ALTER TABLE ONLY "public"."table_combination_tables"
    ADD CONSTRAINT "table_combination_tables_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."table_combinations"
    ADD CONSTRAINT "table_combinations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."table_configuration"
    ADD CONSTRAINT "table_configuration_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."table_configuration"
    ADD CONSTRAINT "table_configuration_table_number_key" UNIQUE ("table_number");



ALTER TABLE ONLY "public"."tables"
    ADD CONSTRAINT "tables_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_reminders"
    ADD CONSTRAINT "unique_booking_reminder" UNIQUE ("booking_id", "reminder_type");



COMMENT ON CONSTRAINT "unique_booking_reminder" ON "public"."booking_reminders" IS 'Ensures each reminder type is only sent once per booking';



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id", "role_id");



ALTER TABLE ONLY "public"."vendor_contacts"
    ADD CONSTRAINT "vendor_contacts_pkey" PRIMARY KEY ("id");



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



CREATE INDEX "idx_achievement_progress_member_id" ON "public"."achievement_progress" USING "btree" ("member_id");



CREATE INDEX "idx_api_usage_key_time" ON "public"."api_usage" USING "btree" ("api_key_id", "created_at" DESC);



CREATE INDEX "idx_audit_logs_created_at" ON "public"."audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_logs_employee_history" ON "public"."audit_logs" USING "btree" ("resource_id", "created_at" DESC) WHERE (("resource_type" = 'employee'::"text") AND ("operation_status" = 'success'::"text"));



CREATE INDEX "idx_audit_logs_operation_type" ON "public"."audit_logs" USING "btree" ("operation_type");



CREATE INDEX "idx_audit_logs_resource" ON "public"."audit_logs" USING "btree" ("resource_type", "resource_id");



CREATE INDEX "idx_audit_logs_resource_composite" ON "public"."audit_logs" USING "btree" ("resource_type", "resource_id", "created_at" DESC);



CREATE INDEX "idx_audit_logs_resource_created" ON "public"."audit_logs" USING "btree" ("resource_type", "created_at" DESC) WHERE ("resource_type" = ANY (ARRAY['employee'::"text", 'message_template'::"text", 'bulk_message'::"text"]));



CREATE INDEX "idx_audit_logs_resource_type_id" ON "public"."audit_logs" USING "btree" ("resource_type", "resource_id");



CREATE INDEX "idx_audit_logs_user_created" ON "public"."audit_logs" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_audit_logs_user_date" ON "public"."audit_logs" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_audit_logs_user_id" ON "public"."audit_logs" USING "btree" ("user_id");



CREATE INDEX "idx_background_jobs_created_at" ON "public"."background_jobs" USING "btree" ("created_at");



CREATE INDEX "idx_background_jobs_priority" ON "public"."background_jobs" USING "btree" ("priority" DESC, "created_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_background_jobs_status_scheduled" ON "public"."background_jobs" USING "btree" ("status", "scheduled_for") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_background_jobs_type" ON "public"."background_jobs" USING "btree" ("type");



CREATE INDEX "idx_booking_audit_booking" ON "public"."booking_audit" USING "btree" ("booking_id", "created_at" DESC);



CREATE INDEX "idx_booking_audit_event" ON "public"."booking_audit" USING "btree" ("event", "created_at" DESC);



CREATE INDEX "idx_booking_items_booking" ON "public"."table_booking_items" USING "btree" ("booking_id");



CREATE INDEX "idx_booking_modifications_booking_id" ON "public"."table_booking_modifications" USING "btree" ("booking_id");



CREATE INDEX "idx_booking_modifications_created_at" ON "public"."table_booking_modifications" USING "btree" ("created_at");



CREATE INDEX "idx_booking_policies_type" ON "public"."booking_policies" USING "btree" ("booking_type");



CREATE INDEX "idx_booking_reminders_booking_id" ON "public"."booking_reminders" USING "btree" ("booking_id");



CREATE INDEX "idx_booking_reminders_booking_type" ON "public"."booking_reminders" USING "btree" ("booking_id", "reminder_type");



CREATE INDEX "idx_booking_reminders_sent_at" ON "public"."booking_reminders" USING "btree" ("sent_at");



CREATE INDEX "idx_bookings_correlation" ON "public"."table_bookings" USING "btree" ("correlation_id");



CREATE INDEX "idx_bookings_created_at" ON "public"."bookings" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_bookings_created_recent" ON "public"."bookings" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_bookings_customer_id" ON "public"."bookings" USING "btree" ("customer_id");



CREATE INDEX "idx_bookings_customer_id_created_at" ON "public"."bookings" USING "btree" ("customer_id", "created_at" DESC);



CREATE INDEX "idx_bookings_date_status" ON "public"."table_bookings" USING "btree" ("booking_date", "status") WHERE ("status" = ANY (ARRAY['confirmed'::"public"."table_booking_status", 'pending_payment'::"public"."table_booking_status"]));



CREATE INDEX "idx_bookings_event_customer" ON "public"."bookings" USING "btree" ("event_id", "customer_id");



CREATE INDEX "idx_bookings_event_date" ON "public"."bookings" USING "btree" ("event_id", "created_at" DESC);



CREATE INDEX "idx_bookings_event_id" ON "public"."bookings" USING "btree" ("event_id");



CREATE INDEX "idx_bookings_event_id_count" ON "public"."bookings" USING "btree" ("event_id") INCLUDE ("id");



CREATE INDEX "idx_catering_packages_package_type" ON "public"."catering_packages" USING "btree" ("package_type");



CREATE INDEX "idx_catering_packages_pricing_model" ON "public"."catering_packages" USING "btree" ("pricing_model");



CREATE INDEX "idx_customer_achievements_member_id" ON "public"."customer_achievements" USING "btree" ("member_id");



CREATE INDEX "idx_customer_category_stats_category_id" ON "public"."customer_category_stats" USING "btree" ("category_id");



CREATE INDEX "idx_customer_category_stats_customer_id" ON "public"."customer_category_stats" USING "btree" ("customer_id");



CREATE INDEX "idx_customer_category_stats_last_attended" ON "public"."customer_category_stats" USING "btree" ("last_attended_date" DESC);



CREATE INDEX "idx_customer_challenges_member_id" ON "public"."customer_challenges" USING "btree" ("member_id");



CREATE INDEX "idx_customer_label_assignments_customer_id" ON "public"."customer_label_assignments" USING "btree" ("customer_id");



CREATE INDEX "idx_customer_label_assignments_label_id" ON "public"."customer_label_assignments" USING "btree" ("label_id");



CREATE INDEX "idx_customers_consecutive_failures" ON "public"."customers" USING "btree" ("consecutive_failures");



CREATE INDEX "idx_customers_created_at" ON "public"."customers" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_customers_created_recent" ON "public"."customers" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_customers_messaging_status" ON "public"."customers" USING "btree" ("messaging_status");



CREATE INDEX "idx_customers_mobile" ON "public"."customers" USING "btree" ("mobile_number");



CREATE UNIQUE INDEX "idx_customers_mobile_e164" ON "public"."customers" USING "btree" ("mobile_e164") WHERE ("mobile_e164" IS NOT NULL);



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



CREATE INDEX "idx_employees_created_at" ON "public"."employees" USING "btree" ("created_at" DESC);



CREATE UNIQUE INDEX "idx_employees_email" ON "public"."employees" USING "btree" ("email_address");



CREATE INDEX "idx_employees_employment_dates" ON "public"."employees" USING "btree" ("employment_start_date", "employment_end_date");



CREATE INDEX "idx_employees_name_search" ON "public"."employees" USING "btree" ("last_name", "first_name");



CREATE INDEX "idx_employees_status" ON "public"."employees" USING "btree" ("status");



CREATE INDEX "idx_event_categories_slug" ON "public"."event_categories" USING "btree" ("slug");



CREATE INDEX "idx_event_categories_sort_order" ON "public"."event_categories" USING "btree" ("sort_order");



CREATE INDEX "idx_event_check_ins_check_in_time" ON "public"."event_check_ins" USING "btree" ("check_in_time");



CREATE INDEX "idx_event_check_ins_customer_id" ON "public"."event_check_ins" USING "btree" ("customer_id");



CREATE INDEX "idx_event_check_ins_event_id" ON "public"."event_check_ins" USING "btree" ("event_id");



CREATE INDEX "idx_event_check_ins_member_id" ON "public"."event_check_ins" USING "btree" ("member_id");



CREATE INDEX "idx_event_faqs_event_id" ON "public"."event_faqs" USING "btree" ("event_id");



CREATE INDEX "idx_event_faqs_sort_order" ON "public"."event_faqs" USING "btree" ("event_id", "sort_order");



CREATE INDEX "idx_event_images_event_id" ON "public"."event_images" USING "btree" ("event_id");



CREATE INDEX "idx_event_images_type" ON "public"."event_images" USING "btree" ("image_type");



CREATE INDEX "idx_event_message_templates_event" ON "public"."event_message_templates" USING "btree" ("event_id");



CREATE INDEX "idx_event_message_templates_send_timing" ON "public"."event_message_templates" USING "btree" ("send_timing");



CREATE INDEX "idx_events_category_id" ON "public"."events" USING "btree" ("category_id");



CREATE INDEX "idx_events_created_at" ON "public"."events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_events_date" ON "public"."events" USING "btree" ("date");



CREATE INDEX "idx_events_date_status" ON "public"."events" USING "btree" ("date", "event_status");



CREATE INDEX "idx_events_date_upcoming" ON "public"."events" USING "btree" ("date");



CREATE UNIQUE INDEX "idx_events_slug" ON "public"."events" USING "btree" ("slug");



CREATE INDEX "idx_idempotency_expires" ON "public"."idempotency_keys" USING "btree" ("expires_at");



CREATE INDEX "idx_invoice_audit_action" ON "public"."invoice_audit" USING "btree" ("action");



CREATE INDEX "idx_invoice_audit_created_at" ON "public"."invoice_audit" USING "btree" ("created_at");



CREATE INDEX "idx_invoice_audit_invoice" ON "public"."invoice_audit" USING "btree" ("invoice_id");



CREATE INDEX "idx_invoice_audit_performed_by" ON "public"."invoice_audit" USING "btree" ("performed_by");



CREATE INDEX "idx_invoice_email_logs_invoice_id" ON "public"."invoice_email_logs" USING "btree" ("invoice_id");



CREATE INDEX "idx_invoice_email_logs_quote_id" ON "public"."invoice_email_logs" USING "btree" ("quote_id");



CREATE INDEX "idx_invoice_emails_invoice" ON "public"."invoice_emails" USING "btree" ("invoice_id");



CREATE INDEX "idx_invoice_emails_sent_at" ON "public"."invoice_emails" USING "btree" ("sent_at");



CREATE INDEX "idx_invoice_emails_status" ON "public"."invoice_emails" USING "btree" ("status");



CREATE INDEX "idx_invoice_emails_type" ON "public"."invoice_emails" USING "btree" ("email_type");



CREATE INDEX "idx_invoice_line_items_invoice_id" ON "public"."invoice_line_items" USING "btree" ("invoice_id");



CREATE INDEX "idx_invoice_payments_invoice_id" ON "public"."invoice_payments" USING "btree" ("invoice_id");



CREATE INDEX "idx_invoices_due_date" ON "public"."invoices" USING "btree" ("due_date");



CREATE INDEX "idx_invoices_invoice_date" ON "public"."invoices" USING "btree" ("invoice_date" DESC);



CREATE INDEX "idx_invoices_status" ON "public"."invoices" USING "btree" ("status");



CREATE INDEX "idx_invoices_vendor_id" ON "public"."invoices" USING "btree" ("vendor_id");



CREATE INDEX "idx_job_queue_created_at" ON "public"."job_queue" USING "btree" ("created_at");



CREATE INDEX "idx_job_queue_status" ON "public"."job_queue" USING "btree" ("status");



CREATE INDEX "idx_job_queue_type" ON "public"."job_queue" USING "btree" ("type");



CREATE INDEX "idx_jobs_created_at" ON "public"."jobs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_jobs_priority_scheduled" ON "public"."jobs" USING "btree" ("priority" DESC, "scheduled_for") WHERE (("status")::"text" = 'pending'::"text");



CREATE INDEX "idx_jobs_status_scheduled" ON "public"."jobs" USING "btree" ("status", "scheduled_for") WHERE (("status")::"text" = 'pending'::"text");



CREATE INDEX "idx_jobs_type" ON "public"."jobs" USING "btree" ("type");



CREATE INDEX "idx_loyalty_challenges_active" ON "public"."loyalty_challenges" USING "btree" ("active", "start_date", "end_date");



CREATE INDEX "idx_loyalty_members_access_token" ON "public"."loyalty_members" USING "btree" ("access_token");



CREATE INDEX "idx_loyalty_members_customer_id" ON "public"."loyalty_members" USING "btree" ("customer_id");



CREATE INDEX "idx_loyalty_members_tier_id" ON "public"."loyalty_members" USING "btree" ("tier_id");



CREATE INDEX "idx_loyalty_point_transactions_created_at" ON "public"."loyalty_point_transactions" USING "btree" ("created_at");



CREATE INDEX "idx_loyalty_point_transactions_member_id" ON "public"."loyalty_point_transactions" USING "btree" ("member_id");



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



CREATE INDEX "idx_messages_status" ON "public"."messages" USING "btree" ("status");



CREATE INDEX "idx_messages_twilio_message_sid" ON "public"."messages" USING "btree" ("twilio_message_sid");



CREATE INDEX "idx_messages_twilio_sid" ON "public"."messages" USING "btree" ("twilio_message_sid") WHERE ("twilio_message_sid" IS NOT NULL);



CREATE INDEX "idx_messages_twilio_status" ON "public"."messages" USING "btree" ("twilio_status");



CREATE INDEX "idx_messages_unread_inbound" ON "public"."messages" USING "btree" ("direction", "read_at") WHERE (("direction" = 'inbound'::"text") AND ("read_at" IS NULL));



CREATE INDEX "idx_pending_bookings_event_id" ON "public"."pending_bookings" USING "btree" ("event_id");



CREATE INDEX "idx_pending_bookings_expires_at" ON "public"."pending_bookings" USING "btree" ("expires_at");



CREATE INDEX "idx_pending_bookings_mobile_number" ON "public"."pending_bookings" USING "btree" ("mobile_number");



CREATE INDEX "idx_pending_bookings_token" ON "public"."pending_bookings" USING "btree" ("token");



CREATE INDEX "idx_pending_bookings_token_lookup" ON "public"."pending_bookings" USING "btree" ("token") WHERE ("confirmed_at" IS NULL);



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



CREATE INDEX "idx_quote_line_items_quote_id" ON "public"."quote_line_items" USING "btree" ("quote_id");



CREATE INDEX "idx_quotes_vendor_id" ON "public"."quotes" USING "btree" ("vendor_id");



CREATE INDEX "idx_rate_limits_key" ON "public"."rate_limits" USING "btree" ("key");



CREATE INDEX "idx_rate_limits_updated_at" ON "public"."rate_limits" USING "btree" ("updated_at");



CREATE INDEX "idx_recurring_invoices_next_date" ON "public"."recurring_invoices" USING "btree" ("next_invoice_date");



CREATE INDEX "idx_recurring_invoices_vendor_id" ON "public"."recurring_invoices" USING "btree" ("vendor_id");



CREATE INDEX "idx_reminder_history_booking_id" ON "public"."table_booking_reminder_history" USING "btree" ("booking_id");



CREATE INDEX "idx_reminder_logs_booking_id" ON "public"."reminder_processing_logs" USING "btree" ("booking_id");



CREATE INDEX "idx_reminder_logs_created_at" ON "public"."reminder_processing_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_reminder_logs_processing_type" ON "public"."reminder_processing_logs" USING "btree" ("processing_type");



CREATE INDEX "idx_reward_redemptions_code" ON "public"."reward_redemptions" USING "btree" ("redemption_code");



CREATE INDEX "idx_reward_redemptions_member_id" ON "public"."reward_redemptions" USING "btree" ("member_id");



CREATE INDEX "idx_reward_redemptions_status" ON "public"."reward_redemptions" USING "btree" ("status");



CREATE INDEX "idx_role_permissions_permission_id" ON "public"."role_permissions" USING "btree" ("permission_id");



CREATE INDEX "idx_role_permissions_role_id" ON "public"."role_permissions" USING "btree" ("role_id");



CREATE INDEX "idx_service_slots_date" ON "public"."service_slots" USING "btree" ("service_date", "booking_type") WHERE ("is_active" = true);



CREATE INDEX "idx_short_link_clicks_clicked_at" ON "public"."short_link_clicks" USING "btree" ("clicked_at");



CREATE INDEX "idx_short_link_clicks_country" ON "public"."short_link_clicks" USING "btree" ("country");



CREATE INDEX "idx_short_link_clicks_device_type" ON "public"."short_link_clicks" USING "btree" ("device_type");



CREATE INDEX "idx_short_link_clicks_short_link_id" ON "public"."short_link_clicks" USING "btree" ("short_link_id");



CREATE INDEX "idx_short_links_expires_at" ON "public"."short_links" USING "btree" ("expires_at") WHERE ("expires_at" IS NOT NULL);



CREATE INDEX "idx_short_links_link_type" ON "public"."short_links" USING "btree" ("link_type");



CREATE INDEX "idx_short_links_short_code" ON "public"."short_links" USING "btree" ("short_code");



CREATE INDEX "idx_sms_queue_booking_daily" ON "public"."private_booking_sms_queue" USING "btree" ("booking_id", "recipient_phone", "public"."date_utc"("created_at"));



CREATE INDEX "idx_sms_queue_priority" ON "public"."private_booking_sms_queue" USING "btree" ("priority", "created_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_sms_queue_scheduled_status" ON "public"."private_booking_sms_queue" USING "btree" ("scheduled_for", "status") WHERE ("status" = ANY (ARRAY['pending'::"text", 'approved'::"text"]));



CREATE INDEX "idx_sms_templates_key" ON "public"."table_booking_sms_templates" USING "btree" ("template_key");



CREATE INDEX "idx_special_hours_date" ON "public"."special_hours" USING "btree" ("date");



CREATE INDEX "idx_sunday_lunch_menu_items_category" ON "public"."sunday_lunch_menu_items" USING "btree" ("category");



CREATE INDEX "idx_sunday_lunch_menu_items_display_order" ON "public"."sunday_lunch_menu_items" USING "btree" ("display_order");



CREATE INDEX "idx_sunday_lunch_menu_items_is_active" ON "public"."sunday_lunch_menu_items" USING "btree" ("is_active");



CREATE UNIQUE INDEX "idx_sunday_lunch_menu_items_name" ON "public"."sunday_lunch_menu_items" USING "btree" ("lower"(("name")::"text"));



CREATE INDEX "idx_table_booking_items_booking_id" ON "public"."table_booking_items" USING "btree" ("booking_id");



CREATE INDEX "idx_table_booking_payments_booking_id" ON "public"."table_booking_payments" USING "btree" ("booking_id");



CREATE INDEX "idx_table_booking_payments_transaction_id" ON "public"."table_booking_payments" USING "btree" ("transaction_id");



CREATE INDEX "idx_table_bookings_booking_date" ON "public"."table_bookings" USING "btree" ("booking_date");



CREATE INDEX "idx_table_bookings_booking_type" ON "public"."table_bookings" USING "btree" ("booking_type");



CREATE INDEX "idx_table_bookings_customer_id" ON "public"."table_bookings" USING "btree" ("customer_id");



CREATE INDEX "idx_table_bookings_date_time" ON "public"."table_bookings" USING "btree" ("booking_date", "booking_time");



CREATE INDEX "idx_table_bookings_reminder_status" ON "public"."table_bookings" USING "btree" ("status", "reminder_sent", "booking_date") WHERE (("status" = 'confirmed'::"public"."table_booking_status") AND ("reminder_sent" = false));



CREATE INDEX "idx_table_bookings_status" ON "public"."table_bookings" USING "btree" ("status");



CREATE INDEX "idx_table_combinations_active" ON "public"."table_combinations" USING "btree" ("is_active");



CREATE UNIQUE INDEX "idx_table_combinations_name" ON "public"."table_combinations" USING "btree" ("lower"(("name")::"text"));



CREATE UNIQUE INDEX "idx_table_configuration_table_number" ON "public"."table_configuration" USING "btree" ("lower"(("table_number")::"text"));



CREATE UNIQUE INDEX "idx_tables_table_number" ON "public"."tables" USING "btree" ("lower"(("table_number")::"text"));



CREATE INDEX "idx_user_roles_role_id" ON "public"."user_roles" USING "btree" ("role_id");



CREATE INDEX "idx_user_roles_user_id" ON "public"."user_roles" USING "btree" ("user_id");



CREATE INDEX "idx_vendor_contacts_primary" ON "public"."vendor_contacts" USING "btree" ("vendor_id", "is_primary");



CREATE INDEX "idx_vendor_contacts_vendor" ON "public"."vendor_contacts" USING "btree" ("vendor_id");



CREATE INDEX "idx_webhook_logs_customer_id" ON "public"."webhook_logs" USING "btree" ("customer_id");



CREATE INDEX "idx_webhook_logs_from_number" ON "public"."webhook_logs" USING "btree" ("from_number");



CREATE INDEX "idx_webhook_logs_message_id" ON "public"."webhook_logs" USING "btree" ("message_id");



CREATE INDEX "idx_webhook_logs_message_sid" ON "public"."webhook_logs" USING "btree" ("message_sid");



CREATE INDEX "idx_webhook_logs_processed_at" ON "public"."webhook_logs" USING "btree" ("processed_at" DESC);



CREATE INDEX "idx_webhook_logs_status" ON "public"."webhook_logs" USING "btree" ("status");



CREATE INDEX "idx_webhook_logs_to_number" ON "public"."webhook_logs" USING "btree" ("to_number");



CREATE INDEX "idx_webhook_logs_webhook_type" ON "public"."webhook_logs" USING "btree" ("webhook_type");



CREATE OR REPLACE TRIGGER "booking_category_stats_trigger" AFTER INSERT ON "public"."bookings" FOR EACH ROW WHEN (("new"."seats" > 0)) EXECUTE FUNCTION "public"."update_customer_category_stats"();



CREATE OR REPLACE TRIGGER "booking_policies_updated_at" BEFORE UPDATE ON "public"."booking_policies" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "booking_time_slots_updated_at" BEFORE UPDATE ON "public"."booking_time_slots" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "enforce_event_date_not_past" BEFORE INSERT OR UPDATE ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."check_event_date_not_past"();



COMMENT ON TRIGGER "enforce_event_date_not_past" ON "public"."events" IS 'Prevents creating new events with past dates and changing future events to past dates';



CREATE OR REPLACE TRIGGER "enforce_single_default_category" BEFORE INSERT OR UPDATE ON "public"."event_categories" FOR EACH ROW WHEN (("new"."is_default" = true)) EXECUTE FUNCTION "public"."ensure_single_default_category"();



CREATE OR REPLACE TRIGGER "log_template_changes" AFTER UPDATE ON "public"."message_templates" FOR EACH ROW EXECUTE FUNCTION "public"."log_template_change"();



CREATE OR REPLACE TRIGGER "loyalty_tier_upgrade_trigger" AFTER UPDATE OF "lifetime_events" ON "public"."loyalty_members" FOR EACH ROW WHEN (("new"."lifetime_events" > "old"."lifetime_events")) EXECUTE FUNCTION "public"."check_tier_upgrade"();



CREATE OR REPLACE TRIGGER "on_employees_updated" BEFORE UPDATE ON "public"."employees" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "on_financial_details_updated" BEFORE UPDATE ON "public"."employee_financial_details" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "on_health_records_updated" BEFORE UPDATE ON "public"."employee_health_records" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "pending_bookings_updated_at" BEFORE UPDATE ON "public"."pending_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "prevent_audit_log_delete" BEFORE DELETE ON "public"."audit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_audit_log_deletion"();



CREATE OR REPLACE TRIGGER "prevent_audit_log_update" BEFORE UPDATE ON "public"."audit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_audit_log_update"();



CREATE OR REPLACE TRIGGER "set_balance_due_date" BEFORE INSERT OR UPDATE OF "event_date" ON "public"."private_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."calculate_balance_due_date"();



CREATE OR REPLACE TRIGGER "set_loyalty_access_token_trigger" BEFORE INSERT ON "public"."loyalty_members" FOR EACH ROW EXECUTE FUNCTION "public"."set_loyalty_access_token"();



CREATE OR REPLACE TRIGGER "sync_customer_name_trigger" BEFORE INSERT OR UPDATE OF "customer_id" ON "public"."private_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."sync_customer_name_from_customers"();



CREATE OR REPLACE TRIGGER "system_settings_updated_at" BEFORE UPDATE ON "public"."system_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "table_booking_items_updated_at" BEFORE UPDATE ON "public"."table_booking_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "table_booking_payments_updated_at" BEFORE UPDATE ON "public"."table_booking_payments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "table_booking_sms_templates_updated_at" BEFORE UPDATE ON "public"."table_booking_sms_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "table_bookings_set_reference" BEFORE INSERT ON "public"."table_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."set_booking_reference"();



CREATE OR REPLACE TRIGGER "table_bookings_updated_at" BEFORE UPDATE ON "public"."table_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "table_combinations_updated_at" BEFORE UPDATE ON "public"."table_combinations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "table_configuration_updated_at" BEFORE UPDATE ON "public"."table_configuration" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_achievement_progress_updated_at" BEFORE UPDATE ON "public"."achievement_progress" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_api_keys_updated_at" BEFORE UPDATE ON "public"."api_keys" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_attachment_categories_updated_at" BEFORE UPDATE ON "public"."attachment_categories" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_business_amenities_updated_at" BEFORE UPDATE ON "public"."business_amenities" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_business_hours_updated_at" BEFORE UPDATE ON "public"."business_hours" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_catering_packages_updated_at" BEFORE UPDATE ON "public"."catering_packages" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_customer_challenges_updated_at" BEFORE UPDATE ON "public"."customer_challenges" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_customer_health_on_delivery_status" AFTER INSERT OR UPDATE ON "public"."message_delivery_status" FOR EACH ROW EXECUTE FUNCTION "public"."update_customer_messaging_health"();



CREATE OR REPLACE TRIGGER "update_customer_sms_status_trigger" AFTER UPDATE OF "twilio_status" ON "public"."messages" FOR EACH ROW WHEN (("new"."twilio_status" IS DISTINCT FROM "old"."twilio_status")) EXECUTE FUNCTION "public"."update_customer_sms_status"();



CREATE OR REPLACE TRIGGER "update_customer_stats_on_booking" AFTER INSERT OR UPDATE ON "public"."table_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."update_customer_booking_stats"();



CREATE OR REPLACE TRIGGER "update_employee_onboarding_checklist_updated_at" BEFORE UPDATE ON "public"."employee_onboarding_checklist" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_employee_right_to_work_updated_at" BEFORE UPDATE ON "public"."employee_right_to_work" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_employees_updated_at" BEFORE UPDATE ON "public"."employees" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_event_faqs_updated_at" BEFORE UPDATE ON "public"."event_faqs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_event_images_updated_at_trigger" BEFORE UPDATE ON "public"."event_images" FOR EACH ROW EXECUTE FUNCTION "public"."update_event_images_updated_at"();



CREATE OR REPLACE TRIGGER "update_invoice_email_templates_updated_at" BEFORE UPDATE ON "public"."invoice_email_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_invoice_vendors_updated_at" BEFORE UPDATE ON "public"."invoice_vendors" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_invoices_updated_at" BEFORE UPDATE ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_jobs_updated_at" BEFORE UPDATE ON "public"."jobs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_line_item_catalog_updated_at" BEFORE UPDATE ON "public"."line_item_catalog" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_loyalty_achievements_updated_at" BEFORE UPDATE ON "public"."loyalty_achievements" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_loyalty_campaigns_updated_at" BEFORE UPDATE ON "public"."loyalty_campaigns" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_loyalty_challenges_updated_at" BEFORE UPDATE ON "public"."loyalty_challenges" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_loyalty_members_updated_at" BEFORE UPDATE ON "public"."loyalty_members" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_loyalty_programs_updated_at" BEFORE UPDATE ON "public"."loyalty_programs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_loyalty_rewards_updated_at" BEFORE UPDATE ON "public"."loyalty_rewards" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_loyalty_tiers_updated_at" BEFORE UPDATE ON "public"."loyalty_tiers" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_menu_items_updated_at" BEFORE UPDATE ON "public"."menu_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_menu_sections_updated_at" BEFORE UPDATE ON "public"."menu_sections" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_message_templates_updated_at" BEFORE UPDATE ON "public"."message_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_messages_updated_at" BEFORE UPDATE ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."update_messages_updated_at"();



CREATE OR REPLACE TRIGGER "update_private_bookings_updated_at" BEFORE UPDATE ON "public"."private_bookings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_quotes_updated_at" BEFORE UPDATE ON "public"."quotes" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_recurring_invoices_updated_at" BEFORE UPDATE ON "public"."recurring_invoices" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_roles_updated_at" BEFORE UPDATE ON "public"."roles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_special_hours_updated_at" BEFORE UPDATE ON "public"."special_hours" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_sunday_lunch_menu_items_updated_at" BEFORE UPDATE ON "public"."sunday_lunch_menu_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_table_combinations_updated_at" BEFORE UPDATE ON "public"."table_combinations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_tables_updated_at" BEFORE UPDATE ON "public"."tables" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_vendor_contacts_updated_at" BEFORE UPDATE ON "public"."vendor_contacts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_vendors_updated_at" BEFORE UPDATE ON "public"."vendors" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_venue_spaces_updated_at" BEFORE UPDATE ON "public"."venue_spaces" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_webhooks_updated_at" BEFORE UPDATE ON "public"."webhooks" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."achievement_progress"
    ADD CONSTRAINT "achievement_progress_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "public"."loyalty_achievements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."achievement_progress"
    ADD CONSTRAINT "achievement_progress_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."loyalty_members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."api_usage"
    ADD CONSTRAINT "api_usage_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."booking_audit"
    ADD CONSTRAINT "booking_audit_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."table_bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_audit"
    ADD CONSTRAINT "booking_audit_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."booking_reminders"
    ADD CONSTRAINT "booking_reminders_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_reminders"
    ADD CONSTRAINT "booking_reminders_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_achievements"
    ADD CONSTRAINT "customer_achievements_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "public"."loyalty_achievements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_achievements"
    ADD CONSTRAINT "customer_achievements_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."loyalty_members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_category_stats"
    ADD CONSTRAINT "customer_category_stats_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."event_categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_category_stats"
    ADD CONSTRAINT "customer_category_stats_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_challenges"
    ADD CONSTRAINT "customer_challenges_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."loyalty_challenges"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_challenges"
    ADD CONSTRAINT "customer_challenges_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."loyalty_members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_label_assignments"
    ADD CONSTRAINT "customer_label_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."customer_label_assignments"
    ADD CONSTRAINT "customer_label_assignments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_label_assignments"
    ADD CONSTRAINT "customer_label_assignments_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "public"."customer_labels"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."employee_onboarding_checklist"
    ADD CONSTRAINT "employee_onboarding_checklist_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_right_to_work"
    ADD CONSTRAINT "employee_right_to_work_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_right_to_work"
    ADD CONSTRAINT "employee_right_to_work_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."event_check_ins"
    ADD CONSTRAINT "event_check_ins_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id");



ALTER TABLE ONLY "public"."event_check_ins"
    ADD CONSTRAINT "event_check_ins_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_check_ins"
    ADD CONSTRAINT "event_check_ins_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_check_ins"
    ADD CONSTRAINT "event_check_ins_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."loyalty_members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_check_ins"
    ADD CONSTRAINT "event_check_ins_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "auth"."users"("id");



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



ALTER TABLE ONLY "public"."invoice_audit"
    ADD CONSTRAINT "invoice_audit_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."invoice_email_logs"
    ADD CONSTRAINT "invoice_email_logs_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_email_logs"
    ADD CONSTRAINT "invoice_email_logs_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_emails"
    ADD CONSTRAINT "invoice_emails_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."invoice_line_items"
    ADD CONSTRAINT "invoice_line_items_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."line_item_catalog"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoice_line_items"
    ADD CONSTRAINT "invoice_line_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_payments"
    ADD CONSTRAINT "invoice_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."invoice_vendors"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."job_queue"
    ADD CONSTRAINT "job_queue_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."loyalty_achievements"
    ADD CONSTRAINT "loyalty_achievements_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."loyalty_programs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_campaigns"
    ADD CONSTRAINT "loyalty_campaigns_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."loyalty_programs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_challenges"
    ADD CONSTRAINT "loyalty_challenges_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."loyalty_programs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_members"
    ADD CONSTRAINT "loyalty_members_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_members"
    ADD CONSTRAINT "loyalty_members_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."loyalty_programs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_members"
    ADD CONSTRAINT "loyalty_members_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "public"."loyalty_tiers"("id");



ALTER TABLE ONLY "public"."loyalty_point_transactions"
    ADD CONSTRAINT "loyalty_point_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."loyalty_point_transactions"
    ADD CONSTRAINT "loyalty_point_transactions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."loyalty_members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_rewards"
    ADD CONSTRAINT "loyalty_rewards_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."loyalty_programs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_rewards"
    ADD CONSTRAINT "loyalty_rewards_tier_required_fkey" FOREIGN KEY ("tier_required") REFERENCES "public"."loyalty_tiers"("id");



ALTER TABLE ONLY "public"."loyalty_tiers"
    ADD CONSTRAINT "loyalty_tiers_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."loyalty_programs"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."pending_bookings"
    ADD CONSTRAINT "pending_bookings_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pending_bookings"
    ADD CONSTRAINT "pending_bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pending_bookings"
    ADD CONSTRAINT "pending_bookings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pending_bookings"
    ADD CONSTRAINT "pending_bookings_initiated_by_api_key_fkey" FOREIGN KEY ("initiated_by_api_key") REFERENCES "public"."api_keys"("id") ON DELETE SET NULL;



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



ALTER TABLE ONLY "public"."quote_line_items"
    ADD CONSTRAINT "quote_line_items_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."line_item_catalog"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."quote_line_items"
    ADD CONSTRAINT "quote_line_items_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_converted_to_invoice_id_fkey" FOREIGN KEY ("converted_to_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."invoice_vendors"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."recurring_invoice_line_items"
    ADD CONSTRAINT "recurring_invoice_line_items_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."line_item_catalog"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."recurring_invoice_line_items"
    ADD CONSTRAINT "recurring_invoice_line_items_recurring_invoice_id_fkey" FOREIGN KEY ("recurring_invoice_id") REFERENCES "public"."recurring_invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recurring_invoices"
    ADD CONSTRAINT "recurring_invoices_last_invoice_id_fkey" FOREIGN KEY ("last_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."recurring_invoices"
    ADD CONSTRAINT "recurring_invoices_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."invoice_vendors"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."reminder_processing_logs"
    ADD CONSTRAINT "reminder_processing_logs_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminder_processing_logs"
    ADD CONSTRAINT "reminder_processing_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminder_processing_logs"
    ADD CONSTRAINT "reminder_processing_logs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reward_redemptions"
    ADD CONSTRAINT "reward_redemptions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."loyalty_members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reward_redemptions"
    ADD CONSTRAINT "reward_redemptions_redeemed_by_fkey" FOREIGN KEY ("redeemed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."reward_redemptions"
    ADD CONSTRAINT "reward_redemptions_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "public"."loyalty_rewards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."short_link_clicks"
    ADD CONSTRAINT "short_link_clicks_short_link_id_fkey" FOREIGN KEY ("short_link_id") REFERENCES "public"."short_links"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."short_links"
    ADD CONSTRAINT "short_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."table_booking_items"
    ADD CONSTRAINT "table_booking_items_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."table_bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."table_booking_modifications"
    ADD CONSTRAINT "table_booking_modifications_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."table_bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."table_booking_payments"
    ADD CONSTRAINT "table_booking_payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."table_bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."table_booking_reminder_history"
    ADD CONSTRAINT "table_booking_reminder_history_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."table_bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."table_bookings"
    ADD CONSTRAINT "table_bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."table_combination_tables"
    ADD CONSTRAINT "table_combination_tables_combination_id_fkey" FOREIGN KEY ("combination_id") REFERENCES "public"."table_combinations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."table_combination_tables"
    ADD CONSTRAINT "table_combination_tables_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "public"."table_configuration"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_contacts"
    ADD CONSTRAINT "vendor_contacts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."webhook_deliveries"
    ADD CONSTRAINT "webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can manage booking policies" ON "public"."booking_policies" USING ("public"."user_has_permission"("auth"."uid"(), 'table_bookings'::"text", 'manage'::"text"));



CREATE POLICY "Admins manage SMS templates" ON "public"."table_booking_sms_templates" USING ("public"."user_has_permission"("auth"."uid"(), 'table_bookings'::"text", 'manage'::"text"));



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



CREATE POLICY "Anyone can track clicks" ON "public"."short_link_clicks" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can view active menu items" ON "public"."sunday_lunch_menu_items" FOR SELECT USING (("is_active" = true));



CREATE POLICY "Anyone can view active slots" ON "public"."service_slots" FOR SELECT USING (("is_active" = true));



CREATE POLICY "Anyone can view booking policies" ON "public"."booking_policies" FOR SELECT USING (true);



CREATE POLICY "Anyone can view booking time slots" ON "public"."booking_time_slots" FOR SELECT USING (true);



CREATE POLICY "Anyone can view event images" ON "public"."event_images" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Authenticated users can create short links" ON "public"."short_links" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can insert" ON "public"."private_booking_sms_queue" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Authenticated users can view clicks" ON "public"."short_link_clicks" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can view permissions" ON "public"."permissions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view role permissions" ON "public"."role_permissions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view roles" ON "public"."roles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view short links" ON "public"."short_links" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



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



CREATE POLICY "Managers can delete bookings" ON "public"."table_bookings" FOR DELETE USING ("public"."user_has_permission"("auth"."uid"(), 'table_bookings'::"text", 'manage'::"text"));



CREATE POLICY "Managers can manage booking time slots" ON "public"."booking_time_slots" USING ("public"."user_has_permission"("auth"."uid"(), 'table_bookings'::"text", 'manage'::"text"));



CREATE POLICY "Managers can manage menu items" ON "public"."sunday_lunch_menu_items" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = ANY (ARRAY['super_admin'::"text", 'manager'::"text"]))))));



CREATE POLICY "Managers can manage slots" ON "public"."service_slots" USING ((("auth"."role"() = 'service_role'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE ("user_roles"."user_id" = "auth"."uid"())))));



CREATE POLICY "Managers can manage system settings" ON "public"."system_settings" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = ANY (ARRAY['super_admin'::"text", 'manager'::"text"]))))));



CREATE POLICY "Managers can manage tables" ON "public"."tables" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = ANY (ARRAY['super_admin'::"text", 'manager'::"text"]))))));



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



CREATE POLICY "Public can view active menu items" ON "public"."sunday_lunch_menu_items" FOR SELECT USING (("is_active" = true));



CREATE POLICY "Service role can do everything" ON "public"."private_booking_sms_queue" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can manage API keys" ON "public"."api_keys" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can manage booking_reminders" ON "public"."booking_reminders" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can manage jobs" ON "public"."background_jobs" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



CREATE POLICY "Service role can manage pending bookings" ON "public"."pending_bookings" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



CREATE POLICY "Service role can manage reminder logs" ON "public"."reminder_processing_logs" TO "service_role" USING (true);



CREATE POLICY "Service role full access" ON "public"."job_queue" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



CREATE POLICY "Service role manages jobs" ON "public"."jobs" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role only" ON "public"."idempotency_keys" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Staff can create bookings" ON "public"."table_bookings" FOR INSERT WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'table_bookings'::"text", 'create'::"text"));



CREATE POLICY "Staff can create modifications" ON "public"."table_booking_modifications" FOR INSERT WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'table_bookings'::"text", 'edit'::"text"));



CREATE POLICY "Staff can create point transactions" ON "public"."loyalty_point_transactions" FOR INSERT WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'manage'::"text"));



CREATE POLICY "Staff can manage achievement progress" ON "public"."achievement_progress" USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'manage'::"text"));



CREATE POLICY "Staff can manage achievements" ON "public"."loyalty_achievements" USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'manage'::"text"));



CREATE POLICY "Staff can manage booking items" ON "public"."table_booking_items" USING ("public"."user_has_permission"("auth"."uid"(), 'table_bookings'::"text", 'view'::"text"));



CREATE POLICY "Staff can manage campaigns" ON "public"."loyalty_campaigns" USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'manage'::"text"));



CREATE POLICY "Staff can manage challenges" ON "public"."loyalty_challenges" USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'manage'::"text"));



CREATE POLICY "Staff can manage check-ins" ON "public"."event_check_ins" USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'manage'::"text"));



CREATE POLICY "Staff can manage customer achievements" ON "public"."customer_achievements" USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'manage'::"text"));



CREATE POLICY "Staff can manage customer challenges" ON "public"."customer_challenges" USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'manage'::"text"));



CREATE POLICY "Staff can manage event check-ins" ON "public"."event_check_ins" USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'manage'::"text"));



CREATE POLICY "Staff can manage loyalty members" ON "public"."loyalty_members" USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'manage'::"text"));



CREATE POLICY "Staff can manage loyalty programs" ON "public"."loyalty_programs" USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'manage'::"text"));



CREATE POLICY "Staff can manage loyalty tiers" ON "public"."loyalty_tiers" USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'manage'::"text"));



CREATE POLICY "Staff can manage point transactions" ON "public"."loyalty_point_transactions" USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'manage'::"text"));



CREATE POLICY "Staff can manage redemptions" ON "public"."reward_redemptions" USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'manage'::"text"));



CREATE POLICY "Staff can manage rewards" ON "public"."loyalty_rewards" USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'manage'::"text"));



CREATE POLICY "Staff can update bookings" ON "public"."table_bookings" FOR UPDATE USING ("public"."user_has_permission"("auth"."uid"(), 'table_bookings'::"text", 'edit'::"text"));



CREATE POLICY "Staff can view SMS templates" ON "public"."table_booking_sms_templates" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'table_bookings'::"text", 'view'::"text"));



CREATE POLICY "Staff can view achievement progress" ON "public"."achievement_progress" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'view'::"text"));



CREATE POLICY "Staff can view achievements" ON "public"."loyalty_achievements" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'view'::"text"));



CREATE POLICY "Staff can view all bookings" ON "public"."table_bookings" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'table_bookings'::"text", 'view'::"text"));



CREATE POLICY "Staff can view all menu items" ON "public"."sunday_lunch_menu_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = ANY (ARRAY['super_admin'::"text", 'manager'::"text", 'staff'::"text"]))))));



CREATE POLICY "Staff can view all modifications" ON "public"."table_booking_modifications" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'table_bookings'::"text", 'view'::"text"));



CREATE POLICY "Staff can view campaigns" ON "public"."loyalty_campaigns" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'view'::"text"));



CREATE POLICY "Staff can view challenges" ON "public"."loyalty_challenges" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'view'::"text"));



CREATE POLICY "Staff can view check-ins" ON "public"."event_check_ins" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'view'::"text"));



CREATE POLICY "Staff can view customer achievements" ON "public"."customer_achievements" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'view'::"text"));



CREATE POLICY "Staff can view customer challenges" ON "public"."customer_challenges" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'view'::"text"));



CREATE POLICY "Staff can view event check-ins" ON "public"."event_check_ins" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'view'::"text"));



CREATE POLICY "Staff can view loyalty members" ON "public"."loyalty_members" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'view'::"text"));



CREATE POLICY "Staff can view loyalty programs" ON "public"."loyalty_programs" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'view'::"text"));



CREATE POLICY "Staff can view loyalty tiers" ON "public"."loyalty_tiers" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'view'::"text"));



CREATE POLICY "Staff can view payment info" ON "public"."table_booking_payments" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'table_bookings'::"text", 'view'::"text"));



CREATE POLICY "Staff can view point transactions" ON "public"."loyalty_point_transactions" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'view'::"text"));



CREATE POLICY "Staff can view redemptions" ON "public"."reward_redemptions" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'view'::"text"));



CREATE POLICY "Staff can view reminder history" ON "public"."table_booking_reminder_history" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = ANY (ARRAY['super_admin'::"text", 'manager'::"text", 'staff'::"text"]))))));



CREATE POLICY "Staff can view rewards" ON "public"."loyalty_rewards" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'loyalty'::"text", 'view'::"text"));



CREATE POLICY "Staff can view system settings" ON "public"."system_settings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = ANY (ARRAY['super_admin'::"text", 'manager'::"text", 'staff'::"text"]))))));



CREATE POLICY "Staff can view tables" ON "public"."tables" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = ANY (ARRAY['super_admin'::"text", 'manager'::"text", 'staff'::"text"]))))));



CREATE POLICY "Superadmin access" ON "public"."invoice_email_logs" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "Superadmin access" ON "public"."invoice_line_items" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "Superadmin access" ON "public"."invoice_payments" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "Superadmin access" ON "public"."invoice_vendors" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "Superadmin access" ON "public"."invoices" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "Superadmin access" ON "public"."line_item_catalog" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "Superadmin access" ON "public"."quote_line_items" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "Superadmin access" ON "public"."quotes" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "Superadmin access" ON "public"."recurring_invoice_line_items" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "Superadmin access" ON "public"."recurring_invoices" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "Superadmins can create invoice emails" ON "public"."invoice_emails" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "Superadmins can manage email templates" ON "public"."invoice_email_templates" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "Superadmins can manage reminder settings" ON "public"."invoice_reminder_settings" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "Superadmins can manage vendor contacts" ON "public"."vendor_contacts" USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "Superadmins can view email templates" ON "public"."invoice_email_templates" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "Superadmins can view invoice audit" ON "public"."invoice_audit" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "Superadmins can view invoice emails" ON "public"."invoice_emails" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "Superadmins can view recurring history" ON "public"."recurring_invoice_history" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "Superadmins can view reminder settings" ON "public"."invoice_reminder_settings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "System can insert reminder history" ON "public"."table_booking_reminder_history" FOR INSERT WITH CHECK (true);



CREATE POLICY "System can insert template history" ON "public"."message_template_history" FOR INSERT WITH CHECK (true);



CREATE POLICY "System can manage API keys" ON "public"."api_keys" USING (("auth"."uid"() IN ( SELECT "ur"."user_id"
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE ("r"."name" = 'super_admin'::"text"))));



CREATE POLICY "System can manage payments" ON "public"."table_booking_payments" USING ("public"."user_has_permission"("auth"."uid"(), 'table_bookings'::"text", 'manage'::"text"));



CREATE POLICY "Users can approve SMS with permission" ON "public"."private_booking_sms_queue" FOR UPDATE TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'approve_sms'::"text")) WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'approve_sms'::"text"));



CREATE POLICY "Users can create employees" ON "public"."employees" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Users can create jobs" ON "public"."job_queue" FOR INSERT WITH CHECK (("auth"."uid"() = "created_by"));



CREATE POLICY "Users can create notes" ON "public"."employee_notes" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Users can create private bookings with permission" ON "public"."private_bookings" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'create'::"text"));



CREATE POLICY "Users can delete employees" ON "public"."employees" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Users can delete own notes" ON "public"."employee_notes" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "created_by_user_id"));



CREATE POLICY "Users can delete own short links" ON "public"."short_links" FOR DELETE USING ((("created_by" = "auth"."uid"()) OR ("created_by" IS NULL)));



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



CREATE POLICY "Users can manage onboarding checklist based on employee permiss" ON "public"."employee_onboarding_checklist" USING ("public"."user_has_permission"("auth"."uid"(), 'employees'::"text", 'edit'::"text"));



CREATE POLICY "Users can manage right to work based on employee permissions" ON "public"."employee_right_to_work" USING ("public"."user_has_permission"("auth"."uid"(), 'employees'::"text", 'edit'::"text"));



CREATE POLICY "Users can manage table combination tables with permission" ON "public"."table_combination_tables" USING ("public"."user_has_permission"("auth"."uid"(), 'table_bookings'::"text", 'manage'::"text"));



CREATE POLICY "Users can manage table combinations with permission" ON "public"."table_combinations" USING ("public"."user_has_permission"("auth"."uid"(), 'table_bookings'::"text", 'manage'::"text"));



CREATE POLICY "Users can manage table configuration with permission" ON "public"."table_configuration" USING ("public"."user_has_permission"("auth"."uid"(), 'table_bookings'::"text", 'manage'::"text"));



CREATE POLICY "Users can manage templates" ON "public"."message_templates" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Users can manage vendors with permission" ON "public"."vendors" TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'manage_vendors'::"text")) WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'manage_vendors'::"text"));



CREATE POLICY "Users can manage venue spaces with permission" ON "public"."venue_spaces" TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'manage_spaces'::"text")) WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'manage_spaces'::"text"));



CREATE POLICY "Users can update employees" ON "public"."employees" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Users can update own notes" ON "public"."employee_notes" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "created_by_user_id")) WITH CHECK (("auth"."uid"() = "created_by_user_id"));



CREATE POLICY "Users can update own short links" ON "public"."short_links" FOR UPDATE USING ((("created_by" = "auth"."uid"()) OR ("created_by" IS NULL))) WITH CHECK ((("created_by" = "auth"."uid"()) OR ("created_by" IS NULL)));



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



CREATE POLICY "Users can view onboarding checklist based on employee permissio" ON "public"."employee_onboarding_checklist" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'employees'::"text", 'view'::"text"));



CREATE POLICY "Users can view own auth logs" ON "public"."audit_logs" FOR SELECT USING ((("auth"."role"() = 'authenticated'::"text") AND ("user_id" = "auth"."uid"()) AND ("operation_type" = ANY (ARRAY['login'::"text", 'logout'::"text"]))));



CREATE POLICY "Users can view own jobs" ON "public"."job_queue" FOR SELECT USING (("auth"."uid"() = "created_by"));



CREATE POLICY "Users can view private bookings with permission" ON "public"."private_bookings" FOR SELECT TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'view'::"text"));



CREATE POLICY "Users can view reminder logs" ON "public"."reminder_processing_logs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view right to work based on employee permissions" ON "public"."employee_right_to_work" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'employees'::"text", 'view'::"text"));



CREATE POLICY "Users can view table combination tables with permission" ON "public"."table_combination_tables" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'table_bookings'::"text", 'view'::"text"));



CREATE POLICY "Users can view table combinations with permission" ON "public"."table_combinations" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'table_bookings'::"text", 'view'::"text"));



CREATE POLICY "Users can view table configuration with permission" ON "public"."table_configuration" FOR SELECT USING ("public"."user_has_permission"("auth"."uid"(), 'table_bookings'::"text", 'view'::"text"));



CREATE POLICY "Users can view their own roles" ON "public"."user_roles" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."user_has_permission"("auth"."uid"(), 'users'::"text", 'view'::"text")));



CREATE POLICY "Users with audit permission can view all logs" ON "public"."audit_logs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."user_has_permission"("auth"."uid"(), 'audit_logs'::"text", 'view'::"text") "user_has_permission"("user_has_permission")
  WHERE ("user_has_permission"."user_has_permission" = true))));



CREATE POLICY "Users with bookings create permission can create bookings" ON "public"."bookings" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'bookings'::"text", 'create'::"text"));



CREATE POLICY "Users with bookings delete permission can delete bookings" ON "public"."bookings" FOR DELETE TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'bookings'::"text", 'delete'::"text"));



CREATE POLICY "Users with bookings edit permission can update bookings" ON "public"."bookings" FOR UPDATE TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'bookings'::"text", 'edit'::"text")) WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'bookings'::"text", 'edit'::"text"));



CREATE POLICY "Users with bookings view permission can view bookings" ON "public"."bookings" FOR SELECT TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'bookings'::"text", 'view'::"text"));



CREATE POLICY "Users with customer edit permission can assign labels" ON "public"."customer_label_assignments" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ((("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
     JOIN "public"."role_permissions" "rp" ON (("r"."id" = "rp"."role_id")))
     JOIN "public"."permissions" "p" ON (("rp"."permission_id" = "p"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("p"."module_name" = 'customers'::"text") AND ("p"."action" = ANY (ARRAY['edit'::"text", 'manage'::"text"]))))));



CREATE POLICY "Users with customer edit permission can remove label assignment" ON "public"."customer_label_assignments" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ((("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
     JOIN "public"."role_permissions" "rp" ON (("r"."id" = "rp"."role_id")))
     JOIN "public"."permissions" "p" ON (("rp"."permission_id" = "p"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("p"."module_name" = 'customers'::"text") AND ("p"."action" = ANY (ARRAY['edit'::"text", 'manage'::"text"]))))));



CREATE POLICY "Users with customer manage permission can create labels" ON "public"."customer_labels" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ((("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
     JOIN "public"."role_permissions" "rp" ON (("r"."id" = "rp"."role_id")))
     JOIN "public"."permissions" "p" ON (("rp"."permission_id" = "p"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("p"."module_name" = 'customers'::"text") AND ("p"."action" = 'manage'::"text")))));



CREATE POLICY "Users with customer manage permission can delete labels" ON "public"."customer_labels" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ((("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
     JOIN "public"."role_permissions" "rp" ON (("r"."id" = "rp"."role_id")))
     JOIN "public"."permissions" "p" ON (("rp"."permission_id" = "p"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("p"."module_name" = 'customers'::"text") AND ("p"."action" = 'manage'::"text")))));



CREATE POLICY "Users with customer manage permission can update labels" ON "public"."customer_labels" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ((("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
     JOIN "public"."role_permissions" "rp" ON (("r"."id" = "rp"."role_id")))
     JOIN "public"."permissions" "p" ON (("rp"."permission_id" = "p"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("p"."module_name" = 'customers'::"text") AND ("p"."action" = 'manage'::"text")))));



CREATE POLICY "Users with customer view permission can view label assignments" ON "public"."customer_label_assignments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
     JOIN "public"."role_permissions" "rp" ON (("r"."id" = "rp"."role_id")))
     JOIN "public"."permissions" "p" ON (("rp"."permission_id" = "p"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("p"."module_name" = 'customers'::"text") AND ("p"."action" = 'view'::"text")))));



CREATE POLICY "Users with customer view permission can view labels" ON "public"."customer_labels" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
     JOIN "public"."role_permissions" "rp" ON (("r"."id" = "rp"."role_id")))
     JOIN "public"."permissions" "p" ON (("rp"."permission_id" = "p"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("p"."module_name" = 'customers'::"text") AND ("p"."action" = 'view'::"text")))));



CREATE POLICY "Users with customers create permission can create customers" ON "public"."customers" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'customers'::"text", 'create'::"text"));



CREATE POLICY "Users with customers delete permission can delete customers" ON "public"."customers" FOR DELETE TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'customers'::"text", 'delete'::"text"));



CREATE POLICY "Users with customers edit permission can update customers" ON "public"."customers" FOR UPDATE TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'customers'::"text", 'edit'::"text")) WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'customers'::"text", 'edit'::"text"));



CREATE POLICY "Users with customers view permission can view customers" ON "public"."customers" FOR SELECT TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'customers'::"text", 'view'::"text"));



CREATE POLICY "Users with events create permission can create events" ON "public"."events" FOR INSERT TO "authenticated" WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'events'::"text", 'create'::"text"));



CREATE POLICY "Users with events delete permission can delete events" ON "public"."events" FOR DELETE TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'events'::"text", 'delete'::"text"));



CREATE POLICY "Users with events edit permission can update events" ON "public"."events" FOR UPDATE TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'events'::"text", 'edit'::"text")) WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'events'::"text", 'edit'::"text"));



CREATE POLICY "Users with events view permission can view events" ON "public"."events" FOR SELECT TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'events'::"text", 'view'::"text"));



CREATE POLICY "Users with vendor view can see contacts" ON "public"."vendor_contacts" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."user_roles" "ur"
     JOIN "public"."roles" "r" ON (("ur"."role_id" = "r"."id")))
  WHERE (("ur"."user_id" = "auth"."uid"()) AND ("r"."name" = 'super_admin'::"text")))));



CREATE POLICY "View audit logs" ON "public"."booking_audit" FOR SELECT USING ((("auth"."role"() = 'service_role'::"text") OR ("booking_id" IN ( SELECT "table_bookings"."id"
   FROM "public"."table_bookings"
  WHERE ("table_bookings"."customer_id" IN ( SELECT "customers"."id"
           FROM "public"."customers"
          WHERE ("auth"."uid"() IS NOT NULL)))))));



CREATE POLICY "View click analytics" ON "public"."short_link_clicks" FOR SELECT USING (true);



ALTER TABLE "public"."achievement_progress" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "anon_read_customers_for_bookings" ON "public"."customers" FOR SELECT TO "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."pending_bookings"
  WHERE (("pending_bookings"."customer_id" = "customers"."id") AND ("pending_bookings"."customer_id" IS NOT NULL)))));



CREATE POLICY "anon_read_events_for_bookings" ON "public"."events" FOR SELECT TO "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."pending_bookings"
  WHERE ("pending_bookings"."event_id" = "events"."id"))));



CREATE POLICY "anon_read_pending_bookings" ON "public"."pending_bookings" FOR SELECT TO "anon" USING (true);



COMMENT ON POLICY "anon_read_pending_bookings" ON "public"."pending_bookings" IS 'Allow anonymous users to read pending bookings - security is enforced through unique UUID tokens';



ALTER TABLE "public"."api_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."api_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_logs_insert_policy" ON "public"."audit_logs" FOR INSERT WITH CHECK ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



CREATE POLICY "audit_logs_read_policy" ON "public"."audit_logs" FOR SELECT USING (("public"."user_has_permission"("auth"."uid"(), 'settings'::"text", 'view'::"text") OR ("user_id" = "auth"."uid"())));



ALTER TABLE "public"."background_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_policies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_reminders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_time_slots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."business_amenities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."business_hours" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."catering_packages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_achievements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_category_stats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_challenges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_label_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_labels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_attachments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_emergency_contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_financial_details" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_health_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_onboarding_checklist" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_right_to_work" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_check_ins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_faqs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_images" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_message_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."idempotency_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_email_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_email_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_emails" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_line_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_reminder_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_vendors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."job_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."line_item_catalog" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_achievements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_campaigns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_challenges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_point_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_programs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_rewards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_tiers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."menu_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."menu_sections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."message_delivery_status" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."message_template_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."message_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pending_bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."private_booking_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."private_booking_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."private_booking_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."private_booking_sms_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."private_bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quote_line_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quotes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recurring_invoice_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recurring_invoice_line_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recurring_invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reminder_processing_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reward_redemptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_slots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."short_link_clicks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."short_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."special_hours" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sunday_lunch_menu_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."table_booking_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."table_booking_modifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."table_booking_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."table_booking_reminder_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."table_booking_sms_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."table_bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."table_combination_tables" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."table_combinations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."table_configuration" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tables" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendor_contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."venue_spaces" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."webhook_deliveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."webhook_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."webhooks" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";




















































































































































































GRANT ALL ON FUNCTION "public"."apply_customer_labels_retroactively"() TO "anon";
GRANT ALL ON FUNCTION "public"."apply_customer_labels_retroactively"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_customer_labels_retroactively"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_generate_weekly_slots"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_generate_weekly_slots"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_generate_weekly_slots"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_balance_due_date"() TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_balance_due_date"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_balance_due_date"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_event_points"("p_base_points" integer, "p_tier_id" "uuid", "p_event_id" "uuid", "p_member_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_event_points"("p_base_points" integer, "p_tier_id" "uuid", "p_event_id" "uuid", "p_member_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_event_points"("p_base_points" integer, "p_tier_id" "uuid", "p_event_id" "uuid", "p_member_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_message_cost"("segments" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_message_cost"("segments" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_message_cost"("segments" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_next_generation_date"("p_frequency" character varying, "p_frequency_interval" integer, "p_current_date" "date", "p_day_of_month" integer, "p_day_of_week" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_next_generation_date"("p_frequency" character varying, "p_frequency_interval" integer, "p_current_date" "date", "p_day_of_month" integer, "p_day_of_week" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_next_generation_date"("p_frequency" character varying, "p_frequency_interval" integer, "p_current_date" "date", "p_day_of_month" integer, "p_day_of_week" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_private_booking_balance"("p_booking_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_private_booking_balance"("p_booking_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_private_booking_balance"("p_booking_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_refund_amount"("p_booking_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_refund_amount"("p_booking_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_refund_amount"("p_booking_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_send_time"("p_event_timestamp" timestamp with time zone, "p_send_timing" "text", "p_custom_hours" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_send_time"("p_event_timestamp" timestamp with time zone, "p_send_timing" "text", "p_custom_hours" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_send_time"("p_event_timestamp" timestamp with time zone, "p_send_timing" "text", "p_custom_hours" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."can_edit_invoice"("invoice_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_edit_invoice"("invoice_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_edit_invoice"("invoice_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."categorize_historical_events"() TO "anon";
GRANT ALL ON FUNCTION "public"."categorize_historical_events"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."categorize_historical_events"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_and_reserve_capacity"("p_service_date" "date", "p_booking_time" time without time zone, "p_party_size" integer, "p_booking_type" "public"."table_booking_type", "p_duration_minutes" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."check_and_reserve_capacity"("p_service_date" "date", "p_booking_time" time without time zone, "p_party_size" integer, "p_booking_type" "public"."table_booking_type", "p_duration_minutes" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_and_reserve_capacity"("p_service_date" "date", "p_booking_time" time without time zone, "p_party_size" integer, "p_booking_type" "public"."table_booking_type", "p_duration_minutes" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_event_date_not_past"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_event_date_not_past"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_event_date_not_past"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_expired_quotes"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_expired_quotes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_expired_quotes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_overdue_invoices"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_overdue_invoices"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_overdue_invoices"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_table_availability"("p_date" "date", "p_time" time without time zone, "p_party_size" integer, "p_duration_minutes" integer, "p_exclude_booking_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_table_availability"("p_date" "date", "p_time" time without time zone, "p_party_size" integer, "p_duration_minutes" integer, "p_exclude_booking_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_table_availability"("p_date" "date", "p_time" time without time zone, "p_party_size" integer, "p_duration_minutes" integer, "p_exclude_booking_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_tier_upgrade"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_tier_upgrade"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_tier_upgrade"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_expired_idempotency_keys"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_expired_idempotency_keys"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_expired_idempotency_keys"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_import"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_import"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_import"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_jobs"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_jobs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_jobs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_rate_limits"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_rate_limits"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_rate_limits"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_reminder_logs"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_reminder_logs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_reminder_logs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_service_slots"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_service_slots"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_service_slots"() TO "service_role";



GRANT ALL ON FUNCTION "public"."compare_employee_versions"("p_employee_id" "uuid", "p_version1" integer, "p_version2" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."compare_employee_versions"("p_employee_id" "uuid", "p_version1" integer, "p_version2" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compare_employee_versions"("p_employee_id" "uuid", "p_version1" integer, "p_version2" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."convert_quote_to_invoice"("p_quote_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."convert_quote_to_invoice"("p_quote_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."convert_quote_to_invoice"("p_quote_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_short_link"("p_destination_url" "text", "p_link_type" character varying, "p_metadata" "jsonb", "p_expires_at" timestamp with time zone, "p_custom_code" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."create_short_link"("p_destination_url" "text", "p_link_type" character varying, "p_metadata" "jsonb", "p_expires_at" timestamp with time zone, "p_custom_code" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_short_link"("p_destination_url" "text", "p_link_type" character varying, "p_metadata" "jsonb", "p_expires_at" timestamp with time zone, "p_custom_code" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_sunday_lunch_booking"("p_customer_id" "uuid", "p_booking_date" "date", "p_booking_time" time without time zone, "p_party_size" integer, "p_special_requirements" "text", "p_dietary_requirements" "text"[], "p_allergies" "text"[], "p_correlation_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_sunday_lunch_booking"("p_customer_id" "uuid", "p_booking_date" "date", "p_booking_time" time without time zone, "p_party_size" integer, "p_special_requirements" "text", "p_dietary_requirements" "text"[], "p_allergies" "text"[], "p_correlation_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_sunday_lunch_booking"("p_customer_id" "uuid", "p_booking_date" "date", "p_booking_time" time without time zone, "p_party_size" integer, "p_special_requirements" "text", "p_dietary_requirements" "text"[], "p_allergies" "text"[], "p_correlation_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."date_utc"(timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."date_utc"(timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."date_utc"(timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."encrypt_sensitive_audit_data"("p_encryption_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."encrypt_sensitive_audit_data"("p_encryption_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."encrypt_sensitive_audit_data"("p_encryption_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_single_default_category"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_single_default_category"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_single_default_category"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_booking_reference"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_booking_reference"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_booking_reference"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_invoice_from_recurring"("p_recurring_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_invoice_from_recurring"("p_recurring_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_invoice_from_recurring"("p_recurring_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_invoice_reminder_digest"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_invoice_reminder_digest"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_invoice_reminder_digest"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_loyalty_access_token"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_loyalty_access_token"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_loyalty_access_token"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_service_slots_for_period"("start_date" "date", "days_ahead" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."generate_service_slots_for_period"("start_date" "date", "days_ahead" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_service_slots_for_period"("start_date" "date", "days_ahead" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_service_slots_from_config"("start_date" "date", "days_ahead" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."generate_service_slots_from_config"("start_date" "date", "days_ahead" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_service_slots_from_config"("start_date" "date", "days_ahead" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_short_code"("length" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."generate_short_code"("length" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_short_code"("length" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_slots_simple"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_slots_simple"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_slots_simple"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_all_links_analytics"("p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_links_analytics"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_links_analytics"("p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_all_users_unsafe"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_users_unsafe"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_users_unsafe"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_all_users_with_roles"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_users_with_roles"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_users_with_roles"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_and_increment_invoice_series"("p_series_code" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."get_and_increment_invoice_series"("p_series_code" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_and_increment_invoice_series"("p_series_code" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_bookings_needing_reminders"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_bookings_needing_reminders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_bookings_needing_reminders"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_category_regulars"("p_category_id" "uuid", "p_days_back" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_category_regulars"("p_category_id" "uuid", "p_days_back" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_category_regulars"("p_category_id" "uuid", "p_days_back" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_cross_category_suggestions"("p_target_category_id" "uuid", "p_source_category_id" "uuid", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_cross_category_suggestions"("p_target_category_id" "uuid", "p_source_category_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_cross_category_suggestions"("p_target_category_id" "uuid", "p_source_category_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_customer_labels"("p_customer_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_customer_labels"("p_customer_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_customer_labels"("p_customer_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_employee_at_timestamp"("p_employee_id" "uuid", "p_timestamp" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_employee_at_timestamp"("p_employee_id" "uuid", "p_timestamp" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_employee_at_timestamp"("p_employee_id" "uuid", "p_timestamp" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_employee_changes_summary"("p_employee_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_employee_changes_summary"("p_employee_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_employee_changes_summary"("p_employee_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_invoice_summary_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_invoice_summary_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_invoice_summary_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_message_template"("p_event_id" "uuid", "p_template_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_message_template"("p_event_id" "uuid", "p_template_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_message_template"("p_event_id" "uuid", "p_template_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_next_booking_reference"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_next_booking_reference"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_next_booking_reference"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_short_link_analytics"("p_short_code" character varying, "p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_short_link_analytics"("p_short_code" character varying, "p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_short_link_analytics"("p_short_code" character varying, "p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_permissions"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_permissions"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_permissions"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_roles"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_roles"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_roles"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_users_for_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_users_for_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_users_for_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_vendor_invoice_email"("p_vendor_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_vendor_invoice_email"("p_vendor_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_vendor_invoice_email"("p_vendor_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_super_admin"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_super_admin"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_super_admin"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_audit_event"("p_user_id" "uuid", "p_user_email" "text", "p_operation_type" "text", "p_resource_type" "text", "p_resource_id" "text", "p_operation_status" "text", "p_ip_address" "inet", "p_user_agent" "text", "p_old_values" "jsonb", "p_new_values" "jsonb", "p_error_message" "text", "p_additional_info" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."log_audit_event"("p_user_id" "uuid", "p_user_email" "text", "p_operation_type" "text", "p_resource_type" "text", "p_resource_id" "text", "p_operation_status" "text", "p_ip_address" "inet", "p_user_agent" "text", "p_old_values" "jsonb", "p_new_values" "jsonb", "p_error_message" "text", "p_additional_info" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_audit_event"("p_user_id" "uuid", "p_user_email" "text", "p_operation_type" "text", "p_resource_type" "text", "p_resource_id" "text", "p_operation_status" "text", "p_ip_address" "inet", "p_user_agent" "text", "p_old_values" "jsonb", "p_new_values" "jsonb", "p_error_message" "text", "p_additional_info" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_invoice_audit"("p_invoice_id" "uuid", "p_action" character varying, "p_details" "jsonb", "p_old_values" "jsonb", "p_new_values" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."log_invoice_audit"("p_invoice_id" "uuid", "p_action" character varying, "p_details" "jsonb", "p_old_values" "jsonb", "p_new_values" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_invoice_audit"("p_invoice_id" "uuid", "p_action" character varying, "p_details" "jsonb", "p_old_values" "jsonb", "p_new_values" "jsonb") TO "service_role";



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



GRANT ALL ON FUNCTION "public"."process_recurring_invoices"() TO "anon";
GRANT ALL ON FUNCTION "public"."process_recurring_invoices"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_recurring_invoices"() TO "service_role";



GRANT ALL ON FUNCTION "public"."queue_private_booking_sms"("p_booking_id" "uuid", "p_trigger_type" "text", "p_template_key" "text", "p_message_body" "text", "p_recipient_phone" "text", "p_customer_name" "text", "p_priority" integer, "p_scheduled_for" timestamp with time zone, "p_metadata" "jsonb", "p_skip_conditions" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."queue_private_booking_sms"("p_booking_id" "uuid", "p_trigger_type" "text", "p_template_key" "text", "p_message_body" "text", "p_recipient_phone" "text", "p_customer_name" "text", "p_priority" integer, "p_scheduled_for" timestamp with time zone, "p_metadata" "jsonb", "p_skip_conditions" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."queue_private_booking_sms"("p_booking_id" "uuid", "p_trigger_type" "text", "p_template_key" "text", "p_message_body" "text", "p_recipient_phone" "text", "p_customer_name" "text", "p_priority" integer, "p_scheduled_for" timestamp with time zone, "p_metadata" "jsonb", "p_skip_conditions" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rebuild_customer_category_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."rebuild_customer_category_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rebuild_customer_category_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."recalculate_invoice_totals"("p_invoice_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recalculate_invoice_totals"("p_invoice_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalculate_invoice_totals"("p_invoice_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."recalculate_quote_totals"("p_quote_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recalculate_quote_totals"("p_quote_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalculate_quote_totals"("p_quote_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."render_template"("p_template" "text", "p_variables" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."render_template"("p_template" "text", "p_variables" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."render_template"("p_template" "text", "p_variables" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."restore_employee_version"("p_employee_id" "uuid", "p_version_number" integer, "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."restore_employee_version"("p_employee_id" "uuid", "p_version_number" integer, "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."restore_employee_version"("p_employee_id" "uuid", "p_version_number" integer, "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_booking_reference"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_booking_reference"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_booking_reference"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_loyalty_access_token"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_loyalty_access_token"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_loyalty_access_token"() TO "service_role";



GRANT ALL ON FUNCTION "public"."should_send_private_booking_sms"("p_booking_id" "uuid", "p_phone" "text", "p_priority" integer, "p_trigger_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."should_send_private_booking_sms"("p_booking_id" "uuid", "p_phone" "text", "p_priority" integer, "p_trigger_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."should_send_private_booking_sms"("p_booking_id" "uuid", "p_phone" "text", "p_priority" integer, "p_trigger_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."standardize_phone_flexible"("phone" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."standardize_phone_flexible"("phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."standardize_phone_flexible"("phone" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_customer_name_from_customers"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_customer_name_from_customers"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_customer_name_from_customers"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_log_invoice_changes"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_log_invoice_changes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_log_invoice_changes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_recalculate_invoice_totals"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_recalculate_invoice_totals"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_recalculate_invoice_totals"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_recalculate_quote_totals"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_recalculate_quote_totals"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_recalculate_quote_totals"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_update_invoice_payment_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_update_invoice_payment_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_update_invoice_payment_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_customer_booking_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_customer_booking_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_customer_booking_stats"() TO "service_role";



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



GRANT ALL ON FUNCTION "public"."update_invoice_payment_status"("p_invoice_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."update_invoice_payment_status"("p_invoice_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_invoice_payment_status"("p_invoice_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_messages_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_messages_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_messages_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."user_has_permission"("p_user_id" "uuid", "p_module_name" "text", "p_action" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."user_has_permission"("p_user_id" "uuid", "p_module_name" "text", "p_action" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_has_permission"("p_user_id" "uuid", "p_module_name" "text", "p_action" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_booking_against_policy"("p_booking_type" "public"."table_booking_type", "p_booking_date" "date", "p_booking_time" time without time zone, "p_party_size" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."validate_booking_against_policy"("p_booking_type" "public"."table_booking_type", "p_booking_date" "date", "p_booking_time" time without time zone, "p_party_size" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_booking_against_policy"("p_booking_type" "public"."table_booking_type", "p_booking_date" "date", "p_booking_time" time without time zone, "p_party_size" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_employee_attachment_upload"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_employee_attachment_upload"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_employee_attachment_upload"() TO "service_role";


















GRANT ALL ON TABLE "public"."achievement_progress" TO "anon";
GRANT ALL ON TABLE "public"."achievement_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."achievement_progress" TO "service_role";



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



GRANT ALL ON TABLE "public"."booking_audit" TO "anon";
GRANT ALL ON TABLE "public"."booking_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_audit" TO "service_role";



GRANT ALL ON SEQUENCE "public"."booking_audit_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."booking_audit_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."booking_audit_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."booking_policies" TO "anon";
GRANT ALL ON TABLE "public"."booking_policies" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_policies" TO "service_role";



GRANT ALL ON SEQUENCE "public"."booking_reference_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."booking_reference_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."booking_reference_seq" TO "service_role";



GRANT ALL ON TABLE "public"."booking_reminders" TO "anon";
GRANT ALL ON TABLE "public"."booking_reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_reminders" TO "service_role";



GRANT ALL ON TABLE "public"."booking_time_slots" TO "anon";
GRANT ALL ON TABLE "public"."booking_time_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_time_slots" TO "service_role";



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



GRANT ALL ON TABLE "public"."customer_achievements" TO "anon";
GRANT ALL ON TABLE "public"."customer_achievements" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_achievements" TO "service_role";



GRANT ALL ON TABLE "public"."customer_category_stats" TO "anon";
GRANT ALL ON TABLE "public"."customer_category_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_category_stats" TO "service_role";



GRANT ALL ON TABLE "public"."customer_challenges" TO "anon";
GRANT ALL ON TABLE "public"."customer_challenges" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_challenges" TO "service_role";



GRANT ALL ON TABLE "public"."customer_label_assignments" TO "anon";
GRANT ALL ON TABLE "public"."customer_label_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_label_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."customer_labels" TO "anon";
GRANT ALL ON TABLE "public"."customer_labels" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_labels" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";
GRANT SELECT ON TABLE "public"."customers" TO "anon";



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



GRANT ALL ON TABLE "public"."employee_onboarding_checklist" TO "anon";
GRANT ALL ON TABLE "public"."employee_onboarding_checklist" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_onboarding_checklist" TO "service_role";



GRANT ALL ON TABLE "public"."employee_right_to_work" TO "anon";
GRANT ALL ON TABLE "public"."employee_right_to_work" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_right_to_work" TO "service_role";



GRANT ALL ON TABLE "public"."employee_version_history" TO "anon";
GRANT ALL ON TABLE "public"."employee_version_history" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_version_history" TO "service_role";



GRANT ALL ON TABLE "public"."employees" TO "anon";
GRANT ALL ON TABLE "public"."employees" TO "authenticated";
GRANT ALL ON TABLE "public"."employees" TO "service_role";



GRANT ALL ON TABLE "public"."event_categories" TO "anon";
GRANT ALL ON TABLE "public"."event_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."event_categories" TO "service_role";



GRANT ALL ON TABLE "public"."event_check_ins" TO "anon";
GRANT ALL ON TABLE "public"."event_check_ins" TO "authenticated";
GRANT ALL ON TABLE "public"."event_check_ins" TO "service_role";



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
GRANT SELECT ON TABLE "public"."events" TO "anon";



GRANT ALL ON TABLE "public"."idempotency_keys" TO "anon";
GRANT ALL ON TABLE "public"."idempotency_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."idempotency_keys" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_audit" TO "anon";
GRANT ALL ON TABLE "public"."invoice_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_audit" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_email_logs" TO "anon";
GRANT ALL ON TABLE "public"."invoice_email_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_email_logs" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_email_templates" TO "anon";
GRANT ALL ON TABLE "public"."invoice_email_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_email_templates" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_emails" TO "anon";
GRANT ALL ON TABLE "public"."invoice_emails" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_emails" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_line_items" TO "anon";
GRANT ALL ON TABLE "public"."invoice_line_items" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_line_items" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_payments" TO "anon";
GRANT ALL ON TABLE "public"."invoice_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_payments" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_reminder_settings" TO "anon";
GRANT ALL ON TABLE "public"."invoice_reminder_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_reminder_settings" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_series" TO "anon";
GRANT ALL ON TABLE "public"."invoice_series" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_series" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_vendors" TO "anon";
GRANT ALL ON TABLE "public"."invoice_vendors" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_vendors" TO "service_role";



GRANT ALL ON TABLE "public"."invoices" TO "anon";
GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT ALL ON TABLE "public"."job_queue" TO "anon";
GRANT ALL ON TABLE "public"."job_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."job_queue" TO "service_role";



GRANT ALL ON TABLE "public"."jobs" TO "anon";
GRANT ALL ON TABLE "public"."jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."jobs" TO "service_role";



GRANT ALL ON TABLE "public"."line_item_catalog" TO "anon";
GRANT ALL ON TABLE "public"."line_item_catalog" TO "authenticated";
GRANT ALL ON TABLE "public"."line_item_catalog" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_achievements" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_achievements" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_achievements" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_campaigns" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_challenges" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_challenges" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_challenges" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_members" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_members" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_members" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_point_transactions" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_point_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_point_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_programs" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_programs" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_programs" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_rewards" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_rewards" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_rewards" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_tiers" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_tiers" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_tiers" TO "service_role";



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



GRANT ALL ON TABLE "public"."pending_bookings" TO "anon";
GRANT ALL ON TABLE "public"."pending_bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."pending_bookings" TO "service_role";



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



GRANT ALL ON TABLE "public"."quote_line_items" TO "anon";
GRANT ALL ON TABLE "public"."quote_line_items" TO "authenticated";
GRANT ALL ON TABLE "public"."quote_line_items" TO "service_role";



GRANT ALL ON TABLE "public"."quotes" TO "anon";
GRANT ALL ON TABLE "public"."quotes" TO "authenticated";
GRANT ALL ON TABLE "public"."quotes" TO "service_role";



GRANT ALL ON TABLE "public"."rate_limits" TO "anon";
GRANT ALL ON TABLE "public"."rate_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."reminder_processing_logs" TO "anon";
GRANT ALL ON TABLE "public"."reminder_processing_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."reminder_processing_logs" TO "service_role";



GRANT ALL ON TABLE "public"."recent_reminder_activity" TO "anon";
GRANT ALL ON TABLE "public"."recent_reminder_activity" TO "authenticated";
GRANT ALL ON TABLE "public"."recent_reminder_activity" TO "service_role";



GRANT ALL ON TABLE "public"."recurring_invoice_history" TO "anon";
GRANT ALL ON TABLE "public"."recurring_invoice_history" TO "authenticated";
GRANT ALL ON TABLE "public"."recurring_invoice_history" TO "service_role";



GRANT ALL ON TABLE "public"."recurring_invoice_line_items" TO "anon";
GRANT ALL ON TABLE "public"."recurring_invoice_line_items" TO "authenticated";
GRANT ALL ON TABLE "public"."recurring_invoice_line_items" TO "service_role";



GRANT ALL ON TABLE "public"."recurring_invoices" TO "anon";
GRANT ALL ON TABLE "public"."recurring_invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."recurring_invoices" TO "service_role";



GRANT ALL ON TABLE "public"."reminder_timing_debug" TO "anon";
GRANT ALL ON TABLE "public"."reminder_timing_debug" TO "authenticated";
GRANT ALL ON TABLE "public"."reminder_timing_debug" TO "service_role";



GRANT ALL ON TABLE "public"."reward_redemptions" TO "anon";
GRANT ALL ON TABLE "public"."reward_redemptions" TO "authenticated";
GRANT ALL ON TABLE "public"."reward_redemptions" TO "service_role";



GRANT ALL ON TABLE "public"."role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";



GRANT ALL ON TABLE "public"."service_slot_config" TO "anon";
GRANT ALL ON TABLE "public"."service_slot_config" TO "authenticated";
GRANT ALL ON TABLE "public"."service_slot_config" TO "service_role";



GRANT ALL ON TABLE "public"."service_slot_overrides" TO "anon";
GRANT ALL ON TABLE "public"."service_slot_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."service_slot_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."service_slots" TO "anon";
GRANT ALL ON TABLE "public"."service_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."service_slots" TO "service_role";



GRANT ALL ON TABLE "public"."short_link_clicks" TO "anon";
GRANT ALL ON TABLE "public"."short_link_clicks" TO "authenticated";
GRANT ALL ON TABLE "public"."short_link_clicks" TO "service_role";



GRANT ALL ON TABLE "public"."short_links" TO "anon";
GRANT ALL ON TABLE "public"."short_links" TO "authenticated";
GRANT ALL ON TABLE "public"."short_links" TO "service_role";



GRANT ALL ON TABLE "public"."short_link_daily_stats" TO "anon";
GRANT ALL ON TABLE "public"."short_link_daily_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."short_link_daily_stats" TO "service_role";



GRANT ALL ON TABLE "public"."special_hours" TO "anon";
GRANT ALL ON TABLE "public"."special_hours" TO "authenticated";
GRANT ALL ON TABLE "public"."special_hours" TO "service_role";



GRANT ALL ON TABLE "public"."sunday_lunch_menu_items" TO "anon";
GRANT ALL ON TABLE "public"."sunday_lunch_menu_items" TO "authenticated";
GRANT ALL ON TABLE "public"."sunday_lunch_menu_items" TO "service_role";



GRANT ALL ON TABLE "public"."system_settings" TO "anon";
GRANT ALL ON TABLE "public"."system_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."system_settings" TO "service_role";



GRANT ALL ON TABLE "public"."table_booking_items" TO "anon";
GRANT ALL ON TABLE "public"."table_booking_items" TO "authenticated";
GRANT ALL ON TABLE "public"."table_booking_items" TO "service_role";



GRANT ALL ON TABLE "public"."table_booking_modifications" TO "anon";
GRANT ALL ON TABLE "public"."table_booking_modifications" TO "authenticated";
GRANT ALL ON TABLE "public"."table_booking_modifications" TO "service_role";



GRANT ALL ON TABLE "public"."table_booking_payments" TO "anon";
GRANT ALL ON TABLE "public"."table_booking_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."table_booking_payments" TO "service_role";



GRANT ALL ON TABLE "public"."table_booking_reminder_history" TO "anon";
GRANT ALL ON TABLE "public"."table_booking_reminder_history" TO "authenticated";
GRANT ALL ON TABLE "public"."table_booking_reminder_history" TO "service_role";



GRANT ALL ON TABLE "public"."table_booking_sms_templates" TO "anon";
GRANT ALL ON TABLE "public"."table_booking_sms_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."table_booking_sms_templates" TO "service_role";



GRANT ALL ON TABLE "public"."table_bookings" TO "anon";
GRANT ALL ON TABLE "public"."table_bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."table_bookings" TO "service_role";



GRANT ALL ON TABLE "public"."table_combination_tables" TO "anon";
GRANT ALL ON TABLE "public"."table_combination_tables" TO "authenticated";
GRANT ALL ON TABLE "public"."table_combination_tables" TO "service_role";



GRANT ALL ON TABLE "public"."table_combinations" TO "anon";
GRANT ALL ON TABLE "public"."table_combinations" TO "authenticated";
GRANT ALL ON TABLE "public"."table_combinations" TO "service_role";



GRANT ALL ON TABLE "public"."table_configuration" TO "anon";
GRANT ALL ON TABLE "public"."table_configuration" TO "authenticated";
GRANT ALL ON TABLE "public"."table_configuration" TO "service_role";



GRANT ALL ON TABLE "public"."tables" TO "anon";
GRANT ALL ON TABLE "public"."tables" TO "authenticated";
GRANT ALL ON TABLE "public"."tables" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_contacts" TO "anon";
GRANT ALL ON TABLE "public"."vendor_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_contacts" TO "service_role";



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
