

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


CREATE OR REPLACE FUNCTION "public"."get_message_template"("p_event_id" "uuid", "p_template_type" "text") RETURNS TABLE("content" "text", "variables" "text"[])
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- First check for event-specific template
  RETURN QUERY
  SELECT emt.content, emt.variables
  FROM event_message_templates emt
  WHERE emt.event_id = p_event_id
    AND emt.template_type = p_template_type
    AND emt.is_active = true
  LIMIT 1;
  
  -- If no event-specific template, return default
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT mt.content, mt.variables
    FROM message_templates mt
    WHERE mt.template_type = p_template_type
      AND mt.is_default = true
      AND mt.is_active = true
    LIMIT 1;
  END IF;
END;
$$;


ALTER FUNCTION "public"."get_message_template"("p_event_id" "uuid", "p_template_type" "text") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."log_template_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
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


COMMENT ON TABLE "public"."audit_logs" IS 'Immutable audit log for tracking sensitive operations';



COMMENT ON COLUMN "public"."audit_logs"."operation_type" IS 'Type of operation: login, logout, create, update, delete, view, export, etc.';



COMMENT ON COLUMN "public"."audit_logs"."resource_type" IS 'Type of resource: employee, customer, financial_details, health_records, attachment, etc.';



COMMENT ON COLUMN "public"."audit_logs"."old_values" IS 'Previous values before update (for update operations)';



COMMENT ON COLUMN "public"."audit_logs"."new_values" IS 'New values after update (for create/update operations)';



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
    CONSTRAINT "chk_customer_phone_format" CHECK (("mobile_number" ~* '^(\+?44|0)?[0-9]{10,11}$'::"text")),
    CONSTRAINT "customers_messaging_status_check" CHECK (("messaging_status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'invalid_number'::"text", 'opted_out'::"text"])))
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


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



COMMENT ON CONSTRAINT "chk_customer_phone_format" ON "public"."customers" IS 'Ensures UK phone numbers are in valid format';



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
    CONSTRAINT "messages_direction_check" CHECK (("direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text"]))),
    CONSTRAINT "messages_message_type_check" CHECK (("message_type" = ANY (ARRAY['sms'::"text", 'mms'::"text", 'whatsapp'::"text"])))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."messages"."twilio_message_sid" IS 'Twilio message SID for tracking';



COMMENT ON COLUMN "public"."messages"."error_code" IS 'Twilio error code if message failed';



COMMENT ON COLUMN "public"."messages"."error_message" IS 'Human-readable error message if failed';



COMMENT ON COLUMN "public"."messages"."twilio_status" IS 'Current status of the message from Twilio (queued, sent, delivered, failed, etc)';



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
    CONSTRAINT "chk_employee_phone_format" CHECK ((("phone_number" IS NULL) OR ("phone_number" ~* '^(\+?44|0)?[0-9]{10,11}$'::"text"))),
    CONSTRAINT "chk_employee_status" CHECK (("status" = ANY (ARRAY['Active'::"text", 'Former'::"text"]))),
    CONSTRAINT "chk_employment_dates" CHECK ((("employment_end_date" IS NULL) OR ("employment_end_date" > "employment_start_date")))
);


ALTER TABLE "public"."employees" OWNER TO "postgres";


COMMENT ON CONSTRAINT "chk_date_of_birth" ON "public"."employees" IS 'Ensures date of birth is reasonable (after 1900 and before current date)';



COMMENT ON CONSTRAINT "chk_employee_email_format" ON "public"."employees" IS 'Ensures email addresses follow valid format';



COMMENT ON CONSTRAINT "chk_employee_status" ON "public"."employees" IS 'Ensures employee status is either Active or Former';



COMMENT ON CONSTRAINT "chk_employment_dates" ON "public"."employees" IS 'Ensures employment end date is after start date';



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
    CONSTRAINT "event_message_templates_template_type_check" CHECK (("template_type" = ANY (ARRAY['booking_confirmation'::"text", 'reminder_7_day'::"text", 'reminder_24_hour'::"text", 'custom'::"text"])))
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
    CONSTRAINT "chk_event_date_reasonable" CHECK (("date" >= (CURRENT_DATE - '1 year'::interval))),
    CONSTRAINT "events_capacity_check" CHECK ((("capacity" IS NULL) OR ("capacity" > 0)))
);


ALTER TABLE "public"."events" OWNER TO "postgres";


COMMENT ON COLUMN "public"."events"."capacity" IS 'Maximum number of seats available for the event. NULL means unlimited capacity.';



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
    CONSTRAINT "message_templates_template_type_check" CHECK (("template_type" = ANY (ARRAY['booking_confirmation'::"text", 'reminder_7_day'::"text", 'reminder_24_hour'::"text", 'custom'::"text"])))
);


