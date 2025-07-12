-- Fix type mismatch in get_category_regulars function by ensuring all returned columns match expected types
DROP FUNCTION IF EXISTS "public"."get_category_regulars"(
  "p_category_id" "uuid", 
  "p_days_back" integer
);

CREATE OR REPLACE FUNCTION "public"."get_category_regulars"(
  "p_category_id" "uuid", 
  "p_days_back" integer DEFAULT 90
) 
RETURNS TABLE(
  "customer_id" "uuid", 
  "first_name" character varying(255), -- Changed back to match customers table type
  "last_name" character varying(255),  -- Changed back to match customers table type
  "mobile_number" character varying(255), -- Changed back to match customers table type
  "times_attended" integer, 
  "last_attended_date" "date", 
  "days_since_last_visit" integer
)
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

-- Fix type mismatch in get_cross_category_suggestions function
DROP FUNCTION IF EXISTS "public"."get_cross_category_suggestions"(
  "p_target_category_id" "uuid", 
  "p_source_category_id" "uuid", 
  "p_limit" integer
);

CREATE OR REPLACE FUNCTION "public"."get_cross_category_suggestions"(
  "p_target_category_id" "uuid", 
  "p_source_category_id" "uuid", 
  "p_limit" integer DEFAULT 20
) 
RETURNS TABLE(
  "customer_id" "uuid", 
  "first_name" character varying(255), -- Changed back to match customers table type
  "last_name" character varying(255),  -- Changed back to match customers table type
  "mobile_number" character varying(255), -- Changed back to match customers table type
  "source_times_attended" integer, 
  "source_last_attended" "date", 
  "already_attended_target" boolean
)
LANGUAGE "plpgsql" SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH source_customers AS (
    -- Get customers who attended source category
    SELECT 
      c.id,
      c.first_name,
      c.last_name,
      c.mobile_number,
      ccs.times_attended,
      ccs.last_attended_date
    FROM customer_category_stats ccs
    JOIN customers c ON c.id = ccs.customer_id
    WHERE ccs.category_id = p_source_category_id
      AND c.sms_opt_in = true
      AND ccs.last_attended_date >= CURRENT_DATE - INTERVAL '90 days'
  ),
  target_attendance AS (
    -- Check if they've attended target category
    SELECT DISTINCT customer_id
    FROM customer_category_stats
    WHERE category_id = p_target_category_id
  )
  SELECT 
    sc.id as customer_id,
    sc.first_name,
    sc.last_name,
    sc.mobile_number,
    sc.times_attended as source_times_attended,
    sc.last_attended_date as source_last_attended,
    CASE WHEN ta.customer_id IS NOT NULL THEN true ELSE false END as already_attended_target
  FROM source_customers sc
  LEFT JOIN target_attendance ta ON ta.customer_id = sc.id
  ORDER BY 
    ta.customer_id IS NULL DESC, -- Prioritize those who haven't attended target
    sc.times_attended DESC,
    sc.last_attended_date DESC
  LIMIT p_limit;
END;
$$;

-- Ensure the trigger function exists and works properly
CREATE OR REPLACE FUNCTION "public"."update_customer_category_stats"() 
RETURNS "trigger"
LANGUAGE "plpgsql" SECURITY DEFINER
AS $$
DECLARE
  v_category_id UUID;
BEGIN
  -- Only process if the event has a category
  SELECT category_id INTO v_category_id 
  FROM events 
  WHERE id = NEW.event_id;

  IF v_category_id IS NOT NULL THEN
    -- Insert or update the stats
    INSERT INTO customer_category_stats (
      customer_id,
      category_id,
      times_attended,
      last_attended_date,
      first_attended_date
    )
    VALUES (
      NEW.customer_id,
      v_category_id,
      1,
      CURRENT_DATE,
      CURRENT_DATE
    )
    ON CONFLICT (customer_id, category_id) DO UPDATE
    SET 
      times_attended = customer_category_stats.times_attended + 1,
      last_attended_date = GREATEST(customer_category_stats.last_attended_date, CURRENT_DATE),
      updated_at = NOW();
  END IF;

  RETURN NEW;
END;
$$;

-- Ensure the trigger exists
DROP TRIGGER IF EXISTS update_customer_category_stats_trigger ON bookings;
CREATE TRIGGER update_customer_category_stats_trigger
  AFTER INSERT ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_category_stats();

-- Add a function to backfill missing customer_category_stats
CREATE OR REPLACE FUNCTION "public"."backfill_customer_category_stats"()
RETURNS integer
LANGUAGE "plpgsql" SECURITY DEFINER
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  -- Insert missing stats from existing bookings
  INSERT INTO customer_category_stats (
    customer_id,
    category_id,
    times_attended,
    last_attended_date,
    first_attended_date
  )
  SELECT 
    b.customer_id,
    e.category_id,
    COUNT(*)::integer as times_attended,
    MAX(e.date) as last_attended_date,
    MIN(e.date) as first_attended_date
  FROM bookings b
  JOIN events e ON e.id = b.event_id
  WHERE e.category_id IS NOT NULL
  GROUP BY b.customer_id, e.category_id
  ON CONFLICT (customer_id, category_id) DO UPDATE
  SET 
    times_attended = EXCLUDED.times_attended,
    last_attended_date = EXCLUDED.last_attended_date,
    first_attended_date = EXCLUDED.first_attended_date,
    updated_at = NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Run the backfill to ensure all data is up to date
SELECT backfill_customer_category_stats();