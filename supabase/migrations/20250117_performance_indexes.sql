-- Add indexes to improve performance on /messages and /customers/[id] pages
-- These indexes address the 5-second page load issues

-- 1. Composite index for messages page - filtering inbound messages and ordering by created_at
CREATE INDEX IF NOT EXISTS idx_messages_direction_created_at 
ON messages(direction, created_at DESC) 
WHERE direction = 'inbound';

-- 2. Index for unread message counts
CREATE INDEX IF NOT EXISTS idx_messages_unread_inbound 
ON messages(direction, read_at) 
WHERE direction = 'inbound' AND read_at IS NULL;

-- 3. Index for customer detail page - messages by customer_id
CREATE INDEX IF NOT EXISTS idx_messages_customer_id_created_at 
ON messages(customer_id, created_at);

-- 4. Index for SMS statistics - outbound messages by customer
CREATE INDEX IF NOT EXISTS idx_messages_customer_direction_status 
ON messages(customer_id, direction, twilio_status) 
WHERE direction = 'outbound';

-- 5. Index for webhook message_sid lookups
CREATE INDEX IF NOT EXISTS idx_messages_twilio_message_sid 
ON messages(twilio_message_sid);

-- 6. Index for customer mobile number lookups (used in customer search and matching)
CREATE INDEX IF NOT EXISTS idx_customers_mobile_number 
ON customers(mobile_number);

-- 7. Index for time-based message queries
CREATE INDEX IF NOT EXISTS idx_messages_created_at 
ON messages(created_at DESC);

-- 8. Index for message delivery status joins
CREATE INDEX IF NOT EXISTS idx_messages_twilio_status 
ON messages(twilio_status);

-- 9. Index for booking queries by customer
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id_created_at 
ON bookings(customer_id, created_at DESC);

-- 10. Index for booking queries by event
CREATE INDEX IF NOT EXISTS idx_bookings_event_id 
ON bookings(event_id);

-- 11. Index for events by date (for upcoming events queries)
CREATE INDEX IF NOT EXISTS idx_events_date 
ON events(date) 
WHERE date >= CURRENT_DATE;

-- 12. Index for customers with SMS failures (for delivery reports)
CREATE INDEX IF NOT EXISTS idx_customers_sms_failures 
ON customers(sms_opt_in, sms_delivery_failures) 
WHERE sms_opt_in = false OR sms_delivery_failures > 0;

-- Analyze tables to update statistics after creating indexes
ANALYZE messages;
ANALYZE customers;
ANALYZE bookings;
ANALYZE events;