ALTER TABLE "public"."message_templates" OWNER TO "postgres";


COMMENT ON TABLE "public"."message_templates" IS 'System-wide message templates for SMS communications';



CREATE TABLE IF NOT EXISTS "public"."permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "module_name" "text" NOT NULL,
    "action" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."permissions" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "user_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"(),
    "assigned_by" "uuid"
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


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


ALTER TABLE ONLY "public"."attachment_categories"
    ADD CONSTRAINT "attachment_categories_category_name_key" UNIQUE ("category_name");



ALTER TABLE ONLY "public"."attachment_categories"
    ADD CONSTRAINT "attachment_categories_pkey" PRIMARY KEY ("category_id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_customer_id_event_id_key" UNIQUE ("customer_id", "event_id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."event_message_templates"
    ADD CONSTRAINT "event_message_templates_event_id_template_type_key" UNIQUE ("event_id", "template_type");



ALTER TABLE ONLY "public"."event_message_templates"
    ADD CONSTRAINT "event_message_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id", "role_id");



ALTER TABLE ONLY "public"."webhook_logs"
    ADD CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_audit_logs_created_at" ON "public"."audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_logs_operation_type" ON "public"."audit_logs" USING "btree" ("operation_type");



CREATE INDEX "idx_audit_logs_resource" ON "public"."audit_logs" USING "btree" ("resource_type", "resource_id");



CREATE INDEX "idx_audit_logs_user_id" ON "public"."audit_logs" USING "btree" ("user_id");



CREATE INDEX "idx_bookings_customer_id" ON "public"."bookings" USING "btree" ("customer_id");



CREATE INDEX "idx_bookings_event_id" ON "public"."bookings" USING "btree" ("event_id");



CREATE INDEX "idx_customers_consecutive_failures" ON "public"."customers" USING "btree" ("consecutive_failures");



CREATE INDEX "idx_customers_messaging_status" ON "public"."customers" USING "btree" ("messaging_status");



CREATE INDEX "idx_customers_sms_delivery_failures" ON "public"."customers" USING "btree" ("sms_delivery_failures");



CREATE INDEX "idx_customers_sms_opt_in" ON "public"."customers" USING "btree" ("sms_opt_in");



CREATE INDEX "idx_employee_attachments_category" ON "public"."employee_attachments" USING "btree" ("category_id", "uploaded_at" DESC);



CREATE INDEX "idx_employee_attachments_employee_id" ON "public"."employee_attachments" USING "btree" ("employee_id");



CREATE INDEX "idx_employee_emergency_contacts_employee_id" ON "public"."employee_emergency_contacts" USING "btree" ("employee_id");



CREATE INDEX "idx_employee_financial_details_employee_id" ON "public"."employee_financial_details" USING "btree" ("employee_id");



CREATE INDEX "idx_employee_health_records_employee_id" ON "public"."employee_health_records" USING "btree" ("employee_id");



CREATE INDEX "idx_employee_notes_created_at" ON "public"."employee_notes" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_employee_notes_employee_id" ON "public"."employee_notes" USING "btree" ("employee_id");



CREATE UNIQUE INDEX "idx_employees_email" ON "public"."employees" USING "btree" ("email_address");



CREATE INDEX "idx_employees_employment_dates" ON "public"."employees" USING "btree" ("employment_start_date", "employment_end_date");



CREATE INDEX "idx_employees_name_search" ON "public"."employees" USING "btree" ("last_name", "first_name");



CREATE INDEX "idx_employees_status" ON "public"."employees" USING "btree" ("status");



CREATE INDEX "idx_event_message_templates_event" ON "public"."event_message_templates" USING "btree" ("event_id");



CREATE INDEX "idx_events_date" ON "public"."events" USING "btree" ("date");



CREATE INDEX "idx_message_delivery_status_created_at" ON "public"."message_delivery_status" USING "btree" ("created_at");



CREATE INDEX "idx_message_delivery_status_message_id" ON "public"."message_delivery_status" USING "btree" ("message_id");



CREATE INDEX "idx_message_templates_default" ON "public"."message_templates" USING "btree" ("is_default");



CREATE INDEX "idx_message_templates_type" ON "public"."message_templates" USING "btree" ("template_type");



CREATE INDEX "idx_messages_created_at" ON "public"."messages" USING "btree" ("created_at");



CREATE INDEX "idx_messages_customer_id" ON "public"."messages" USING "btree" ("customer_id");



CREATE INDEX "idx_messages_direction" ON "public"."messages" USING "btree" ("direction");



CREATE INDEX "idx_messages_from_number" ON "public"."messages" USING "btree" ("from_number");



CREATE INDEX "idx_messages_twilio_message_sid" ON "public"."messages" USING "btree" ("twilio_message_sid");



CREATE INDEX "idx_permissions_module_name" ON "public"."permissions" USING "btree" ("module_name");



CREATE INDEX "idx_profiles_email" ON "public"."profiles" USING "btree" ("email");



CREATE INDEX "idx_role_permissions_permission_id" ON "public"."role_permissions" USING "btree" ("permission_id");



CREATE INDEX "idx_role_permissions_role_id" ON "public"."role_permissions" USING "btree" ("role_id");



CREATE INDEX "idx_user_roles_role_id" ON "public"."user_roles" USING "btree" ("role_id");



CREATE INDEX "idx_user_roles_user_id" ON "public"."user_roles" USING "btree" ("user_id");



CREATE INDEX "idx_webhook_logs_message_sid" ON "public"."webhook_logs" USING "btree" ("message_sid");



CREATE INDEX "idx_webhook_logs_processed_at" ON "public"."webhook_logs" USING "btree" ("processed_at" DESC);



CREATE INDEX "idx_webhook_logs_status" ON "public"."webhook_logs" USING "btree" ("status");



CREATE INDEX "idx_webhook_logs_webhook_type" ON "public"."webhook_logs" USING "btree" ("webhook_type");



CREATE OR REPLACE TRIGGER "log_template_changes" AFTER UPDATE ON "public"."message_templates" FOR EACH ROW EXECUTE FUNCTION "public"."log_template_change"();



CREATE OR REPLACE TRIGGER "on_employees_updated" BEFORE UPDATE ON "public"."employees" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "on_financial_details_updated" BEFORE UPDATE ON "public"."employee_financial_details" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "on_health_records_updated" BEFORE UPDATE ON "public"."employee_health_records" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "prevent_audit_log_delete" BEFORE DELETE ON "public"."audit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_audit_log_deletion"();



CREATE OR REPLACE TRIGGER "prevent_audit_log_update" BEFORE UPDATE ON "public"."audit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_audit_log_update"();



CREATE OR REPLACE TRIGGER "update_attachment_categories_updated_at" BEFORE UPDATE ON "public"."attachment_categories" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_customer_health_on_delivery_status" AFTER INSERT OR UPDATE ON "public"."message_delivery_status" FOR EACH ROW EXECUTE FUNCTION "public"."update_customer_messaging_health"();



CREATE OR REPLACE TRIGGER "update_customer_sms_status_trigger" AFTER UPDATE OF "twilio_status" ON "public"."messages" FOR EACH ROW WHEN (("new"."twilio_status" IS DISTINCT FROM "old"."twilio_status")) EXECUTE FUNCTION "public"."update_customer_sms_status"();



CREATE OR REPLACE TRIGGER "update_employees_updated_at" BEFORE UPDATE ON "public"."employees" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_message_templates_updated_at" BEFORE UPDATE ON "public"."message_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_messages_updated_at" BEFORE UPDATE ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."update_messages_updated_at"();



CREATE OR REPLACE TRIGGER "update_roles_updated_at" BEFORE UPDATE ON "public"."roles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id");



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



