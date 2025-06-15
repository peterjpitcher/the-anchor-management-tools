-- Add missing columns to messages table
ALTER TABLE "public"."messages" 
ADD COLUMN IF NOT EXISTS "from_number" "text",
ADD COLUMN IF NOT EXISTS "to_number" "text",
ADD COLUMN IF NOT EXISTS "message_type" "text" DEFAULT 'sms'::"text",
ADD COLUMN IF NOT EXISTS "read_at" timestamp with time zone;

-- Add message type constraint if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'messages_message_type_check'
    ) THEN
        ALTER TABLE "public"."messages" 
        ADD CONSTRAINT "messages_message_type_check" 
        CHECK (("message_type" = ANY (ARRAY['sms'::"text", 'mms'::"text", 'whatsapp'::"text"])));
    END IF;
END $$;

-- Add missing indexes
CREATE INDEX IF NOT EXISTS "idx_messages_direction" ON "public"."messages" USING "btree" ("direction");
CREATE INDEX IF NOT EXISTS "idx_messages_from_number" ON "public"."messages" USING "btree" ("from_number");

-- Add cleanup_import function if it doesn't exist
CREATE OR REPLACE FUNCTION "public"."cleanup_import"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  DROP FUNCTION IF EXISTS import_message_history();
  DROP FUNCTION IF EXISTS find_customer_by_phone(TEXT);
  DROP FUNCTION IF EXISTS clean_phone_for_match(TEXT);
END;
$$;

-- Grant permissions on cleanup_import function
GRANT ALL ON FUNCTION "public"."cleanup_import"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_import"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_import"() TO "service_role";