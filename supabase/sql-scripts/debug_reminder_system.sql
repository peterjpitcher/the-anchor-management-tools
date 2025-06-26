-- Debug reminder system for event scheduled tomorrow night
-- Current time check
SELECT 
    NOW() as current_time,
    NOW()::date as current_date,
    NOW()::time as current_time_only;

-- 1. Check message templates configuration
SELECT 
    template_type,
    send_timing,
    custom_timing_hours,
    is_active,
    CASE 
        WHEN send_timing = '1_hour' THEN '1 hour before'
        WHEN send_timing = '12_hours' THEN '12 hours before'
        WHEN send_timing = '24_hours' THEN '24 hours before'
        WHEN send_timing = '7_days' THEN '7 days before'
        WHEN send_timing = 'custom' THEN custom_timing_hours || ' hours before'
        ELSE send_timing
    END as timing_description
FROM message_templates
WHERE template_type IN ('dayBeforeReminder', 'weekBeforeReminder', 'booking_reminder_24_hour', 'booking_reminder_7_day')
    AND is_active = true
ORDER BY template_type;

-- 2. Check events happening tomorrow night
SELECT 
    e.id,
    e.name,
    e.date,
    e.time,
    e.date::timestamp + e.time::time as event_datetime,
    (e.date::timestamp + e.time::time) - INTERVAL '24 hours' as reminder_24h_time,
    (e.date::timestamp + e.time::time) - INTERVAL '7 days' as reminder_7d_time,
    NOW() as current_time,
    CASE 
        WHEN (e.date::timestamp + e.time::time) - INTERVAL '24 hours' BETWEEN NOW() AND NOW() + INTERVAL '1 hour' 
        THEN 'Should send 24h reminder NOW'
        WHEN (e.date::timestamp + e.time::time) - INTERVAL '7 days' BETWEEN NOW() AND NOW() + INTERVAL '1 hour' 
        THEN 'Should send 7d reminder NOW'
        ELSE 'No reminder due'
    END as reminder_status
FROM events e
WHERE e.date = CURRENT_DATE + 1  -- Tomorrow
ORDER BY e.date, e.time;

-- 3. Check bookings for tomorrow's events with customer details
SELECT 
    b.id as booking_id,
    c.first_name || ' ' || c.last_name as customer_name,
    c.mobile_number,
    c.sms_opt_in,
    e.name as event_name,
    e.date,
    e.time,
    b.seats,
    CASE 
        WHEN b.seats > 0 THEN 'Regular booking'
        ELSE 'Reminder only'
    END as booking_type
FROM bookings b
JOIN customers c ON b.customer_id = c.id
JOIN events e ON b.event_id = e.id
WHERE e.date = CURRENT_DATE + 1  -- Tomorrow
    AND c.sms_opt_in = true
    AND c.mobile_number IS NOT NULL
ORDER BY e.time, c.last_name;

-- 4. Check what get_bookings_needing_reminders() returns RIGHT NOW
SELECT * FROM get_bookings_needing_reminders();

-- 5. Check booking_reminders table for recent activity
SELECT 
    br.booking_id,
    br.reminder_type,
    br.sent_at,
    c.first_name || ' ' || c.last_name as customer_name,
    e.name as event_name,
    e.date as event_date
FROM booking_reminders br
JOIN bookings b ON br.booking_id = b.id
JOIN customers c ON b.customer_id = c.id
JOIN events e ON b.event_id = e.id
WHERE br.sent_at > NOW() - INTERVAL '48 hours'
ORDER BY br.sent_at DESC
LIMIT 20;

-- 6. Manual check of timing logic for tomorrow's events
WITH tomorrow_events AS (
    SELECT 
        e.id,
        e.name,
        e.date,
        e.time,
        (e.date::timestamp + e.time::time) as event_timestamp
    FROM events e
    WHERE e.date = CURRENT_DATE + 1
)
SELECT 
    name,
    date,
    time,
    event_timestamp,
    event_timestamp - INTERVAL '24 hours' as "24h_before",
    event_timestamp - INTERVAL '7 days' as "7d_before",
    NOW() as current_time,
    CASE 
        WHEN event_timestamp - INTERVAL '24 hours' <= NOW() THEN '24h reminder should have been sent'
        WHEN event_timestamp - INTERVAL '24 hours' > NOW() AND 
             event_timestamp - INTERVAL '24 hours' <= NOW() + INTERVAL '1 hour' THEN '24h reminder due within next hour'
        ELSE 'Not time for 24h reminder yet'
    END as "24h_status"
FROM tomorrow_events
ORDER BY time;

-- 7. Check for any errors in webhook logs related to reminders
SELECT 
    created_at,
    endpoint,
    status,
    error,
    response_status
FROM webhook_logs
WHERE created_at > NOW() - INTERVAL '24 hours'
    AND (error IS NOT NULL OR response_status != 200)
ORDER BY created_at DESC
LIMIT 10;

-- 8. Check recent messages sent
SELECT 
    m.created_at,
    m.direction,
    m.to_number,
    SUBSTRING(m.body, 1, 50) || '...' as message_preview,
    m.status,
    m.twilio_status,
    c.first_name || ' ' || c.last_name as customer_name
FROM messages m
LEFT JOIN customers c ON m.customer_id = c.id
WHERE m.created_at > NOW() - INTERVAL '24 hours'
    AND m.direction = 'outbound'
ORDER BY m.created_at DESC
LIMIT 20;