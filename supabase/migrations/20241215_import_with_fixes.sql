-- Modified import function with better error handling and data cleaning

CREATE OR REPLACE FUNCTION import_message_history_safe()
RETURNS TABLE(
  total_count INT,
  imported_count INT,
  skipped_count INT,
  error_count INT,
  duplicate_count INT
) AS $$
DECLARE
  rec RECORD;
  cust_id UUID;
  total INT := 0;
  imported INT := 0;
  skipped INT := 0;
  errors INT := 0;
  duplicates INT := 0;
  msg_direction TEXT;
  msg_status TEXT;
  clean_status TEXT;
  existing_count INT;
BEGIN
  -- Process each record in the temp table
  FOR rec IN SELECT * FROM temp_message_import LOOP
    total := total + 1;
    
    -- Check if message already exists
    SELECT COUNT(*) INTO existing_count
    FROM messages 
    WHERE message_sid = rec.sid OR twilio_message_sid = rec.sid;
    
    IF existing_count > 0 THEN
      duplicates := duplicates + 1;
      CONTINUE;
    END IF;
    
    -- Determine the customer phone based on direction
    IF rec.direction = 'inbound' THEN
      cust_id := find_customer_by_phone(rec.from_number);
    ELSE
      cust_id := find_customer_by_phone(rec.to_number);
    END IF;
    
    -- Skip if no customer found
    IF cust_id IS NULL THEN
      skipped := skipped + 1;
      CONTINUE;
    END IF;
    
    -- Clean and map status - handle outbound-api and outbound-reply
    clean_status := LOWER(TRIM(rec.status));
    
    -- For direction, normalize outbound variants
    IF rec.direction IN ('outbound-api', 'outbound-reply') THEN
      msg_direction := 'outbound';
    ELSIF rec.direction = 'inbound' THEN
      msg_direction := 'inbound';
    ELSE
      msg_direction := 'outbound';  -- Default
    END IF;
    
    -- Map status values
    msg_status := CASE 
      WHEN clean_status IN ('delivered', 'sent', 'received', 'queued') THEN clean_status
      WHEN clean_status = 'failed' THEN 'failed'
      WHEN clean_status = 'undelivered' THEN 'undelivered'
      ELSE 'sent'  -- Default to 'sent' for unknown statuses
    END;
    
    -- Insert the message with better error handling
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
        updated_at,
        read_at
      ) VALUES (
        cust_id,
        msg_direction,
        rec.sid,
        rec.sid,
        COALESCE(rec.body, ''),  -- Handle NULL body
        msg_status,
        msg_status,
        rec.from_number,
        rec.to_number,
        'sms',
        rec.sent_date::timestamp with time zone,
        rec.sent_date::timestamp with time zone,  -- Set updated_at
        NOW() -- Mark imported messages as read
      );
      
      imported := imported + 1;
    EXCEPTION 
      WHEN unique_violation THEN
        duplicates := duplicates + 1;
      WHEN OTHERS THEN
        errors := errors + 1;
        -- Log first few errors for debugging
        IF errors <= 5 THEN
          RAISE NOTICE 'Error importing message %: % - %', rec.sid, SQLSTATE, SQLERRM;
          RAISE NOTICE '  Customer: %, Direction: %, Status: %', cust_id, msg_direction, msg_status;
        END IF;
    END;
  END LOOP;
  
  -- Show summary
  RAISE NOTICE 'Import complete: Total=%, Imported=%, Skipped=%, Errors=%, Duplicates=%', 
    total, imported, skipped, errors, duplicates;
  
  RETURN QUERY SELECT total, imported, skipped, errors, duplicates;
END;
$$ LANGUAGE plpgsql;

-- Run the safe import
SELECT * FROM import_message_history_safe();

-- Clean up the new function
DROP FUNCTION IF EXISTS import_message_history_safe();