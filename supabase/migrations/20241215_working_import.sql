-- Working import script for message history
-- This version handles all the issues identified

-- Create helper functions
CREATE OR REPLACE FUNCTION clean_phone_for_match(phone TEXT)
RETURNS TEXT AS $$
BEGIN
  -- Remove all non-digits
  phone := regexp_replace(phone, '[^0-9]', '', 'g');
  
  -- If it starts with 44, add the +
  IF phone LIKE '44%' THEN
    RETURN '+' || phone;
  -- If it starts with 0, convert to +44
  ELSIF phone LIKE '0%' THEN
    RETURN '+44' || substring(phone from 2);
  ELSE
    RETURN '+' || phone;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION find_customer_by_phone(phone TEXT)
RETURNS UUID AS $$
DECLARE
  customer_id UUID;
  clean_phone TEXT;
  variants TEXT[];
  variant TEXT;
BEGIN
  -- Clean the input phone
  clean_phone := clean_phone_for_match(phone);
  
  -- Create variants to check
  variants := ARRAY[
    phone,  -- Original
    clean_phone,  -- Cleaned version
    regexp_replace(clean_phone, '^\+44', '0'),  -- UK local format
    regexp_replace(clean_phone, '^\+', '')  -- Without +
  ];
  
  -- Try each variant
  FOREACH variant IN ARRAY variants LOOP
    SELECT id INTO customer_id 
    FROM customers 
    WHERE mobile_number = variant 
    LIMIT 1;
    
    IF customer_id IS NOT NULL THEN
      RETURN customer_id;
    END IF;
  END LOOP;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Import messages directly without temp table
DO $$
DECLARE
  imported INT := 0;
  skipped INT := 0;
  duplicates INT := 0;
  errors INT := 0;
  cust_id UUID;
  msg_direction TEXT;
  msg_status TEXT;
BEGIN
  -- Import each message
  -- NOTE: Replace this section with the actual message data
  
  -- Example format:
  -- Check for existing message
  IF NOT EXISTS (SELECT 1 FROM messages WHERE message_sid = 'SM347121d4a63fc2e730b3342e1e3fc92b') THEN
    -- Find customer
    cust_id := find_customer_by_phone('+447990587315');  -- Use TO number for outbound
    
    IF cust_id IS NOT NULL THEN
      BEGIN
        INSERT INTO messages (
          customer_id, direction, message_sid, twilio_message_sid, body, status, twilio_status,
          from_number, to_number, message_type, created_at, read_at
        ) VALUES (
          cust_id, 'outbound', 'SM347121d4a63fc2e730b3342e1e3fc92b', 'SM347121d4a63fc2e730b3342e1e3fc92b',
          'Can you help?', 'delivered', 'delivered',
          '+447700106752', '+447990587315', 'sms',
          '2025-06-15T20:41:03+01:00'::timestamp with time zone, NOW()
        );
        imported := imported + 1;
      EXCEPTION WHEN OTHERS THEN
        errors := errors + 1;
      END;
    ELSE
      skipped := skipped + 1;
    END IF;
  ELSE
    duplicates := duplicates + 1;
  END IF;

  -- Add more messages here in the same pattern...
  
  RAISE NOTICE 'Import complete: Imported=%, Skipped=%, Duplicates=%, Errors=%', 
    imported, skipped, duplicates, errors;
END;
$$;

-- Clean up functions
DROP FUNCTION IF EXISTS find_customer_by_phone(TEXT);
DROP FUNCTION IF EXISTS clean_phone_for_match(TEXT);