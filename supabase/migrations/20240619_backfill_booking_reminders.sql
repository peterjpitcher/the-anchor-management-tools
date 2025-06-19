-- Backfill booking_reminders for messages sent on 2025-06-19
-- These are 24-hour reminders for Cash Bingo event on 2025-06-20

-- First, let's identify the event and bookings
DO $$
DECLARE
    v_event_id uuid;
    v_booking record;
    v_message record;
BEGIN
    -- Find the Cash Bingo event on 2025-06-20
    SELECT id INTO v_event_id
    FROM events
    WHERE name = 'Cash Bingo'
    AND date = '2025-06-20'
    LIMIT 1;
    
    IF v_event_id IS NULL THEN
        RAISE NOTICE 'Cash Bingo event on 2025-06-20 not found';
        RETURN;
    END IF;
    
    -- For each message sent on 2025-06-19 for this event
    FOR v_message IN 
        SELECT m.id, m.customer_id, m.body, m.created_at
        FROM messages m
        WHERE m.created_at::date = '2025-06-19'
        AND m.direction = 'outbound'
        AND m.body LIKE '%Cash Bingo%tomorrow at 18:00%'
        AND m.twilio_status = 'queued'
    LOOP
        -- Find the corresponding booking
        SELECT * INTO v_booking
        FROM bookings b
        WHERE b.customer_id = v_message.customer_id
        AND b.event_id = v_event_id
        LIMIT 1;
        
        IF v_booking.id IS NOT NULL THEN
            -- Insert into booking_reminders if not already exists
            INSERT INTO booking_reminders (
                booking_id,
                reminder_type,
                sent_at,
                message_id,
                created_at
            )
            VALUES (
                v_booking.id,
                '24_hour',
                v_message.created_at,
                v_message.id,
                v_message.created_at
            )
            ON CONFLICT (booking_id, reminder_type) DO NOTHING;
            
            RAISE NOTICE 'Created reminder record for booking % (customer %)', 
                v_booking.id, v_message.customer_id;
        ELSE
            RAISE NOTICE 'No booking found for customer % and event %', 
                v_message.customer_id, v_event_id;
        END IF;
    END LOOP;
END $$;

-- Let's also add a query to verify the results
SELECT 
    c.first_name,
    c.last_name,
    e.name as event_name,
    e.date as event_date,
    br.reminder_type,
    br.sent_at
FROM booking_reminders br
JOIN bookings b ON br.booking_id = b.id
JOIN customers c ON b.customer_id = c.id
JOIN events e ON b.event_id = e.id
WHERE br.created_at::date = '2025-06-19'
ORDER BY br.sent_at;