-- Initial database setup for EventPlanner 3.0
-- This migration creates all tables, functions, triggers, indexes, and policies

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create custom functions
CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."handle_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
    BEGIN
       NEW.updated_at = now();
       RETURN NEW;
    END;
    $$;

CREATE OR REPLACE FUNCTION "public"."update_messages_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

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

-- Create tables
CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE
);

COMMENT ON TABLE "public"."profiles" IS 'Required by Supabase Auth. Stores basic user profile data. No UI currently implemented but kept for authentication purposes.';

CREATE TABLE IF NOT EXISTS "public"."attachment_categories" (
    "category_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "attachment_categories_pkey" PRIMARY KEY ("category_id"),
    CONSTRAINT "attachment_categories_category_name_key" UNIQUE ("category_name")
);

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
    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

COMMENT ON COLUMN "public"."customers"."sms_opt_in" IS 'Whether the customer has opted in to receive SMS messages';
COMMENT ON COLUMN "public"."customers"."sms_delivery_failures" IS 'Count of consecutive SMS delivery failures';
COMMENT ON COLUMN "public"."customers"."last_sms_failure_reason" IS 'The reason for the last SMS delivery failure';
COMMENT ON COLUMN "public"."customers"."last_successful_sms_at" IS 'Timestamp of the last successful SMS delivery';
COMMENT ON COLUMN "public"."customers"."sms_deactivated_at" IS 'When SMS was automatically deactivated for this customer';
COMMENT ON COLUMN "public"."customers"."sms_deactivation_reason" IS 'Reason for automatic SMS deactivation';

CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "date" "date" NOT NULL,
    "time" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "capacity" integer,
    CONSTRAINT "events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "events_capacity_check" CHECK ((("capacity" IS NULL) OR ("capacity" > 0)))
);

COMMENT ON COLUMN "public"."events"."capacity" IS 'Maximum number of seats available for the event. NULL means unlimited capacity.';

CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "seats" integer,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "notes" "text",
    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bookings_customer_id_event_id_key" UNIQUE ("customer_id", "event_id"),
    CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE,
    CONSTRAINT "bookings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id")
);

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
    CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messages_direction_check" CHECK (("direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text"]))),
    CONSTRAINT "messages_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE
);

COMMENT ON COLUMN "public"."messages"."twilio_message_sid" IS 'Twilio message SID for tracking';
COMMENT ON COLUMN "public"."messages"."error_code" IS 'Twilio error code if message failed';
COMMENT ON COLUMN "public"."messages"."error_message" IS 'Human-readable error message if failed';
COMMENT ON COLUMN "public"."messages"."twilio_status" IS 'Current status of the message from Twilio (queued, sent, delivered, failed, etc)';

CREATE TABLE IF NOT EXISTS "public"."message_delivery_status" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "error_code" "text",
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "raw_webhook_data" "jsonb",
    CONSTRAINT "message_delivery_status_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "message_delivery_status_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE
);

COMMENT ON TABLE "public"."message_delivery_status" IS 'Tracks the full history of message delivery status changes from Twilio webhooks';

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
    CONSTRAINT "employees_pkey" PRIMARY KEY ("employee_id"),
    CONSTRAINT "employees_email_address_key" UNIQUE ("email_address")
);

CREATE TABLE IF NOT EXISTS "public"."employee_attachments" (
    "attachment_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "category_id" "uuid" NOT NULL,
    "file_name" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "mime_type" "text" NOT NULL,
    "file_size_bytes" bigint NOT NULL,
    "description" "text",
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "employee_attachments_pkey" PRIMARY KEY ("attachment_id"),
    CONSTRAINT "employee_attachments_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."attachment_categories"("category_id"),
    CONSTRAINT "employee_attachments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "public"."employee_emergency_contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "employee_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "relationship" "text",
    "address" "text",
    "phone_number" "text",
    CONSTRAINT "employee_emergency_contacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_emergency_contacts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE CASCADE
);

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
    CONSTRAINT "employee_financial_details_pkey" PRIMARY KEY ("employee_id"),
    CONSTRAINT "employee_financial_details_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE CASCADE
);

COMMENT ON TABLE "public"."employee_financial_details" IS 'Stores confidential financial details for employees.';

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
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "employee_health_records_pkey" PRIMARY KEY ("employee_id"),
    CONSTRAINT "employee_health_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE CASCADE
);

COMMENT ON TABLE "public"."employee_health_records" IS 'Stores confidential health and medical records for employees.';

CREATE TABLE IF NOT EXISTS "public"."employee_notes" (
    "note_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "note_text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by_user_id" "uuid",
    CONSTRAINT "employee_notes_pkey" PRIMARY KEY ("note_id"),
    CONSTRAINT "employee_notes_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE CASCADE
);

-- Create indexes
CREATE INDEX "idx_bookings_customer_id" ON "public"."bookings" USING "btree" ("customer_id");
CREATE INDEX "idx_bookings_event_id" ON "public"."bookings" USING "btree" ("event_id");
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
CREATE INDEX "idx_events_date" ON "public"."events" USING "btree" ("date");
CREATE INDEX "idx_message_delivery_status_created_at" ON "public"."message_delivery_status" USING "btree" ("created_at");
CREATE INDEX "idx_message_delivery_status_message_id" ON "public"."message_delivery_status" USING "btree" ("message_id");
CREATE INDEX "idx_messages_created_at" ON "public"."messages" USING "btree" ("created_at");
CREATE INDEX "idx_messages_customer_id" ON "public"."messages" USING "btree" ("customer_id");
CREATE INDEX "idx_messages_twilio_message_sid" ON "public"."messages" USING "btree" ("twilio_message_sid");

