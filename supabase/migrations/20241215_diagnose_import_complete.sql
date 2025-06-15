-- Complete diagnostic script with temp table creation

-- First, create the temp table and insert a few sample records
CREATE TEMP TABLE IF NOT EXISTS temp_message_import (
  from_number TEXT,
  to_number TEXT,
  body TEXT,
  status TEXT,
  sent_date TEXT,
  direction TEXT,
  sid TEXT
);

-- Insert just a few sample messages for testing
INSERT INTO temp_message_import VALUES 
  ('+447700106752', '+447990587315', 'Can you help?', 'delivered', '2025-06-15T20:41:03+01:00', 'outbound-api', 'SM347121d4a63fc2e730b3342e1e3fc92b'),
  ('+447990587315', '+447700106752', 'Hi', 'received', '2025-06-15T20:29:06+01:00', 'inbound', 'SMfda0962bce9d3b60a4a1fd6041f08279'),
  ('+447700106752', '+447990587315', 'Hi Peter, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00!', 'delivered', '2025-06-15T12:56:36+01:00', 'outbound-api', 'SMbe72f317c8ceffe372243dba1843dd22');

-- Check if messages table has all required columns
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'messages'
ORDER BY ordinal_position;

-- Check what's in temp table
SELECT * FROM temp_message_import;

-- Check if these phone numbers exist in customers
SELECT id, first_name, last_name, mobile_number 
FROM customers 
WHERE mobile_number IN ('+447990587315', '07990587315', '+447700106752', '07700106752')
   OR mobile_number LIKE '%7990587315%'
   OR mobile_number LIKE '%7700106752%';

-- Check for existing messages with these SIDs
SELECT message_sid, created_at, direction, status 
FROM messages 
WHERE message_sid IN ('SM347121d4a63fc2e730b3342e1e3fc92b', 'SMfda0962bce9d3b60a4a1fd6041f08279', 'SMbe72f317c8ceffe372243dba1843dd22');

-- Test inserting a single message manually
DO $$
DECLARE
  test_customer_id UUID;
BEGIN
  -- Find a customer (try Peter's number)
  SELECT id INTO test_customer_id FROM customers WHERE mobile_number LIKE '%7990587315%' LIMIT 1;
  
  IF test_customer_id IS NOT NULL THEN
    RAISE NOTICE 'Found customer: %', test_customer_id;
    
    -- Try to insert a test message
    BEGIN
      INSERT INTO messages (
        customer_id,
        direction,
        message_sid,
        twilio_message_sid,
        body,
        status,
        twilio_status,
        created_at
      ) VALUES (
        test_customer_id,
        'outbound',
        'TEST_' || extract(epoch from now())::text,
        'TEST_' || extract(epoch from now())::text,
        'Test message from diagnostic',
        'delivered',
        'delivered',
        NOW()
      );
      RAISE NOTICE 'SUCCESS: Test message inserted';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'ERROR inserting test message: % - %', SQLSTATE, SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'No customer found with phone number containing 7990587315';
  END IF;
END;
$$;

-- Check constraints on messages table
SELECT 
  tc.constraint_name, 
  tc.constraint_type,
  cc.check_clause
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.check_constraints cc 
  ON tc.constraint_name = cc.constraint_name
WHERE tc.table_name = 'messages';