-- Migration: Standardize booking logic to exclude reminder-only signups

-- 1. Update apply_customer_labels_retroactively to exclude reminder-only bookings for "Event Booker" label
CREATE OR REPLACE FUNCTION public.apply_customer_labels_retroactively()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  regular_label_id uuid;
  event_booker_label_id uuid;
  event_attendee_label_id uuid;
  new_customer_label_id uuid;
  at_risk_label_id uuid;
BEGIN
  SELECT id INTO regular_label_id FROM customer_labels WHERE name = 'Regular';
  SELECT id INTO event_booker_label_id FROM customer_labels WHERE name = 'Event Booker';
  SELECT id INTO event_attendee_label_id FROM customer_labels WHERE name = 'Event Attendee';
  SELECT id INTO new_customer_label_id FROM customer_labels WHERE name = 'New Customer';
  SELECT id INTO at_risk_label_id FROM customer_labels WHERE name = 'At Risk';

  -- Apply Regular label (5+ events in last 90 days)
  IF regular_label_id IS NOT NULL THEN
    INSERT INTO customer_label_assignments (customer_id, label_id, auto_assigned, notes)
    SELECT DISTINCT
      customer_id,
      regular_label_id,
      true,
      'Auto-applied: 5+ events in last 90 days'
    FROM (
      SELECT customer_id, SUM(times_attended) AS total
      FROM customer_category_stats
      WHERE last_attended_date >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY customer_id
      HAVING SUM(times_attended) >= 5
    ) qualified
    WHERE NOT EXISTS (
      SELECT 1 FROM customer_label_assignments
      WHERE customer_id = qualified.customer_id
        AND label_id = regular_label_id
    );
  END IF;

  -- Apply Event Booker label (at least one booking on record)
  IF event_booker_label_id IS NOT NULL THEN
    INSERT INTO customer_label_assignments (customer_id, label_id, auto_assigned, notes)
    SELECT DISTINCT
      b.customer_id,
      event_booker_label_id,
      true,
      'Auto-applied: Booked at least one event'
    FROM bookings b
    WHERE b.customer_id IS NOT NULL
      AND b.seats > 0 -- NEW: Must have seats
      AND (b.is_reminder_only IS NULL OR b.is_reminder_only = false) -- NEW: Must not be reminder-only
    ON CONFLICT (customer_id, label_id) DO NOTHING;
  END IF;

  -- Apply Event Attendee label (at least one check-in)
  IF event_attendee_label_id IS NOT NULL THEN
    INSERT INTO customer_label_assignments (customer_id, label_id, auto_assigned, notes)
    SELECT DISTINCT
      eci.customer_id,
      event_attendee_label_id,
      true,
      'Auto-applied: Checked in to an event'
    FROM event_check_ins eci
    WHERE eci.customer_id IS NOT NULL
    ON CONFLICT (customer_id, label_id) DO NOTHING;
  END IF;

  -- Apply New Customer label (first event within 30 days)
  IF new_customer_label_id IS NOT NULL THEN
    INSERT INTO customer_label_assignments (customer_id, label_id, auto_assigned, notes)
    SELECT DISTINCT
      c.id,
      new_customer_label_id,
      true,
      'Auto-applied: New customer (joined within 30 days)'
    FROM customers c
    WHERE c.created_at >= CURRENT_DATE - INTERVAL '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM customer_label_assignments
        WHERE customer_id = c.id
          AND label_id = new_customer_label_id
      );
  END IF;

  -- Apply At Risk label (3+ past events but inactive 60+ days)
  IF at_risk_label_id IS NOT NULL THEN
    INSERT INTO customer_label_assignments (customer_id, label_id, auto_assigned, notes)
    SELECT DISTINCT
      customer_id,
      at_risk_label_id,
      true,
      'Auto-applied: Previously active but no recent attendance'
    FROM (
      SELECT customer_id, MAX(last_attended_date) as last_seen, SUM(times_attended) as total
      FROM customer_category_stats
      GROUP BY customer_id
      HAVING SUM(times_attended) >= 3 
        AND MAX(last_attended_date) < CURRENT_DATE - INTERVAL '60 days'
    ) risk_candidates
    WHERE NOT EXISTS (
      SELECT 1 FROM customer_label_assignments
      WHERE customer_id = risk_candidates.customer_id
        AND label_id = at_risk_label_id
    )
    -- Ensure they haven't booked anything recently either
    AND NOT EXISTS (
       SELECT 1 FROM bookings b
       WHERE b.customer_id = risk_candidates.customer_id
         AND b.created_at > CURRENT_DATE - INTERVAL '60 days'
    );
  END IF;

END;
$$;

-- 2. Update dashboard stats to exclude reminder-only bookings from "Recent Bookings"
CREATE OR REPLACE FUNCTION "public"."get_dashboard_stats"() RETURNS TABLE("total_customers" bigint, "new_customers_week" bigint, "upcoming_events" bigint, "recent_bookings" bigint, "unread_messages" bigint, "active_employees" bigint)
    LANGUAGE "plpgsql" STABLE
    AS $$
    BEGIN
      RETURN QUERY
      SELECT 
        (SELECT COUNT(*) FROM customers)::bigint,
        (SELECT COUNT(*) FROM customers WHERE created_at >= CURRENT_DATE - INTERVAL '7 days')::bigint,
        (SELECT COUNT(*) FROM events WHERE date >= CURRENT_DATE)::bigint,
        (SELECT COUNT(*) FROM bookings 
         WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
           AND seats > 0 
           AND (is_reminder_only IS NULL OR is_reminder_only = false)
        )::bigint,
        (SELECT COUNT(*) FROM messages WHERE direction = 'inbound' AND read_at IS NULL)::bigint,
        (SELECT COUNT(*) FROM employees WHERE is_active = true)::bigint;
    END;
    $$;

-- 3. Cleanup existing "Event Booker" labels for customers who ONLY have reminder bookings
-- Logic: Delete "Event Booker" label IF the customer has NO bookings that meet the criteria (seats > 0 AND not reminder-only)
DO $$
DECLARE
  event_booker_id UUID;
BEGIN
  SELECT id INTO event_booker_id FROM customer_labels WHERE name = 'Event Booker';
  
  IF event_booker_id IS NOT NULL THEN
    DELETE FROM customer_label_assignments
    WHERE label_id = event_booker_id
      AND customer_id NOT IN (
        SELECT DISTINCT customer_id 
        FROM bookings 
        WHERE seats > 0 
          AND (is_reminder_only IS NULL OR is_reminder_only = false)
      );
  END IF;
END $$;
