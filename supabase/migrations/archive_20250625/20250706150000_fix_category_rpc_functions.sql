-- Fix type mismatch in get_category_regulars function
CREATE OR REPLACE FUNCTION "public"."get_category_regulars"(
  "p_category_id" "uuid", 
  "p_days_back" integer DEFAULT 90
) 
RETURNS TABLE(
  "customer_id" "uuid", 
  "first_name" text, -- Changed from character varying to text
  "last_name" text,  -- Changed from character varying to text
  "mobile_number" text, -- Changed from character varying to text
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
    c.first_name::text,
    c.last_name::text,
    c.mobile_number::text,
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
CREATE OR REPLACE FUNCTION "public"."get_cross_category_suggestions"(
  "p_target_category_id" "uuid", 
  "p_source_category_id" "uuid", 
  "p_limit" integer DEFAULT 20
) 
RETURNS TABLE(
  "customer_id" "uuid", 
  "first_name" text, -- Changed from character varying to text
  "last_name" text,  -- Changed from character varying to text
  "mobile_number" text, -- Changed from character varying to text
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
      c.first_name::text,
      c.last_name::text,
      c.mobile_number::text,
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

-- Create the missing trigger for auto-updating customer_category_stats
CREATE OR REPLACE TRIGGER update_customer_category_stats_trigger
  AFTER INSERT ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_category_stats();