ALTER TABLE ONLY "public"."event_message_templates"
    ADD CONSTRAINT "event_message_templates_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



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



CREATE POLICY "Admin users can view audit logs" ON "public"."audit_logs" FOR SELECT USING (("auth"."uid"() IN ( SELECT "users"."id"
   FROM "auth"."users"
  WHERE (("users"."raw_user_meta_data" ->> 'role'::"text") = 'admin'::"text"))));



CREATE POLICY "Allow authenticated users to insert message delivery status" ON "public"."message_delivery_status" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow authenticated users to insert messages" ON "public"."messages" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow authenticated users to read message delivery status" ON "public"."message_delivery_status" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated users to read messages" ON "public"."messages" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated users to read webhook_logs" ON "public"."webhook_logs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow individual users to update their own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Allow public inserts to webhook_logs" ON "public"."webhook_logs" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public read access to profiles" ON "public"."profiles" FOR SELECT USING ((("auth"."role"() = 'authenticated'::"text") OR ("auth"."role"() = 'anon'::"text")));



CREATE POLICY "Authenticated users can view permissions" ON "public"."permissions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view role permissions" ON "public"."role_permissions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authenticated users can view roles" ON "public"."roles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Only users with role management permission can manage permissio" ON "public"."permissions" TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'roles'::"text", 'manage'::"text"));



