-- Fix the apply_customer_labels_retroactively function return type
DROP FUNCTION IF EXISTS apply_customer_labels_retroactively();

CREATE OR REPLACE FUNCTION apply_customer_labels_retroactively()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  label_record RECORD;
BEGIN
  -- Loop through all labels with auto-apply rules
  FOR label_record IN 
    SELECT * FROM customer_labels 
    WHERE auto_apply_rules IS NOT NULL 
    AND auto_apply_rules->>'manual_only' != 'true'
  LOOP
    -- Apply VIP label
    IF label_record.name = 'VIP' THEN
      INSERT INTO customer_label_assignments (customer_id, label_id, auto_assigned, notes)
      SELECT DISTINCT 
        c.id,
        label_record.id,
        true,
        'Auto-applied based on high attendance across multiple categories'
      FROM customers c
      WHERE EXISTS (
        SELECT 1 
        FROM customer_category_stats ccs
        WHERE ccs.customer_id = c.id
        GROUP BY ccs.customer_id
        HAVING COUNT(DISTINCT ccs.category_id) >= COALESCE((label_record.auto_apply_rules->>'min_categories')::int, 3)
        AND SUM(times_attended) >= COALESCE((label_record.auto_apply_rules->>'min_attendance')::int, 10)
      )
      AND NOT EXISTS (
        SELECT 1 FROM customer_label_assignments 
        WHERE customer_id = c.id AND label_id = label_record.id
      );
      
    -- Apply Regular label
    ELSIF label_record.name = 'Regular' THEN
      INSERT INTO customer_label_assignments (customer_id, label_id, auto_assigned, notes)
      SELECT DISTINCT 
        c.id,
        label_record.id,
        true,
        'Auto-applied based on recent attendance'
      FROM customers c
      WHERE EXISTS (
        SELECT 1 
        FROM customer_category_stats ccs
        WHERE ccs.customer_id = c.id
        AND ccs.last_attended_date >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY ccs.customer_id
        HAVING SUM(times_attended) >= COALESCE((label_record.auto_apply_rules->>'min_attendance')::int, 5)
      )
      AND NOT EXISTS (
        SELECT 1 FROM customer_label_assignments 
        WHERE customer_id = c.id AND label_id = label_record.id
      );
      
    -- Apply New Customer label
    ELSIF label_record.name = 'New Customer' THEN
      INSERT INTO customer_label_assignments (customer_id, label_id, auto_assigned, notes)
      SELECT DISTINCT 
        c.id,
        label_record.id,
        true,
        'Auto-applied based on join date'
      FROM customers c
      WHERE EXISTS (
        SELECT 1 
        FROM customer_category_stats ccs
        WHERE ccs.customer_id = c.id
        AND ccs.first_attended_date >= CURRENT_DATE - INTERVAL '30 days'
      )
      AND NOT EXISTS (
        SELECT 1 FROM customer_label_assignments 
        WHERE customer_id = c.id AND label_id = label_record.id
      );
      
    -- Apply At Risk label
    ELSIF label_record.name = 'At Risk' THEN
      INSERT INTO customer_label_assignments (customer_id, label_id, auto_assigned, notes)
      SELECT DISTINCT 
        c.id,
        label_record.id,
        true,
        'Auto-applied - customer hasn''t attended recently'
      FROM customers c
      WHERE EXISTS (
        SELECT 1 
        FROM customer_category_stats ccs
        WHERE ccs.customer_id = c.id
        GROUP BY ccs.customer_id
        HAVING SUM(times_attended) >= COALESCE((label_record.auto_apply_rules->>'min_attendance')::int, 3)
        AND MAX(ccs.last_attended_date) < CURRENT_DATE - INTERVAL '60 days'
      )
      AND NOT EXISTS (
        SELECT 1 FROM customer_label_assignments 
        WHERE customer_id = c.id AND label_id = label_record.id
      );
      
    END IF;
  END LOOP;
END;
$$;