-- Create triggers
CREATE OR REPLACE TRIGGER "on_employees_updated" BEFORE UPDATE ON "public"."employees" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();
CREATE OR REPLACE TRIGGER "on_financial_details_updated" BEFORE UPDATE ON "public"."employee_financial_details" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();
CREATE OR REPLACE TRIGGER "on_health_records_updated" BEFORE UPDATE ON "public"."employee_health_records" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();
CREATE OR REPLACE TRIGGER "update_attachment_categories_updated_at" BEFORE UPDATE ON "public"."attachment_categories" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
CREATE OR REPLACE TRIGGER "update_customer_sms_status_trigger" AFTER UPDATE OF "twilio_status" ON "public"."messages" FOR EACH ROW WHEN (("new"."twilio_status" IS DISTINCT FROM "old"."twilio_status")) EXECUTE FUNCTION "public"."update_customer_sms_status"();
CREATE OR REPLACE TRIGGER "update_employees_updated_at" BEFORE UPDATE ON "public"."employees" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
CREATE OR REPLACE TRIGGER "update_messages_updated_at" BEFORE UPDATE ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."update_messages_updated_at"();

-- Enable Row Level Security
ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."employee_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."employee_emergency_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."employee_financial_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."employee_health_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."employee_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."message_delivery_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Allow individual users to update their own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));
CREATE POLICY "Allow public read access to profiles" ON "public"."profiles" FOR SELECT USING ((("auth"."role"() = 'authenticated'::"text") OR ("auth"."role"() = 'anon'::"text")));

CREATE POLICY "Users can view all employees" ON "public"."employees" FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Users can create employees" ON "public"."employees" FOR INSERT TO "authenticated" WITH CHECK (true);
CREATE POLICY "Users can update employees" ON "public"."employees" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);
CREATE POLICY "Users can delete employees" ON "public"."employees" FOR DELETE TO "authenticated" USING (true);

CREATE POLICY "Users can view attachments" ON "public"."employee_attachments" FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Users can manage attachments" ON "public"."employee_attachments" TO "authenticated" USING (true) WITH CHECK (true);

CREATE POLICY "Users can view emergency contacts" ON "public"."employee_emergency_contacts" FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Users can manage emergency contacts" ON "public"."employee_emergency_contacts" TO "authenticated" USING (true) WITH CHECK (true);

CREATE POLICY "Users can view financial details" ON "public"."employee_financial_details" FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Users can manage financial details" ON "public"."employee_financial_details" TO "authenticated" USING (true) WITH CHECK (true);

CREATE POLICY "Users can view health records" ON "public"."employee_health_records" FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Users can manage health records" ON "public"."employee_health_records" TO "authenticated" USING (true) WITH CHECK (true);

CREATE POLICY "Users can view notes" ON "public"."employee_notes" FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Users can create notes" ON "public"."employee_notes" FOR INSERT TO "authenticated" WITH CHECK (true);
CREATE POLICY "Users can update own notes" ON "public"."employee_notes" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "created_by_user_id")) WITH CHECK (("auth"."uid"() = "created_by_user_id"));
CREATE POLICY "Users can delete own notes" ON "public"."employee_notes" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "created_by_user_id"));

CREATE POLICY "Allow authenticated users to read messages" ON "public"."messages" FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Allow authenticated users to insert messages" ON "public"."messages" FOR INSERT TO "authenticated" WITH CHECK (true);

CREATE POLICY "Allow authenticated users to read message delivery status" ON "public"."message_delivery_status" FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Allow authenticated users to insert message delivery status" ON "public"."message_delivery_status" FOR INSERT TO "authenticated" WITH CHECK (true);

-- Grant permissions
GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";

GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "service_role";

GRANT ALL ON FUNCTION "public"."update_customer_sms_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_customer_sms_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_customer_sms_status"() TO "service_role";

GRANT ALL ON FUNCTION "public"."update_messages_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_messages_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_messages_updated_at"() TO "service_role";

GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";

GRANT ALL ON FUNCTION "public"."validate_employee_attachment_upload"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_employee_attachment_upload"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_employee_attachment_upload"() TO "service_role";

GRANT ALL ON TABLE "public"."attachment_categories" TO "anon";
GRANT ALL ON TABLE "public"."attachment_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."attachment_categories" TO "service_role";

GRANT ALL ON TABLE "public"."bookings" TO "anon";
GRANT ALL ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";

GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";

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

GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";

GRANT ALL ON TABLE "public"."message_delivery_status" TO "anon";
GRANT ALL ON TABLE "public"."message_delivery_status" TO "authenticated";
GRANT ALL ON TABLE "public"."message_delivery_status" TO "service_role";

GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";

GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";

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

-- Add publication for realtime
ALTER PUBLICATION "supabase_realtime" ADD TABLE "public"."messages";

-- Create storage bucket for employee attachments (this needs to be done separately via Supabase Dashboard or API)
-- The bucket configuration:
-- Name: employee-attachments
-- Public: false
-- File size limit: 5MB
-- Allowed MIME types: application/pdf, image/jpeg, image/jpg, image/png, image/gif, image/webp, 
--                     application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document,
--                     application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,
--                     text/plain, text/csv, application/zip, application/x-zip-compressed