CREATE POLICY "Only users with role management permission can manage role perm" ON "public"."role_permissions" TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'roles'::"text", 'manage'::"text"));



CREATE POLICY "Only users with role management permission can manage roles" ON "public"."roles" TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'roles'::"text", 'manage'::"text"));



CREATE POLICY "Only users with user management permission can manage user role" ON "public"."user_roles" TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'users'::"text", 'manage_roles'::"text"));



CREATE POLICY "Users can create employees" ON "public"."employees" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Users can create notes" ON "public"."employee_notes" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Users can delete employees" ON "public"."employees" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Users can delete own notes" ON "public"."employee_notes" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "created_by_user_id"));



CREATE POLICY "Users can manage attachments" ON "public"."employee_attachments" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Users can manage emergency contacts" ON "public"."employee_emergency_contacts" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Users can manage event templates" ON "public"."event_message_templates" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Users can manage financial details" ON "public"."employee_financial_details" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Users can manage health records" ON "public"."employee_health_records" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Users can manage templates" ON "public"."message_templates" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Users can update employees" ON "public"."employees" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Users can update own notes" ON "public"."employee_notes" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "created_by_user_id")) WITH CHECK (("auth"."uid"() = "created_by_user_id"));



CREATE POLICY "Users can view all employees" ON "public"."employees" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view all templates" ON "public"."message_templates" FOR SELECT USING (true);



CREATE POLICY "Users can view attachments" ON "public"."employee_attachments" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view emergency contacts" ON "public"."employee_emergency_contacts" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view event templates" ON "public"."event_message_templates" FOR SELECT USING (true);



CREATE POLICY "Users can view financial details" ON "public"."employee_financial_details" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view health records" ON "public"."employee_health_records" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view notes" ON "public"."employee_notes" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view template history" ON "public"."message_template_history" FOR SELECT USING (true);



CREATE POLICY "Users can view their own roles" ON "public"."user_roles" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."user_has_permission"("auth"."uid"(), 'users'::"text", 'view'::"text")));



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_attachments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_emergency_contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_financial_details" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_health_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employee_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_message_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."message_delivery_status" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."message_template_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."message_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."webhook_logs" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";




















































































































































































GRANT ALL ON FUNCTION "public"."calculate_message_cost"("segments" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_message_cost"("segments" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_message_cost"("segments" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_import"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_import"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_import"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_all_users_unsafe"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_users_unsafe"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_users_unsafe"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_message_template"("p_event_id" "uuid", "p_template_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_message_template"("p_event_id" "uuid", "p_template_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_message_template"("p_event_id" "uuid", "p_template_type" "text") TO "service_role";



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



GRANT ALL ON FUNCTION "public"."log_template_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_template_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_template_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_audit_log_deletion"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_audit_log_deletion"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_audit_log_deletion"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_audit_log_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_audit_log_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_audit_log_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."render_template"("p_template" "text", "p_variables" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."render_template"("p_template" "text", "p_variables" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."render_template"("p_template" "text", "p_variables" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_customer_messaging_health"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_customer_messaging_health"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_customer_messaging_health"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_customer_sms_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_customer_sms_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_customer_sms_status"() TO "service_role";



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



GRANT ALL ON TABLE "public"."attachment_categories" TO "anon";
GRANT ALL ON TABLE "public"."attachment_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."attachment_categories" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."bookings" TO "anon";
GRANT ALL ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
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



GRANT ALL ON TABLE "public"."employees" TO "anon";
GRANT ALL ON TABLE "public"."employees" TO "authenticated";
GRANT ALL ON TABLE "public"."employees" TO "service_role";



GRANT ALL ON TABLE "public"."event_message_templates" TO "anon";
GRANT ALL ON TABLE "public"."event_message_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."event_message_templates" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."message_delivery_status" TO "anon";
GRANT ALL ON TABLE "public"."message_delivery_status" TO "authenticated";
GRANT ALL ON TABLE "public"."message_delivery_status" TO "service_role";



GRANT ALL ON TABLE "public"."message_template_history" TO "anon";
GRANT ALL ON TABLE "public"."message_template_history" TO "authenticated";
GRANT ALL ON TABLE "public"."message_template_history" TO "service_role";



GRANT ALL ON TABLE "public"."message_templates" TO "anon";
GRANT ALL ON TABLE "public"."message_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."message_templates" TO "service_role";



GRANT ALL ON TABLE "public"."permissions" TO "anon";
GRANT ALL ON TABLE "public"."permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."permissions" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."webhook_logs" TO "anon";
GRANT ALL ON TABLE "public"."webhook_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."webhook_logs" TO "service_role";



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
