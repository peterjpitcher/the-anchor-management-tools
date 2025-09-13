-- Verify Reminder System Health (future events)
-- Horizon: next 30 days

WITH scope AS (
  SELECT e.id AS event_id, e.date AS event_date
  FROM events e
  WHERE e.date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '30 days')
)
-- 1) Pending reminders by type/status (future horizon)
SELECT br.reminder_type, br.status, COUNT(*)
FROM booking_reminders br
JOIN bookings b ON b.id = br.booking_id
JOIN scope s ON s.event_id = b.event_id
GROUP BY 1, 2
ORDER BY 1, 2;

-- 2) Pending day-before scheduled earlier than event-1d (should be 0 rows)
WITH scope AS (
  SELECT e.id AS event_id, e.date AS event_date
  FROM events e
  WHERE e.date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '30 days')
)
SELECT br.id, br.reminder_type, br.status, br.scheduled_for, s.event_date
FROM booking_reminders br
JOIN bookings b ON b.id = br.booking_id
JOIN scope s ON s.event_id = b.event_id
WHERE br.status = 'pending'
  AND br.reminder_type IN ('no_seats_day_before','has_seats_day_before', '24_hour')
  AND br.scheduled_for::date < (s.event_date::date - INTERVAL '1 day')
ORDER BY s.event_date, br.scheduled_for;

-- 3) Pending with message_id (should be 0 rows)
WITH scope AS (
  SELECT e.id AS event_id, e.date AS event_date
  FROM events e
  WHERE e.date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '30 days')
)
SELECT COUNT(*) AS pending_with_message_id
FROM booking_reminders br
JOIN bookings b ON b.id = br.booking_id
JOIN scope s ON s.event_id = b.event_id
WHERE br.status = 'pending'
  AND br.message_id IS NOT NULL;

-- 4) D-1 pending for seats=0 (should be 0 rows if gating enabled)
WITH scope AS (
  SELECT e.id AS event_id, e.date AS event_date
  FROM events e
  WHERE e.date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '30 days')
)
SELECT COUNT(*) AS d1_pending_for_zero_seats
FROM booking_reminders br
JOIN bookings b ON b.id = br.booking_id
JOIN scope s ON s.event_id = b.event_id
WHERE br.status = 'pending'
  AND br.reminder_type IN ('24_hour','has_seats_day_before','no_seats_day_before')
  AND COALESCE(b.seats, 0) = 0;

-- 5) Duplicate pending per (booking_id, reminder_type) (should be 0)
WITH scope AS (
  SELECT e.id AS event_id, e.date AS event_date
  FROM events e
  WHERE e.date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '30 days')
), pending AS (
  SELECT br.booking_id, br.reminder_type, COUNT(*) AS cnt
  FROM booking_reminders br
  JOIN bookings b ON b.id = br.booking_id
  JOIN scope s ON s.event_id = b.event_id
  WHERE br.status = 'pending'
  GROUP BY 1, 2
)
SELECT * FROM pending WHERE cnt > 1 ORDER BY cnt DESC;

-- 6) Event times not normalized (should be 0 rows ideally)
SELECT id, name, date, time
FROM events
WHERE date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '60 days')
  AND (time IS NULL OR time !~ '^[0-2][0-9]:[0-5][0-9](:[0-5][0-9])?$')
ORDER BY date;

-- 7) Active legacy templates (consider deactivating)
SELECT 'event_message_templates' AS table_name, template_type, COUNT(*) AS active_count
FROM event_message_templates
WHERE is_active = TRUE AND template_type IN (
  'reminder_24_hour','reminder_7_day','booking_reminder_24_hour','booking_reminder_7_day'
)
GROUP BY 1, 2
UNION ALL
SELECT 'message_templates' AS table_name, template_type, COUNT(*) AS active_count
FROM message_templates
WHERE is_active = TRUE AND template_type IN (
  'reminder_24_hour','reminder_7_day','booking_reminder_24_hour','booking_reminder_7_day'
)
GROUP BY 1, 2
ORDER BY table_name, template_type;
