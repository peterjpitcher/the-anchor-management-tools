-- Reset hold_expiry for all FUTURE draft bookings to start from NOW
-- This prevents the cron job from auto-cancelling old drafts that we want to "revive"
UPDATE "public"."private_bookings"
SET "hold_expiry" = LEAST("event_date"::timestamp, (CURRENT_TIMESTAMP + INTERVAL '14 days'))
WHERE "status" = 'draft'
AND "event_date" >= CURRENT_DATE;
