-- Bulk import for clean messages table
-- First, delete all existing messages (run this manually if you prefer):
-- DELETE FROM messages;

-- Create temporary import table
CREATE TEMP TABLE message_import (
  from_number TEXT,
  to_number TEXT,
  body TEXT,
  status TEXT,
  sent_date TEXT,
  direction TEXT,
  sid TEXT
);

-- Use COPY to bulk load data (much faster than individual INSERTs)
-- You'll need to upload the CSV file to Supabase first, or use the INSERT statements below

-- Create helper functions for phone matching
CREATE OR REPLACE FUNCTION find_customer_id(phone TEXT)
RETURNS UUID AS $$
DECLARE
  cust_id UUID;
BEGIN
  -- Try exact match first
  SELECT id INTO cust_id FROM customers WHERE mobile_number = phone LIMIT 1;
  IF cust_id IS NOT NULL THEN RETURN cust_id; END IF;
  
  -- Try without + prefix
  SELECT id INTO cust_id FROM customers WHERE mobile_number = regexp_replace(phone, '^\+', '') LIMIT 1;
  IF cust_id IS NOT NULL THEN RETURN cust_id; END IF;
  
  -- Try UK format conversions
  IF phone LIKE '+44%' THEN
    SELECT id INTO cust_id FROM customers WHERE mobile_number = '0' || substring(phone from 4) LIMIT 1;
    IF cust_id IS NOT NULL THEN RETURN cust_id; END IF;
  END IF;
  
  IF phone LIKE '0%' THEN
    SELECT id INTO cust_id FROM customers WHERE mobile_number = '+44' || substring(phone from 2) LIMIT 1;
    IF cust_id IS NOT NULL THEN RETURN cust_id; END IF;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Bulk insert from temp table to messages
INSERT INTO messages (
  customer_id,
  direction,
  message_sid,
  twilio_message_sid,
  body,
  status,
  twilio_status,
  from_number,
  to_number,
  message_type,
  created_at,
  updated_at
)
SELECT 
  CASE 
    WHEN i.direction = 'inbound' THEN find_customer_id(i.from_number)
    ELSE find_customer_id(i.to_number)
  END as customer_id,
  CASE 
    WHEN i.direction IN ('outbound-api', 'outbound-reply') THEN 'outbound'
    ELSE i.direction
  END as direction,
  i.sid,
  i.sid,
  i.body,
  i.status,
  i.status,
  i.from_number,
  i.to_number,
  'sms',
  i.sent_date::timestamp with time zone,
  i.sent_date::timestamp with time zone
FROM message_import i
WHERE CASE 
    WHEN i.direction = 'inbound' THEN find_customer_id(i.from_number)
    ELSE find_customer_id(i.to_number)
  END IS NOT NULL;

-- Show results
WITH import_stats AS (
  SELECT 
    COUNT(*) as total_in_temp,
    COUNT(CASE 
      WHEN direction = 'inbound' THEN 
        CASE WHEN find_customer_id(from_number) IS NOT NULL THEN 1 END
      ELSE 
        CASE WHEN find_customer_id(to_number) IS NOT NULL THEN 1 END
    END) as with_customer,
    COUNT(CASE 
      WHEN direction = 'inbound' THEN 
        CASE WHEN find_customer_id(from_number) IS NULL THEN 1 END
      ELSE 
        CASE WHEN find_customer_id(to_number) IS NULL THEN 1 END
    END) as without_customer
  FROM message_import
),
final_stats AS (
  SELECT COUNT(*) as imported FROM messages
)
SELECT 
  total_in_temp as "Total Messages",
  with_customer as "Had Customer", 
  without_customer as "No Customer Found",
  imported as "Successfully Imported"
FROM import_stats, final_stats;

-- Cleanup
DROP FUNCTION find_customer_id(TEXT);