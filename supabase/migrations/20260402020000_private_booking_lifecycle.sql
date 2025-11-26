-- Add hold_expiry column to private_bookings
ALTER TABLE "public"."private_bookings" 
ADD COLUMN IF NOT EXISTS "hold_expiry" timestamp with time zone;

-- Add cancellation_reason if it doesn't exist
ALTER TABLE "public"."private_bookings" 
ADD COLUMN IF NOT EXISTS "cancellation_reason" text;

-- Add cancelled_at if it doesn't exist
ALTER TABLE "public"."private_bookings" 
ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;

-- Populate hold_expiry for existing draft bookings
-- Defaulting to 14 days from creation, or 14 days from now if creation is missing (unlikely)
UPDATE "public"."private_bookings"
SET "hold_expiry" = "created_at" + INTERVAL '14 days'
WHERE "status" = 'draft' AND "hold_expiry" IS NULL;

-- Add index for performance on cron jobs
CREATE INDEX IF NOT EXISTS "idx_private_bookings_hold_expiry" 
ON "public"."private_bookings" ("hold_expiry");

CREATE INDEX IF NOT EXISTS "idx_private_bookings_status_expiry" 
ON "public"."private_bookings" ("status", "hold_expiry");
