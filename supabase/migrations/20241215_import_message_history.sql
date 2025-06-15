-- Migration to import message history
-- This migration processes the Twilio export data and imports it into the messages table

-- Create a temporary table to hold the import data
CREATE TEMP TABLE temp_message_import (
  from_number TEXT,
  to_number TEXT,
  body TEXT,
  status TEXT,
  sent_date TEXT,
  direction TEXT,
  sid TEXT
);

-- Note: The actual data will be inserted via the import script
-- This migration sets up the structure and provides the import logic

-- Function to clean phone numbers for matching
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

-- Function to find customer by phone number
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

-- Import function that processes the temp table
CREATE OR REPLACE FUNCTION import_message_history()
RETURNS TABLE(
  total_count INT,
  imported_count INT,
  skipped_count INT,
  error_count INT
) AS $$
DECLARE
  rec RECORD;
  cust_id UUID;
  total INT := 0;
  imported INT := 0;
  skipped INT := 0;
  errors INT := 0;
  msg_direction TEXT;
  msg_status TEXT;
BEGIN
  -- Process each record in the temp table
  FOR rec IN SELECT * FROM temp_message_import LOOP
    total := total + 1;
    
    -- Determine the customer phone based on direction
    IF rec.direction = 'inbound' THEN
      cust_id := find_customer_by_phone(rec.from_number);
      msg_direction := 'inbound';
    ELSE
      cust_id := find_customer_by_phone(rec.to_number);
      msg_direction := 'outbound';
    END IF;
    
    -- Skip if no customer found
    IF cust_id IS NULL THEN
      skipped := skipped + 1;
      CONTINUE;
    END IF;
    
    -- Map status
    msg_status := CASE 
      WHEN rec.status IN ('delivered', 'sent', 'received') THEN rec.status
      WHEN rec.status = 'failed' THEN 'failed'
      WHEN rec.status = 'undelivered' THEN 'undelivered'
      ELSE 'unknown'
    END;
    
    -- Insert the message
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
        msg_direction,
        rec.sid,
        rec.sid,
        rec.body,
        msg_status,
        msg_status,
        rec.from_number,
        rec.to_number,
        'sms',
        rec.sent_date::timestamp with time zone,
        NOW() -- Mark imported messages as read
      )
      ON CONFLICT (message_sid) DO NOTHING;
      
      imported := imported + 1;
    EXCEPTION WHEN OTHERS THEN
      errors := errors + 1;
      RAISE NOTICE 'Error importing message %: %', rec.sid, SQLERRM;
    END;
  END LOOP;
  
  RETURN QUERY SELECT total, imported, skipped, errors;
END;
$$ LANGUAGE plpgsql;

-- Clean up after import
CREATE OR REPLACE FUNCTION cleanup_import()
RETURNS VOID AS $$
BEGIN
  DROP FUNCTION IF EXISTS import_message_history();
  DROP FUNCTION IF EXISTS find_customer_by_phone(TEXT);
  DROP FUNCTION IF EXISTS clean_phone_for_match(TEXT);
END;
$$ LANGUAGE plpgsql;