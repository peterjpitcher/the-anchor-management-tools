-- Backfill booking_reminders for specific messages sent on 2025-06-19
-- These are 24-hour reminders for Cash Bingo event

-- Create temporary table with the message IDs and customer IDs
WITH sent_reminders AS (
    SELECT * FROM (VALUES
        ('87344523-da42-4fe4-a7db-45ae1726040e'::uuid, '4b7b3f9a-d717-4e4e-9633-aa449a0d1418'::uuid, 'Katie'),
        ('75e14819-ef47-417d-b60f-08f30b2848ea'::uuid, 'a1d8b408-2fd7-435f-ba6c-54d439f3239a'::uuid, 'Luke'),
        ('43403553-360b-422e-9ddd-b72373304cc8'::uuid, 'ba19868e-5e0d-4fa0-a992-e54207e1c8c7'::uuid, 'Peter'),
        ('b68c8a58-f3dd-46ac-89dc-cba03ca4d3cd'::uuid, 'cd6607c9-3740-4e2e-87ed-739a4da9852f'::uuid, 'Jacqui'),
        ('b0736b80-c469-4a0f-8cf4-e28e44fe45cf'::uuid, 'f890356d-9537-4663-97ba-7b5feec21041'::uuid, 'Mandy'),
        ('4603ebb2-8a64-4f42-b900-db3c687b4559'::uuid, '5cd528ea-736f-4b7a-aa09-1fa994821b81'::uuid, 'Claire'),
        ('3a476451-cc78-4b84-8872-c80cee9bbf19'::uuid, '95188fe2-c0e3-44ab-bbe6-63a13716ce88'::uuid, 'Moureen'),
        ('cd968222-9452-417b-b384-2fc3a8e24497'::uuid, '9d6cd6e8-d3de-45d1-a476-d187ea8195ea'::uuid, 'Penny'),
        ('d7c46b55-9a3b-475f-b169-ca64d426264e'::uuid, '6206dc82-f48e-4e0f-8eeb-74c8780d9c4c'::uuid, 'Myrtle'),
        ('310539d6-0a93-49eb-95e6-3c9c42e0d636'::uuid, '45c9fb5e-825d-4530-9007-1497bbf2ef23'::uuid, 'Anne'),
        ('8fed4384-82b5-4fe4-b222-757fe553a128'::uuid, 'dc13ad2b-634f-4411-b178-70f9dda67356'::uuid, 'Shell'),
        ('4ad71a9c-e8bb-42d8-af87-ac7f6250d7bd'::uuid, '9b6c4eef-6f45-47a4-9c9d-0a716e97ab63'::uuid, 'Rupi'),
        ('5c1ee3b6-b099-4b6c-bcdc-4d73fd2a6825'::uuid, 'a4f81eed-b066-4976-8f77-94bc68bb84c7'::uuid, 'Nish'),
        ('3d0408bb-ce8e-4b2f-9c88-f3f45bad43c1'::uuid, 'a851a8b3-88fa-4ca6-b7e6-818a597e504d'::uuid, 'Marion'),
        ('a0278bde-f3e6-47c7-8bd0-fcbe935b0da4'::uuid, '73dbb33c-fa4c-49ef-a8ec-60f3699bd00c'::uuid, 'Margaret'),
        ('1388078e-a548-47af-ab6d-85098e73d500'::uuid, '758f976d-00a4-46f4-b6db-d2f915772db7'::uuid, 'Caz'),
        ('a40935e2-3c6c-4a13-b2f6-5434e1c9c7b0'::uuid, 'b3440b73-4915-4f01-8859-4111c43df075'::uuid, 'Julie')
    ) AS t(message_id, customer_id, customer_name)
),
-- Find the Cash Bingo event on 2025-06-20
event_info AS (
    SELECT id as event_id
    FROM events
    WHERE name = 'Cash Bingo'
    AND date = '2025-06-20'
    LIMIT 1
)
-- Insert booking reminders for each message
INSERT INTO booking_reminders (booking_id, reminder_type, sent_at, message_id, created_at)
SELECT 
    b.id as booking_id,
    '24_hour' as reminder_type,
    m.created_at as sent_at,
    sr.message_id,
    m.created_at
FROM sent_reminders sr
JOIN messages m ON m.id = sr.message_id
JOIN event_info ei ON true
JOIN bookings b ON b.customer_id = sr.customer_id AND b.event_id = ei.event_id
ON CONFLICT (booking_id, reminder_type) DO NOTHING;

-- Report what was inserted
SELECT 
    COUNT(*) as reminders_recorded,
    MIN(created_at) as earliest_reminder,
    MAX(created_at) as latest_reminder
FROM booking_reminders
WHERE created_at >= '2025-06-19 05:58:00'::timestamptz
AND created_at <= '2025-06-19 05:59:00'::timestamptz;