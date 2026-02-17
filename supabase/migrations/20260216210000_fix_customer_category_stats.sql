-- Migration: Fix customer_category_stats to exclude reminder-only bookings

-- 1. Update the rebuild function to strictly exclude is_reminder_only bookings
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
    AND (b.is_reminder_only IS NULL OR b.is_reminder_only = false) -- NEW: Exclude reminders
  GROUP BY b.customer_id, e.category_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 2. Update the trigger to prevent future reminder-only bookings from updating stats
-- We need to drop the old trigger and recreate it with the new condition
DROP TRIGGER IF EXISTS "booking_category_stats_trigger" ON "public"."bookings";

CREATE TRIGGER "booking_category_stats_trigger"
AFTER INSERT ON "public"."bookings"
FOR EACH ROW
WHEN (
  (NEW.seats > 0) AND 
  (NEW.is_reminder_only IS NULL OR NEW.is_reminder_only = false)
)
EXECUTE FUNCTION "public"."update_customer_category_stats"();

-- 3. Run the rebuild function to clean up existing dirty data
SELECT "public"."rebuild_customer_category_stats"();
