-- Diagnostic queries to understand import issues

-- Check if messages table has all required columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'messages'
ORDER BY ordinal_position;

-- Check a sample of what's in temp_message_import
SELECT * FROM temp_message_import LIMIT 5;

-- Test the import with detailed error logging
DO $$
DECLARE
  rec RECORD;
  cust_id UUID;
  test_count INT := 0;
BEGIN
  FOR rec IN SELECT * FROM temp_message_import LIMIT 5 LOOP
    test_count := test_count + 1;
    
    -- Find customer
    IF rec.direction = 'inbound' THEN
      cust_id := find_customer_by_phone(rec.from_number);
    ELSE
      cust_id := find_customer_by_phone(rec.to_number);
    END IF;
    
    RAISE NOTICE 'Test %: Phone=%, Customer ID=%, Direction=%', 
      test_count,
      CASE WHEN rec.direction = 'inbound' THEN rec.from_number ELSE rec.to_number END,
      cust_id,
      rec.direction;
    
    -- Try to insert if customer found
    IF cust_id IS NOT NULL THEN
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
          cust_id,
          CASE WHEN rec.direction = 'inbound' THEN 'inbound' ELSE 'outbound' END,
          rec.sid,
          rec.sid,
          rec.body,
          rec.status,
          rec.status,
          rec.from_number,
          rec.to_number,
          'sms',
          rec.sent_date::timestamp with time zone,
          NOW()
        );
        RAISE NOTICE '  SUCCESS: Message inserted';
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '  ERROR: % - %', SQLSTATE, SQLERRM;
        
        -- Show the actual values being inserted
        RAISE NOTICE '  Values: customer_id=%, direction=%, sid=%, status=%, created_at=%',
          cust_id,
          CASE WHEN rec.direction = 'inbound' THEN 'inbound' ELSE 'outbound' END,
          rec.sid,
          rec.status,
          rec.sent_date;
      END;
    ELSE
      RAISE NOTICE '  SKIPPED: No customer found';
    END IF;
  END LOOP;
END;
$$;