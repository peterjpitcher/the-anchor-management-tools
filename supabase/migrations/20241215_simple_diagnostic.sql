-- Simple diagnostic queries without temp tables

-- 1. Check messages table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'messages'
ORDER BY ordinal_position;

-- 2. Check constraints on messages table
SELECT 
  tc.constraint_name, 
  tc.constraint_type,
  cc.check_clause
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.check_constraints cc 
  ON tc.constraint_name = cc.constraint_name
WHERE tc.table_name = 'messages';

-- 3. Check if we have customers with these phone numbers
SELECT id, first_name, last_name, mobile_number 
FROM customers 
WHERE mobile_number IN ('+447990587315', '07990587315', '+447700106752', '07700106752')
   OR mobile_number LIKE '%7990587315%'
   OR mobile_number LIKE '%7700106752%'
LIMIT 10;

-- 4. Check existing messages count
SELECT COUNT(*) as total_messages, 
       COUNT(DISTINCT customer_id) as unique_customers,
       MIN(created_at) as oldest_message,
       MAX(created_at) as newest_message
FROM messages;

-- 5. Test a simple insert with a known customer
DO $$
DECLARE
  test_customer_id UUID;
  test_sid TEXT;
BEGIN
  -- Generate unique SID for test
  test_sid := 'TEST_' || extract(epoch from now())::text;
  
  -- Find any customer
  SELECT id INTO test_customer_id FROM customers LIMIT 1;
  
  IF test_customer_id IS NOT NULL THEN
    RAISE NOTICE 'Testing insert with customer ID: %', test_customer_id;
    
    -- Try minimal insert
    BEGIN
      INSERT INTO messages (customer_id, direction, message_sid, body, status, created_at)
      VALUES (test_customer_id, 'outbound', test_sid, 'Test', 'sent', NOW());
      
      RAISE NOTICE 'SUCCESS: Basic insert worked';
      
      -- Clean up test
      DELETE FROM messages WHERE message_sid = test_sid;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'ERROR: % - %', SQLSTATE, SQLERRM;
    END;
    
    -- Now try with all fields from import
    BEGIN
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
        read_at
      ) VALUES (
        test_customer_id,
        'outbound',
        test_sid || '_2',
        test_sid || '_2',
        'Test message',
        'delivered',
        'delivered',
        '+447700106752',
        '+447990587315',
        'sms',
        '2025-06-15T20:41:03+01:00'::timestamp with time zone,
        NOW()
      );
      
      RAISE NOTICE 'SUCCESS: Full insert with all fields worked';
      
      -- Clean up
      DELETE FROM messages WHERE message_sid = test_sid || '_2';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'ERROR with full insert: % - %', SQLSTATE, SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'ERROR: No customers found in database';
  END IF;
END;
$$;