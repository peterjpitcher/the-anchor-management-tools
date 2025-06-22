-- Fix the reminder timing logic in get_bookings_needing_reminders function
CREATE OR REPLACE FUNCTION get_bookings_needing_reminders()
RETURNS TABLE (
  booking_id UUID,
  customer_id UUID,
  event_id UUID,
  template_type TEXT,
  reminder_type TEXT,
  send_timing TEXT,
  custom_timing_hours INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH template_configs AS (
    -- Get all active message templates with their timing
    SELECT DISTINCT
      mt.template_type,
      mt.send_timing,
      mt.custom_timing_hours,
      CASE 
        WHEN mt.send_timing = '1_hour' THEN 1
        WHEN mt.send_timing = '12_hours' THEN 12
        WHEN mt.send_timing = '24_hours' THEN 24
        WHEN mt.send_timing = '7_days' THEN 168
        WHEN mt.send_timing = 'custom' THEN mt.custom_timing_hours
        ELSE NULL
      END AS hours_before_event
    FROM message_templates mt
    WHERE mt.is_active = true
      AND mt.send_timing != 'immediate'
      AND mt.template_type IN (
        'dayBeforeReminder', 
        'weekBeforeReminder',
        'booking_reminder_24_hour',
        'booking_reminder_7_day'
      )
  ),
  bookings_with_timing AS (
    -- Get all bookings with customers opted in for SMS
    SELECT 
      b.id AS booking_id,
      b.customer_id,
      b.event_id,
      b.seats,
      e.date AS event_date,
      e.time AS event_time,
      c.sms_opt_in,
      c.mobile_number,
      -- Calculate the exact event timestamp
      (e.date::timestamp + e.time::time) AS event_timestamp
    FROM bookings b
    INNER JOIN events e ON b.event_id = e.id
    INNER JOIN customers c ON b.customer_id = c.id
    WHERE c.sms_opt_in = true
      AND c.mobile_number IS NOT NULL
      AND e.date >= CURRENT_DATE
  )
  -- Match bookings with templates based on timing
  SELECT DISTINCT
    bwt.booking_id,
    bwt.customer_id,
    bwt.event_id,
    tc.template_type,
    CASE 
      WHEN tc.send_timing = '1_hour' THEN '1_hour'
      WHEN tc.send_timing = '12_hours' THEN '12_hour'
      WHEN tc.send_timing = '24_hours' THEN '24_hour'
      WHEN tc.send_timing = '7_days' THEN '7_day'
      WHEN tc.send_timing = 'custom' THEN 'custom_' || tc.custom_timing_hours::TEXT || '_hour'
      ELSE tc.send_timing
    END AS reminder_type,
    tc.send_timing,
    tc.custom_timing_hours
  FROM bookings_with_timing bwt
  CROSS JOIN template_configs tc
  WHERE tc.hours_before_event IS NOT NULL
    -- FIXED: Check if we're within the window to send this reminder
    -- The reminder should be sent when NOW() is within 1 hour AFTER the reminder time
    AND bwt.event_timestamp - (tc.hours_before_event * INTERVAL '1 hour') <= NOW()
    AND bwt.event_timestamp - (tc.hours_before_event * INTERVAL '1 hour') > NOW() - INTERVAL '1 hour'
    -- Filter for appropriate template type based on booking
    AND (
      -- For bookings with seats
      (bwt.seats > 0 AND tc.template_type IN ('dayBeforeReminder', 'weekBeforeReminder'))
      OR
      -- For reminders (0 seats)
      ((bwt.seats = 0 OR bwt.seats IS NULL) AND tc.template_type IN ('booking_reminder_24_hour', 'booking_reminder_7_day'))
    )
    -- Check if reminder hasn't been sent yet
    AND NOT EXISTS (
      SELECT 1 
      FROM booking_reminders br 
      WHERE br.booking_id = bwt.booking_id 
        AND br.reminder_type = CASE 
          WHEN tc.send_timing = '1_hour' THEN '1_hour'
          WHEN tc.send_timing = '12_hours' THEN '12_hour'
          WHEN tc.send_timing = '24_hours' THEN '24_hour'
          WHEN tc.send_timing = '7_days' THEN '7_day'
          WHEN tc.send_timing = 'custom' THEN 'custom_' || tc.custom_timing_hours::TEXT || '_hour'
          ELSE tc.send_timing
        END
    );
END;
$$ LANGUAGE plpgsql;

-- Add additional debugging view to help understand timing calculations
CREATE OR REPLACE VIEW reminder_timing_debug AS
WITH template_configs AS (
  SELECT 
    mt.template_type,
    mt.send_timing,
    mt.custom_timing_hours,
    CASE 
      WHEN mt.send_timing = '1_hour' THEN 1
      WHEN mt.send_timing = '12_hours' THEN 12
      WHEN mt.send_timing = '24_hours' THEN 24
      WHEN mt.send_timing = '7_days' THEN 168
      WHEN mt.send_timing = 'custom' THEN mt.custom_timing_hours
      ELSE NULL
    END AS hours_before_event
  FROM message_templates mt
  WHERE mt.is_active = true
    AND mt.send_timing != 'immediate'
),
upcoming_events AS (
  SELECT 
    e.id,
    e.name,
    e.date,
    e.time,
    (e.date::timestamp + e.time::time) AS event_timestamp,
    COUNT(DISTINCT b.id) as total_bookings,
    COUNT(DISTINCT CASE WHEN c.sms_opt_in = true THEN b.id END) as sms_opted_in_bookings
  FROM events e
  LEFT JOIN bookings b ON e.id = b.event_id
  LEFT JOIN customers c ON b.customer_id = c.id
  WHERE e.date >= CURRENT_DATE
  GROUP BY e.id, e.name, e.date, e.time
)
SELECT 
  ue.name as event_name,
  ue.date as event_date,
  ue.time as event_time,
  ue.event_timestamp,
  tc.template_type,
  tc.send_timing,
  tc.hours_before_event,
  ue.event_timestamp - (tc.hours_before_event * INTERVAL '1 hour') as reminder_send_time,
  NOW() as current_time,
  CASE 
    WHEN ue.event_timestamp - (tc.hours_before_event * INTERVAL '1 hour') > NOW() THEN 
      'Future - sends in ' || 
      EXTRACT(EPOCH FROM (ue.event_timestamp - (tc.hours_before_event * INTERVAL '1 hour') - NOW()) / 3600)::INTEGER || 
      ' hours'
    WHEN ue.event_timestamp - (tc.hours_before_event * INTERVAL '1 hour') <= NOW() 
     AND ue.event_timestamp - (tc.hours_before_event * INTERVAL '1 hour') > NOW() - INTERVAL '1 hour' THEN
      'DUE NOW - should send'
    ELSE 
      'Missed - was due ' || 
      EXTRACT(EPOCH FROM (NOW() - (ue.event_timestamp - (tc.hours_before_event * INTERVAL '1 hour'))) / 3600)::INTEGER || 
      ' hours ago'
  END as status,
  ue.total_bookings,
  ue.sms_opted_in_bookings
FROM upcoming_events ue
CROSS JOIN template_configs tc
WHERE tc.hours_before_event IS NOT NULL
ORDER BY ue.event_timestamp, tc.hours_before_event DESC;

-- Grant permissions
GRANT SELECT ON reminder_timing_debug TO authenticated;

-- Add helpful comment
COMMENT ON VIEW reminder_timing_debug IS 'Debug view to understand when reminders should be sent for each event and template combination';