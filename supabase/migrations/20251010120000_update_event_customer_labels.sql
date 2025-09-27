-- Update customer labels to focus on event attendance behaviour

-- Remove legacy VIP label assignments and the label itself if present
DO $$
DECLARE
  vip_label_id uuid;
BEGIN
  SELECT id INTO vip_label_id FROM customer_labels WHERE name = 'VIP';
  IF vip_label_id IS NOT NULL THEN
    DELETE FROM customer_label_assignments WHERE label_id = vip_label_id;
    DELETE FROM customer_labels WHERE id = vip_label_id;
  END IF;
END $$;

-- Ensure Event Booker label exists
INSERT INTO customer_labels (name, description, color, icon, auto_apply_rules)
SELECT 'Event Booker', 'Customers who have booked at least one event', '#2563EB', 'calendar-days', jsonb_build_object(
    'type', 'event_booking',
    'minimum_bookings', 1
  )
WHERE NOT EXISTS (
  SELECT 1 FROM customer_labels WHERE name = 'Event Booker'
);

-- Ensure Event Attendee label exists
INSERT INTO customer_labels (name, description, color, icon, auto_apply_rules)
SELECT 'Event Attendee', 'Customers who have attended an event at The Anchor', '#16A34A', 'user-group', jsonb_build_object(
    'type', 'event_attendance',
    'minimum_check_ins', 1
  )
WHERE NOT EXISTS (
  SELECT 1 FROM customer_labels WHERE name = 'Event Attendee'
);

-- Refresh the auto-apply routine to align with the new label strategy
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
      SELECT customer_id, MAX(last_attended_date) AS last_date, SUM(times_attended) AS total
      FROM customer_category_stats
      GROUP BY customer_id
      HAVING SUM(times_attended) >= 3
         AND MAX(last_attended_date) < CURRENT_DATE - INTERVAL '60 days'
    ) qualified
    WHERE NOT EXISTS (
      SELECT 1 FROM customer_label_assignments
      WHERE customer_id = qualified.customer_id
        AND label_id = at_risk_label_id
    );
  END IF;
END;
$$;
