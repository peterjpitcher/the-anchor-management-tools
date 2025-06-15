-- Create webhook_logs table to track all webhook attempts
CREATE TABLE IF NOT EXISTS "public"."webhook_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "webhook_type" "text" NOT NULL DEFAULT 'twilio',
    "status" "text" NOT NULL, -- success, error, signature_failed, etc.
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
    "message_id" "uuid",
    CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS "idx_webhook_logs_processed_at" ON "public"."webhook_logs" USING "btree" ("processed_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_webhook_logs_status" ON "public"."webhook_logs" USING "btree" ("status");
CREATE INDEX IF NOT EXISTS "idx_webhook_logs_message_sid" ON "public"."webhook_logs" USING "btree" ("message_sid");
CREATE INDEX IF NOT EXISTS "idx_webhook_logs_webhook_type" ON "public"."webhook_logs" USING "btree" ("webhook_type");

-- Enable RLS but allow public inserts (for webhook to work without auth)
ALTER TABLE "public"."webhook_logs" ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert (webhooks need this)
CREATE POLICY "Allow public inserts to webhook_logs" ON "public"."webhook_logs" 
    FOR INSERT 
    WITH CHECK (true);

-- Allow authenticated users to read
CREATE POLICY "Allow authenticated users to read webhook_logs" ON "public"."webhook_logs" 
    FOR SELECT 
    TO "authenticated" 
    USING (true);

-- Grant permissions
GRANT ALL ON TABLE "public"."webhook_logs" TO "anon";
GRANT ALL ON TABLE "public"."webhook_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."webhook_logs" TO "service_role";