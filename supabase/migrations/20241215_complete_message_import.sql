-- Complete migration to import message history from Twilio export
-- This single file contains all functions and data needed for the import
-- Run this file to import all message history

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

-- Insert message data
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Can you help?',
  'delivered',
  '2025-06-15T20:41:03+01:00',
  'outbound-api',
  'SM347121d4a63fc2e730b3342e1e3fc92b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi',
  'delivered',
  '2025-06-15T20:34:00+01:00',
  'outbound-api',
  'SM1887c00289590ae558a0ba2ccb1ed21d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447990587315',
  '+447700106752',
  'Hi',
  'received',
  '2025-06-15T20:29:06+01:00',
  'inbound',
  'SMfda0962bce9d3b60a4a1fd6041f08279'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447990587315',
  '+447700106752',
  'Thanks',
  'received',
  '2025-06-15T19:17:35+01:00',
  'inbound',
  'SM805e29ef0613660b54693d6b058521ca'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-15T12:56:36+01:00',
  'outbound-api',
  'SMbe72f317c8ceffe372243dba1843dd22'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-15T12:33:37+01:00',
  'outbound-api',
  'SM8205ddd03c8938533ee9f114dfe04cef'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-15T12:28:04+01:00',
  'outbound-api',
  'SM456eb3c5e182c9dea7353ab6f3383845'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-15T12:16:18+01:00',
  'outbound-api',
  'SM19b40091065d6bb818fd87209106d3ab'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, just a reminder that our Cash Bingo is next week on 20 June at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-13T10:28:48+01:00',
  'outbound-api',
  'SM6cc4e3eaabf713705c39bae3a94a14e0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447914398101',
  'Hi Jacqui, just a reminder that our Cash Bingo is next week on 20 June at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-13T10:28:48+01:00',
  'outbound-api',
  'SM841d7e3e1faf5ba3d722d73a2ed04daa'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy, just a reminder that our Cash Bingo is next week on 20 June at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-13T10:28:48+01:00',
  'outbound-api',
  'SM819c3ce9dd18c841fb3e3bfe6d6ded00'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire, just a reminder that our Cash Bingo is next week on 20 June at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-13T10:28:47+01:00',
  'outbound-api',
  'SM3d0cc9daf7604bfa365000136da1bab8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447586282882',
  'Hi Moureen, just a reminder that our Cash Bingo is next week on 20 June at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-13T10:28:47+01:00',
  'outbound-api',
  'SM3035b8abad5845394ff20fc310e0bf74'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, just a reminder that our Cash Bingo is next week on 20 June at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-13T10:28:47+01:00',
  'outbound-api',
  'SM71734b0fc1f0a14b1a6f08c781487541'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447805988710',
  'Hi Myrtle, just a reminder that our Cash Bingo is next week on 20 June at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-13T10:28:47+01:00',
  'outbound-api',
  'SM7fe109c8a5baded3c0a5a96e150f3cd9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447809645374',
  'Hi Anne, just a reminder that our Cash Bingo is next week on 20 June at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-13T10:28:46+01:00',
  'outbound-api',
  'SM831df3ea3eab65dff152b49f471a3da8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447914408517',
  'Hi Shell, just a reminder that our Cash Bingo is next week on 20 June at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-13T10:28:46+01:00',
  'outbound-api',
  'SMbdab72a0eeda0acd72c32a0e3fa846f7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+44777191112',
  'Hi Alice, just a reminder that our Cash Bingo is next week on 20 June at 6pm . See you here! The Anchor 01753682707',
  'failed',
  '2025-06-13T10:28:46+01:00',
  'outbound-api',
  'SMdb0c662c58b88fe1119df34ca5dadab7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi, just a reminder that our Cash Bingo is next week on 20 June at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-13T10:28:45+01:00',
  'outbound-api',
  'SMe7c7fda4ad036c3d0fb609c1e5ed7a25'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946754476',
  'Hi Nish, just a reminder that our Cash Bingo is next week on 20 June at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-13T10:28:45+01:00',
  'outbound-api',
  'SM956d212a75a3319f2b33fa0d56d2657c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447803037526',
  'Hi Marion, just a reminder that our Cash Bingo is next week on 20 June at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-13T10:28:45+01:00',
  'outbound-api',
  'SM289c76e2ee419e704c022fc6ffaada0f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447519120751',
  'Hi Margaret, just a reminder that our Cash Bingo is next week on 20 June at 6pm and you have 6 seats booked. See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-13T10:28:45+01:00',
  'outbound-api',
  'SM81afe1dea544354e3a58ca3bef75949c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, just a reminder that our Cash Bingo is next week on 20 June at 6pm and you have 6 seats booked. See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-13T10:28:44+01:00',
  'outbound-api',
  'SM5211182d3d642c04b9dbe40f55939ed8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447788239129',
  'Hi Julie, just a reminder that our Cash Bingo is next week on 20 June at 6pm and you have 4 seats booked. See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-13T10:28:44+01:00',
  'outbound-api',
  'SM506ffd4ebbcfa38ab43afd122a500bd3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447803037526',
  '+447700106752',
  'Hi I did reply a few weeks ago unfortunately I''m go to see Tom Jones so will miss my favourite tipple. Have a successful evening. Marion',
  'received',
  '2025-06-12T10:39:06+01:00',
  'inbound',
  'SM98ed585c5959acd0d0ac1a2e2e7f0a2c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447305866052',
  'Hi Lauren, just a reminder that our Rum Tasting Night is tomorrow at 7pm and you have 2 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-12T10:28:38+01:00',
  'outbound-api',
  'SM4fd600e8cb9d672b183354b34762b120'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, just a reminder that our Rum Tasting Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-12T10:28:38+01:00',
  'outbound-api',
  'SM56c08ee49d40e62472d356c533d69ecd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447719261701',
  'Hi Claire, just a reminder that our Rum Tasting Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-12T10:28:38+01:00',
  'outbound-api',
  'SMc5a8d032e2cdcc7a0f710ec9f6346a0a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447809645374',
  'Hi Anne, just a reminder that our Rum Tasting Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-12T10:28:38+01:00',
  'outbound-api',
  'SM6d83bc4707cd2e8ffc600006aaf53388'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447803037526',
  'Hi Marion, just a reminder that our Rum Tasting Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-12T10:28:38+01:00',
  'outbound-api',
  'SM26b5565c155469cf49557e8086788fe1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447766048813',
  'Hi Chris, just a reminder that our Rum Tasting Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-12T10:28:37+01:00',
  'outbound-api',
  'SMf0e49bc927abecd27522cf149ed67f30'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire, just a reminder that our Rum Tasting Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-12T10:28:37+01:00',
  'outbound-api',
  'SM42e91faa88401c42b27f8a9bcfc8f708'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447914398101',
  'Hi Jacqui, just a reminder that our Rum Tasting Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-12T10:28:37+01:00',
  'outbound-api',
  'SMc9d80250443feac75fa3f347526d8c6d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447888204175',
  'Hi Valentina, just a reminder that our Rum Tasting Night is tomorrow at 7pm and you have 2 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-12T10:28:36+01:00',
  'outbound-api',
  'SM1b62582f52edb523f0cd31a2798bcedd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447498522632',
  'Hi Miles, just a reminder that our Rum Tasting Night is tomorrow at 7pm and you have 1 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-12T10:28:36+01:00',
  'outbound-api',
  'SM64e7275e0fccc3e505d27b99d55f1a0a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447513520317',
  'Hi Pike, just a reminder that our Rum Tasting Night is tomorrow at 7pm and you have 1 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-12T10:28:36+01:00',
  'outbound-api',
  'SMd0bbcb7b957e429c472ef18ef9b1218d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946754476',
  'Hi Nish, just a reminder that our Rum Tasting Night is tomorrow at 7pm and you have 4 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-12T10:28:36+01:00',
  'outbound-api',
  'SMc19039cc00a187948ec109626d1b9dd1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi, just a reminder that our Rum Tasting Night is tomorrow at 7pm and you have 6 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-12T10:28:35+01:00',
  'outbound-api',
  'SM601469d44c09c67f1d611d795e960442'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447305866052',
  'Hi Lauren, your booking for 2 people for our Rum Tasting Night on 13 June at 7pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-06-11T18:37:45+01:00',
  'outbound-api',
  'SMb17c9bc27877c62b2a84b00109eb4855'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Cash Bingo on 20 June at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-11T18:20:53+01:00',
  'outbound-api',
  'SM96de3c04bc8946ba7803594349f120d6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Rum Tasting Night on 13 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T21:00:00+01:00',
  'outbound-api',
  'SMca3a7fbf77d1fa6c713ffb997a731c7e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+4478889600378',
  'Hi Lou, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'failed',
  '2025-06-08T14:51:30+01:00',
  'outbound-api',
  'SM4ba313c5af146157363b6b9401f91dea'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:51:29+01:00',
  'outbound-api',
  'SM81a9e8c206331ac17b578ebd66558664'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447860100825',
  'Hi Shell, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:51:28+01:00',
  'outbound-api',
  'SM8d94142f6ddeeb03ed770cd52c14b045'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447891505037',
  'Hi Jordan, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:51:27+01:00',
  'outbound-api',
  'SMae2cfb10b9c08a03aacd876eb0718ac4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447415423113',
  'Hi Luke, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:51:27+01:00',
  'outbound-api',
  'SM535f4f0e60d1c47424583d5267861a75'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447519120751',
  'Hi Margaret, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:51:26+01:00',
  'outbound-api',
  'SMadb814b13cac5565673c9ee3554fa261'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447736641657',
  'Hi Lorraine , don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:51:26+01:00',
  'outbound-api',
  'SMa4939ed475a5bbd92bff043c27191f00'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447704899719',
  'Hi Anne, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:51:25+01:00',
  'outbound-api',
  'SM5da4f79253f306ffd94ee5caf20e032a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447540308939',
  'Hi Mary, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:51:24+01:00',
  'outbound-api',
  'SMfc2df6074fe0b966aa8becb3b680a776'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447939958957',
  'Hi Pav, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:51:23+01:00',
  'outbound-api',
  'SM68847ccdd0210585a49cee881d0a7ceb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447708714947',
  'Hi Brian, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:51:23+01:00',
  'outbound-api',
  'SMc710b0f6064983fc90361b0dcc89dc65'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:51:22+01:00',
  'outbound-api',
  'SM8d6d92b5fc2dc3f57d4d831d69b649ab'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447788239129',
  'Hi Julie, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:51:22+01:00',
  'outbound-api',
  'SMdf10d3cfa0375f642e3183814055f360'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447739227080',
  'Hi Barbara, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:51:21+01:00',
  'outbound-api',
  'SM31376379abeeeda6c31daec8a5040af0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447759132843',
  'Hi Liz, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:51:21+01:00',
  'outbound-api',
  'SM9b0e0419200e84fcdcc29d3cc1d0271f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447791211627',
  'Hi Sara, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:51:20+01:00',
  'outbound-api',
  'SMd6ecbf2ba9357ee8a69b8fe51245c86c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447153682634',
  'Hi Wendy, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'sent',
  '2025-06-08T14:51:19+01:00',
  'outbound-api',
  'SMbe79553659f9149cf9828478fcc57926'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447941085007',
  'Hi Lorraine, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:51:19+01:00',
  'outbound-api',
  'SMc7788e0995b0556b3bf94a00fb79a449'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447906501332',
  'Hi Suzie, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:51:18+01:00',
  'outbound-api',
  'SM9490bb953801bc302395fecb1a804dbb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447809645374',
  'Hi Anne, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:51:17+01:00',
  'outbound-api',
  'SM569b14cabc44b2e6a6bc10eaf6e528c9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:51:16+01:00',
  'outbound-api',
  'SM21594caf970f69181932987d94857fbf'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, don''t forget, we''ve got our Quiz Night on 2 July at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:51:15+01:00',
  'outbound-api',
  'SM6bce22c897737a24cbc19cda70a3107e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447939958957',
  'Hi Pav, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:48+01:00',
  'outbound-api',
  'SM807d724fdbceecebff8ece63df7dcd0d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:47+01:00',
  'outbound-api',
  'SMfca87c00534c45484fea0fd1a6715b09'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447766048813',
  'Hi Chris, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:46+01:00',
  'outbound-api',
  'SM58f3133ad719f521595e6775055b9f19'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447891505037',
  'Hi Jordan, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:46+01:00',
  'outbound-api',
  'SM0eaceea1341299cb1934164dd7438fe5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447415423113',
  'Hi Luke, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:45+01:00',
  'outbound-api',
  'SMe80b12234598e483d7b8c9040dbadc8f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447519120751',
  'Hi Margaret, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:44+01:00',
  'outbound-api',
  'SM19fa71832706a63b76d636c0056afb79'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447736641657',
  'Hi Lorraine , don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:43+01:00',
  'outbound-api',
  'SMda256f49031634008abf81d08dc5179b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447704899719',
  'Hi Anne, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:42+01:00',
  'outbound-api',
  'SMcb5c05998ff43f51f18764f57292bb66'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447719261701',
  'Hi Claire, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:41+01:00',
  'outbound-api',
  'SM466254e44366f51a4b67795c90bb8c57'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447708714947',
  'Hi Brian, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:41+01:00',
  'outbound-api',
  'SM5eb5ad9f68303bf26fe3d1c646e6a95e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:40+01:00',
  'outbound-api',
  'SMff0a22f40cd1dd5523cd4c167d1f962a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447914398101',
  'Hi Jacqui, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:39+01:00',
  'outbound-api',
  'SM643689b4e2e702d23d5fb4d22e261f82'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:38+01:00',
  'outbound-api',
  'SM68bf5b478fcd526e2b1d6675b071ad4c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447586282882',
  'Hi Moureen, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:37+01:00',
  'outbound-api',
  'SM89af0111388fc62bb1f687a0882ea8bd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:37+01:00',
  'outbound-api',
  'SM39c2f3f9a77194ccdd682861008dc112'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447788239129',
  'Hi Julie, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:36+01:00',
  'outbound-api',
  'SMd333952b6e2db68569547ff3b302e31f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447739227080',
  'Hi Barbara, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:35+01:00',
  'outbound-api',
  'SM5443940f1a8308b8c30cdf1346203f19'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447759132843',
  'Hi Liz, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:34+01:00',
  'outbound-api',
  'SM9f023d365463b5aed9e1047a1dc85aea'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447153682634',
  'Hi Wendy, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'undelivered',
  '2025-06-08T14:48:33+01:00',
  'outbound-api',
  'SMe33c39563bcb873a42be5b86d8ba5cb9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:32+01:00',
  'outbound-api',
  'SM6cc7f409b4307660fb34d935118ec5c5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:31+01:00',
  'outbound-api',
  'SMe25fe6f87c950ca0b6130ada8882a6ca'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946754476',
  'Hi Nish, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:30+01:00',
  'outbound-api',
  'SMfb3a480acbedd6370e4109dfef22de52'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447742116805',
  'Hi Jade, don''t forget, we''ve got our Drag Cabaret & Karaoke on 27 June at 19:00! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:48:29+01:00',
  'outbound-api',
  'SM32bf58574715f8bb5255caeed472b7d1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447498522632',
  'Hi Miles, your booking for 1 people for our Rum Tasting Night on 13 June at 7pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-06-08T14:36:08+01:00',
  'outbound-api',
  'SMfc9beaaefde1b22060c6e62f1df0ced6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447513520317',
  'Hi Pike, your booking for 1 people for our Rum Tasting Night on 13 June at 7pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-06-08T13:36:50+01:00',
  'outbound-api',
  'SM0ba0d03dc973bd8ef0df23effb35b2eb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447803037526',
  'Hi Marion, just a reminder that our Rum Tasting Night is next week on 13 June at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-06T10:28:25+01:00',
  'outbound-api',
  'SMaed0cea14b6c775bc61cc23014658fb6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447888204175',
  'Hi Valentina, just a reminder that our Rum Tasting Night is next week on 13 June at 7pm and you have 2 seats booked. See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-06T10:28:24+01:00',
  'outbound-api',
  'SMe66e4bc1153d0c63a63392df687bb1fb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447719261701',
  'Hi Claire, just a reminder that our Rum Tasting Night is next week on 13 June at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-06T10:28:24+01:00',
  'outbound-api',
  'SMbb063d7ab2c6020dbe221fa5c705c0a4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447766048813',
  'Hi Chris, just a reminder that our Rum Tasting Night is next week on 13 June at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-06T10:28:24+01:00',
  'outbound-api',
  'SMa870c073689d4a5dcb3a5fc17e05ba1c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447708714947',
  'Hi Brian, just a reminder that our Rum Tasting Night is next week on 13 June at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-06T10:28:24+01:00',
  'outbound-api',
  'SM24a7565a42ac97aa78b9f94b8dca3b1f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447586282882',
  'Hi Moureen, just a reminder that our Rum Tasting Night is next week on 13 June at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-06T10:28:23+01:00',
  'outbound-api',
  'SM2a6cf2f72404c17f26496719ecb616fd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447912859484',
  'Hi Katie, just a reminder that our Rum Tasting Night is next week on 13 June at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-06T10:28:23+01:00',
  'outbound-api',
  'SM0158b866d2e58f3ee6ebf6576bca05e9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire, just a reminder that our Rum Tasting Night is next week on 13 June at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-06T10:28:23+01:00',
  'outbound-api',
  'SMc1c22f8cab735bba590e780914c0675d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447809645374',
  'Hi Anne, just a reminder that our Rum Tasting Night is next week on 13 June at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-06T10:28:23+01:00',
  'outbound-api',
  'SM40f221a956835da8ddee342feb27ab81'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447914398101',
  'Hi Jacqui, just a reminder that our Rum Tasting Night is next week on 13 June at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-06T10:28:22+01:00',
  'outbound-api',
  'SM43186ffffb21fb278ae101bf6bd9eb2b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, just a reminder that our Rum Tasting Night is next week on 13 June at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-06T10:28:22+01:00',
  'outbound-api',
  'SM48c599754299c2257a01d088155d9a74'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi, just a reminder that our Rum Tasting Night is next week on 13 June at 7pm and you have 6 seats booked. See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-06T10:28:22+01:00',
  'outbound-api',
  'SM84336165fb5f31c5dae92c4ccc58630a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946754476',
  'Hi Nish, just a reminder that our Rum Tasting Night is next week on 13 June at 7pm and you have 4 seats booked. See you here! The Anchor 01753682707',
  'delivered',
  '2025-06-06T10:28:22+01:00',
  'outbound-api',
  'SMec320e55be4d1f3e1d472d0559a5054e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447941085007',
  'Hi Lorraine, your booking for 5 people for our Quiz Night on 4 June at 7pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-06-04T15:09:28+01:00',
  'outbound-api',
  'SMe3ce0b78d3167f5b5f2eb194463f4724'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447805988710',
  '+447700106752',
  'I am so sorry I won''t be able to come I will let you all know when we will come thank you.',
  'received',
  '2025-06-03T10:31:06+01:00',
  'inbound',
  'SM49db96f1773d0396d9d8f86ab5033430'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire, just a reminder that our Quiz Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-03T10:29:03+01:00',
  'outbound-api',
  'SM89a75a254c41a0da9716c75206015060'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, just a reminder that our Quiz Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-03T10:29:02+01:00',
  'outbound-api',
  'SMe3a65929af4666b4c86e15c8426887f2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447891505037',
  'Hi Jordan, just a reminder that our Quiz Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-03T10:29:01+01:00',
  'outbound-api',
  'SM7e8750990645023d9cb5d07186f6d0de'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447941085007',
  'Hi Lorraine, just a reminder that our Quiz Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-03T10:29:01+01:00',
  'outbound-api',
  'SM67c81d0a7d35a49ab1378050305317b1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447906501332',
  'Hi Suzie, just a reminder that our Quiz Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-03T10:29:01+01:00',
  'outbound-api',
  'SM6bc7acef51b2e3b2ae4e97e3416db578'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi, just a reminder that our Quiz Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-03T10:29:00+01:00',
  'outbound-api',
  'SMf9608febafb2ff37428816becfa817f4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447519120751',
  'Hi Margaret, just a reminder that our Quiz Night is tomorrow at 7pm and you have 6 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-03T10:29:00+01:00',
  'outbound-api',
  'SM8f99c079caedc91af5402ab71efe8eb8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447805988710',
  'Hi Myrtle, just a reminder that our Quiz Night is tomorrow at 7pm and you have 4 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-03T10:29:00+01:00',
  'outbound-api',
  'SM5a67ae1c0c71769400fcd5075b63f17f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447415423113',
  'Hi Luke, just a reminder that our Quiz Night is tomorrow at 7pm and you have 6 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-03T10:29:00+01:00',
  'outbound-api',
  'SM77ec7267820f1341617c4edb954f527c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, just a reminder that our Quiz Night is tomorrow at 7pm and you have 4 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-03T10:29:00+01:00',
  'outbound-api',
  'SMde5018d3097b32340d0a5653d8c87fc7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447788239129',
  'Hi Julie, just a reminder that our Quiz Night is tomorrow at 7pm and you have 4 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-06-03T10:28:59+01:00',
  'outbound-api',
  'SMb28b38b08c4162bd5e9001f3e606d2e1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+44777191112',
  'Hi Alice, just a reminder that our Quiz Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'failed',
  '2025-06-03T10:28:59+01:00',
  'outbound-api',
  'SM604bcffb1d588f13b40389e382e170e1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447742116805',
  'Hi Jade, just a reminder that our Drag Cabaret & Karaoke is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-29T10:28:34+01:00',
  'outbound-api',
  'SMdf5edf1956de5d4fe7902fa33dca0577'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy, just a reminder that our Drag Cabaret & Karaoke is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-29T10:28:33+01:00',
  'outbound-api',
  'SMf54e06282952d8dc2a6603a63228f016'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447586282882',
  'Hi Moureen, just a reminder that our Drag Cabaret & Karaoke is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-29T10:28:33+01:00',
  'outbound-api',
  'SMf2128e9efe15b59f43a75543e71ce161'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire, just a reminder that our Drag Cabaret & Karaoke is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-29T10:28:33+01:00',
  'outbound-api',
  'SM303bd4d46b37ffd6098848fc1b682727'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, just a reminder that our Drag Cabaret & Karaoke is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-29T10:28:33+01:00',
  'outbound-api',
  'SM9fcee29f7ba87e47e2bfde6cc239f2f1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447906501332',
  'Hi Suzie, just a reminder that our Drag Cabaret & Karaoke is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-29T10:28:33+01:00',
  'outbound-api',
  'SM60ccc3e20a9b3de82ad739509161f9bf'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447941085007',
  'Hi Lorraine, just a reminder that our Drag Cabaret & Karaoke is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-29T10:28:33+01:00',
  'outbound-api',
  'SM524b4d52b3d56969979d2be1c9fafe02'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi, just a reminder that our Drag Cabaret & Karaoke is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-29T10:28:32+01:00',
  'outbound-api',
  'SM94ac0c5891364071dc3298341a722ac7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447519120751',
  'Hi Margaret, just a reminder that our Drag Cabaret & Karaoke is tomorrow at 7pm and you have 8 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-29T10:28:32+01:00',
  'outbound-api',
  'SMdeae3a4bc911208c3a6bb5be6e494cfc'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447736641657',
  'Hi Lorraine , just a reminder that our Drag Cabaret & Karaoke is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-29T10:28:32+01:00',
  'outbound-api',
  'SM3f3765c13184f2e5efa4be29aa3c4995'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447788239129',
  'Hi Julie, just a reminder that our Drag Cabaret & Karaoke is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-29T10:28:32+01:00',
  'outbound-api',
  'SM86a0f2af3e958f121ef56799bb6e5199'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, just a reminder that our Drag Cabaret & Karaoke is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-29T10:28:32+01:00',
  'outbound-api',
  'SM7cd773d4cd6f221c56b63c40f2d5da90'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire, just a reminder that our Quiz Night is next week on 4 June at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-05-28T10:28:42+01:00',
  'outbound-api',
  'SM603a8066c330a410a6695b4c0d27e7cf'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, just a reminder that our Quiz Night is next week on 4 June at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-05-28T10:28:41+01:00',
  'outbound-api',
  'SM06606cac9e0973fbba2731c485aea6d3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447891505037',
  'Hi Jordan, just a reminder that our Quiz Night is next week on 4 June at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-05-28T10:28:41+01:00',
  'outbound-api',
  'SMbf575a547f0e5f6ad7f937a91764477d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447941085007',
  'Hi Lorraine, just a reminder that our Quiz Night is next week on 4 June at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-05-28T10:28:41+01:00',
  'outbound-api',
  'SMc54362410f30b4453b76049e5993238b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447906501332',
  'Hi Suzie, just a reminder that our Quiz Night is next week on 4 June at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-05-28T10:28:41+01:00',
  'outbound-api',
  'SM7fb17283303cf93d55bdf09e43bfece1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi, just a reminder that our Quiz Night is next week on 4 June at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-05-28T10:28:41+01:00',
  'outbound-api',
  'SM1a1701379dbb059c4d05ad73a6f1bc14'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447519120751',
  'Hi Margaret, just a reminder that our Quiz Night is next week on 4 June at 7pm and you have 6 seats booked. See you here! The Anchor 01753682707',
  'delivered',
  '2025-05-28T10:28:41+01:00',
  'outbound-api',
  'SM18f3c5bd8ecf54372f102297620e6adc'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447805988710',
  'Hi Myrtle, just a reminder that our Quiz Night is next week on 4 June at 7pm and you have 4 seats booked. See you here! The Anchor 01753682707',
  'delivered',
  '2025-05-28T10:28:40+01:00',
  'outbound-api',
  'SM8fd1f05633b51d1bf9990057232cca16'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+44777191112',
  'Hi Alice, just a reminder that our Quiz Night is next week on 4 June at 7pm . See you here! The Anchor 01753682707',
  'failed',
  '2025-05-28T10:28:40+01:00',
  'outbound-api',
  'SMca81e5a31e8c184529b9fec706a21dcb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447415423113',
  'Hi Luke, just a reminder that our Quiz Night is next week on 4 June at 7pm and you have 6 seats booked. See you here! The Anchor 01753682707',
  'delivered',
  '2025-05-28T10:28:39+01:00',
  'outbound-api',
  'SMea3c94f8453d200515a310cb2cb00868'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, just a reminder that our Quiz Night is next week on 4 June at 7pm and you have 4 seats booked. See you here! The Anchor 01753682707',
  'delivered',
  '2025-05-28T10:28:39+01:00',
  'outbound-api',
  'SM0f4214ffd7bc2d2fed3bddbe4b3241dd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447788239129',
  'Hi Julie, just a reminder that our Quiz Night is next week on 4 June at 7pm and you have 4 seats booked. See you here! The Anchor 01753682707',
  'delivered',
  '2025-05-28T10:28:39+01:00',
  'outbound-api',
  'SM144d1d33752bd2cd9b58992fa55fd374'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447809645374',
  '+447700106752',
  'Can''t make rum night am on holiday.',
  'received',
  '2025-05-24T14:09:09+01:00',
  'inbound',
  'SMc64d90f2b0337dd3da29b5885dd8266c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447809645374',
  '+447700106752',
  'Thanks',
  'received',
  '2025-05-24T14:08:15+01:00',
  'inbound',
  'SMca723badc42244cf2a56f68646fbc00c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447914398101',
  '+447700106752',
  'Sorry I''m having a knee replace on the 30 may sorry',
  'received',
  '2025-05-24T13:55:17+01:00',
  'inbound',
  'SMe0494011e471a7f815f150bff153d2a4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447914398101',
  '+447700106752',
  'Hi',
  'received',
  '2025-05-24T13:54:29+01:00',
  'inbound',
  'SM91f77aee19e544768117333567460b56'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447914398101',
  'Hi Jacqui, don''t forget, we''ve got our Cash Bingo on 20 June at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:53:28+01:00',
  'outbound-api',
  'SM46fa501397116f7ba8b51a573551a008'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy, don''t forget, we''ve got our Cash Bingo on 20 June at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:53:27+01:00',
  'outbound-api',
  'SMeb4eec34e65884b7546f8207bbe9a9b2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire, don''t forget, we''ve got our Cash Bingo on 20 June at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:53:26+01:00',
  'outbound-api',
  'SMa1690e2d25c8f4223bbdbb94ce0f716e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447586282882',
  'Hi Moureen, don''t forget, we''ve got our Cash Bingo on 20 June at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:53:26+01:00',
  'outbound-api',
  'SMca697dd826342fe7324218a32183cf68'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, don''t forget, we''ve got our Cash Bingo on 20 June at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:53:25+01:00',
  'outbound-api',
  'SMa2cb6d170d8c95e89bbc1b510b11d384'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447805988710',
  'Hi Myrtle, don''t forget, we''ve got our Cash Bingo on 20 June at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:53:25+01:00',
  'outbound-api',
  'SM118861ab026cfce4b344a7fe0d01f900'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447809645374',
  'Hi Anne, don''t forget, we''ve got our Cash Bingo on 20 June at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:53:24+01:00',
  'outbound-api',
  'SMf1bcb03fa0af451b3928a76098dc7ce4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447914408517',
  'Hi Shell, don''t forget, we''ve got our Cash Bingo on 20 June at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:53:24+01:00',
  'outbound-api',
  'SMff0e02639d0aea17ea6b878fa9b10d8b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi, don''t forget, we''ve got our Cash Bingo on 20 June at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:53:23+01:00',
  'outbound-api',
  'SMe5c9217641f37a07b1a794b4e401ada1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946754476',
  'Hi Nish, don''t forget, we''ve got our Cash Bingo on 20 June at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:53:22+01:00',
  'outbound-api',
  'SMf545b0400160d849860297f36511f976'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447803037526',
  'Hi Marion, don''t forget, we''ve got our Cash Bingo on 20 June at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:53:21+01:00',
  'outbound-api',
  'SMdbd055e8c2b9dead8f43bbb3aa8b099e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire, don''t forget, we''ve got our Quiz Night on 4 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:51:40+01:00',
  'outbound-api',
  'SM57e650066191d153364a07251fa522c4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, don''t forget, we''ve got our Quiz Night on 4 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:51:40+01:00',
  'outbound-api',
  'SM6f47b6604baf5e1f499405d37c535fad'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447891505037',
  'Hi Jordan, don''t forget, we''ve got our Quiz Night on 4 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:51:16+01:00',
  'outbound-api',
  'SM7974cdc10c607f71026121985d22e001'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447941085007',
  'Hi Lorraine, don''t forget, we''ve got our Quiz Night on 4 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:51:15+01:00',
  'outbound-api',
  'SM9806d6b87f9623743f6d5a4694d14e3c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447906501332',
  'Hi Suzie, don''t forget, we''ve got our Quiz Night on 4 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:51:14+01:00',
  'outbound-api',
  'SM2157b4e1ac3122bc4ebc81fbdba8384a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi, don''t forget, we''ve got our Quiz Night on 4 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:51:14+01:00',
  'outbound-api',
  'SM46f379ee9d4eb70b42513f38877d0d9c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447742116805',
  'Hi Jade, don''t forget, we''ve got our Drag Cabaret & Karaoke on 30 May at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:50:22+01:00',
  'outbound-api',
  'SM09dc4755e2b0e5e2f685f90e0d780dd5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy, don''t forget, we''ve got our Drag Cabaret & Karaoke on 30 May at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:50:22+01:00',
  'outbound-api',
  'SMa50a3993733902f1450a908850544593'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447586282882',
  'Hi Moureen, don''t forget, we''ve got our Drag Cabaret & Karaoke on 30 May at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:50:21+01:00',
  'outbound-api',
  'SMc65e77c4eb4359dde15b1ba366a31044'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire, don''t forget, we''ve got our Drag Cabaret & Karaoke on 30 May at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:50:20+01:00',
  'outbound-api',
  'SMfd40e804dde9f7ee5f75f09fe644fbf4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, don''t forget, we''ve got our Drag Cabaret & Karaoke on 30 May at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:50:20+01:00',
  'outbound-api',
  'SM160c9308ef14383105a637b5a232f983'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447941085007',
  'Hi Lorraine, don''t forget, we''ve got our Drag Cabaret & Karaoke on 30 May at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:50:16+01:00',
  'outbound-api',
  'SM04a20ce9ee4c7f77566679913636267c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi, don''t forget, we''ve got our Drag Cabaret & Karaoke on 30 May at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-24T13:50:15+01:00',
  'outbound-api',
  'SMa0fb81178c97fca4795964b8ae0bd9c9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447519120751',
  'Hi Margaret, your booking for 6 people for our Quiz Night on 4 June at 7pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-05-23T21:29:59+01:00',
  'outbound-api',
  'SM9bce4dcd34fe6d4aa4c981c0dde282bf'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447805988710',
  'Hi Myrtle, your booking for 4 people for our Quiz Night on 4 June at 7pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-05-23T21:24:50+01:00',
  'outbound-api',
  'SMc81da1f43461f88a2365f8c974870ac6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447415423113',
  'Hi Luke, your booking for 6 people for our Quiz Night on 4 June at 7pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-05-23T19:28:30+01:00',
  'outbound-api',
  'SM7b3235a2bc4cbbb5f7d8dcbc89224a32'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447519120751',
  'Hi Margaret, your booking for 6 people for our Cash Bingo on 20 June at 6pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-05-23T19:26:14+01:00',
  'outbound-api',
  'SMa5a63b3380bd0f1fbe3fa1cc9e761ca1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447519120751',
  'Hi Margaret, your booking for 8 people for our Drag Cabaret & Karaoke on 30 May at 7pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-05-23T19:24:00+01:00',
  'outbound-api',
  'SM08be429798b7a51ca5f1b3b6372af02a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447519120751',
  'Hi Margaret, your booking for 6 people for our Drag Cabaret & Karaoke on 30 May at 7pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-05-23T19:23:29+01:00',
  'outbound-api',
  'SMfc5e37c75d48450100375a9beb9159e7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, your booking for 6 people for our Cash Bingo on 20 June at 6pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-05-23T19:22:11+01:00',
  'outbound-api',
  'SMe9c60e3af294f06203b517d36edef053'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, your booking for 4 people for our Quiz Night on 4 June at 7pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-05-23T19:21:40+01:00',
  'outbound-api',
  'SM0165440ff06925b2d7c9fe4317a4dc6d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447788239129',
  'Hi Julie, your booking for 4 people for our Cash Bingo on 20 June at 6pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-05-23T19:21:01+01:00',
  'outbound-api',
  'SM2d690456263e090445a0a00002f2e0a6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447788239129',
  'Hi Julie, your booking for 4 people for our Quiz Night on 4 June at 7pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-05-23T19:19:26+01:00',
  'outbound-api',
  'SM80d891baf54ea07f5889fdfc71054897'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+44777191112',
  'Hi Alice, don''t forget, we''ve got our Cash Bingo on 20 June at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'failed',
  '2025-05-23T19:18:21+01:00',
  'outbound-api',
  'SM13f26863c749964d26cc110f16b2eebc'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+44777191112',
  'Hi Alice, don''t forget, we''ve got our Quiz Night on 4 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'failed',
  '2025-05-23T19:18:00+01:00',
  'outbound-api',
  'SM68c212aef3e4d598593f048dfe05432e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447586282882',
  'Hi Moureen, your booking for 5 people for our Cash Bingo on 23 May at 6pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-05-23T12:19:19+01:00',
  'outbound-api',
  'SM2c1ab00374e60e518f5247285b021183'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447736641657',
  'Hi Lorraine , just a reminder that our Drag Cabaret & Karaoke is next week on 30 May at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-05-23T10:28:47+01:00',
  'outbound-api',
  'SM61097db6ab35f11ae24b0b2796ae69d4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447788239129',
  'Hi Julie, just a reminder that our Drag Cabaret & Karaoke is next week on 30 May at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-05-23T10:28:46+01:00',
  'outbound-api',
  'SM15a493f94efadeae457d8a4eea6e9800'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, just a reminder that our Drag Cabaret & Karaoke is next week on 30 May at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-05-23T10:28:46+01:00',
  'outbound-api',
  'SM488177616b5b13221f14b7660bac4745'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447891505037',
  'Hi Jordan, your booking for 2 people for our Cash Bingo on 23 May at 6pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-05-22T12:01:30+01:00',
  'outbound-api',
  'SMe253a03ffbfaf2e2482879d86a8fd341'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447940220875',
  '+447700106752',
  'Sorry, we can''t make if this time x',
  'received',
  '2025-05-22T10:30:10+01:00',
  'inbound',
  'SM4a3242e49c502b316c4ab70e7b078154'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447947224608',
  '+447700106752',
  'Hey, thanks for reminding me 😃 if I''m back from the hospital in time I will come and join in but it''s 3pm in London 😔',
  'received',
  '2025-05-22T10:30:01+01:00',
  'inbound',
  'SM1e9c6c547fe2ce4b5a063caa160f23b0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447947224608',
  'Hi Katie, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:29:02+01:00',
  'outbound-api',
  'SMf8e4c6206cb270fe3b47186e84573232'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447914408517',
  'Hi Shell, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:29:02+01:00',
  'outbound-api',
  'SM7b31eaa220ae419fb45f0bd449328b12'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447415423113',
  'Hi Luke, just a reminder that our Cash Bingo is tomorrow at 6pm and you have 3 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:29:02+01:00',
  'outbound-api',
  'SM9878ddbd8473269bba6d1253ce32a801'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447519120751',
  'Hi Margaret, just a reminder that our Cash Bingo is tomorrow at 6pm and you have 6 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:29:02+01:00',
  'outbound-api',
  'SM046421ed5ab7d34fafbe026ffc72a7bb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447788239129',
  'Hi Julie, just a reminder that our Cash Bingo is tomorrow at 6pm and you have 4 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:29:01+01:00',
  'outbound-api',
  'SM8049686778f41ded6bc9dd9096881d91'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447153682634',
  'Hi Wendy, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'sent',
  '2025-05-22T10:29:01+01:00',
  'outbound-api',
  'SMad43c92a395cd7e6d12a074020eb4719'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:29:01+01:00',
  'outbound-api',
  'SM41285bbc824cb4cbc431e64f1799f7c2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447766048813',
  'Hi Chris, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:29:01+01:00',
  'outbound-api',
  'SM6f565500a88567a3dbd90a887410fb4f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447888204175',
  'Hi Valentina, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:29:00+01:00',
  'outbound-api',
  'SM92d14bfcf5866960050e85414700b6c6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447956315214',
  'Hi Billy, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:29:00+01:00',
  'outbound-api',
  'SM11b919a8a8abfa2a455d2a4ce50181cf'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946233319',
  'Hi Hannah, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:29:00+01:00',
  'outbound-api',
  'SMd2908e65e14c9c8f67a038ed744924dd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+4478889600378',
  'Hi Lou, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'failed',
  '2025-05-22T10:29:00+01:00',
  'outbound-api',
  'SMb34825e69f306cb3be10af6cff55bebd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447739514023',
  'Hi Cindy, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:59+01:00',
  'outbound-api',
  'SM651fcd12f05aefbe85ff92910680ac1e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447860100825',
  'Hi Shell, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:59+01:00',
  'outbound-api',
  'SM8591974c1a0d386960108780c864d211'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447891505037',
  'Hi Jordan, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:59+01:00',
  'outbound-api',
  'SMae4f87bb9b28ad8550fec2505c87fdee'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:59+01:00',
  'outbound-api',
  'SMf331465fe17902a2104e4b185826c9f1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447736641657',
  'Hi Lorraine , just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:58+01:00',
  'outbound-api',
  'SM3aae8575c24844642200f51774836c2b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447988517062',
  'Hi Sarah, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:58+01:00',
  'outbound-api',
  'SM2028375e3a320613f1254450c2cfba23'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447704899719',
  'Hi Anne, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:58+01:00',
  'outbound-api',
  'SMd765a44bf34741441006dc836d0e087c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447540308939',
  'Hi Mary, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:58+01:00',
  'outbound-api',
  'SMb69e2be940e1d1f5db3b17df4d1cf1ea'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447719261701',
  'Hi Claire, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:58+01:00',
  'outbound-api',
  'SMf7479b7b1ed75777d0e1c3069e9df868'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447708714947',
  'Hi Brian, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:57+01:00',
  'outbound-api',
  'SM5a4dc7babaab45507355960209adac2b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:57+01:00',
  'outbound-api',
  'SM93b42bd379bedb7b9f829a3e5a59ef82'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:57+01:00',
  'outbound-api',
  'SM31e856c53a55a10146bf0a728e277110'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447586282882',
  'Hi Moureen, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:57+01:00',
  'outbound-api',
  'SM6d8b4346b8ceb0ea90824700006cdced'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:56+01:00',
  'outbound-api',
  'SM6d34368fd6a1a2190489d9e7af8497b5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447816935952',
  'Hi Debbie, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:56+01:00',
  'outbound-api',
  'SMcb8b0fc0fb945bb1b405d7ff194123a5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447912859484',
  'Hi Katie, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:56+01:00',
  'outbound-api',
  'SM35fb50fd9a6421e49d2f82b5fb5677ab'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447739227080',
  'Hi Barbara, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:56+01:00',
  'outbound-api',
  'SM41c5beeabb9780804963d4d8bfc1e52c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447759132843',
  'Hi Liz, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:56+01:00',
  'outbound-api',
  'SM3442d2e4241e2094ab7153b63f3a96a7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447791211627',
  'Hi Sara, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:55+01:00',
  'outbound-api',
  'SM7600a028e64f6b49192e1827caa9bbac'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447906501332',
  'Hi Suzie, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:55+01:00',
  'outbound-api',
  'SM17150ba25ef475d92c956905da57bbac'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447941085007',
  'Hi Lorraine, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:54+01:00',
  'outbound-api',
  'SMc1d7530652557037a7b24ec66417f1b6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:54+01:00',
  'outbound-api',
  'SMe9e84c7548d003935790781a334d10f3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946754476',
  'Hi Nish, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:54+01:00',
  'outbound-api',
  'SM35d4a148c8f56799f7362a68df1b30ba'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-22T10:28:53+01:00',
  'outbound-api',
  'SMaee7a73bd63e4adb3bdcb3443af7a0b7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447947224608',
  'Hi Katie, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-21T18:24:59+01:00',
  'outbound-api',
  'SM236f85abc745ad997251eddcc7c9fb7f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447914408517',
  'Hi Shell, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-21T18:24:59+01:00',
  'outbound-api',
  'SM70f22f0920ea9835c12806f50603a1cc'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447415423113',
  'Hi Luke, don''t forget, we''ve got our Quiz Night on 4 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-21T18:15:50+01:00',
  'outbound-api',
  'SM8ddc5322739acc0aaafefbaaada7a804'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447415423113',
  'Hi Luke, your booking for 3 people for our Cash Bingo on 23 May at 6pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-05-21T18:15:03+01:00',
  'outbound-api',
  'SMbc823e915b63331aa0e982adb95f1519'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447519120751',
  'Hi Margaret, your booking for 6 people for our Cash Bingo on 23 May at 6pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-05-20T22:02:35+01:00',
  'outbound-api',
  'SMd6b12e333f8cc2164664d69715819a0b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447788239129',
  'Hi Julie, your booking for 4 people for our Cash Bingo on 23 May at 6pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-05-19T17:47:36+01:00',
  'outbound-api',
  'SMf6ca2f2d827b9a6662c3babaf314f1ed'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447803037526',
  '+447700106752',
  'Hi Guys unfortunately I''m unable to attend Tom Jones is calling for me to be at Hampton Court. All the best Marion x',
  'received',
  '2025-05-19T15:57:30+01:00',
  'inbound',
  'SMc64653775f6615898b5dc8fb17392f07'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447153682634',
  'Hi Wendy, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'sent',
  '2025-05-18T08:39:51+01:00',
  'outbound-api',
  'SM6229d01ac0bddbf6ee87800ae1500dd3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447956315214',
  'Hi Billy, don''t forget, we''ve got our Rum Tasting Night on 13 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T16:06:08+01:00',
  'outbound-api',
  'SMfc7db5c2bdf0a80dd2391cc7cfdc1a89'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447803037526',
  'Hi Marion, don''t forget, we''ve got our Rum Tasting Night on 13 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:44:11+01:00',
  'outbound-api',
  'SM41a7e503621895ed1298bad493fcb9f8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447888204175',
  'Hi Valentina, your booking for 2 people for our Rum Tasting Night on 13 June at 7pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:42:53+01:00',
  'outbound-api',
  'SM3d923f6baa2853c1319a484a84329df8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447719261701',
  'Hi Claire, don''t forget, we''ve got our Rum Tasting Night on 13 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:28:34+01:00',
  'outbound-api',
  'SMa002df124ad5fd0bb711b82bc1629fb6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447766048813',
  'Hi Chris, don''t forget, we''ve got our Rum Tasting Night on 13 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:28:33+01:00',
  'outbound-api',
  'SMa82a7bd1f8395b6c2415c3bf9fd0d0f3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447708714947',
  'Hi Brian, don''t forget, we''ve got our Rum Tasting Night on 13 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:28:33+01:00',
  'outbound-api',
  'SM0df8575f22d72a642698b040d47c47da'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447586282882',
  'Hi Moureen, don''t forget, we''ve got our Rum Tasting Night on 13 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:28:32+01:00',
  'outbound-api',
  'SM80f0f5525537bb779393b5fda33149af'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447912859484',
  'Hi Katie, don''t forget, we''ve got our Rum Tasting Night on 13 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:28:31+01:00',
  'outbound-api',
  'SM4198351c9a88fd35f3b58f803fd16058'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire, don''t forget, we''ve got our Rum Tasting Night on 13 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:28:31+01:00',
  'outbound-api',
  'SM460c702cd1c1c54bf15338396ce66efc'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447809645374',
  'Hi Anne, don''t forget, we''ve got our Rum Tasting Night on 13 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:28:30+01:00',
  'outbound-api',
  'SM718982124a7a42bece4087109dffc1a2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447914398101',
  'Hi Jacqui, don''t forget, we''ve got our Rum Tasting Night on 13 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:28:29+01:00',
  'outbound-api',
  'SMe76ddcd64e4bab47adcaa2e2e761990a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:24+01:00',
  'outbound-api',
  'SMbc5503c22608db94b7716c107ed30e0a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447766048813',
  'Hi Chris, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:24+01:00',
  'outbound-api',
  'SM7ade4aee485281beb8a9dce5112beeb6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447888204175',
  'Hi Valentina, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:23+01:00',
  'outbound-api',
  'SMfeed188c12fa1ec0f32aae7939e937cf'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447956315214',
  'Hi Billy, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:22+01:00',
  'outbound-api',
  'SM3849133e5a876fdac01d46125cf6ca7b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946233319',
  'Hi Hannah, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:21+01:00',
  'outbound-api',
  'SMb3236b403c380d0fd4dd86db97ad7bf2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447739514023',
  'Hi Cindy, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:21+01:00',
  'outbound-api',
  'SM3b7a5af01eb671c6400fb83af83124cb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447926203166',
  'Hi Sid, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'undelivered',
  '2025-05-17T14:26:20+01:00',
  'outbound-api',
  'SM50f892901ab6d4e02c0b6f983d8a8371'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447860100825',
  'Hi Shell, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:19+01:00',
  'outbound-api',
  'SMdc6c30586e22284bdcd25403a6beb57c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447891505037',
  'Hi Jordan, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:19+01:00',
  'outbound-api',
  'SMe75d20095c94e1b910cdf163a896d6c1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+4478889600378',
  'Hi Lou, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'failed',
  '2025-05-17T14:26:19+01:00',
  'outbound-api',
  'SMc726ecd096204fd8e90ec116fea1312c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:17+01:00',
  'outbound-api',
  'SM8fd95b638dc7fb393c76241fd86a3c37'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447519120751',
  'Hi Margaret, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:17+01:00',
  'outbound-api',
  'SM5ed15a362391c042e3711d93dde7a554'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447736641657',
  'Hi Lorraine , don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:16+01:00',
  'outbound-api',
  'SM840e66568f6cb7e647df459306f3e7e3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447988517062',
  'Hi Sarah, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:15+01:00',
  'outbound-api',
  'SM51a7764a20a78c7c29f6f00ff9012416'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447704899719',
  'Hi Anne, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:14+01:00',
  'outbound-api',
  'SMc3e209373b5f6a595515b9174ca3a76d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447540308939',
  'Hi Mary, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:14+01:00',
  'outbound-api',
  'SMf01a559f4e51225b7436181fd58419b1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447719261701',
  'Hi Claire, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:12+01:00',
  'outbound-api',
  'SM3f5c1e4b627659e7d41d521d01889265'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447708714947',
  'Hi Brian, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:12+01:00',
  'outbound-api',
  'SM1e434974e702b28c840a2c0bbaf31592'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:11+01:00',
  'outbound-api',
  'SMfc8a2122117e0d6e1b735619c48d5aa2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:11+01:00',
  'outbound-api',
  'SM012b49a6ad7faea73ad222f3ac08a03c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447586282882',
  'Hi Moureen, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:10+01:00',
  'outbound-api',
  'SM81ebbbf48be0b00eb4311d0cb2156e10'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:09+01:00',
  'outbound-api',
  'SMd2e0ee4824a20d8580b2ce09906283bb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447816935952',
  'Hi Debbie, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:08+01:00',
  'outbound-api',
  'SM4ad4472abe5d53946c331774623fcdf0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447912859484',
  'Hi Katie, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:08+01:00',
  'outbound-api',
  'SMaba4d5851743a8737c9aee2c7744a8fe'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447788239129',
  'Hi Julie, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:07+01:00',
  'outbound-api',
  'SM91764bd0ab86b777b35ddcb38c37fdb4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447739227080',
  'Hi Barbara, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:06+01:00',
  'outbound-api',
  'SM9433716f15ee5034a2e556c047e05172'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447759132843',
  'Hi Liz, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:05+01:00',
  'outbound-api',
  'SMbc9a088c916718eb88e7e5df06c77fd9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447791211627',
  'Hi Sara, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:04+01:00',
  'outbound-api',
  'SM274ede640b90fd3f048bba4dccecc3e2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447906501332',
  'Hi Suzie, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:03+01:00',
  'outbound-api',
  'SMb7ac76553f56e19affdc29e27d7fec1c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447941085007',
  'Hi Lorraine, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:02+01:00',
  'outbound-api',
  'SMf23e9b1238bad34859576abcf6556fbc'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:01+01:00',
  'outbound-api',
  'SM1c16f6882721d38f0d392a78e541e392'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946754476',
  'Hi Nish, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:26:01+01:00',
  'outbound-api',
  'SM89343cc753e48b9ed8b640dc8bb4ebbe'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, don''t forget, we''ve got our Cash Bingo on 23 May at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:25:59+01:00',
  'outbound-api',
  'SM001152d60aab1764cc0a3dc9784d5e35'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Rum Tasting Night on 13 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:20:32+01:00',
  'outbound-api',
  'SM5b1c997451479695bf3dcc785edc32e4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Rum Tasting Night on 13 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:15:58+01:00',
  'outbound-api',
  'SM7503c3522dc5ab41b727fa2da26e7e5c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Rum Tasting Night on 13 June at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-05-17T14:06:42+01:00',
  'outbound-api',
  'SMc86ee79932462d45afa0d16a496b7f81'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Your booking for Rum Tasting Night on 2025-06-13 at 7pm for 6 seat(s) is confirmed.',
  'delivered',
  '2025-05-17T12:48:33+01:00',
  'outbound-api',
  'SMbc55ca768914e45ac297a06777df9071'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447973560612',
  '+447700106752',
  'Ok great see you soon xx',
  'received',
  '2025-05-07T18:05:49+01:00',
  'inbound',
  'SM75b4cd37a823104e584ff7b13c252bd4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire, just a reminder that our Quiz Night is tomorrow at 7pm and you have 5 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-06T10:28:05+01:00',
  'outbound-api',
  'SM4112b9a337c6b7b6aa00a4c668b3b9cd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447926203166',
  'Hi Sid, just a reminder that our Quiz Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'undelivered',
  '2025-05-06T10:28:05+01:00',
  'outbound-api',
  'SMc00d0219cd37ff968bdf97386742ab8b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447759132843',
  'Hi Liz, just a reminder that our Quiz Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-06T10:28:05+01:00',
  'outbound-api',
  'SM31dcf55af6ce307925e523c4df48458d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447519120751',
  'Hi Margaret, just a reminder that our Quiz Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-06T10:28:04+01:00',
  'outbound-api',
  'SMe933e0e1f83c884ee96cc232846ffdbb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447941085007',
  'Hi Lorraine, just a reminder that our Quiz Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-06T10:28:03+01:00',
  'outbound-api',
  'SMd6159e1cd32acae194aa67cbbd270f04'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, just a reminder that our Quiz Night is tomorrow at 7pm and you have 4 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-06T10:28:03+01:00',
  'outbound-api',
  'SMe987b3dbea0bff2ebe4b312bd114b4f7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447788239129',
  'Hi Julie, just a reminder that our Quiz Night is tomorrow at 7pm and you have 4 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-06T10:28:03+01:00',
  'outbound-api',
  'SMc71e8231a8fb4f3d226e544f83762027'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447956315214',
  'Hi Billy, just a reminder that our Quiz Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-05-06T10:28:03+01:00',
  'outbound-api',
  'SM516b384a9395e1a2a3de8a35ccd68fa8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire, just a reminder that our Quiz Night is next week on 7 May at 7pm and you have 5 seats booked. See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-30T10:27:43+01:00',
  'outbound-api',
  'SM0e71800e2dd500b9c1905aa87ae8bbc9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447926203166',
  'Hi Sid, just a reminder that our Quiz Night is next week on 7 May at 7pm . See you here! The Anchor 01753682707',
  'undelivered',
  '2025-04-30T10:27:42+01:00',
  'outbound-api',
  'SM6131ef1380fdbb4f80a0f4cd24803df5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447759132843',
  'Hi Liz, just a reminder that our Quiz Night is next week on 7 May at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-30T10:27:42+01:00',
  'outbound-api',
  'SM5f7a8cb9035d5eb0745f724beac04187'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447519120751',
  'Hi Margaret, just a reminder that our Quiz Night is next week on 7 May at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-30T10:27:41+01:00',
  'outbound-api',
  'SM347855076210e752473ed96d6ea2d1af'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447941085007',
  'Hi Lorraine, just a reminder that our Quiz Night is next week on 7 May at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-30T10:27:41+01:00',
  'outbound-api',
  'SMeb8a7eba4608411648915c84872aa1f1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, just a reminder that our Quiz Night is next week on 7 May at 7pm and you have 4 seats booked. See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-30T10:27:41+01:00',
  'outbound-api',
  'SM32ad3b06bc1865908f4414a81fec9772'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447788239129',
  'Hi Julie, just a reminder that our Quiz Night is next week on 7 May at 7pm and you have 4 seats booked. See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-30T10:27:41+01:00',
  'outbound-api',
  'SM8aefed97c0d6b973c7549d300510f092'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447956315214',
  'Hi Billy, just a reminder that our Quiz Night is next week on 7 May at 7pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-30T10:27:40+01:00',
  'outbound-api',
  'SMc9b2f07b37ff1cc83248d2c3df4fa862'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447791211627',
  '+447700106752',
  'I''d love to have come but my sons got an evening cup game for rugby so we''ll be watching that. I''ll be coming again though. Have a good night',
  'received',
  '2025-04-24T10:29:21+01:00',
  'inbound',
  'SM005ae134ac3a9ae046d11d30e120df61'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447736641657',
  'Hi Lorraine , just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:09+01:00',
  'outbound-api',
  'SMee412cce10935fe8c6f7fcb50626bc36'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:09+01:00',
  'outbound-api',
  'SM0d97a67755074236881c5d694016284c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, just a reminder that our Cash Bingo is tomorrow at 6pm and you have 6 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:09+01:00',
  'outbound-api',
  'SMdbdcfc92c99f0fb625e837418d0f2f80'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447519120751',
  'Hi Margaret, just a reminder that our Cash Bingo is tomorrow at 6pm and you have 6 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:08+01:00',
  'outbound-api',
  'SM163969b87d348056a66a3f033da1b1df'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447586282882',
  'Hi Moureen, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:08+01:00',
  'outbound-api',
  'SMc1dd383f1788b4c54fe2a5118975a15f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447739227080',
  'Hi Barbara, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:08+01:00',
  'outbound-api',
  'SM8c2ad18d80a326478ecbb92590d4d595'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447759132843',
  'Hi Liz, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:08+01:00',
  'outbound-api',
  'SMfc4f8920fa31fa34f647318ebc19c1ed'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447540308939',
  'Hi Mary, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:07+01:00',
  'outbound-api',
  'SMb1cf4adcb53d19a927f2f6ff8d999ef8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447791211627',
  'Hi Sara, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:07+01:00',
  'outbound-api',
  'SM74aa7ed7c19ef2a30535fff17b75de47'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+4478889600378',
  'Hi Lou, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'failed',
  '2025-04-24T10:28:07+01:00',
  'outbound-api',
  'SM032cbe0370ef92b2e78e90284459cdda'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447719261701',
  'Hi Claire, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:06+01:00',
  'outbound-api',
  'SM938d3c2e0d2c33fce042f310e265e825'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:05+01:00',
  'outbound-api',
  'SM1476c0998f66395fe13facaa91672763'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447860100825',
  'Hi Shell, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:05+01:00',
  'outbound-api',
  'SM9f0f2f5666b65b07a05274dcddce04cf'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447739514023',
  'Hi Cindy, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:05+01:00',
  'outbound-api',
  'SMf3f3251511a5b5e0ec2d824dc3127d36'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447941085007',
  'Hi Lorraine, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:05+01:00',
  'outbound-api',
  'SM8e792ed32e8d039cf2bd483abb393007'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447906501332',
  'Hi Suzie, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:05+01:00',
  'outbound-api',
  'SMdba2f96764e3f507265a59c71951948b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447816935952',
  'Hi Debbie, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:04+01:00',
  'outbound-api',
  'SMa780a76f9ca5f029fa91abb0a418d58c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447704899719',
  'Hi Anne, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:04+01:00',
  'outbound-api',
  'SM328ec01f58e11c8fe357c5cdcc58cbc2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447988517062',
  'Hi Sarah, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:04+01:00',
  'outbound-api',
  'SM13cc5d7b413e61aef7f2a87c719faed0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:03+01:00',
  'outbound-api',
  'SMc4898760ce4cada239af2795d1e66ef7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, just a reminder that our Cash Bingo is tomorrow at 6pm and you have 4 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:03+01:00',
  'outbound-api',
  'SMa8ef575d2bd3778c0d4e4d0b2d7f2f37'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447708714947',
  'Hi Brian, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:03+01:00',
  'outbound-api',
  'SMdad27f0a7890ac9a68da49470cf40d4b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447766048813',
  'Hi Chris, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:02+01:00',
  'outbound-api',
  'SMa24cf870ddf29941396ee6c3a451763d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946754476',
  'Hi Nish, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:02+01:00',
  'outbound-api',
  'SM841393688d48a29cf347d8b7ec9c9ceb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:02+01:00',
  'outbound-api',
  'SM7c616f4216fa61d181ea067994d122c1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447888204175',
  'Hi Valentina, just a reminder that our Cash Bingo is tomorrow at 6pm and you have 1 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:02+01:00',
  'outbound-api',
  'SM4182422ee0e176a5eb8be26556812e04'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447912859484',
  'Hi Katie, just a reminder that our Cash Bingo is tomorrow at 6pm and you have 1 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:01+01:00',
  'outbound-api',
  'SMcd7cb2a8dc56be56478c4420375f2ee5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447968042989',
  'Hi Leanne, just a reminder that our Cash Bingo is tomorrow at 6pm and you have 1 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:01+01:00',
  'outbound-api',
  'SM200de87a447fc8173962cb4d1ac4c738'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946233319',
  'Hi Hannah, just a reminder that our Cash Bingo is tomorrow at 6pm and you have 1 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:01+01:00',
  'outbound-api',
  'SM3fa195fb256f560ba97d64ec0d39305f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, just a reminder that our Cash Bingo is tomorrow at 6pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-24T10:28:01+01:00',
  'outbound-api',
  'SM0e1c07b63b1bb540476d32408e4eb780'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447940220875',
  '+447700106752',
  'We can''t make it I am afraid. When is the next quiz as we will try to make that one? Thanks. Penny',
  'received',
  '2025-04-19T21:48:32+01:00',
  'inbound',
  'SM9610ba066a55a9e27f470334b08948ca'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447759132843',
  'Hi Liz, just a reminder that our Cash Bingo is next week on 25 April at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:37+01:00',
  'outbound-api',
  'SM0efad9e75777729add36146406bfc646'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447540308939',
  'Hi Mary, just a reminder that our Cash Bingo is next week on 25 April at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:36+01:00',
  'outbound-api',
  'SMa38bc30213f54d4cffc1c1572d139e1e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447791211627',
  'Hi Sara, just a reminder that our Cash Bingo is next week on 25 April at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:36+01:00',
  'outbound-api',
  'SM9cd28c7ff51dbaa93f591b639f5b9dec'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+4478889600378',
  'Hi Lou, just a reminder that our Cash Bingo is next week on 25 April at 6pm . See you here! The Anchor 01753682707',
  'failed',
  '2025-04-18T10:27:36+01:00',
  'outbound-api',
  'SMbd99f315fe968e1bcc3097f7f6832028'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447719261701',
  'Hi Claire, just a reminder that our Cash Bingo is next week on 25 April at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:35+01:00',
  'outbound-api',
  'SM7e2c7d7ec00338728178fb20e92c8de9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, just a reminder that our Cash Bingo is next week on 25 April at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:35+01:00',
  'outbound-api',
  'SMba060afc497fbe96be63637efd54a567'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447860100825',
  'Hi Shell, just a reminder that our Cash Bingo is next week on 25 April at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:34+01:00',
  'outbound-api',
  'SM8552e991fd7f0f0414abff822a4b2002'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447739514023',
  'Hi Cindy, just a reminder that our Cash Bingo is next week on 25 April at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:34+01:00',
  'outbound-api',
  'SMd6a1e051182971969a525ccdbfbf1ca9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447941085007',
  'Hi Lorraine, just a reminder that our Cash Bingo is next week on 25 April at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:33+01:00',
  'outbound-api',
  'SM4ed637389e00ef18ee8f47a96ada9d9b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447906501332',
  'Hi Suzie, just a reminder that our Cash Bingo is next week on 25 April at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:33+01:00',
  'outbound-api',
  'SMe10960d9620338387db8778b1b20bd24'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447816935952',
  'Hi Debbie, just a reminder that our Cash Bingo is next week on 25 April at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:32+01:00',
  'outbound-api',
  'SM9ebb68ec5ed6bcd3670628b0acc83dd8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447704899719',
  'Hi Anne, just a reminder that our Cash Bingo is next week on 25 April at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:32+01:00',
  'outbound-api',
  'SM1526d2cf59cf8abf4849bd3b9c1fc317'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447988517062',
  'Hi Sarah, just a reminder that our Cash Bingo is next week on 25 April at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:31+01:00',
  'outbound-api',
  'SM3d0af32076edadcae0b4b029f5c73348'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi, just a reminder that our Cash Bingo is next week on 25 April at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:31+01:00',
  'outbound-api',
  'SM4f30e4eb46a58eb5426500917d8d5995'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, just a reminder that our Cash Bingo is next week on 25 April at 6pm and you have 4 seats booked. See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:31+01:00',
  'outbound-api',
  'SMa018ef39d9ccfcec82297478ba22259b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447708714947',
  'Hi Brian, just a reminder that our Cash Bingo is next week on 25 April at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:31+01:00',
  'outbound-api',
  'SM7a5d1571e8221125a180bdb0c941bc47'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447766048813',
  'Hi Chris, just a reminder that our Cash Bingo is next week on 25 April at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:30+01:00',
  'outbound-api',
  'SMab9bc200379263673b0bbba96c7cf277'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946754476',
  'Hi Nish, just a reminder that our Cash Bingo is next week on 25 April at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:30+01:00',
  'outbound-api',
  'SMe1fd25823971d6a2f3f876bd768eb218'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy, just a reminder that our Cash Bingo is next week on 25 April at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:29+01:00',
  'outbound-api',
  'SMc11f612a150dba7ef706272d963a9088'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447888204175',
  'Hi Valentina, just a reminder that our Cash Bingo is next week on 25 April at 6pm and you have 1 seats booked. See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:29+01:00',
  'outbound-api',
  'SMe71d63d0be912b7dfc0c911da99f66d0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447912859484',
  'Hi Katie, just a reminder that our Cash Bingo is next week on 25 April at 6pm and you have 1 seats booked. See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:29+01:00',
  'outbound-api',
  'SMc4304da56ee5e4089d3019dff0e0745a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447968042989',
  'Hi Leanne, just a reminder that our Cash Bingo is next week on 25 April at 6pm and you have 1 seats booked. See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:29+01:00',
  'outbound-api',
  'SM345595e93d1e6ac6be463493520e39c3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946233319',
  'Hi Hannah, just a reminder that our Cash Bingo is next week on 25 April at 6pm and you have 1 seats booked. See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:28+01:00',
  'outbound-api',
  'SMc56949e64f14a5bffc0008b1ef7722cd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, just a reminder that our Cash Bingo is next week on 25 April at 6pm . See you here! The Anchor 01753682707',
  'delivered',
  '2025-04-18T10:27:28+01:00',
  'outbound-api',
  'SMb6ee781dd5c31905fdd2344895a47172'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447990587315',
  '+447700106752',
  'Yes',
  'received',
  '2025-04-03T12:16:39+01:00',
  'inbound',
  'SMbc6cb532558b99f3aff80ac7eed90584'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hello, are you coming tonight?',
  'delivered',
  '2025-04-03T11:54:51+01:00',
  'outbound-api',
  'SM6fc64b815583d272ebd34eb1a1350422'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2025-04-03T09:43:59+01:00',
  'outbound-reply',
  'SM0119d51ef01433f33e5339bcea5f3058'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447990587315',
  '+447700106752',
  'Hi, I want to change my booking',
  'received',
  '2025-04-03T09:43:59+01:00',
  'inbound',
  'SMfbb199bf48178490bf1c1e1c60098a4f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hello',
  'delivered',
  '2025-04-03T09:39:15+01:00',
  'outbound-api',
  'SMea6860d2c070640074549b31d12f0a31'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447736641657',
  'Hi Lorraine , don''t forget, we''ve got our Drag Cabaret & Karaoke on 30 May at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-04-02T22:21:00+01:00',
  'outbound-api',
  'SMbea74fdf379cef19ddda735e29426b80'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447736641657',
  'Hi Lorraine , don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-04-02T22:20:51+01:00',
  'outbound-api',
  'SMff9944ddcbcb41b46a3a778e96202736'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire, your booking for 5 people for our Quiz Night on 7 May at 7pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-04-02T22:20:04+01:00',
  'outbound-api',
  'SM55199ce3a3c14f823e8fe843fe0e9235'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447926203166',
  'Hi Sid, don''t forget, we''ve got our Quiz Night on 7 May at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'undelivered',
  '2025-04-02T22:16:00+01:00',
  'outbound-api',
  'SMf964c91d0a29d371e5e7b6793492cd2e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447759132843',
  'Hi Liz, don''t forget, we''ve got our Quiz Night on 7 May at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-04-02T22:15:46+01:00',
  'outbound-api',
  'SM9f40def8991bcaacb604488354a3ba24'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447519120751',
  'Hi Margaret, don''t forget, we''ve got our Quiz Night on 7 May at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-04-02T22:15:31+01:00',
  'outbound-api',
  'SM08a639f6d62d0b79b305f08b48f55185'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447941085007',
  'Hi Lorraine, don''t forget, we''ve got our Quiz Night on 7 May at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'undelivered',
  '2025-04-02T22:14:42+01:00',
  'outbound-api',
  'SMecc3ebeba31f9ee0aed04c0db9920f13'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447788239129',
  'Hi Julie, don''t forget, we''ve got our Drag Cabaret & Karaoke on 30 May at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-04-02T22:13:07+01:00',
  'outbound-api',
  'SMd4c261515e02c5629f9349caa30ba5c4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, don''t forget, we''ve got our Drag Cabaret & Karaoke on 30 May at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-04-02T22:12:47+01:00',
  'outbound-api',
  'SM6c4758c1f67aaf6497b1485ace4b93fa'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, your booking for 4 people for our Quiz Night on 7 May at 7pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-04-02T22:12:33+01:00',
  'outbound-api',
  'SM9551143607dd85635550e99d1a1b8ede'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-04-02T22:12:08+01:00',
  'outbound-api',
  'SM8381b2599fdb0dfbaddd75b82f4cbbea'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, your booking for 6 people for our Cash Bingo on 25 April at 6pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-04-02T22:09:13+01:00',
  'outbound-api',
  'SM9edef8edd0e808ade6fd51578eb71369'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447788239129',
  'Hi Julie, your booking for 4 people for our Quiz Night on 7 May at 7pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-04-02T20:58:38+01:00',
  'outbound-api',
  'SMccf04aa1e7f59492101ed620e460cae6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447736641657',
  'Hi Lorraine , just a reminder that our Quiz Night is tomorrow at 7pm and you have 4 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-01T10:27:57+01:00',
  'outbound-api',
  'SM65a111024bc87c35fbcbfc7bfbcb76d0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447891505037',
  'Hi Jordan, just a reminder that our Quiz Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-01T10:27:57+01:00',
  'outbound-api',
  'SM69bd615897dafc43c0a65e9bc526311c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi, just a reminder that our Quiz Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-01T10:27:56+01:00',
  'outbound-api',
  'SM6b6f08668742b5d432dd1fc00e25eba4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, just a reminder that our Quiz Night is tomorrow at 7pm and you have 4 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-01T10:27:56+01:00',
  'outbound-api',
  'SMb5dbe2370c625fe5984925979fa3c204'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, just a reminder that our Quiz Night is tomorrow at 7pm and you have 6 seats booked. See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-01T10:27:56+01:00',
  'outbound-api',
  'SM3f0890c00bb668648227c295ed501f38'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, just a reminder that our Quiz Night is tomorrow at 7pm . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-04-01T10:27:56+01:00',
  'outbound-api',
  'SMb5aaa18b15cb3e6e419d93be222e38c0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447736641657',
  'Hi Lorraine , your booking for 4 people for our Quiz Night on 2 April at 7pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-03-31T21:10:58+01:00',
  'outbound-api',
  'SM009c73060d20ce3ab6f510cd9d95856d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946754476',
  'Hi Nish, your booking for 4 people for our Rum Tasting Night on 13 June at 7pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-03-31T09:50:53+01:00',
  'outbound-api',
  'SM997025179e9871d94f3b964835221555'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447917595200',
  'Hi Jamie, your booking for 6 people for our Test on 31 March at 9am is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-03-30T12:48:34+01:00',
  'outbound-api',
  'SMa087d8a8f82bc49805885f1320cfbd5f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447891505037',
  'Hi Jordan, don''t forget, we''ve got our Quiz Night on 2 April at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-03-30T10:30:41+01:00',
  'outbound-api',
  'SM4cad00d0f44b816548d029dcb9228d2e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447956315214',
  'Hi Billy, just a reminder that our Test is tomorrow at 9am . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-03-30T10:09:50+01:00',
  'outbound-api',
  'SM7ccfeb79544fbf547911f4455f97d0b0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, just a reminder that our Test is tomorrow at 9am . See you tomorrow! The Anchor 01753682707',
  'delivered',
  '2025-03-30T10:09:50+01:00',
  'outbound-api',
  'SM7bde732c0622164538a7b1c45e5d2540'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447586282882',
  'Hi Moureen, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-03-30T09:14:26+01:00',
  'outbound-api',
  'SMaafc8fe7761b2165867fd349e2d3b2b8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447739227080',
  'Hi Barbara, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-03-30T09:14:19+01:00',
  'outbound-api',
  'SMc773ae4b647caa984963b26cef686b77'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447759132843',
  'Hi Liz, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-03-30T09:14:12+01:00',
  'outbound-api',
  'SM2826036e8db8d49746e0481dbafe45c8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447519120751',
  'Hi Margaret, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-03-30T09:14:05+01:00',
  'outbound-api',
  'SMb2ea76684a66b2935b338dceaadcc7a7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447540308939',
  'Hi Mary, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-03-30T09:13:56+01:00',
  'outbound-api',
  'SM017c2084873754b393f65ffc2c7b0f6e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447791211627',
  'Hi Sara, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-03-30T09:13:49+01:00',
  'outbound-api',
  'SM6586961f1ca8d1850291468bd709d92e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447719261701',
  'Hi Claire, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-03-30T09:13:42+01:00',
  'outbound-api',
  'SMd73ae986472c53ce21ddc5073dbdbdbd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+4478889600378',
  'Hi Lou, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'failed',
  '2025-03-30T09:13:34+01:00',
  'outbound-api',
  'SMc70efcd193cdb05786ffe20ec1c44a75'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-03-30T09:11:50+01:00',
  'outbound-api',
  'SMde84d8c70ac810d24dfef8081dd7e923'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, your booking for 4 people for our Rum Tasting Night on 13 June at 7pm is confirmed! See you then. The Anchor 01753682707',
  'delivered',
  '2025-03-30T09:08:23+01:00',
  'outbound-api',
  'SM9b2f7526810f8e1a823c4012a2ae0131'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447956315214',
  'Hi Billy, don''t forget, we''ve got our Quiz Night on 7 May at 7pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-03-29T22:05:46Z',
  'outbound-api',
  'SM91a02ffb8dc7d5fb4d53fe82aed85500'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447956315214',
  'Hi Billy, don''t forget, we''ve got our Test on 31 March at 9am! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-03-29T21:56:55Z',
  'outbound-api',
  'SM76694fdbecdee51a67e0d38ea5789f73'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447860100825',
  'Hi Shell, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-03-29T20:48:37Z',
  'outbound-api',
  'SMd1e4cb0f751e1bca94fbbc878c096190'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447739514023',
  'Hi Cindy, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-03-29T20:47:32Z',
  'outbound-api',
  'SM1f489cfef4974b5c7f254eee98cee178'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447941085007',
  'Hi Lorraine, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-03-29T20:45:32Z',
  'outbound-api',
  'SMc665efbee52320c51088d3790ecdb0b6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447906501332',
  'Hi Suzie, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-03-29T20:43:33Z',
  'outbound-api',
  'SM9ff6e9a9233e7ce2a20b85af9bea10e1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Test on 31 March at 9am! Let us know if you want to book seats. The Anchor 01753682707',
  'delivered',
  '2025-03-29T20:17:40Z',
  'outbound-api',
  'SM3a98161df52de17261f3891fbcbe8ae7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Test on 31 March at 9am! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T20:15:39Z',
  'outbound-api',
  'SM5718b95a99b17c5747a1fe012d419a31'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, your booking for 3 people for our Test on 31 March at 9am is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T20:14:49Z',
  'outbound-api',
  'SM1cee597697ee8d7ef4bd0fca0942b444'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Test on 31 March at 9am! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T20:14:06Z',
  'outbound-api',
  'SM1996d0068c9c9601e992ff2ce7a17a34'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Test on 31 March at 9am! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T19:59:33Z',
  'outbound-api',
  'SMebc2f5185079f335a060b45cde1f43bf'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Test on 31 March at 9am! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T17:37:19Z',
  'outbound-api',
  'SM0e3527a3bd88fce4e016db737539fcfc'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447816935952',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2025-03-29T17:21:16Z',
  'outbound-reply',
  'SM65917084044b6dbde949f820c0734428'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447816935952',
  '+447700106752',
  'Thank you pete xx',
  'received',
  '2025-03-29T17:21:16Z',
  'inbound',
  'SMe0e94cd180d866ceb9dbc36adfeb2afd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447816935952',
  'Hi Debbie, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T17:20:37Z',
  'outbound-api',
  'SM351589deff1bda9db7a30ecacff45db6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447704899719',
  'Hi Anne, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T17:19:13Z',
  'outbound-api',
  'SM913faa5361c490427beac2c8748f5550'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447988517062',
  'Hi Sarah, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T17:17:39Z',
  'outbound-api',
  'SMb657c364ba1819be4e2d4c07bcb5aea2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T17:16:12Z',
  'outbound-api',
  'SMf73d17b45b27891f998719d623cf10e5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T17:15:43Z',
  'outbound-api',
  'SM8092a282a65796da423cffc9e99fea84'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, your booking for 4 people for our Cash Bingo on 25 April at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T17:15:28Z',
  'outbound-api',
  'SM827180e74c6beb65663b97f3c7f6d963'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447708714947',
  'Hi Brian, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T17:12:58Z',
  'outbound-api',
  'SM5c0b6cf8d3595a0e364b4edda66722bf'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447766048813',
  'Hi Chris, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T17:12:48Z',
  'outbound-api',
  'SM2695bfa059c9ae05fd0d93c6d8bc6d7f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946754476',
  'Hi Nish, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T17:12:32Z',
  'outbound-api',
  'SM2d5bfc27230086765fa5c0d0b84f7152'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T17:12:07Z',
  'outbound-api',
  'SMd202165deea408d75cac505b5362d82e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447888204175',
  'Hi Valentina, your booking for 1 people for our Cash Bingo on 25 April at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T17:11:57Z',
  'outbound-api',
  'SM102ee619e59a334c54830a6cd9ea5453'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447912859484',
  'Hi Katie, your booking for 1 people for our Cash Bingo on 25 April at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T17:11:47Z',
  'outbound-api',
  'SM1af6769ade459fda2d8442295d2fb96d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447968042989',
  'Hi Leanne, your booking for 1 people for our Cash Bingo on 25 April at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T17:11:35Z',
  'outbound-api',
  'SM2292098db176127d601566e7ad692f5a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946233319',
  'Hi Hannah, your booking for 1 people for our Cash Bingo on 25 April at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T17:11:21Z',
  'outbound-api',
  'SM84c47fd21bdbeab997a0c224119da05c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Cash Bingo on 25 April at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T17:09:33Z',
  'outbound-api',
  'SMff2bd34d1bce1cf4623c3d96c6e246aa'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi, don''t forget, we''ve got our Quiz Night on 2 April at 7pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T17:00:43Z',
  'outbound-api',
  'SM52f05380455011aed550d4e406f5d9a7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, your booking for 4 people for our Quiz Night on 2 April at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T17:00:27Z',
  'outbound-api',
  'SMd031fe0e4994a946928fa24a28bb92e8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, your booking for 6 people for our Quiz Night on 2 April at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T17:00:13Z',
  'outbound-api',
  'SM07e6c914291eb25341492bd5f5c3e406'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Quiz Night on 2 April at 7pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T16:30:49Z',
  'outbound-api',
  'SM4e6d06240642776205299a1ee7e3cfd0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447956315214',
  'Hi Billy, just a reminder that our Test Event is tomorrow at 7pm . If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T16:22:41Z',
  'outbound-api',
  'SM53aa9448ff61cfcc0e578073541e3990'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, just a reminder that our Test Event is tomorrow at 7pm . If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T16:22:40Z',
  'outbound-api',
  'SM686577cd6930587c86aaff1b08526cc5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447956315214',
  'Hi Billy, don''t forget, we''ve got our Test Event on 30 March at 7pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T16:21:41Z',
  'outbound-api',
  'SMbb3435d88b65382f748dc4105e75c61e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, just a reminder that our Test Event is tomorrow at 7pm . If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T16:20:33Z',
  'outbound-api',
  'SM6cd0d533ff4bcd3ab822120a9be874c7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, just a reminder that our Test Event is tomorrow at 7pm . If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T16:20:31Z',
  'outbound-api',
  'SMfbdf0f16dd36b3470fa00adf3fa056d0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, your booking for 2 people for our Cabaret Night on 30 May at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T15:50:19Z',
  'outbound-api',
  'SMabaa2ae29986185c3df377cee10ef1db'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Test Event on 30 March at 7pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T15:26:55Z',
  'outbound-api',
  'SMf1d9b8731b6534c31e21678510463d04'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447956315214',
  'Hi Billy, your booking for 4 people for our Quiz Night on 2 April at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T15:17:02Z',
  'outbound-api',
  'SM05b35861c7efa29cf24a44a95cd37a31'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447956315214',
  'Hi Billy, don''t forget, we''ve got our Quiz Night on 2 April at 7pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-29T15:16:26Z',
  'outbound-api',
  'SM37383c322f76cbe79ffc2eb1b43f9586'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, your booking for 4 seat(s) at Quiz Night on 4/2/2025 at 7pm is confirmed.',
  'delivered',
  '2025-03-29T15:06:52Z',
  'outbound-api',
  'SM3a7a2818bcbaff34e1085be5008c1133'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'This is a test message from Event Planner app.',
  'delivered',
  '2025-03-26T18:06:12Z',
  'outbound-api',
  'SM9d6d18556ede60f35615fb7c71f5f9c4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'This is a test message from Event Planner app.',
  'delivered',
  '2025-03-26T18:05:29Z',
  'outbound-api',
  'SMe466ce9581f858d2deba0e6bcb3e2551'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2025-03-25T07:29:05Z',
  'outbound-reply',
  'SM571cfd3360a2c129e501d16553c6b37f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447990587315',
  '+447700106752',
  'Thanks',
  'received',
  '2025-03-25T07:29:05Z',
  'inbound',
  'SM97bf5e373fe43842aae17d40833fdb5b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter Pitcher, your booking for Bingo on 25/03/2025 has been confirmed. We look forward to seeing you!',
  'delivered',
  '2025-03-25T07:03:24Z',
  'outbound-api',
  'SMdc7d8217df757d162717691945b8748f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Test',
  'delivered',
  '2025-03-25T06:36:14Z',
  'outbound-api',
  'SM5a57c269d587e6afbdb00f76b579b89e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'sdf',
  'delivered',
  '2025-03-25T06:29:02Z',
  'outbound-api',
  'SM3bbd8806bdfeb71d9f1684a2c326458b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'asd',
  'delivered',
  '2025-03-25T06:12:56Z',
  'outbound-api',
  'SM4bc269d9a723232be83448ea704c0098'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter Pitcher, this is a reminder that Drag Cabaret is scheduled for tomorrow at 09:00. We look forward to seeing you!',
  'delivered',
  '2025-03-25T05:56:45Z',
  'outbound-api',
  'SMc271e00a642ec8e39dfcf9461efef513'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'test',
  'delivered',
  '2025-03-25T05:52:59Z',
  'outbound-api',
  'SMdab3517c4b37495289a38934dff2ea15'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'test',
  'delivered',
  '2025-03-24T22:07:38Z',
  'outbound-api',
  'SM964d89cb02192c2261f952e6b8a54adf'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447398967604',
  'Hi Tom! Thanks for visiting The Anchor. Please review us: https://bit.ly/3JyLZ8d. Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-03-23T15:00:06Z',
  'outbound-api',
  'SM8bf6f13bbd4687486d50257ba2fea163'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447398967604',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2025-03-22T14:50:58Z',
  'outbound-reply',
  'SM885fa1aae1b76eef347f22ca7bc61d18'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447398967604',
  '+447700106752',
  'Yes',
  'received',
  '2025-03-22T14:50:58Z',
  'inbound',
  'SMc4a9b63f9e488e85bd17fc0acfc5e508'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447398967604',
  'Hi Tom! Reminder: your booking for tomorrow at The Anchor is confirmed. See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-03-22T13:01:05Z',
  'outbound-api',
  'SM60c4bbd5abc0635bd6264d6089e0520c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter, this is a reminder that Cash Bingo is on Friday 21st March at 6pm. We look forward to seeing you! - The Anchor',
  'delivered',
  '2025-03-16T10:08:49Z',
  'outbound-api',
  'SM9041107c34061a5469c96f76daeaf07f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Pete P, your booking for Cash Bingo on 3/21/2025 has been confirmed. We look forward to seeing you!',
  'delivered',
  '2025-03-16T08:59:38Z',
  'outbound-api',
  'SM506d03c78998f67ead9739ff7d95eb1d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Pete P, your booking for Cash Bingo on 3/21/2025 has been cancelled. If this was a mistake, please contact us.',
  'delivered',
  '2025-03-16T08:59:37Z',
  'outbound-api',
  'SM3998e0c99ee8951d6671976b676b444d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'We''re very sorry that your booking for our Cash Bingo on Friday 21st March has been cancelled. If this message has been received in error, please contact us on 01753682707',
  'delivered',
  '2025-03-16T08:53:28Z',
  'outbound-api',
  'SM9b0f80bc0f9ba4f6af621f4b7207bb8a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447398967604',
  'Hi Tom! Your booking for 23/03/2025 13:00 is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-03-15T18:19:56Z',
  'outbound-api',
  'SMbd1d9c78959208031552662bd5e47302'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447888204175',
  'Hi Valentina, just a reminder that our Cash Bingo is next Friday at 6pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:07:23Z',
  'outbound-api',
  'SM1cf165931050eb4fc18d9bc32f41c1a5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447586282882',
  'Hi Moureen, just a reminder that our Cash Bingo is next Friday at 6pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:07:22Z',
  'outbound-api',
  'SM54d2720b1b8e83d2e7d22631c67753fa'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447766048813',
  'Hi Chris, just a reminder that our Cash Bingo is next Friday at 6pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:07:21Z',
  'outbound-api',
  'SM02e0d9a26c0b8292e3f3c097248bc5f1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447920486907',
  'Hi Karen, just a reminder that our Cash Bingo is next Friday at 6pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:07:20Z',
  'outbound-api',
  'SMcbe254af0adf4af7696a6d8b08528438'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447801257158',
  'Hi Jane, just a reminder that our Cash Bingo is next Friday at 6pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:07:19Z',
  'outbound-api',
  'SM116685c677f01716e41b6736b1bdac31'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447426675717',
  'Hi Andrew, just a reminder that our Cash Bingo is next Friday at 6pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:07:18Z',
  'outbound-api',
  'SM234cbe49ab6b77db43f8a32c260437e1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447926203166',
  'Hi Sid, just a reminder that our Cash Bingo is next Friday at 6pm. If you''d like seats, WhatsApp/Call 01753682707',
  'undelivered',
  '2025-03-14T09:07:17Z',
  'outbound-api',
  'SM206f0173e8e4e53d462cd57fe0798f06'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447946754476',
  'Hi Nish, just a reminder that our Cash Bingo is next Friday at 6pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:07:15Z',
  'outbound-api',
  'SM1f44d6f28b0e397c7b0fd70824682323'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447954340912',
  'Hi Mandy, just a reminder that our Cash Bingo is next Friday at 6pm. If you''d like seats, WhatsApp/Call 01753682707',
  'undelivered',
  '2025-03-14T09:07:15Z',
  'outbound-api',
  'SM9184e1e57182831520f4d15334319fd8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447803364853',
  'Hi Lisa, just a reminder that our Cash Bingo is next Friday at 6pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:07:14Z',
  'outbound-api',
  'SMfc5942c888a49a488908c75957df99d2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447708714947',
  'Hi Brian, just a reminder that our Cash Bingo is next Friday at 6pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:07:13Z',
  'outbound-api',
  'SM2cd9328fbbb45440c4a642af7aa3188f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447947100347',
  'Hi Vinnie, just a reminder that our Cash Bingo is next Friday at 6pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:07:11Z',
  'outbound-api',
  'SMeb149b0fb30e4039b5c8a564c6fce7b1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447968042989',
  'Hi Leanne, just a reminder that our Cash Bingo is next Friday at 6pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:07:10Z',
  'outbound-api',
  'SMa3f2830fb622f0094699fbb38b2a4b80'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447935785513',
  'Hi Jade, just a reminder that our Cash Bingo is next Friday at 6pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:07:10Z',
  'outbound-api',
  'SM9bfe85a06ad61cce383828ad69bc15fa'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447719261701',
  'Hi Claire, just a reminder that our Cash Bingo is next Friday at 6pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:07:08Z',
  'outbound-api',
  'SM13a90585e601c99d591830fef27b87e7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447793080018',
  'Hi Claire, just a reminder that our Cash Bingo is next Friday at 6pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:07:07Z',
  'outbound-api',
  'SM2b8b727593837e0dae913135c616f261'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447860100825',
  'Hi Shell, just a reminder that our Cash Bingo is next Friday at 6pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:07:06Z',
  'outbound-api',
  'SMf8a9e9692163f407556d85d3c5b29f99'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447889600378',
  'Hi Lou, just a reminder that our Cash Bingo is next Friday at 6pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:07:05Z',
  'outbound-api',
  'SM659e8e1b7b4dcadd81f431db6bccf555'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447912859484',
  'Hi Katie, just a reminder that our Cash Bingo is next  Friday at 6pm. You have 4 seats booked. If you have any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:07:03Z',
  'outbound-api',
  'SM7116bb6f6e2d016bc415ae9f00e07b4a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447590122208',
  'Hi Rupi, just a reminder that our Cash Bingo is next  Friday at 6pm. You have 2 seats booked. If you have any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:07:02Z',
  'outbound-api',
  'SM52c1728b85f3c984e4e2e27ae80fc412'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447973560612',
  'Hi Caz, just a reminder that our Cash Bingo is next  Friday at 6pm. You have 6 seats booked. If you have any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:07:01Z',
  'outbound-api',
  'SM5b8181fc32385b5c9948a99118f3d620'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447540050888',
  'Hi Jackie, just a reminder that our Cash Bingo is next  Friday at 6pm. You have 2 seats booked. If you have any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:07:01Z',
  'outbound-api',
  'SM79db82b885dcb304e67ea2ba0a8392f0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447940220875',
  'Hi Penny, just a reminder that our Cash Bingo is next  Friday at 6pm. You have 5 seats booked. If you have any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:06:59Z',
  'outbound-api',
  'SMb9554732eb1cd1d10dcbe6b4c3facdaa'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447985751794',
  'Hi Julie, just a reminder that our Cash Bingo is next  Friday at 6pm. You have 4 seats booked. If you have any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-14T09:06:58Z',
  'outbound-api',
  'SMc63f08a4562104ea2bcce8683bb5634a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447843951131',
  'Hi Lance (Pub), your booking for 1 people for our Spring Tasting Night on March 14 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call',
  'delivered',
  '2025-03-13T19:14:24Z',
  'outbound-api',
  'SMdc0761d92a531aab8c9076c3c1c2887d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Peter, just a reminder that our Spring Tasting Night is tomorrow at 7pm if you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-13T11:45:16Z',
  'outbound-api',
  'SM40615d95b3ff3e141b1a9af1e1722319'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Spring Tasting Night on March 14 at 7pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-13T11:13:01Z',
  'outbound-api',
  'SMe6aa3ac14a0cc5a978f762721eff26d1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447914398101',
  'Hi Jacqui, just a reminder that our Spring Tasting Night is tomorrow at 7pm and you have 1 seats booked. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-13T09:02:35Z',
  'outbound-api',
  'SMbf92959d2703961a2697846fd464c3a1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447803037526',
  'Hi Marion, just a reminder that our Spring Tasting Night is tomorrow at 7pm and you have 1 seats booked. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-13T09:02:34Z',
  'outbound-api',
  'SMe07f9923aec13b6f6657cb966f0b5ac2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447590122208',
  'Hi Rupi, just a reminder that our Spring Tasting Night is tomorrow at 7pm and you have 5 seats booked. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-13T09:02:33Z',
  'outbound-api',
  'SM5288d2c8be6d49a8851c2ff080924950'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447968042989',
  'Hi Leanne, just a reminder that our Spring Tasting Night is tomorrow at 7pm and you have 6 seats booked. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-13T09:02:31Z',
  'outbound-api',
  'SM4d6218222adee23352d3722290d1e965'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447809645374',
  'Hi Anne, just a reminder that our Spring Tasting Night is tomorrow at 7pm and you have 1 seats booked. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-13T09:02:31Z',
  'outbound-api',
  'SM1e4927f8559885285643398a1db84319'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447946754476',
  'Hi Nish, just a reminder that our Spring Tasting Night is tomorrow at 7pm and you have 2 seats booked. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-13T09:02:30Z',
  'outbound-api',
  'SMfebb0ba51c87863874c9201a2444f741'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447586282882',
  'Hi Moureen, just a reminder that our Spring Tasting Night is tomorrow at 7pm if you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-13T09:00:17Z',
  'outbound-api',
  'SM11d2ed393505dd5b52dc721c820f7b8a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447766048813',
  'Hi Chris, just a reminder that our Spring Tasting Night is tomorrow at 7pm if you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-13T09:00:16Z',
  'outbound-api',
  'SM3705db5258cd8828a310fc50480c5c3c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447719261701',
  'Hi Claire, just a reminder that our Spring Tasting Night is tomorrow at 7pm if you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-13T09:00:16Z',
  'outbound-api',
  'SM93d0e8072eca61b3a509ac48e68b4e53'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447540050888',
  'Hi Jackie, your booking for 2 people for our Cash Bingo on March 21 at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-09T06:28:17Z',
  'outbound-api',
  'SMd632b063fb439eba6797e26dd2688b33'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447590122208',
  'Hi Rupi, your booking for 5 people for our Spring Tasting Night on March 14 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 017536',
  'delivered',
  '2025-03-07T20:46:20Z',
  'outbound-api',
  'SM3ba73d9989ebac8e0ddeaf5b69d1b6b4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447903879340',
  'Hi Hemma, your booking for 1 people for our Paint with Pals on July 12 at 5pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-07T18:36:09Z',
  'outbound-api',
  'SM415bfeb32258751dd0973d89690c889a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447940220875',
  'Hi Penny, your booking for 6 people for our Pub Pursuit Quiz Night on April 2 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 0175',
  'delivered',
  '2025-03-07T18:20:15Z',
  'outbound-api',
  'SM74b892748e7fa2b8944e56e579432fcd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447590122208',
  'Hi Rupi, just a reminder that our Spring Tasting Night is next Friday at 7pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-07T09:03:58Z',
  'outbound-api',
  'SMa7fd6f17dd49b764cde7737727a916cd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447586282882',
  'Hi Moureen, just a reminder that our Spring Tasting Night is next Friday at 7pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-07T09:03:57Z',
  'outbound-api',
  'SM676b0e19cbd32f551b331a76e3bd0c59'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447719261701',
  'Hi Claire, just a reminder that our Spring Tasting Night is next Friday at 7pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-07T09:03:56Z',
  'outbound-api',
  'SM30eba3fc289ac44b9955cd9bb9fa1eda'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447766048813',
  'Hi Chris, just a reminder that our Spring Tasting Night is next Friday at 7pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-07T09:03:55Z',
  'outbound-api',
  'SMa72da945033b68c24c86f7bfa0413b85'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447914398101',
  'Hi Jacqui, just a reminder that our Spring Tasting Night is next  Friday at 7pm. You have 1 seats booked. If you have any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-07T09:02:21Z',
  'outbound-api',
  'SM430e2cccd4004b8b62a380322419d8be'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447803037526',
  'Hi Marion, just a reminder that our Spring Tasting Night is next  Friday at 7pm. You have 1 seats booked. If you have any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-07T09:02:20Z',
  'outbound-api',
  'SMc6423f2ebeff951ffcf7cba710290e83'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447968042989',
  'Hi Leanne, just a reminder that our Spring Tasting Night is next  Friday at 7pm. You have 6 seats booked. If you have any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-07T09:02:19Z',
  'outbound-api',
  'SM412a53a0adb08d6714ea70c0b4a6d50c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447809645374',
  'Hi Anne, just a reminder that our Spring Tasting Night is next  Friday at 7pm. You have 1 seats booked. If you have any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-07T09:02:19Z',
  'outbound-api',
  'SM269bb1bbbabed7d6d9769a06bf2e1bee'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447946754476',
  'Hi Nish, just a reminder that our Spring Tasting Night is next  Friday at 7pm. You have 2 seats booked. If you have any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-07T09:02:18Z',
  'outbound-api',
  'SM197a29f807d2aba43242fb36081ce4a3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447590122208',
  'Hi Rupi, don''t forget, we''ve got our Pub Pursuit Quiz Night on April 2 at 7pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-06T09:17:30Z',
  'outbound-api',
  'SM257d3da99672a4cb8e5450a4de018380'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447920486907',
  'Hi Karen, don''t forget, we''ve got our Cash Bingo on March 21 at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-06T09:16:27Z',
  'outbound-api',
  'SM0d10583d1fc2e3b4fb14ecf60990111a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447973560612',
  'Hi Caz, don''t forget, we''ve got our Pub Pursuit Quiz Night on April 2 at 7pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-06T09:16:27Z',
  'outbound-api',
  'SM356e7de9c17291f0ebb00a2fad6bc0f7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447803364853',
  'Hi Lisa, don''t forget, we''ve got our Cash Bingo on March 21 at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-06T09:16:25Z',
  'outbound-api',
  'SM5f985f62f75156dc7dbcbc955458d0e4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447426675717',
  'Hi Andrew, don''t forget, we''ve got our Cash Bingo on March 21 at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-06T09:16:24Z',
  'outbound-api',
  'SMd5f6ed2ca0662b3c8fcf5ce70b7e2e85'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447940220875',
  'Hi Penny, don''t forget, we''ve got our Pub Pursuit Quiz Night on April 2 at 7pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-06T09:16:23Z',
  'outbound-api',
  'SM845b660d07922a40fa157c33837914f5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447793080018',
  'Hi Claire, don''t forget, we''ve got our Cash Bingo on March 21 at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-06T09:15:21Z',
  'outbound-api',
  'SM82f5eaecabf1109f8718ac7c6d5250db'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447793080018',
  'Hi Claire, don''t forget, we''ve got our Pub Pursuit Quiz Night on April 2 at 7pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-06T09:14:26Z',
  'outbound-api',
  'SMba5af9637f3b377b315e4f5c277378ab'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447860100825',
  'Hi Shell, don''t forget, we''ve got our Cash Bingo on March 21 at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-05T21:27:36Z',
  'outbound-api',
  'SMee3e0ace7dcc8702e11eb1bb27c68fbf'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447889600378',
  'Hi Lou, don''t forget, we''ve got our Cash Bingo on March 21 at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-05T21:27:33Z',
  'outbound-api',
  'SM4b817fe51030df9043cd914e76d145a4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447889600378',
  'Hi Lou, don''t forget, we''ve got our Quiz Night on March 5 at 7pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-05T21:26:26Z',
  'outbound-api',
  'SMfd5e2ccb375fc57b9dccf953f8893b60'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447926203166',
  'Hi Sid, don''t forget, we''ve got our Drag Cabaret on March 28 at 7pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'undelivered',
  '2025-03-05T20:01:07Z',
  'outbound-api',
  'SMda62164f4941028f26e05819df3514cd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447985751794',
  'Hi Julie, your booking for 4 people for our Drag Cabaret on March 28 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-05T20:01:07Z',
  'outbound-api',
  'SM06db36e5bacdc6f9d6d9c3adde73145c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447973560612',
  'Hi Caz, your booking for 6 people for our Cash Bingo on March 21 at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-05T18:54:34Z',
  'outbound-api',
  'SM25e17965f5d2e2650d3d562e670502a8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447809645374',
  'Hi Anne, your booking for 1 people for our Spring Tasting Night on March 14 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 017536',
  'delivered',
  '2025-03-04T21:24:49Z',
  'outbound-api',
  'SMc63cae3b620fecf7e6c45e11c2efcaec'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447914398101',
  'Hi Jacqui, your booking for 1 people for our Spring Tasting Night on March 14 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 0175',
  'delivered',
  '2025-03-04T21:23:52Z',
  'outbound-api',
  'SMafe90e90ddcb0d1a2fd8629a1bfe090e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447803037526',
  'Hi Marion, your booking for 1 people for our Spring Tasting Night on March 14 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 0175',
  'delivered',
  '2025-03-04T21:23:51Z',
  'outbound-api',
  'SMf2ae93b955e53d2ac4ed56329e259e13'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447719261701',
  'Hi Claire, don''t forget, we''ve got our Cash Bingo on March 21 at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-04T19:59:49Z',
  'outbound-api',
  'SM81752f49b74673ca7edacc8ed0a08ab8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447590122208',
  'Hi Rupi, don''t forget, we''ve got our Spring Tasting Night on March 14 at 7pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-04T19:31:33Z',
  'outbound-api',
  'SM28dd2e5c4d01a7297527fa01e214e2bf'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447586282882',
  'Hi Moureen, don''t forget, we''ve got our Spring Tasting Night on March 14 at 7pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-04T19:22:04Z',
  'outbound-api',
  'SM7a76f11b807b34d8729157320afdd525'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447586282882',
  'Hi Moureen, don''t forget, we''ve got our Cash Bingo on March 21 at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-04T19:22:00Z',
  'outbound-api',
  'SMadb3ca288a7f6971152da0ad6904e05a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447719261701',
  'Hi Claire, don''t forget, we''ve got our Spring Tasting Night on March 14 at 7pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-04T19:19:47Z',
  'outbound-api',
  'SM54d02192ecb44b120096beb879d21354'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447766048813',
  'Hi Chris, don''t forget, we''ve got our Spring Tasting Night on March 14 at 7pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-04T13:11:08Z',
  'outbound-api',
  'SM2a2c5eb595d9109e540189160c38ea30'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447926203166',
  'Hi Sid, don''t forget, we''ve got our Cash Bingo on March 21 at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'undelivered',
  '2025-03-04T13:09:59Z',
  'outbound-api',
  'SM38323df880f7aa2c2d42feb7805b55d4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447801257158',
  'Hi Jane, don''t forget, we''ve got our Cash Bingo on March 21 at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-04T13:09:04Z',
  'outbound-api',
  'SMef0e7c9e14ff2922cf96b50b1c592a5d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447935785513',
  'Hi Jade, don''t forget, we''ve got our Cash Bingo on March 21 at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-04T13:08:00Z',
  'outbound-api',
  'SMf984cdb6ae124682cae942c3d8641ee5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447708714947',
  'Hi Brian, don''t forget, we''ve got our Cash Bingo on March 21 at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-04T13:03:58Z',
  'outbound-api',
  'SMf0caecaff1f2b06ff66c1d3cab5322ec'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447946754476',
  'Hi Nish, don''t forget, we''ve got our Cash Bingo on March 21 at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-04T13:03:53Z',
  'outbound-api',
  'SMb76652a8ec474322e58cbabf452d088a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447973560612',
  'Hi Caz, don''t forget, we''ve got our Cash Bingo on March 21 at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-04T13:03:53Z',
  'outbound-api',
  'SMa8ff0fedccccac1cecc302f840b72f0c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447947100347',
  'Hi Vinnie, don''t forget, we''ve got our Cash Bingo on March 21 at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-04T13:03:52Z',
  'outbound-api',
  'SMe5a59c55a4e820ff5770b9715d0de90d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447766048813',
  'Hi Chris, don''t forget, we''ve got our Cash Bingo on March 21 at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-04T13:03:51Z',
  'outbound-api',
  'SM2bb8549079ebfd845bf1033738bf6945'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447954340912',
  'Hi Mandy, don''t forget, we''ve got our Cash Bingo on March 21 at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-04T13:02:47Z',
  'outbound-api',
  'SMcbbd33c67cbb4f02d567a508dfa6e18d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447888204175',
  'Hi Valentina, don''t forget, we''ve got our Cash Bingo on March 21 at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-04T13:02:46Z',
  'outbound-api',
  'SM6a7fc068ce3a5963dadbf6b21e2a1282'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447968042989',
  'Hi Leanne, don''t forget, we''ve got our Cash Bingo on March 21 at 6pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-04T13:01:39Z',
  'outbound-api',
  'SMd9d450d151ab3a6c1086e59ba0e52419'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Peter, just a reminder that our Test Event is tomorrow at 9pm if you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-04T11:30:11Z',
  'outbound-api',
  'SMa7c6230270fe460182734939738974fa'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Peter, just a reminder that our Test Event is next  Tuesday at 9pm. If you''d like seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-04T11:01:41Z',
  'outbound-api',
  'SMec8c0eed61c2b84e7b26d8eb365d1434'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Test Event on March 11 at 9pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-04T10:44:31Z',
  'outbound-api',
  'SMffc64566cb5648499e8b509a00f3fefe'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Peter, don''t forget, we''ve got our Spring Tasting Night on March 14 at 7pm! If you''d like to book seats, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-04T09:38:19Z',
  'outbound-api',
  'SMcdac06d434e1aa900e7bad9537db1a3b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447946754476',
  'Hi Nish, your booking for 2 people for our Spring Tasting Night on March 14 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 017536',
  'delivered',
  '2025-03-03T11:24:51Z',
  'outbound-api',
  'SMd93c82a6fde6cd97dfaf974160bf802c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447968042989',
  'Hi Leanne, your booking for 6 people for our Spring Tasting Night on March 14 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 0175',
  'delivered',
  '2025-03-03T11:24:51Z',
  'outbound-api',
  'SMf88e88ff6e78ed0c774f483d06005747'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447968042989',
  'Hi Leanne, your booking for 6 people for our Spring Tasting Night on March 15 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 0175',
  'delivered',
  '2025-03-03T11:22:50Z',
  'outbound-api',
  'SMf55daa3721cf478d232a5484189e8ac2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447946754476',
  'Hi Nish, your booking for 2 people for our Spring Tasting Night on March 15 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 017536',
  'delivered',
  '2025-03-03T10:51:49Z',
  'outbound-api',
  'SM96960a85921bccc7c5fc88080bce4082'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447968042989',
  'Hi Leanne, your booking for 4 people for our Spring Tasting Night on March 15 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 0175',
  'delivered',
  '2025-03-03T10:50:56Z',
  'outbound-api',
  'SMc034e3e9d5605b318d96316cc73d5323'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447985751794',
  'Hi Julie, your booking for 4 people for our Cash Bingo on March 21 at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-03T10:49:53Z',
  'outbound-api',
  'SMd994b70d055415906c823b1d1f9c452f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447912859484',
  'Hi Katie, your booking for people for our Cash Bingo on March 21 at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-03T10:48:57Z',
  'outbound-api',
  'SM6170e7fa9408c736093821874f9786d4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447590122208',
  'Hi Rupi, your booking for 2 people for our Cash Bingo on March 21 at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-03T10:48:57Z',
  'outbound-api',
  'SM99dc7efbe73d5ea7bdf5f0fdc790dd94'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447590122208',
  'Hi Rupi, your booking for 2 people for our Quiz Night on March 5 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-03T10:48:57Z',
  'outbound-api',
  'SM33331de41dd79b17602dc9ada2918ce2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447968042989',
  'Hi Leanne, your booking for 4 people for our Quiz Night on March 5 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-03T10:48:03Z',
  'outbound-api',
  'SM2bfbe908a0d7b05cf61204138f8d2f66'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447985751794',
  'Hi Julie, your booking for 4 people for our Quiz Night on March 5 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-03T10:46:56Z',
  'outbound-api',
  'SMb74519195f0ce0eb1041b33ce29c52c6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447462570351',
  'Hi Mark! Thanks for visiting The Anchor. Please review us: https://bit.ly/3JyLZ8d. Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-03-02T16:00:05Z',
  'outbound-api',
  'SM2682c1afe1d47243f85a397bc719801b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447940220875',
  'Hi Penny, your booking for 5 people for our Quiz Night on March 5 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-03-01T21:35:59Z',
  'outbound-api',
  'SMc7fae0e96361283fe733db2fd708f963'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447462570351',
  'Hi Mark! Reminder: your booking for tomorrow at The Anchor is confirmed. See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-03-01T14:01:05Z',
  'outbound-api',
  'SM55059abe42d05915fd25004394cc2173'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447940220875',
  'Hi Penny, your booking for 5 people for our Cash Bingo on March 21 at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-28T22:36:15Z',
  'outbound-api',
  'SM0c8ee95dca5bf5c3f4b295044a09c2db'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447912859484',
  'Hi Katie Fowles! Thanks for visiting The Anchor. Please review us: https://bit.ly/3JyLZ8d. Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-02-28T15:00:06Z',
  'outbound-api',
  'SMa17cf88576e78222c30cd35a78aaa66f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447912859484',
  'Hi Katie Fowles! Reminder: your booking for tomorrow at The Anchor is confirmed. See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-02-27T13:01:04Z',
  'outbound-api',
  'SM6aed659792ff43d14256d1e1ebbe5a22'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447920486907',
  'Hi Karen, just a reminder that our Cash Bingo is tomorrow at 6pm and you have 6 seats booked. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-27T09:00:42Z',
  'outbound-api',
  'SMab27c7335367ed66058872e34b633cde'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447973560612',
  'Hi Caz, just a reminder that our Cash Bingo is tomorrow at 6pm and you have 4 seats booked. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-27T09:00:41Z',
  'outbound-api',
  'SM93b856c69b6877914bacffcb7694f3bc'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447462570351',
  'Hi Mark! Your booking for 02/03/2025 14:00 is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-02-26T12:54:11Z',
  'outbound-api',
  'SM040381602c94b1abeb55953502be0c49'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447973560612',
  'Hi Caz, just a reminder that our Quiz Night is next  Wednesday at 7pm. You have 4 seats booked. If you have any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-26T09:02:35Z',
  'outbound-api',
  'SMb529cd309e3e2f1aff85f78996746d1c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447414451211',
  'Hi Richard! Thanks for visiting The Anchor. Please review us: https://bit.ly/3JyLZ8d. Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-02-23T15:00:05Z',
  'outbound-api',
  'SMd734b6188a629fe334e28ed54b882459'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447861205644',
  'Hi Lindi! Thanks for visiting The Anchor. Please review us: https://bit.ly/3JyLZ8d. Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-02-23T14:00:04Z',
  'outbound-api',
  'SM24112e990eca49447d5c5dd297d80c4f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447414451211',
  'Hi Richard! Reminder: your booking for tomorrow at The Anchor is confirmed. See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-02-23T11:01:05Z',
  'outbound-api',
  'SM254f510c04a027608b214b97081023e9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447414451211',
  'Hi Richard! Your booking for 23/02/2025 12:30 is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-02-23T10:57:46Z',
  'outbound-api',
  'SMfb2d7660f92736b988d0570e745ee204'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447861205644',
  'Hi Lindi! Reminder: your booking for tomorrow at The Anchor is confirmed. See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-02-22T21:01:04Z',
  'outbound-api',
  'SM09fdf09f9ec429d5da097dfff82112b6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447861205644',
  'Hi Lindi! Your booking for 23/02/2025 12:00 is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-02-22T20:47:30Z',
  'outbound-api',
  'SM2dcac60138c8f49dad67bb997bb091ec'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447366463428',
  'Hi Ryadh! Thanks for visiting The Anchor. Please review us: https://bit.ly/3JyLZ8d. Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-02-21T21:00:06Z',
  'outbound-api',
  'SMeb92f22fab22fc529be69473f12f6e1f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie! Thanks for visiting The Anchor. Please review us: https://bit.ly/3JyLZ8d. Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-02-21T21:00:05Z',
  'outbound-api',
  'SMdce9397a3589792cbd9d3261c39f05ac'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter! Thanks for visiting The Anchor. Please review us: https://bit.ly/3JyLZ8d. Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-02-21T21:00:05Z',
  'outbound-api',
  'SM8f84eb04355fb2272decdf5ce7762f1a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447985751794',
  'FIRST TO KNOW! Our Spring Tasting Night featuring Gins & Vodkas that evoke warm days is on March 14th! Limited to just 25 tickets, including all spirits, mixers, a fun quiz & nibbles – all for £30 per person. Click here to message us & secure your ticket: https://bit.ly/3Xc86c9',
  'delivered',
  '2025-02-21T11:55:58Z',
  'outbound-api',
  'SM17f618481e3b0ce5d77d66fd1e7127d3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447590122208',
  'FIRST TO KNOW! Our Spring Tasting Night featuring Gins & Vodkas that evoke warm days is on March 14th! Limited to just 25 tickets, including all spirits, mixers, a fun quiz & nibbles – all for £30 per person. Click here to message us & secure your ticket: https://bit.ly/3Xc86c9',
  'delivered',
  '2025-02-21T11:55:57Z',
  'outbound-api',
  'SMf4f84e350c7ade7d79c7031276bd45ce'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447843951131',
  'FIRST TO KNOW! Our Spring Tasting Night featuring Gins & Vodkas that evoke warm days is on March 14th! Limited to just 25 tickets, including all spirits, mixers, a fun quiz & nibbles – all for £30 per person. Click here to message us & secure your ticket: https://bit.ly/3Xc86c9',
  'delivered',
  '2025-02-21T11:55:57Z',
  'outbound-api',
  'SM1864849c5250feaed51a4d404ef67d3a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447912859484',
  'FIRST TO KNOW! Our Spring Tasting Night featuring Gins & Vodkas that evoke warm days is on March 14th! Limited to just 25 tickets, including all spirits, mixers, a fun quiz & nibbles – all for £30 per person. Click here to message us & secure your ticket: https://bit.ly/3Xc86c9',
  'delivered',
  '2025-02-21T11:55:56Z',
  'outbound-api',
  'SMadab80124ce5f76438817186b3c76492'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447946754476',
  'FIRST TO KNOW! Our Spring Tasting Night featuring Gins & Vodkas that evoke warm days is on March 14th! Limited to just 25 tickets, including all spirits, mixers, a fun quiz & nibbles – all for £30 per person. Click here to message us & secure your ticket: https://bit.ly/3Xc86c9',
  'delivered',
  '2025-02-21T11:55:56Z',
  'outbound-api',
  'SM399d2d3377a4d4dc25131c04283657ad'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447956315214',
  'FIRST TO KNOW! Our Spring Tasting Night featuring Gins & Vodkas that evoke warm days is on March 14th! Limited to just 25 tickets, including all spirits, mixers, a fun quiz & nibbles – all for £30 per person. Click here to message us & secure your ticket: https://bit.ly/3Xc86c9',
  'delivered',
  '2025-02-21T11:55:23Z',
  'outbound-api',
  'SM8ec26baed062f7e9a9a98578bbe2936e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'FIRST TO KNOW! Our Spring Tasting Night featuring Gins & Vodkas that evoke warm days is on March 14th! Limited to just 25 tickets, including all spirits, mixers, a fun quiz & nibbles – all for £30 per person. Click here to message us & secure your ticket: https://bit.ly/3Xc86c9',
  'delivered',
  '2025-02-21T11:55:22Z',
  'outbound-api',
  'SM4034a7b79090291cb87e5834eb318924'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447366463428',
  'Hi Ryadh! Reminder: your booking for tomorrow at The Anchor is confirmed. See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-02-21T10:01:04Z',
  'outbound-api',
  'SM9c411899b88ba4b109f9a77c1623e60f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447366463428',
  'Hi Ryadh! Your booking for 21/02/2025 19:00 is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-02-21T09:58:34Z',
  'outbound-api',
  'SM17ed60087c6bf439e138ecb3c340cb78'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447985751794',
  'Hi Julie, just a reminder that our Cash Bingo is next  Friday,Friday,Friday,Friday,Friday,Friday,Friday,Friday at 6pm. You have 4 seats booked. If you have any',
  'delivered',
  '2025-02-21T09:02:14Z',
  'outbound-api',
  'SM5917495c1af7d1fb266e0fdd6760212a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447426675717',
  'Hi Andrew, just a reminder that our Cash Bingo is next  Friday,Friday,Friday,Friday,Friday,Friday,Friday,Friday at 6pm. You have 3 seats booked. If you have any',
  'delivered',
  '2025-02-21T09:02:13Z',
  'outbound-api',
  'SMc03b6b3f23c8d1a7ba0b0683dd704325'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447803364853',
  'Hi Lisa, just a reminder that our Cash Bingo is next  Friday,Friday,Friday,Friday,Friday,Friday,Friday,Friday at 6pm. You have 2 seats booked. If you have any q',
  'delivered',
  '2025-02-21T09:02:11Z',
  'outbound-api',
  'SMd52c559c19987bdc86e3f89a26fc2022'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447513520317',
  'Hi Pike, just a reminder that our Cash Bingo is next  Friday,Friday,Friday,Friday,Friday,Friday,Friday,Friday at 6pm. You have 3 seats booked. If you have any q',
  'delivered',
  '2025-02-21T09:02:11Z',
  'outbound-api',
  'SMcb8e4a698c06bfa463d02a7591bc690d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447912859484',
  'Hi Katie, just a reminder that our Cash Bingo is next  Friday,Friday,Friday,Friday,Friday,Friday,Friday,Friday at 6pm. You have 6 seats booked. If you have any',
  'delivered',
  '2025-02-21T09:02:11Z',
  'outbound-api',
  'SMa58143fcfb63c0a6924988dfe2b79f83'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447973560612',
  'Hi Caz, just a reminder that our Cash Bingo is next  Friday,Friday,Friday,Friday,Friday,Friday,Friday,Friday at 6pm. You have 4 seats booked. If you have any qu',
  'delivered',
  '2025-02-21T09:02:08Z',
  'outbound-api',
  'SM854b229325ac6d6d4b46727d67c3067d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447920486907',
  'Hi Karen, just a reminder that our Cash Bingo is next  Friday,Friday,Friday,Friday,Friday,Friday,Friday,Friday at 6pm. You have 6 seats booked. If you have any',
  'delivered',
  '2025-02-21T09:02:08Z',
  'outbound-api',
  'SMbc5f7b273c3bc12144371972356ae08f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Peter, just a reminder that our Cash Bingo is next  Friday,Friday,Friday,Friday,Friday,Friday,Friday,Friday at 6pm. You have 1 seats booked. If you have any',
  'delivered',
  '2025-02-21T09:02:08Z',
  'outbound-api',
  'SM15e24417e4d4d430ef5342c38f8c3279'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie! Reminder: your booking for tomorrow at The Anchor is confirmed. See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-02-20T19:01:05Z',
  'outbound-api',
  'SM547272623142077d41e5d7175670614c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter! Reminder: your booking for tomorrow at The Anchor is confirmed. See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-02-20T19:01:05Z',
  'outbound-api',
  'SMc2babb60b9faf6dd66647d6834c9b6f9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447973560612',
  'Hi Caz, your booking for 4 people for our Quiz Night on March 5 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-20T13:05:03Z',
  'outbound-api',
  'SM917a5efeac090f9e1e370c241eec4d2f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447766048813',
  'Hi Chris, just a reminder that our Gameshow House Party is tomorrow at 7pm and you have 2 seats booked. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-20T09:01:22Z',
  'outbound-api',
  'SM0e5e2b3f9da13c6437019b71269353b8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447985751794',
  'Hi Julie, just a reminder that our Gameshow House Party is tomorrow at 7pm and you have 4 seats booked. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-20T09:01:22Z',
  'outbound-api',
  'SMc8f8689f5408c42b83a86a8eb733ccd3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447426675717',
  'Hi Andrew, just a reminder that our Gameshow House Party is tomorrow at 7pm and you have 3 seats booked. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-20T09:01:21Z',
  'outbound-api',
  'SM1b8e8f9af890226c9f177125b24c88a3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447742116805',
  'Hi Jade, just a reminder that our Gameshow House Party is tomorrow at 7pm and you have 3 seats booked. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-20T09:01:20Z',
  'outbound-api',
  'SMa79e361edce66030fedec5b585df7f26'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Peter, just a reminder that our Gameshow House Party is tomorrow at 7pm and you have 1 seats booked. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-20T09:01:20Z',
  'outbound-api',
  'SM75944d9bcbfe033c349fae8650f565d4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447803364853',
  'Hi Lisa, just a reminder that our Gameshow House Party is tomorrow at 7pm and you have 2 seats booked. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-20T09:01:17Z',
  'outbound-api',
  'SM349c841c0d130a49e867453520959dfb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447590122208',
  'Hi Rupi, just a reminder that our Gameshow House Party is tomorrow at 7pm and you have 2 seats booked. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-20T09:01:16Z',
  'outbound-api',
  'SM05a58a5337a9688a58d2373f9f2f24bd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447973560612',
  'Hi Caz, just a reminder that our Gameshow House Party is tomorrow at 7pm and you have 4 seats booked. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-20T09:01:15Z',
  'outbound-api',
  'SM89eef51d0549de5c2d8660f961caa1d3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447590122208',
  'Hi Rupi, your booking for 2 people for our Gameshow House Party on February 5 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 0175',
  'delivered',
  '2025-02-18T19:55:09Z',
  'outbound-api',
  'SM37b7f98371b414c532204e916fb3e2ac'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447956315214',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:31Z',
  'outbound-api',
  'SM3f83ae8d248d79007489367e818b419a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447947100347',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:30Z',
  'outbound-api',
  'SM7ca1b905e2de21fd38254972926fb7dd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447926203166',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'undelivered',
  '2025-02-16T12:14:30Z',
  'outbound-api',
  'SM17b5855c9e7714d381f73ac591112beb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447946322633',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:30Z',
  'outbound-api',
  'SM3d63455056a730e9e10a4083f2ce572e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447463726233',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:30Z',
  'outbound-api',
  'SMf6476582fc3f7f3862af4503e80a9a6a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447590122208',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:29Z',
  'outbound-api',
  'SMa6f56ab068d57e1ade848e64c3673ff9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447875767053',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:29Z',
  'outbound-api',
  'SM797674f03ef3656683b1d7122853385e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447513520317',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:29Z',
  'outbound-api',
  'SM22de38c108ea8829a66e49dc10a31d94'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447795514533',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:29Z',
  'outbound-api',
  'SM045ba4f82fe8629e93680796e8b71617'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447476353024',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:29Z',
  'outbound-api',
  'SM3a3b1933bd1438ecc5f155202f833950'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447736641657',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:28Z',
  'outbound-api',
  'SM0798d81622f17beb05b658c438bd71cf'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447843951131',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:28Z',
  'outbound-api',
  'SM78b61d491d210b9e36226f9b676e4b06'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447597537511',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:28Z',
  'outbound-api',
  'SM90411c608f9a751c7d2f861c32d0b7c3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447985751794',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:28Z',
  'outbound-api',
  'SM47a68cb1dcacc78acd02eff11fd5e3da'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447702746498',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:27Z',
  'outbound-api',
  'SM66d791c875ebd4a17e469bdbfe6ea68e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447890680950',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:27Z',
  'outbound-api',
  'SMec8a4363223504c72f26252aa9a1d5f2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447771496954',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:27Z',
  'outbound-api',
  'SM3d9e4b10984a91f7acf61658d6ef9846'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447947207494',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:27Z',
  'outbound-api',
  'SMce6229dbc9eaaaf4ac6cd4236ed0b87c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447946439144',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:26Z',
  'outbound-api',
  'SM9bb6e29fee42a83ede89879fe7407cc4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447725119000',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:26Z',
  'outbound-api',
  'SM6cfed9643be16b156498d0d5cd5d1ccd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447481948048',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:26Z',
  'outbound-api',
  'SM5faf46d87ae7df844a0fd6eb94a9daa5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447719261701',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:26Z',
  'outbound-api',
  'SM6a7d4d244128ecde309a82d0c619c739'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447793080018',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:25Z',
  'outbound-api',
  'SMf2ee06a7f9c5430a3fb657d35c711228'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447970941030',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:25Z',
  'outbound-api',
  'SM766a8aacd1c5cb5d08b0bc109df23be4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447825304222',
  'If you do want to book, please call or whatsapp us on +441753682707',
  'delivered',
  '2025-02-16T12:14:25Z',
  'outbound-api',
  'SM66ac3d9af53c81370056663b2ddd0135'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447956315214',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:55Z',
  'outbound-api',
  'SM622be68f3ccd26f155f8bd02f0999a38'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447947100347',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:55Z',
  'outbound-api',
  'SM2dbc7d12779169709617a894b227c828'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447926203166',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'undelivered',
  '2025-02-16T12:11:55Z',
  'outbound-api',
  'SMb02b97eb0f197dc9a9ad4cd40e9f726c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447946322633',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:54Z',
  'outbound-api',
  'SM0a86c9d4d4adddfe17fa6c5b3d84b372'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447463726233',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:54Z',
  'outbound-api',
  'SMc01eff51be9a9ce45bccb149fd7b5e48'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447590122208',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:53Z',
  'outbound-api',
  'SM32df36d9c3700181832e15550e4b3a59'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447875767053',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:52Z',
  'outbound-api',
  'SMdf0e0aae28e6990483e4f7d9f8ee9410'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447513520317',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:52Z',
  'outbound-api',
  'SM8510c350a90f79f8a42515b4b0baf860'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447795514533',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:51Z',
  'outbound-api',
  'SM40da9f4ddd8919ea1d1a9893ea1b34da'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447476353024',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:51Z',
  'outbound-api',
  'SM83587fb0ac8c099aa910f9025be15344'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447736641657',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:50Z',
  'outbound-api',
  'SM82ef33550ee067f6659f7e6e615278e8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447843951131',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:50Z',
  'outbound-api',
  'SM08010cd8e534ca2e99ee1923fd810c8b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447597537511',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:49Z',
  'outbound-api',
  'SM647ce27bef653d85b87f492276cbd12d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447985751794',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:49Z',
  'outbound-api',
  'SMa8890004284ca40f8ffce3a599aedbd1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447702746498',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:48Z',
  'outbound-api',
  'SMbd9729c93116c0d387cc2b318c47b290'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447890680950',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:47Z',
  'outbound-api',
  'SM40be2a7fc61c0857ecd9b2066d6aaf33'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447771496954',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:47Z',
  'outbound-api',
  'SM731f7bc6779fa6543744955effd68dd6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447947207494',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:46Z',
  'outbound-api',
  'SM4fd42f8b76d41900e4976a9a9c9ba912'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447946439144',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:46Z',
  'outbound-api',
  'SM234c8b87f567afea26caffa652ce41bd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447725119000',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:45Z',
  'outbound-api',
  'SM0889b9c3cadef5c65923469d3eeb55a4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447481948048',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:45Z',
  'outbound-api',
  'SM376845d8606fc47240eef65372e45a2d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447719261701',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:44Z',
  'outbound-api',
  'SM34480bf38b55629635cb6a4d5055a39c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447793080018',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:43Z',
  'outbound-api',
  'SMcfb33312880cd7394e0c928a795e3430'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447970941030',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:43Z',
  'outbound-api',
  'SM983df295fdfa90fd993fec2982c9af05'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447825304222',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:42Z',
  'outbound-api',
  'SM5a2f20032d194ee98a2bd0e042e6caab'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:11:01Z',
  'outbound-api',
  'SMde0df6ba54ad67104a91dff2e5b3f75c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Nikki''s back at The Anchor this Friday for our Gameshow House Party, featuring Nikki Against Humanity. Let us know if you''d like to book your seat, no need to pay until the night. Tickets are £7.50 this year, just like last year. We can''t wait to see you!',
  'delivered',
  '2025-02-16T12:08:24Z',
  'outbound-api',
  'SMebbfb3c4604b9ae910689f26228c80c3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Peter, your booking for 1 people for our Cash Bingo on February 5 at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-16T11:56:45Z',
  'outbound-api',
  'SM6b4404ed78ade20308742cf0af9e9e95'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447766048813',
  'Hi Chris, just a reminder that our Gameshow House Party is next Friday,Friday,Friday,Friday,Friday,Friday,Friday at 7pm. You have 2 seats booked. If you have an',
  'delivered',
  '2025-02-14T13:10:40Z',
  'outbound-api',
  'SM5532823f29ce1d350740ca15d09f71eb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447985751794',
  'Hi Julie, just a reminder that our Gameshow House Party is next Friday,Friday,Friday,Friday,Friday,Friday,Friday at 7pm. You have 4 seats booked. If you have an',
  'delivered',
  '2025-02-14T13:10:40Z',
  'outbound-api',
  'SMb6ceec3b3670340f7e1cd622576d3cac'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447742116805',
  'Hi Jade, just a reminder that our Gameshow House Party is next Friday,Friday,Friday,Friday,Friday,Friday,Friday at 7pm. You have 3 seats booked. If you have any',
  'delivered',
  '2025-02-14T13:10:40Z',
  'outbound-api',
  'SM75c76569e4bcb78c00cf7109612d1550'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447426675717',
  'Hi Andrew, just a reminder that our Gameshow House Party is next Friday,Friday,Friday,Friday,Friday,Friday,Friday at 7pm. You have 3 seats booked. If you have a',
  'delivered',
  '2025-02-14T13:10:39Z',
  'outbound-api',
  'SMb84191829e96594e2f4cdb6cff02b1b8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447803364853',
  'Hi Lisa, just a reminder that our Gameshow House Party is next Friday,Friday,Friday,Friday,Friday,Friday,Friday at 7pm. You have 2 seats booked. If you have any',
  'delivered',
  '2025-02-14T13:10:38Z',
  'outbound-api',
  'SM11681deea4868df180f4d4b779fe7ebb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Peter, just a reminder that our Gameshow House Party is next Friday,Friday,Friday,Friday,Friday,Friday,Friday at 7pm. You have 1 seats booked. If you have an',
  'delivered',
  '2025-02-14T13:10:36Z',
  'outbound-api',
  'SM1042a94977e0f1a9e5412d83410bbdfe'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447973560612',
  'Hi Caz, just a reminder that our Gameshow House Party is next Friday,Friday,Friday,Friday,Friday,Friday,Friday at 7pm. You have 4 seats booked. If you have any',
  'delivered',
  '2025-02-14T13:10:35Z',
  'outbound-api',
  'SM5117349f188161570599974489db9211'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'It looks like our booking system was on the whiskey last night and sent out a lot of random messages this morning. We apologise and will send the right messages out this afternoon.',
  'delivered',
  '2025-02-14T12:42:05Z',
  'outbound-api',
  'SMd3722c87dfc98960ab38e3f5ba423869'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447742116805',
  'It looks like our booking system was on the whiskey last night and sent out a lot of random messages this morning. We apologise and will send the right messages out this afternoon.',
  'delivered',
  '2025-02-14T12:42:04Z',
  'outbound-api',
  'SM52c2ff9470e31240896fe7d02021d37b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447803364853',
  'It looks like our booking system was on the whiskey last night and sent out a lot of random messages this morning. We apologise and will send the right messages out this afternoon.',
  'delivered',
  '2025-02-14T12:42:04Z',
  'outbound-api',
  'SM725b5ba7b4b43f885f581c7b81e3470d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447426675717',
  'It looks like our booking system was on the whiskey last night and sent out a lot of random messages this morning. We apologise and will send the right messages out this afternoon.',
  'delivered',
  '2025-02-14T12:42:04Z',
  'outbound-api',
  'SMf38874b54f22cc089896541475683183'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447973560612',
  'It looks like our booking system was on the whiskey last night and sent out a lot of random messages this morning. We apologise and will send the right messages out this afternoon.',
  'delivered',
  '2025-02-14T12:42:03Z',
  'outbound-api',
  'SMd7ad02936993db9817320e3e13bff97c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447766048813',
  'It looks like our booking system was on the whiskey last night and sent out a lot of random messages this morning. We apologise and will send the right messages out this afternoon.',
  'delivered',
  '2025-02-14T12:42:03Z',
  'outbound-api',
  'SM12f3a55c0b10e2b18d4c855fc6890ae4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447985751794',
  'It looks like our booking system was on the whiskey last night and sent out a lot of random messages this morning. We apologise and will send the right messages out this afternoon.',
  'delivered',
  '2025-02-14T12:42:03Z',
  'outbound-api',
  'SM35571d5e92b8ad63ece72dae265e6376'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'It looks like our booking system was on the whiskey last night and sent out a lot of random messages this morning. We apologise and will send the right messages out this afternoon.',
  'delivered',
  '2025-02-14T12:41:37Z',
  'outbound-api',
  'SM0f08a748cd4c88ee2a95c21314737296'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:01:00Z',
  'outbound-api',
  'SMe91dfeba61e628c5029738106210b9eb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447426675717',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:01:00Z',
  'outbound-api',
  'SM40a3a38865325e10c9b68514dd568bab'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447766048813',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:01:00Z',
  'outbound-api',
  'SM3653076ac066bc94b243b18fd1aebebb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447742116805',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:01:00Z',
  'outbound-api',
  'SMaf867448239282a07f7fb66f51f3c6f7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447803364853',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:01:00Z',
  'outbound-api',
  'SM2672cb837f434861270f9f8a43b99ae9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447985751794',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:01:00Z',
  'outbound-api',
  'SMd2e593f321d53cedec582630bd25bb6d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447973560612',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:01:00Z',
  'outbound-api',
  'SM09caf59a69aed25c4bc9129dec03bbe4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447985751794',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:58Z',
  'outbound-api',
  'SM2f6c168d7bc5829b565527a86b5d3e14'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447426675717',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:58Z',
  'outbound-api',
  'SMb68bbcfe1be00d4c2f4999bdcdf0edd8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447766048813',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:58Z',
  'outbound-api',
  'SMb165636b80a7df1263a19029d1c3c69a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447973560612',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:58Z',
  'outbound-api',
  'SM1a70a426c950252bbadc8c06a0bd8148'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447803364853',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:58Z',
  'outbound-api',
  'SM1b08a228a45fee0057dfc5c015bedb53'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447742116805',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:58Z',
  'outbound-api',
  'SM8f698ac2dd4c6502c4eb83d9ba1fba2c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:58Z',
  'outbound-api',
  'SM6cc7d26c0cb076462b776e1a9b124397'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447803364853',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:55Z',
  'outbound-api',
  'SM075db3aa9f05c0282afa030e2abe890b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447742116805',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:55Z',
  'outbound-api',
  'SM18c1b476e254a15999c0977dce351c23'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447426675717',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:55Z',
  'outbound-api',
  'SM3ad550988e592ae0b3e840ab38450741'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447985751794',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:55Z',
  'outbound-api',
  'SM862c9680d51dc222c7dbb3c0b76badef'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447973560612',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:55Z',
  'outbound-api',
  'SM8a959d73486ce3479eb02ea23fded39f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:55Z',
  'outbound-api',
  'SM841194aaea0b0399c815eaf938c885a1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447766048813',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:54Z',
  'outbound-api',
  'SM9c1e62ada73b1c0e968b55a6f9ec5670'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447973560612',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:53Z',
  'outbound-api',
  'SM2194a504193b073b5bb2c18ed4ca1bd9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447742116805',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:53Z',
  'outbound-api',
  'SM7b60be54db1d09c886782c27d05cb69b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447426675717',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:53Z',
  'outbound-api',
  'SM820b1dbe64eeac2c5bbee21b1911d6d1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447985751794',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:53Z',
  'outbound-api',
  'SM9b5eabb8e9f1f43f45731a3eabaa7705'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:53Z',
  'outbound-api',
  'SM7564c21792a57d7f143281387e7dec2d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447766048813',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:53Z',
  'outbound-api',
  'SMfe40ffd3a63b2d36cc4b8f6d8e4cf060'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447803364853',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:53Z',
  'outbound-api',
  'SM024457630be9f8b2e70243267234a7f8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447985751794',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:52Z',
  'outbound-api',
  'SM40530b8efb0cd9b8dd51b3a13f4f5b16'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447766048813',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:52Z',
  'outbound-api',
  'SMa0ac824a6ae0bc94fab9464f0a4161a6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447426675717',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:52Z',
  'outbound-api',
  'SMf678c304b2f98e691419752cfec6dfcf'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447973560612',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:52Z',
  'outbound-api',
  'SM64a317b2b54071abc9c5c6b90c5dc7fd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447803364853',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:52Z',
  'outbound-api',
  'SMb5556dd98fad4f7b554675f2223f9e63'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447742116805',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:52Z',
  'outbound-api',
  'SM1c87935fe5aa1fc6e2e8fc69029fc458'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:52Z',
  'outbound-api',
  'SM77cd1e7a945355b3101006c92bb28a0d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447973560612',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:51Z',
  'outbound-api',
  'SM5c3ca041a675e49224718ba03219803f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447985751794',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:51Z',
  'outbound-api',
  'SMc114982de9a08cb8e72ee977790704db'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:51Z',
  'outbound-api',
  'SMf69b8acf5456d689ac5ab265d4555c9b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447426675717',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:51Z',
  'outbound-api',
  'SMd3fbde890ce7069a51c1f9ab27ac6eeb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447742116805',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:51Z',
  'outbound-api',
  'SM4aa196a0af2e04664839fcf78ac32d1d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447803364853',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:51Z',
  'outbound-api',
  'SMa02bf10b7837b1ece6bce77b68d474c3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447766048813',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:51Z',
  'outbound-api',
  'SM2afab012d95b5520a35ee92d26b0e394'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447742116805',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:51Z',
  'outbound-api',
  'SMc46edff22146a8c8fbe39102d5972d82'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447426675717',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:50Z',
  'outbound-api',
  'SMb3482f2bc907cadc15ce32732343b598'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447766048813',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:50Z',
  'outbound-api',
  'SMaae24e6ed1a5272c7f0d977ecaff7b85'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447973560612',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:50Z',
  'outbound-api',
  'SMf0c3aa8b49b48f3268c56ce6a6d8d56e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:50Z',
  'outbound-api',
  'SMab52d5f7a40efbc1e9e4358ccc4f7c4f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447985751794',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:50Z',
  'outbound-api',
  'SM2b90b491c73bb9be7cb4f175b051cdc0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447803364853',
  'Hi Caz,Lisa,Peter,Andrew,Jade,Chris,Julie, just a reminder that our Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow House Party,Gameshow',
  'delivered',
  '2025-02-14T09:00:50Z',
  'outbound-api',
  'SM6073488e556beeeff49d64e8c25133e4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447912859484',
  'Hi Katie, your booking for 6 people for our Cash Bingo on February 5 at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-14T07:54:43Z',
  'outbound-api',
  'SMaad0fde06f8f202b8a801798e44d829b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Peter, your booking for 1 people for our Gameshow House Party on February 5 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 017',
  'delivered',
  '2025-02-13T15:43:14Z',
  'outbound-api',
  'SMbc0ee58d827b06e66c4ad1a09ae8ae73'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447920486907',
  'Hi Karen, your booking for 6 people for our Cash Bingo on February 5 at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-10T16:03:37Z',
  'outbound-api',
  'SMdfe3ca680e85517c957d53ce60be683a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447973560612',
  'Hi Caz, your booking for 4 people for our Cash Bingo on February 5 at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-10T16:02:47Z',
  'outbound-api',
  'SMab7888f27f489b08c9ccd5c1bf8ac159'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447803364853',
  'Hi Lisa, your booking for 2 people for our Cash Bingo on February 5 at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-10T16:02:46Z',
  'outbound-api',
  'SM240f28f762048f0f10e54d803b33946f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447426675717',
  'Hi Andrew, your booking for 3 people for our Cash Bingo on February 5 at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-10T16:02:45Z',
  'outbound-api',
  'SM5552f823d37ccb332b3d1691a4852767'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447985751794',
  'Hi Julie, your booking for 4 people for our Cash Bingo on February 5 at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-10T16:01:54Z',
  'outbound-api',
  'SMb1fa1f9e473744953781cbf9bbfae0ef'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447513520317',
  'Hi Pike, your booking for 3 people for our Cash Bingo on February 5 at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-10T16:01:52Z',
  'outbound-api',
  'SM339f7f304dead4986fc9b9bb8b66aabc'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447742116805',
  'Hi Jade, your booking for 3 people for our Gameshow House Party on February 5 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 0175',
  'delivered',
  '2025-02-10T16:00:59Z',
  'outbound-api',
  'SM3291af596ab635b8607b27bcdd0eacad'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447803364853',
  'Hi Lisa, your booking for 2 people for our Gameshow House Party on February 5 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 0175',
  'delivered',
  '2025-02-10T15:58:51Z',
  'outbound-api',
  'SMcaa493908327f24bc4680b3a07cf92c0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447426675717',
  'Hi Andrew, your booking for 3 people for our Gameshow House Party on February 5 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01',
  'delivered',
  '2025-02-10T15:57:52Z',
  'outbound-api',
  'SM15eb91dc7739b5576aacb15b8d48ffa2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447973560612',
  'Hi Caz, your booking for 4 people for our Gameshow House Party on February 5 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753',
  'delivered',
  '2025-02-10T15:56:52Z',
  'outbound-api',
  'SM5f3aaf7acccf4d56f41595360f5f20d6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447766048813',
  'Hi Chris, your booking for 2 people for our Gameshow House Party on February 5 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 017',
  'delivered',
  '2025-02-10T15:55:48Z',
  'outbound-api',
  'SM37420c6c1ee1d08b776e00743c4ed271'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447985751794',
  'Hi Julie, your booking for 4 people for our Gameshow House Party on February 5 at 7pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 017',
  'delivered',
  '2025-02-10T15:53:58Z',
  'outbound-api',
  'SM7e99e47bc8c45d8d211118114fffd511'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Peter, your booking for 2 people for our Cash Bingo on February 5 at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-10T15:47:28Z',
  'outbound-api',
  'SM22a6539426188df2a7f5d42521a8dce8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Peter, your booking for 2 people for our Cash Bingo on February 5 at 6pm is confirmed! See you then. If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-10T15:45:32Z',
  'outbound-api',
  'SM83da5ddcc4a18b9d44a534e1c967ddd2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor, Stanwell Moor Village',
  '+447990587315',
  'Hi Peter, your booking for 2 people for our Cash Bingo on February 5 at 6pm is confirmed! See you then.  If you''ve got any questions, WhatsApp/Call 01753682707',
  'failed',
  '2025-02-10T15:42:28Z',
  'outbound-api',
  'SM8270c6bc2b170c2610d05230ea7c4288'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Peter, your booking for 2 people for our Cash Bingo on February 5 at 6pm is confirmed! See you then.  If you''ve got any questions, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-10T15:41:27Z',
  'outbound-api',
  'SMf15a5d4686e5c1dee7fbc4229be86c87'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447956315214',
  'Hi Billy, your booking for 5 people for our Gameshow House Party on February 2 at 7pm is confirmed! See you then. Questions? WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-10T15:38:27Z',
  'outbound-api',
  'SMc73d97634c0f059a90031f022e13453b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Peter, just a reminder that our Gameshow House Party is tomorrow at 7pm and you have 5 seats booked. If you''ve got any question, WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-10T15:16:34Z',
  'outbound-api',
  'SM2c5eb34ccd79ec97d5e837748283832c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447956315214',
  'Hi Billy, your booking for people for our Gameshow House Party on February 5 at 7pm is confirmed! See you then. Questions? WhatsApp/Call 01753682707',
  'delivered',
  '2025-02-10T14:56:05Z',
  'outbound-api',
  'SM09996aef9c49db32576454934333dd3d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Peter, just a reminder that our Gameshow is tomorrow at 7pm. See you there! Questions? WhatsApp/Call 01753682707 – The Anchor',
  'delivered',
  '2025-02-10T14:27:06Z',
  'outbound-api',
  'SM77798a7622745976e4c2b2fe6cbe9755'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Peter, just a reminder that our Gameshow is tomorrow at . See you there! Questions? WhatsApp/Call 01753682707 – The Anchor',
  'delivered',
  '2025-02-10T14:26:02Z',
  'outbound-api',
  'SMa34addec9f63500b75abea3c9537827d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447956315214',
  'Hi Billy, you’re booked for our Cash Bingo next Monday! We can’t wait to see you. Any questions, WhatsApp/Call 01753682707 – The Anchor',
  'delivered',
  '2025-02-10T13:58:57Z',
  'outbound-api',
  'SM2489c370b134b349aa6179b1a261f729'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Peter, you’re booked for our Gameshow next Monday! We can’t wait to see you. Questions? WhatsApp/Call 01753682707. – The Anchor',
  'delivered',
  '2025-02-10T13:52:58Z',
  'outbound-api',
  'SMc33a00a43e32e384fa49255593e9f8fb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Peter, our Gameshow is in 7 days on February 17! Any questions? WhatsApp/Call 01753682707. – The Anchor',
  'delivered',
  '2025-02-10T13:49:16Z',
  'outbound-api',
  'SMc3dce7593e3a0a91232b969292084d95'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Hi Peter, our Gameshow is in 7 days on February 17. We can’t wait to see you!',
  'delivered',
  '2025-02-10T13:46:09Z',
  'outbound-api',
  'SMca9602dccacf9df8cb9a28cc26b00821'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Test',
  'delivered',
  '2025-02-10T13:37:59Z',
  'outbound-api',
  'SMd7d08e2f347e81b732a25f2b41613f0a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447713638531',
  'Hi Paul, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-02-09T19:00:05Z',
  'outbound-api',
  'SM467a883b5d3ed1aa8a06dc6d23ffe516'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447713638531',
  'Hi Paul, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-02-09T13:01:05Z',
  'outbound-api',
  'SM998f0ddee377fe9c7b0d69f8d037d28c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi Peter! your booking on 21/02/2025 19:00 for Gameshow House Party (February 21st) is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707',
  'delivered',
  '2025-02-09T12:32:50Z',
  'outbound-api',
  'SM75b3831328bc82b17e19e4dfe738d4be'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, your booking on 21/02/2025 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-02-09T12:25:42Z',
  'outbound-api',
  'SM17dbd459f2dca919ed4a362d06739133'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447713638531',
  'Hi Paul, your booking on 09/02/2025 13:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-02-09T12:22:58Z',
  'outbound-api',
  'SM89986831854c0d840a6a7e3bdec1b172'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Test',
  'delivered',
  '2025-02-09T11:31:50Z',
  'outbound-api',
  'SM95304fbfa9a0981db3235fd65fec18bb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+447990587315',
  'Test',
  'undelivered',
  '2025-02-09T11:29:56Z',
  'outbound-api',
  'SMb337ea4487f91712d9cda9e96c8bb47f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'The Anchor',
  '+07990587315',
  'Test',
  'failed',
  '2025-02-09T11:29:10Z',
  'outbound-api',
  'SM6ecaafdb4e619070966b28b9721ce4c1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  'whatsapp:+441753682707',
  'whatsapp:+14155238886',
  'join thou-vertical',
  'received',
  '2025-02-08T19:39:02Z',
  'inbound',
  'SMb48d6bbd4a7ed621682865113702d64a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447803364853',
  'Hi Lisa Stevens, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-02-07T23:00:05Z',
  'outbound-api',
  'SM8d83eb20a025deb761bc46df6a605bab'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447803364853',
  'Hi Lisa Stevens, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-02-06T18:01:05Z',
  'outbound-api',
  'SMef1afbf9bab6ccb8f45705b182906604'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-02-06T00:00:06Z',
  'outbound-api',
  'SM71dcd25b3c063ba0b62ca63fae127b34'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447425941854',
  'Hi Holly, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-02-06T00:00:05Z',
  'outbound-api',
  'SMa6ea5fbf708959d372737911674da5c7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-02-06T00:00:05Z',
  'outbound-api',
  'SMc1db9a1d4fabda48437ec8a2681d30b7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-02-06T00:00:05Z',
  'outbound-api',
  'SM407c9b7e9df57b1256013062f2c3b314'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447807536363',
  'Hi Cliff King, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-02-04T23:00:05Z',
  'outbound-api',
  'SM334bf5b031e2d26a3f1bd7dc717f01b2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-02-04T19:01:06Z',
  'outbound-api',
  'SM8c816ab8d9e85b11233608f106f77c6d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447425941854',
  'Hi Holly, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-02-04T19:01:05Z',
  'outbound-api',
  'SM59509966da069f503774f22cb27169b9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-02-04T19:01:05Z',
  'outbound-api',
  'SM0c324191fc0ed32c13e127adcdbe78c5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-02-04T19:01:05Z',
  'outbound-api',
  'SM8475ba8a250bab9cf943694fe9dcb9ed'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447807536363',
  'Hi Cliff King, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-02-04T18:01:04Z',
  'outbound-api',
  'SMf3a35ed5eb0f13e84c852521fc91d5d8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447807536363',
  'Hi Cliff King, your booking on 04/02/2025 18:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-02-04T17:22:21Z',
  'outbound-api',
  'SM6315b75d8c7e3d4537229ba605e425a1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447807536363',
  'Hi Cliff King, we got your booking at The Anchor! We''ll notify you once reviewed. Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-02-04T17:20:30Z',
  'outbound-api',
  'SMa4cec6e493a2c941332be83ef5dd6331'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447513818877',
  'Hi Claire, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-02-02T21:00:05Z',
  'outbound-api',
  'SM5e4252f822b70261a7afcb46b9193d6c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447513818877',
  'Hi Claire, your booking on 02/02/2025 15:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-02-02T15:10:39Z',
  'outbound-api',
  'SMfe47bd6ccaf62dac7db7692cbfd79757'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447912859484',
  'Hi Katie Fowles, your booking on 28/02/2025 12:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-01-29T12:07:54Z',
  'outbound-api',
  'SM823c62624b2c0485b01dcb81c731cdfc'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447803364853',
  'Hi Lisa Stevens, your booking on 07/02/2025 18:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-01-28T12:57:24Z',
  'outbound-api',
  'SMfc3fe31c6cc5f42e969a251c6abc87b9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447803364853',
  'Hi Lisa Stevens, we got your booking at The Anchor! We''ll notify you once reviewed. Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-01-28T11:04:27Z',
  'outbound-api',
  'SM2cdb0566340a1db9c2ede68e04f0a7f3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+15163820734',
  'Hi Christy, your booking on 16/05/2025 18:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'failed',
  '2025-01-28T06:50:11Z',
  'outbound-api',
  'SM81ee4ec7884f7c965d57c2a1cc3caa3b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+15163820734',
  'Hi Christy, your booking on 16/05/2025 18:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'failed',
  '2025-01-28T06:49:55Z',
  'outbound-api',
  'SMaf7d3bdd0ab49509d63520d8fccf7b6d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+15163820734',
  'Hi Christy, we got your booking at The Anchor! We''ll notify you once reviewed. Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'failed',
  '2025-01-27T22:44:14Z',
  'outbound-api',
  'SM7639986e488831e8d6d248a96117d0a4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447425941854',
  'Hi Holly, your booking on 05/02/2025 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-01-17T18:36:47Z',
  'outbound-api',
  'SM31285b7c0ed2e1bf33c912e2b9c2d86e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447974650489',
  'Hi Simon, we got your booking at The Anchor! We''ll notify you once reviewed. Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-01-16T16:51:36Z',
  'outbound-api',
  'SM8761eb03d10161322764933b53f4d8a0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, your booking on 05/02/2025 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-01-12T20:20:34Z',
  'outbound-api',
  'SMc01622fe97b572a450674ee5c3a07ea3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, your booking on 05/02/2025 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2025-01-11T14:24:06Z',
  'outbound-api',
  'SMb016889886a4c20767e1f0e5ec9f3edb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447813802011',
  'Hi Jon Heather, we got your booking at The Anchor! We''ll notify you once reviewed. Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'undelivered',
  '2025-01-09T11:14:15Z',
  'outbound-api',
  'SMce81512e7a5e51bb3443cf6e0e51d563'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447889855937',
  'Hi Charlie, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-24T23:00:05Z',
  'outbound-api',
  'SM45507222a242e6c35de7f6cb55bea273'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447889855937',
  'Hi Charlie, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-23T18:01:05Z',
  'outbound-api',
  'SMe924322125819344b5a819b50c561d24'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447736641657',
  'Hi lorraine, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-19T00:00:06Z',
  'outbound-api',
  'SMc56411040efc6bbcd155a2b5b3071813'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-19T00:00:06Z',
  'outbound-api',
  'SM6a26b1c6aa713247a6092db743153ce7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946322633',
  'Hi Shane Palmer, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-19T00:00:05Z',
  'outbound-api',
  'SM843d7b47feb1b091c1ff8eec9627cdea'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447968042989',
  'Hi leanne, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-18T22:00:05Z',
  'outbound-api',
  'SM08afa503edf157da8e883c937b3fc4a8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447736641657',
  'Hi lorraine, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-17T19:01:06Z',
  'outbound-api',
  'SM9a4502dd8a2420de74dec18b02682ee7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-17T19:01:05Z',
  'outbound-api',
  'SM0668ee4aa93a2bf2347907d8fecbd338'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946322633',
  'Hi Shane Palmer, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-17T19:01:05Z',
  'outbound-api',
  'SMe5279783f44bee0d60318ec1a2b52825'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447968042989',
  'Hi leanne, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-17T18:01:05Z',
  'outbound-api',
  'SM23c4eca9165ff9b7845831d39153d258'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447968042989',
  'Hi leanne, your booking on 18/12/2024 17:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-17T17:03:30Z',
  'outbound-api',
  'SMe5fd1fc2fe965cbca824266fccc237c9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447736641657',
  'Hi lorraine, your booking on 18/12/2024 18:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-17T16:57:55Z',
  'outbound-api',
  'SMdc7d4e97dd05b14e6e6baa47ee164de9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946322633',
  'Hi Shane Palmer, your booking on 18/12/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-16T20:04:33Z',
  'outbound-api',
  'SMfa9b2ce54c27c1143435c2be6c5d9d34'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-14T00:00:05Z',
  'outbound-api',
  'SMedca537677da6ad8d5f065e48ea6e5b6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-12T19:01:04Z',
  'outbound-api',
  'SMe9cdb3caa494c2f81a03d5df61d88545'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2024-12-12T10:08:09Z',
  'outbound-reply',
  'SM0acbd86c00c38e35d2d379255f088b25'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447940220875',
  '+447700106752',
  'I haven''t got an account but I''ll leave one on fb. Cheers x',
  'received',
  '2024-12-12T10:08:09Z',
  'inbound',
  'SMdf498ee8a49c95f50571a49d17847bda'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-12T00:00:06Z',
  'outbound-api',
  'SMeb213c6f72abd41295f2b67571a432a1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-12T00:00:05Z',
  'outbound-api',
  'SM59dc8fd627d2e292ca6982a5e98b0df1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-12T00:00:05Z',
  'outbound-api',
  'SMd93ebf24642a040c6d93ad5355507c8c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447824774535',
  'Hi Carol Bagnall, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-12T00:00:05Z',
  'outbound-api',
  'SM5b2e5dbce1ca0cfc2eba6b7e67a17810'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2024-12-11T22:19:21Z',
  'outbound-reply',
  'SM9ed3183d91a741d2e62bd266880554d7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447973560612',
  '+447700106752',
  '👍',
  'received',
  '2024-12-11T22:19:21Z',
  'inbound',
  'SM2fd8e87ba7aa8bcb2d9ca4a1b19bd0e2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, your booking on 05/02/2025 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-11T21:41:17Z',
  'outbound-api',
  'SM0f52aec7941d89df61ff6f7003ed77b9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447824774535',
  'Hi Carol Bagnall, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-11T17:01:04Z',
  'outbound-api',
  'SM10b1298f3412f08d9fff311c78176f7d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447824774535',
  'Hi Carol Bagnall, your booking on 11/12/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-11T16:50:58Z',
  'outbound-api',
  'SMfb4570519c1ac47b698f17b4271bd8e9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-10T19:01:06Z',
  'outbound-api',
  'SM7eed82ab53f90945bd306c17091b96be'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-10T19:01:05Z',
  'outbound-api',
  'SM7f168e50dabe60296967f734928298a5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-10T19:01:05Z',
  'outbound-api',
  'SMa98e5f7b0f0056431cbdbcdc5105f90b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447889855937',
  'Hi Charlie, your booking on 24/12/2024 18:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-12-05T16:31:22Z',
  'outbound-api',
  'SMdd1e4b58935eae274eb30f4f218f926e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Rob, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-28T01:00:06Z',
  'outbound-api',
  'SMfb8ebbeb4ce87487c8d3cd55e57bc888'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946322633',
  'Hi Shane Palmer, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-28T01:00:05Z',
  'outbound-api',
  'SMeb5573bd286e32ec0af4189eb1267e15'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447968024989',
  'Hi Leanne, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-28T01:00:05Z',
  'outbound-api',
  'SMdd4d4fe1709f256d08ecb4815878adac'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, your booking on 18/12/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-27T13:47:22Z',
  'outbound-api',
  'SM0afb1b1aeeec6f8b55903cea88632940'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, your booking on 18/12/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-27T13:44:22Z',
  'outbound-api',
  'SMac9e5f0f521c8d0b66a8c24c2445b4e3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2024-11-26T20:07:26Z',
  'outbound-reply',
  'SM9a60f65b1ebdc5c213ce3871daf263fe'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447873284453',
  '+447700106752',
  'See you tomorrow guys unfortunately none of us can make the winter warmer drinks on 13th Dec due to family commitments',
  'received',
  '2024-11-26T20:07:26Z',
  'inbound',
  'SMa3c2e47babae45459e9fc6fbb4cb9257'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Rob, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-26T20:01:06Z',
  'outbound-api',
  'SM1f0d18caf286bf27362b0b29293672f5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946322633',
  'Hi Shane Palmer, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-26T20:01:05Z',
  'outbound-api',
  'SMb495c87bbf1a99097bfee5ee61d759ea'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447968024989',
  'Hi Leanne, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-26T20:01:05Z',
  'outbound-api',
  'SM892b24bfb98f882f8bbff6800c0af4a0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2024-11-26T14:41:11Z',
  'outbound-reply',
  'SMa3da9f12192d38d8fd31d2736f785ec6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447940220875',
  '+447700106752',
  'Thank you x',
  'received',
  '2024-11-26T14:41:11Z',
  'inbound',
  'SM9a84cbce1cd603b4c485a11d64173d32'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi Penny, your booking on 11/12/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-26T14:39:00Z',
  'outbound-api',
  'SM5a832269168637acb27027b474cd72b0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447970941030',
  'Hi Penny/Becky, your booking on 11/12/2024 21:30 at The Anchor has been cancelled. We hope to welcome you another time. Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-26T14:37:46Z',
  'outbound-api',
  'SM58d1389fa48af417951ec301a4e87bf8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2024-11-26T12:18:06Z',
  'outbound-reply',
  'SMabea37cfe67b689e34c762c04d0ea7e1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447940220875',
  '+447700106752',
  'I would like to book a table for the quiz on the 11th Dec. for 6 people, by the front window in the name of Claire or Penny. Thank you. Penny',
  'received',
  '2024-11-26T12:18:06Z',
  'inbound',
  'SM04e6aaff75653784e2059cc10a7bb7e4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447968024989',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2024-11-26T10:43:50Z',
  'outbound-reply',
  'SM9053c4be0710e0bb0962d6a762c6b750'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447968024989',
  '+447700106752',
  'Wrong number',
  'received',
  '2024-11-26T10:43:50Z',
  'inbound',
  'SM565263264e9e89012ba53832948142f2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447968024989',
  'Hi Leanne, your booking on 27/11/2024 19:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-26T10:43:17Z',
  'outbound-api',
  'SMe5a2b1b6881251fb82f7837c490c26d4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2024-11-25T10:03:47Z',
  'outbound-reply',
  'SM70eefc15d01a28051bb641d360cbd96c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447985751794',
  '+447700106752',
  'Hey Nikki gutted we can''t make it as we are away in the sunshine but will definitely be at the next one.',
  'received',
  '2024-11-25T10:03:47Z',
  'inbound',
  'SM6383d5ca67237b36f2070203c0c92a97'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447999348877',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:43Z',
  'outbound-api',
  'SM4822efca986834f61de635ce80b4faa9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985933562',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:43Z',
  'outbound-api',
  'SM96b3000a57e65d4ac86a0881c86efe23'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:42Z',
  'outbound-api',
  'SMeaeb9fe47765a9b881ec9c45bb622a78'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447984282087',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:41Z',
  'outbound-api',
  'SM132609237691126457114ba2d44503b1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447983363278',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:41Z',
  'outbound-api',
  'SMcc6bfd9e0c2ea33c7bd9ec576057c49f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447976043455',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:40Z',
  'outbound-api',
  'SMe713b0706922238a11bbd3a3a5cde3dc'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447974077079',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:39Z',
  'outbound-api',
  'SMa2bf7c1e82a4d2f88e5446e05a7e12ed'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:39Z',
  'outbound-api',
  'SM749237bf271136f8bbdc011b9c4abaeb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447968730441',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:39Z',
  'outbound-api',
  'SM9486ee3dd3dd79d48b24be4859ed427b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447962373977',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:39Z',
  'outbound-api',
  'SM2c3f357737d278fc29de5ef9f7bfeb2d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447961453206',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:38Z',
  'outbound-api',
  'SM306dded33df4accfe8e250aeec4e0b76'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447958360751',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:38Z',
  'outbound-api',
  'SMb8ab45f6aee9b63dab72b00ae56b6d28'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447958269776',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:38Z',
  'outbound-api',
  'SMd013818399287c4785f69fc85dcd6b62'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447957967335',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:37Z',
  'outbound-api',
  'SMbea0b28162c492308267b3ad01fb02cf'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447957909524',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:37Z',
  'outbound-api',
  'SM471201846a6ff7f2c9834215ed29dfe3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447957413180',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:36Z',
  'outbound-api',
  'SMf1aeeada0dc29d9376d034811ae4442f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:36Z',
  'outbound-api',
  'SMf899fe511463b73b4138c8682132f954'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447951159909',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'undelivered',
  '2024-11-25T09:30:35Z',
  'outbound-api',
  'SM246269f050afb201e5e05649b76cc849'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447949465620',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:35Z',
  'outbound-api',
  'SMcaf0f0805805262a90220dd42c26bcd2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447947100347',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:34Z',
  'outbound-api',
  'SM57e7d31aa564223759614b8ac53ad1bf'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946233319',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:34Z',
  'outbound-api',
  'SMc3789eea2689c5b6b9333b7d3378793f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447944777913',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:33Z',
  'outbound-api',
  'SMd7ec4a5fbf2916ec152364e96cec7889'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447941909522',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:33Z',
  'outbound-api',
  'SMecabb78ac0ad9fc07da03fcd67d89465'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447941006017',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:32Z',
  'outbound-api',
  'SM1933239b2c181bd1e92b0d39d32476a2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:31Z',
  'outbound-api',
  'SM9a2ae349f91a7201845dde93731c068a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940148047',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:30Z',
  'outbound-api',
  'SM3e5fdb29848a7459f7d938ce1ee23a97'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447939958957',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:30Z',
  'outbound-api',
  'SM518ef428539c8bb3aa557660683dd703'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447935785513',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:30Z',
  'outbound-api',
  'SM136a38031c37b41eed20b7eba78300f1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447931748959',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:30Z',
  'outbound-api',
  'SM0c6b1b9691e45a46c6f35eb711fc653a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447930933086',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:29Z',
  'outbound-api',
  'SMfb5caaaceae0eb7dbf68f734c2c611a1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447923474998',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:29Z',
  'outbound-api',
  'SM15b168c2d20ede4d5a2e5dccb6749571'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447919542034',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:28Z',
  'outbound-api',
  'SM325f9d9a533ffeeb1b3575ce43871b83'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447912859484',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:27Z',
  'outbound-api',
  'SMab3ed0bbd1249b92d39ae2d9fd741ff6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447907135239',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:27Z',
  'outbound-api',
  'SM70cb9273512394b1f2e17039ab6d4b95'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447903139807',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:26Z',
  'outbound-api',
  'SM1a7745e5ae57bc10bf30cde0aacfbf48'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447902606715',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:26Z',
  'outbound-api',
  'SM0f9ac178a1df1cd833f78748159ca0f6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447891236986',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:25Z',
  'outbound-api',
  'SMaebf245f28b33c7b11ddbca0a58c3bb0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447889679392',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:24Z',
  'outbound-api',
  'SM3bb3504c2f711bc2e538bb332347549b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447889600378',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:23Z',
  'outbound-api',
  'SM8b9af4aa9799cc67de1fb95122ce1b21'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447887688484',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:23Z',
  'outbound-api',
  'SM5c424d37d5c6ba7e23efef9a353d900a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447885647172',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:22Z',
  'outbound-api',
  'SMa53b61a720a09b4da176770c719ed551'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447884238696',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:21Z',
  'outbound-api',
  'SM9ee583b907febc03f104291ebbe541d7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447875767053',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:21Z',
  'outbound-api',
  'SM47dac05548fb78b61629d1108534c9f4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447864322491',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:21Z',
  'outbound-api',
  'SM769c3dc08b6f5c6710e02451326c7396'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447860640494',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:20Z',
  'outbound-api',
  'SM405fe8f96fed5b517314ad917f70970a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447858499686',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:19Z',
  'outbound-api',
  'SM3fa7f759af849dca29eed276c0614533'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447856532364',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:19Z',
  'outbound-api',
  'SM4dcdfa29e7c70e0f84c7f3d358c6a088'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447856053809',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:19Z',
  'outbound-api',
  'SM6545068c8d5a26ea95d74fbd3b9ce773'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447852933804',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:19Z',
  'outbound-api',
  'SMc6aa516594a205fc4c829b5a267a5739'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447851837100',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:18Z',
  'outbound-api',
  'SMb2cc123880c08e5ee16d27272aaf42ff'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447849207743',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:18Z',
  'outbound-api',
  'SM62120a370b8dd5d1f0bb4a5b71ebac8a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447843951131',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:17Z',
  'outbound-api',
  'SM2ffc683ecb5205849214fe0ad1edd837'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447843880939',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:17Z',
  'outbound-api',
  'SM3c0f96dd06bc8dfe325f1986b6d75d02'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447840547761',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:16Z',
  'outbound-api',
  'SM59c458a98169efbf3cb807235f4f4bcf'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447833010800',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:16Z',
  'outbound-api',
  'SMa3268fe8ca074b7cc7a15afadc1d7b06'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447825304222',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:15Z',
  'outbound-api',
  'SM7b3dafe77d2a326ec9ddfee0aa4f5c9b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447825225383',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:15Z',
  'outbound-api',
  'SMfc94c591b6658e259a763126d8fa1197'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447821250145',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:15Z',
  'outbound-api',
  'SM1f8a13fbd659b8378d40e2850adf2ee0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447808029531',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:14Z',
  'outbound-api',
  'SM40bd0adb8a2eea66ae5aa74bbe5d7a90'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447803717949',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:14Z',
  'outbound-api',
  'SMaf2ea0891d8084115d37f46dd99faa96'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447802769253',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:13Z',
  'outbound-api',
  'SM153d4bc1caba90ef693a2165286ecb00'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447800745576',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:13Z',
  'outbound-api',
  'SM3541a8e2081797ad21052ab2513b95f9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447799113581',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:12Z',
  'outbound-api',
  'SMa95319ed0bb17ad1f5782111c3d0d1e0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447795514533',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:12Z',
  'outbound-api',
  'SMf22ab5156ccd1d5618786e31b9dfd70e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:12Z',
  'outbound-api',
  'SMfd9edf705bce3a7a3a7263db9c14c642'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447792253288',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:11Z',
  'outbound-api',
  'SMb09d14878e22752af8212939931ca81f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447792195913',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:11Z',
  'outbound-api',
  'SMad5303a572f089b536d37b6cb3dec560'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447790733670',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:10Z',
  'outbound-api',
  'SMdc11c84d6c957628eaa3857b381afb13'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447788239129',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:10Z',
  'outbound-api',
  'SMff5224fe0443a8a97fb7a051a0286945'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447786392116',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:09Z',
  'outbound-api',
  'SMbefea909c782bbad1330d021ae602413'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447776387754',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:09Z',
  'outbound-api',
  'SM377b9ef450024fb81ceee8eb32ce3680'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447775903610',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:09Z',
  'outbound-api',
  'SM2da06bf5b971700883b667578443ea4a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447762477880',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'failed',
  '2024-11-25T09:30:09Z',
  'outbound-api',
  'SMaa838e853de3b03758edd5e55d10221d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447775446081',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:08Z',
  'outbound-api',
  'SM236a78225fcdc0a3606df49a1a404054'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447773087164',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'undelivered',
  '2024-11-25T09:30:08Z',
  'outbound-api',
  'SM1ffde0f69d4598f02c81473adbeb83d1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447748213214',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:06Z',
  'outbound-api',
  'SM4d81a4a74696bfa59b0749f5e2c08eff'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447747827252',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:06Z',
  'outbound-api',
  'SM8bdcfd32e5fd7653b8290e42580eee11'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447739524181',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:06Z',
  'outbound-api',
  'SMe91aad5bb012d19dea66fb6d5fd60d40'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447725203882',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:05Z',
  'outbound-api',
  'SMc0ccea47a0b8861680f3a998a2630695'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447718577118',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:05Z',
  'outbound-api',
  'SMb00f23f447fba716b16c47989e75ce80'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447704283992',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:05Z',
  'outbound-api',
  'SM2cd1d256c06c889988ec3c239662347a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447597537511',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:04Z',
  'outbound-api',
  'SMededae64af359870d2667eb706b7d4f9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447595345167',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:03Z',
  'outbound-api',
  'SMc9cadc2d1cf1ccc5cdb0dd4b540a95a9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:03Z',
  'outbound-api',
  'SMb5f694557bb9f45646e6f22cff43739a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447570492770',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'sent',
  '2024-11-25T09:30:03Z',
  'outbound-api',
  'SM5884e3c94ea3b68dec4fab786e9164c0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447562235960',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:02Z',
  'outbound-api',
  'SM71d412aabff8c4495449f85383660b90'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447546519071',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:02Z',
  'outbound-api',
  'SM9cbe91729a8ca07d29da25dbc9a8db24'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447516053734',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:01Z',
  'outbound-api',
  'SMf12ddb8ede8accbf9dbd94b08bbf6aa9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447515889622',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'undelivered',
  '2024-11-25T09:30:01Z',
  'outbound-api',
  'SM9cf9c4521fb263392ad317df3286633c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447513520317',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:00Z',
  'outbound-api',
  'SMb7bda94ac3c1dd82dae659c5d9618921'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447510312876',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:30:00Z',
  'outbound-api',
  'SMa532ba37af2df25ed2e7b40154f55e19'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447506868556',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:29:59Z',
  'outbound-api',
  'SM8b84ffe78aeb537b7f398465bd94614c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447502562955',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:29:59Z',
  'outbound-api',
  'SMf5a98d2b361e222f3dae915c8349d476'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447498930215',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:29:58Z',
  'outbound-api',
  'SM52a51d3851b3a695b92d135ad809435b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447490518054',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:29:58Z',
  'outbound-api',
  'SM6b21e96b9f798a974e67b27cfcf9f335'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447484347040',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:29:58Z',
  'outbound-api',
  'SMe75aa7a64e232dd3c014acc32eb43e88'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447481948048',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:29:57Z',
  'outbound-api',
  'SM03fb3ad75d80699fb5d907a2528e6f79'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447477774222',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:29:56Z',
  'outbound-api',
  'SM10f7965b0ee8a44bd82859cf28d7650b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447477565730',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:29:55Z',
  'outbound-api',
  'SM66f58751cd9239cdf4d89a505bb32074'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447471071834',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:29:55Z',
  'outbound-api',
  'SM69a540b9222fd6a05c0fff8be567fa1f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447468575857',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:29:54Z',
  'outbound-api',
  'SM7f0356e5ca5d1ebbc064d8d735f40506'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447456034967',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:29:54Z',
  'outbound-api',
  'SMf89dfa5d04479a896dbaacf4eb0093e4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447446690934',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:29:53Z',
  'outbound-api',
  'SM2c55a7f36251b29a96541d9790cebb0c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447427754319',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'undelivered',
  '2024-11-25T09:29:53Z',
  'outbound-api',
  'SM92539d84d2bda22ef8d25b73c9309032'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447419772158',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:29:52Z',
  'outbound-api',
  'SM8477fee251e0f6ba1a215fe55282419b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447401318888',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:29:52Z',
  'outbound-api',
  'SMa17b8dd8bf80389b9913163c84fcdca5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447393862238',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:29:51Z',
  'outbound-api',
  'SM1c185a5bda6fa3c710fb284f5c2cb2f4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447392338040',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:29:50Z',
  'outbound-api',
  'SMe50911c049ba17e0578636a881092457'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447384797023',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'sent',
  '2024-11-25T09:29:49Z',
  'outbound-api',
  'SMf153afc8fa9a2b31cacf11a6a73d69d5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447305119629',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:29:48Z',
  'outbound-api',
  'SM4914d32d15089d998bda13195f6342aa'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447153682634',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'undelivered',
  '2024-11-25T09:29:48Z',
  'outbound-api',
  'SM248f74a255189cb1597f439bbaa702e7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Hi! Nikki here, hosting The Anchor''s Gameshow House Party this Wed! Tickets £7.50: https://bit.ly/3Z2aljC. Don''t miss Heel of Fortune and more!',
  'delivered',
  '2024-11-25T09:27:18Z',
  'outbound-api',
  'SM6c891733a47325d173ac71fe8f2a563e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946322633',
  'Hi Shane Palmer, your booking on 27/11/2024 19:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-24T21:56:37Z',
  'outbound-api',
  'SM6ce263331d1ebc0616d8812d39425406'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447970941030',
  'Hi Penny/Becky, your booking on 11/12/2024 21:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-24T21:12:34Z',
  'outbound-api',
  'SMe400625af4fdee0b4de0091dc42af673'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946322633',
  'Hi Shane Palmer, your booking on 27/11/2024 19:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-24T21:09:54Z',
  'outbound-api',
  'SM47ac7c54bafa212d0a94c0c4f90d4a26'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447833010800',
  '+447700106752',
  'HELP',
  'received',
  '2024-11-17T12:18:30Z',
  'inbound',
  'SM68d96197b1997e473d3533694efa7f08'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447833010800',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2024-11-17T12:18:00Z',
  'outbound-reply',
  'SMebe298ff67dc5ca7f5315aef2a38795e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447833010800',
  '+447700106752',
  'Any tables free from 1300 for 4 adults and a high chair',
  'received',
  '2024-11-17T12:17:59Z',
  'inbound',
  'SM93e28912f1260c41d0c85ce5ec8857f3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-14T00:00:05Z',
  'outbound-api',
  'SMfba31474ed476c6c2c20dd30f628b2bc'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, your booking on 13/12/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-13T21:33:08Z',
  'outbound-api',
  'SMe95a3959052a65dd154b11911fca7d9d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, your booking on 18/12/2024 21:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-13T21:22:49Z',
  'outbound-api',
  'SMdcee748a5f00fddf4cdffb5ffee6db41'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie, your booking on 11/12/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-13T21:21:58Z',
  'outbound-api',
  'SM8286ce6e140749a86ee6ded1be3a5a33'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, your booking on 11/12/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-13T21:16:20Z',
  'outbound-api',
  'SMfdc97349c18087e8f278073e9022c827'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-13T13:01:05Z',
  'outbound-api',
  'SM2cc76fd320bcbc8aaf3c0b6999a98369'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, your booking on 13/11/2024 18:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-13T12:11:16Z',
  'outbound-api',
  'SM34d04b2da540a0efda7d779e69ba7179'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447811144808',
  'Hi Richie Nixon, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'undelivered',
  '2024-11-10T19:00:05Z',
  'outbound-api',
  'SMff45632b510c9b93bf74fbf900712757'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447811144808',
  'Hi Richie Nixon, your booking on 10/11/2024 13:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'undelivered',
  '2024-11-10T13:40:31Z',
  'outbound-api',
  'SMab05d69d63c2f1bf5bd05519d01d03b9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447817482607',
  'Hi Sarah Hyde, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-09T01:00:06Z',
  'outbound-api',
  'SM080c9f49f3637831ab8480c489e33dda'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447435260037',
  'Hi Marika, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-08T21:01:06Z',
  'outbound-api',
  'SMa8ab68909150550726acf097c4f58fb8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447817482607',
  'Hi Sarah Hyde, your booking on 08/11/2024 19:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-08T19:23:42Z',
  'outbound-api',
  'SMb7941336cc67add12b8f2f6f0434af28'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447817482607',
  'Hi Sarah Hyde, we got your booking at The Anchor! We''ll notify you once reviewed. Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-08T19:11:40Z',
  'outbound-api',
  'SMf4dcc7209290c5d58a9703362ab65bff'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447435260037',
  'Hi Marika, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-06T22:00:07Z',
  'outbound-api',
  'SMa0c2dcb7d95734989845f331d2bbb13e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447547179738',
  'Hi Sonia Panesar, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-06T00:00:06Z',
  'outbound-api',
  'SM1578b30198b11ae3c2eeecaa63821d95'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447547179738',
  'Hi Sonia Panesar, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-04T19:01:07Z',
  'outbound-api',
  'SMf61d4a42b57e386438f5ee62eb333071'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447889845567',
  'Hi ANDREW COXHEAD, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-03T17:00:06Z',
  'outbound-api',
  'SM11566de13caa24b8ae24c08f7046c8b6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447889845567',
  'Hi ANDREW COXHEAD, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-02T12:01:06Z',
  'outbound-api',
  'SM19e9879602b3ba833bec64e8f72b47e3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447761413302',
  'Hi Jo, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-11-01T00:00:06Z',
  'outbound-api',
  'SM9c5dcffb81c91165f71303a28ca949ad'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447761413302',
  'Hi Jo, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-31T19:01:07Z',
  'outbound-api',
  'SM6431beb83292a5e407c6a3b66d68393a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447761413302',
  'Hi Jo, your booking on 31/10/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-31T18:01:27Z',
  'outbound-api',
  'SM0aea448a1a8c0d28754c3e15825129b2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447761413302',
  'Hi Jo, we got your booking at The Anchor! We''ll notify you once reviewed. Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-31T17:04:44Z',
  'outbound-api',
  'SM578a64f8c2cbe90dc70d6e4971d5498b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Rob, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-31T01:00:06Z',
  'outbound-api',
  'SM9819f64a2de7f8238792693ee94b2de1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Julie, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-31T01:00:06Z',
  'outbound-api',
  'SM3dfd7b98553f3d6a33d54abc4d817228'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447719261701',
  'Hi Claire Mack, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-30T20:00:07Z',
  'outbound-api',
  'SMec2b893b549783dfa148d44a14ae035a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447463726233',
  'Hi Sadie, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-29T21:01:06Z',
  'outbound-api',
  'SM040059c4b38e2e7e10702adf94f132b8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447912859484',
  'Hi Katie Fowles, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-29T21:01:06Z',
  'outbound-api',
  'SM6383d3bd3d16e786d40a281b777c1e40'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447912859484',
  'Hi Katie Fowles, your booking on 30/10/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-29T20:05:58Z',
  'outbound-api',
  'SM648c4ee64b1edeb11af0df88da3258e2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447463726233',
  'Hi Sadie, your booking on 30/10/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-29T20:04:43Z',
  'outbound-api',
  'SMae39a76a146cbc64e158fc64bf70f905'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Rob, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-29T20:01:06Z',
  'outbound-api',
  'SM62650d9358e8cd50f21a66f6c0d4487a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Julie, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-29T20:01:06Z',
  'outbound-api',
  'SM057a3fb0ce6de0a583aea0811a3f7609'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447719261701',
  'Hi Claire Mack, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-29T15:01:07Z',
  'outbound-api',
  'SM9809c3731cfbd896dada730ffc61471d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447547179738',
  'Hi Sonia Panesar, your booking on 05/11/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-27T19:20:40Z',
  'outbound-api',
  'SMdf1524e7cf0ef2cb733006f62977d60b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Rob, your booking on 30/10/2024 20:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-27T15:52:03Z',
  'outbound-api',
  'SMbbd8f019a4347644d6a0f63f258b0703'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Julie, your booking on 30/10/2024 20:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-27T15:51:55Z',
  'outbound-api',
  'SM3e61d4da4d42261a272404dbe208f043'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447762477880',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'failed',
  '2024-10-27T15:10:21Z',
  'outbound-api',
  'SM09127357ff5894843e346a9f7c58170a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447748213214',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:19Z',
  'outbound-api',
  'SM334492840870af2fee9da8ca2e3eab94'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447747827252',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:19Z',
  'outbound-api',
  'SMe1aba58b02b3e5b025ffabd089fc6577'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447739524181',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:18Z',
  'outbound-api',
  'SMd139bed0d8c7b19d03547d100a3414a6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447725203882',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:17Z',
  'outbound-api',
  'SM228b82afadadde5ad2869a1fc666f97d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447718577118',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:17Z',
  'outbound-api',
  'SM8bc3626c63f131360bd4fc18730aa590'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447704283992',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:16Z',
  'outbound-api',
  'SM6533c2ab00e6eb97982b70ea8ab0d4de'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447597537511',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:16Z',
  'outbound-api',
  'SMed9cba8b39ce5e3a8a8cf70cf793d35f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447595345167',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:15Z',
  'outbound-api',
  'SM98b9325e44d3c6b4b74493e28595cb96'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:15Z',
  'outbound-api',
  'SM5df50b95a87cc15ad262dd3530d95213'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447570492770',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:14Z',
  'outbound-api',
  'SM4a06a8971ea42327ba4aee312a6ea287'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447562235960',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:13Z',
  'outbound-api',
  'SM4c0783443d6377ad92babe2a837477f7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447546519071',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:13Z',
  'outbound-api',
  'SM2e4092afe258efa2b4789e89ff79c4f9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447516053734',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:12Z',
  'outbound-api',
  'SM1a2277df71cd4eb0c90f1c06651dbf7c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447515889622',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:11Z',
  'outbound-api',
  'SMb9ba22a2e75ef4638ea7fe3d43ad69c1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447513520317',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:10Z',
  'outbound-api',
  'SMb05a3165dd326ec6f40a9be5499a376c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447510312876',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:10Z',
  'outbound-api',
  'SM15e8c9154dc0c61e35e33a34eb289d1c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447506868556',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:10Z',
  'outbound-api',
  'SMc0777e8008664e35b5eb77964595bb20'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447502562955',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:09Z',
  'outbound-api',
  'SM523714528cc0e47977fa641ed5cb9ec9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447498930215',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:09Z',
  'outbound-api',
  'SMf44a1ff12e741e16241c8ab5d96672d6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447490518054',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:08Z',
  'outbound-api',
  'SMdc227f28208d7b6506e698779d56f2e5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447484347040',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:08Z',
  'outbound-api',
  'SM41c2ada1ec867e24e204469fa5503272'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447481948048',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:07Z',
  'outbound-api',
  'SMe502edfc50a0f6587ad368d86e90f48d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447477774222',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:06Z',
  'outbound-api',
  'SMf7cba43cfb77ed95137d1e0d8cac4200'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447477565730',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:06Z',
  'outbound-api',
  'SM90f45a349bc14c39c458f463d05e6772'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447471071834',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:04Z',
  'outbound-api',
  'SMfc9615790d9212ee81ee7986f1216d25'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447468575857',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:04Z',
  'outbound-api',
  'SMec09b0a6b71a89170061d1f3655101cc'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447456034967',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:03Z',
  'outbound-api',
  'SM5fe27312995f0c251a413798806212d2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447446690934',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:02Z',
  'outbound-api',
  'SM8b2e21b3693b2040beb51a216144ad3e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447427754319',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'undelivered',
  '2024-10-27T15:10:02Z',
  'outbound-api',
  'SM5c20f8c4f03e29666f620cd23a08e943'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447419772158',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:01Z',
  'outbound-api',
  'SMf36bb4defbc9c1125dd90d46cde62490'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447401318888',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:10:00Z',
  'outbound-api',
  'SM38c48f6547dcead7299ba08f9fd2e8ce'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447393862238',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:09:59Z',
  'outbound-api',
  'SM6c874c7fbb0b91405a819876d9ef193b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447392338040',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:09:58Z',
  'outbound-api',
  'SMd67dee8255d97ba2a5ac2af1a28ee395'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447384797023',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'undelivered',
  '2024-10-27T15:09:57Z',
  'outbound-api',
  'SM68ee171416483301880023f8f69d9ca4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447305119629',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:09:57Z',
  'outbound-api',
  'SM8029626fa6c5cc2f10184070207e1793'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447153682634',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'undelivered',
  '2024-10-27T15:09:56Z',
  'outbound-api',
  'SMc1e257261104f9a18b9f8a2dd3085a54'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Gameshow at The Anchor Snatch Phrase Wed 30 Oct 730pm Drag Bingo Cards Right Tix £7.50 £1 off w/code manfadgefanclub Buy now https://bit.ly/47NtFUO',
  'delivered',
  '2024-10-27T15:07:17Z',
  'outbound-api',
  'SM2b3b016107c9af2bb4ffa2f72ddcc8fa'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Gameshow at The Anchor Snatch Phrase this Wednesday 30 Oct 7:30pm Drag Bingo Cards Right Tickets £7.50 use code manfadgefanclub for £1 off',
  'delivered',
  '2024-10-27T15:05:41Z',
  'outbound-api',
  'SM29e1446d116de006350d3a77140e8d0f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Join our Gameshow House Party at The Anchor Snatch Phrase edition Wed 30 Oct 730pm Drag Bingo Play Your Cards Right and more Tickets 750 use code manfadgefanclub for 1 off',
  'delivered',
  '2024-10-27T15:03:48Z',
  'outbound-api',
  'SM2c40c0d0bb3a100e9b6601d474817a3d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Join our Gameshow Party at The Anchor! Snatch Phrase, Drag Bingo & more, Wed 30 Oct, 7:30pm. Tix £7.50—£1 off w/ code manfadgefanclub!',
  'delivered',
  '2024-10-27T15:02:10Z',
  'outbound-api',
  'SMd0939f9a9904244441c902dad7875fc8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Gameshow House Party at The Anchor! Snatch Phrase edition this Wed, 30 Oct, 7:30pm. Drag Bingo, Cards Right & more! Tix £7.50—£1 off w/ code manfadgefanclub!',
  'delivered',
  '2024-10-27T15:01:22Z',
  'outbound-api',
  'SMacc058d5794e1945e85200c0a6e859f5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Gameshow House Party at The Anchor: Snatch Phrase! Wed 30 Oct, 7:30pm. Drag Bingo, Play Your Cards Right & more! Tix £7.50—get £1 off with code manfadgefanclub!',
  'delivered',
  '2024-10-27T15:00:19Z',
  'outbound-api',
  'SMb3b58a6de527f815be5fcbf7b5ec54c2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Gameshow House Party: Snatch Phrase! Wed 30 Oct, 7:30pm. Drag Bingo & more! Tix £7.50, £1 off with code manfadgefanclub! The Anchor, Stanwell Moor.',
  'delivered',
  '2024-10-27T14:58:29Z',
  'outbound-api',
  'SM64ef3ab2fe2c09e6e87571c35b684ae6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Gameshow House Party: Snatch Phrase Edition! Wed 30 Oct, 7:30 pm. Join us for Drag Bingo, Play Your Cards Right & more. Tickets £7.50—get £1 off with code manfadgefanclub! The Anchor, Stanwell Moor.',
  'delivered',
  '2024-10-27T14:57:26Z',
  'outbound-api',
  'SMe705bc630c46ecd2d2ab8842da6c9da3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Get ready for our Gameshow House Party: Snatch Phrase Edition! This Wednesday, 30 Oct at 7:30 pm—join us for Drag Bingo, Play Your Cards Right & more. Tickets are £7.50—grab yours early with £1 off using code manfadgefanclub! The Anchor, Stanwell Moor.',
  'delivered',
  '2024-10-27T14:55:54Z',
  'outbound-api',
  'SMf813b2e499568213207d0931502299db'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447889845567',
  'Hi ANDREW COXHEAD, your booking on 03/11/2024 12:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-26T18:19:12+01:00',
  'outbound-api',
  'SM92dcee04364d16d0c41a1cfba6a4117b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447889845567',
  'Hi ANDREW COXHEAD, we got your booking at The Anchor! We''ll notify you once reviewed. Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-26T18:18:04+01:00',
  'outbound-api',
  'SM417cd878b4180c756a2beebcae1af21e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Pav and Rupi, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-19T00:00:08+01:00',
  'outbound-api',
  'SM3048dd23cf306cfb8b241be1e40a9425'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447843951131',
  'Hi Lance, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-19T00:00:08+01:00',
  'outbound-api',
  'SM45c077caea45f676c04f0c1015108ec3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447912859484',
  'Hi Katie Fowles, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-19T00:00:07+01:00',
  'outbound-api',
  'SM9ba72f9def2d96c1f2e0ddb48b6cc133'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946754476',
  'Hi Nish and Alan, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-19T00:00:07+01:00',
  'outbound-api',
  'SMb5cd07070fd4f86105db8e07ad2dde13'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Pav and Rupi, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-17T19:00:08+01:00',
  'outbound-api',
  'SM6fa867919bf549ff11ceeac1dc0ba86b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447843951131',
  'Hi Lance, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-17T19:00:08+01:00',
  'outbound-api',
  'SMf87b484d14b4ba0b74d2bf03d69c340b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447912859484',
  'Hi Katie Fowles, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-17T19:00:07+01:00',
  'outbound-api',
  'SM1bdd160227b75c2f3acb309db0382d51'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946754476',
  'Hi Nish and Alan, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-17T19:00:06+01:00',
  'outbound-api',
  'SM72e2b2384ec885160b6cc325d84e5231'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447843951131',
  'Hi Lance, your booking on 18/10/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-06T18:52:11+01:00',
  'outbound-api',
  'SMedf7f1747466e1957854c090ac2aaf89'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Pav and Rupi, your booking on 18/10/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-06T18:39:21+01:00',
  'outbound-api',
  'SM8061e1ce138f8e367425efa4f8b6a427'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie Fowler, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-06T18:00:07+01:00',
  'outbound-api',
  'SMa96e120164eb0181152f1c24a1a41e2c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447719261701',
  'Hi Claire Mack, your booking on 30/10/2024 15:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-06T14:58:26+01:00',
  'outbound-api',
  'SMc66ab62406a27107f4837727a83df9b9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447912859484',
  'Hi Katie Fowles, your booking on 18/10/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-06T08:38:32+01:00',
  'outbound-api',
  'SMf3f9960430a44d78a252930ed0dc79ef'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie Fowler, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-05T19:00:06+01:00',
  'outbound-api',
  'SM10ed2af250a4069cdde114564e71af87'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie Fowler, your booking on 06/10/2024 13:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-05T18:37:24+01:00',
  'outbound-api',
  'SM41d24229015f4c769cae605a0ed1f372'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Hi Julie Fowler, we got your booking at The Anchor! We''ll notify you once reviewed. Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-05T18:34:42+01:00',
  'outbound-api',
  'SMd58fce56e47fb0be9e0875cb352f1b9e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447508229328',
  'Hi margaret, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-04T23:00:07+01:00',
  'outbound-api',
  'SMc5f69428c31958e03b58ddc82aa062e0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447508229328',
  'Hi margaret, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-04T18:00:05+01:00',
  'outbound-api',
  'SMdf785a1a603bff7b49de6ce19b945d71'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447508229328',
  'Hi margaret, your booking on 04/10/2024 18:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-10-04T17:39:08+01:00',
  'outbound-api',
  'SM68b069fe898bdc55bfea8635ff28a3f7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985734050',
  'Hi Tom, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-29T19:00:07+01:00',
  'outbound-api',
  'SM04b3f3079017f0d700f7fd09518588a3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985734050',
  'Hi Tom, your booking on 29/09/2024 13:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-29T13:03:25+01:00',
  'outbound-api',
  'SM0746d511d692dd9616518a88ed09f48a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447766040867',
  'Hi Kate, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-29T00:00:08+01:00',
  'outbound-api',
  'SMb524fae5eef6ade1e10c86296c7ee765'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447935444089',
  'Hi Tim Yuan, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-28T01:00:07+01:00',
  'outbound-api',
  'SM06db398bad0cdb6be5def4af253f39c5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447935444089',
  'Hi Tim Yuan, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-27T19:00:07+01:00',
  'outbound-api',
  'SM1c90c44cc98ed3d1eb87116cf5f6a1f7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447766040867',
  'Hi Kate, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-27T19:00:06+01:00',
  'outbound-api',
  'SMd1046669151de7317a7fca49bfdd8aac'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447935444089',
  'Hi Tim Yuan, your booking on 27/09/2024 19:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-27T18:36:46+01:00',
  'outbound-api',
  'SMba8ece2f91e046377c573d2564de5a22'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447935444089',
  'Hi Tim Yuan, we got your booking at The Anchor! We''ll notify you once reviewed. Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-27T18:36:09+01:00',
  'outbound-api',
  'SM75639930d13b27b8db6774f340808c09'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447970941030',
  'Hi Becky Gibbons, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-26T01:00:13+01:00',
  'outbound-api',
  'SM95a8683a6f3227266b188a4b19a0e6be'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447766048813',
  'Hi Chris, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-26T01:00:12+01:00',
  'outbound-api',
  'SMae4ec9b6c9e2d1787822c905b34a8f10'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy Jones, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-26T01:00:11+01:00',
  'outbound-api',
  'SM8d6dd2820c6a375ff0d26b3cbb1e41ad'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447702746498',
  'Hi Jazz, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-26T01:00:11+01:00',
  'outbound-api',
  'SM073bd87bb04c5a33a81e1e49adcec099'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447926203166',
  'Hi Sid, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-26T01:00:10+01:00',
  'outbound-api',
  'SM0c7e1fcbc459796025fbc7f8686e5547'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447742116805',
  'Hi Jade & Alex, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-26T01:00:10+01:00',
  'outbound-api',
  'SM39540bb2df5a7171b624d63221e64b31'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi & Pav, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-26T01:00:09+01:00',
  'outbound-api',
  'SM7482f65220d52ee88fdb9eb14946ab11'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447597537511',
  'Hi Lucy & Ken, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-26T01:00:08+01:00',
  'outbound-api',
  'SM7ffc4be9798c09e42e5eabcbc897788f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Rob & Denise, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-26T01:00:08+01:00',
  'outbound-api',
  'SM0ef364ede75949f911163739b820ddd8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447843951131',
  'Hi Lance, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-26T01:00:07+01:00',
  'outbound-api',
  'SM61f8f2521b88017112deba7c44a2a64c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Julie & Brian, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-26T01:00:07+01:00',
  'outbound-api',
  'SMc0c5ce99ffbd815ad6595f7ed88405c8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447481948048',
  'Hi Dave & Wendy, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-26T01:00:07+01:00',
  'outbound-api',
  'SMe7c6f818b0a12c91fc98ca560dbc2fa6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447305866052',
  'Hi Lauren, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-26T00:00:07+01:00',
  'outbound-api',
  'SM9a8501eef4c64ba86298968562b9d07a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447947207494',
  'Hi Elaine  Goddard, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-25T23:00:08+01:00',
  'outbound-api',
  'SM135e7a74787b04ff43818bd188841707'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447970941030',
  'Hi Becky Gibbons, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-24T20:00:11+01:00',
  'outbound-api',
  'SMc687b74991f9fb9416327dd14c48b51f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447766048813',
  'Hi Chris, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-24T20:00:10+01:00',
  'outbound-api',
  'SM6ecc6e9d2ee96318af4d0d8e31740369'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy Jones, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-24T20:00:10+01:00',
  'outbound-api',
  'SMcb4d83c6c1ff5ac5c73153b8d2278b77'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447702746498',
  'Hi Jazz, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-24T20:00:09+01:00',
  'outbound-api',
  'SMc018aa79fa563b19ba52f2788fd020cd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447926203166',
  'Hi Sid, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-24T20:00:09+01:00',
  'outbound-api',
  'SM733b7181a0a8886c4d68d1b84c2bf875'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447742116805',
  'Hi Jade & Alex, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-24T20:00:08+01:00',
  'outbound-api',
  'SM7e02b13a454cfe3f8c3fc8e60230551b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi & Pav, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-24T20:00:07+01:00',
  'outbound-api',
  'SM41a6776989504cf59e577bdb784e1019'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447597537511',
  'Hi Lucy & Ken, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-24T20:00:07+01:00',
  'outbound-api',
  'SM15592c2f8ab76077249aee754a6221d8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Rob & Denise, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-24T20:00:07+01:00',
  'outbound-api',
  'SM0c9e37992e12e60c6f1ae4f81d585cad'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447843951131',
  'Hi Lance, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-24T20:00:07+01:00',
  'outbound-api',
  'SMc5f8f40a95b231f77afab830440daa7e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Julie & Brian, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-24T20:00:06+01:00',
  'outbound-api',
  'SM460f354e3b0740e0a329ac0c7b18f089'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447481948048',
  'Hi Dave & Wendy, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-24T20:00:06+01:00',
  'outbound-api',
  'SM1aebd46acceb01b9af64509eb6bcd814'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447305866052',
  'Hi Lauren, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-24T19:00:06+01:00',
  'outbound-api',
  'SMc7f22cb4f2a3c3dba4c623b4a2c5c9b8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447947207494',
  'Hi Elaine  Goddard, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-24T18:00:06+01:00',
  'outbound-api',
  'SM7a5e411bcf6dd7757b166b828171853a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Pav and Rupi, your booking on 18/10/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-23T09:26:32+01:00',
  'outbound-api',
  'SM800bfac4c8e7499fde8f71f07378ecf5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447825372321',
  'Hi Joseph davis, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-20T00:00:07+01:00',
  'outbound-api',
  'SM0b0740c8cd78d94aeb9fe84f8594dfa8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447825372321',
  'Hi Joseph davis, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-19T18:00:06+01:00',
  'outbound-api',
  'SM76673b036a6a74abc1020b02e657c151'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447825372321',
  'Hi Joseph davis, your booking on 19/09/2024 18:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-19T17:55:27+01:00',
  'outbound-api',
  'SM1ec42f327ef361df5782c5e8e094c9b9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447825372321',
  'Hi Joseph davis, we got your booking at The Anchor! We''ll notify you once reviewed. Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-19T17:54:46+01:00',
  'outbound-api',
  'SM45495f50f2945ae3b7edefaec890b78a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447947207494',
  'Hi Elaine  Goddard, your booking on 25/09/2024 17:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-19T17:50:55+01:00',
  'outbound-api',
  'SMcb42c2a941cd122939c24bc7a610d579'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447814806899',
  'Hi Alan Gosling, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-18T23:00:07+01:00',
  'outbound-api',
  'SM34aa06c197c06eeff55032547bbbc2a8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447305866052',
  'Hi Lauren, your booking on 25/09/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-18T19:06:47+01:00',
  'outbound-api',
  'SM2ed186c8a334d8bc2201fb03b27c5921'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447814806899',
  'Hi Alan Gosling, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-17T18:00:06+01:00',
  'outbound-api',
  'SM8bb0ff5bb4dbab9506f1bedc19cbac85'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447912859484',
  'Hi Katie Fowles, your booking on 18/10/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-17T08:53:47+01:00',
  'outbound-api',
  'SM19915a81d669bd5e5008b57cf90c3c27'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Pav and Rupi, your booking on 18/10/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-17T08:52:34+01:00',
  'outbound-api',
  'SMd31187abd1b879d9b0c97c6ad214c483'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946754476',
  'Hi Nish and Alan, your booking on 18/10/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-17T08:51:52+01:00',
  'outbound-api',
  'SMcc800fd5507452f1102e0061c4151a6e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447742116805',
  'Hi Jade & Alex, your booking on 25/09/2024 20:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-17T08:49:18+01:00',
  'outbound-api',
  'SM1f2df2a87118fde38a1f410ef6573f3e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy Jones, your booking on 25/09/2024 20:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-17T08:48:16+01:00',
  'outbound-api',
  'SMd3f4388044dee203486ba4725448f5c7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447970941030',
  'Hi Becky Gibbons, your booking on 25/09/2024 20:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-17T08:44:30+01:00',
  'outbound-api',
  'SM95fcdcdedef2783495fc94729a87b540'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447481948048',
  'Hi Dave & Wendy, your booking on 25/09/2024 20:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-17T08:43:22+01:00',
  'outbound-api',
  'SMe3beebc1bcebd86c251c668cd93e5f86'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447766048813',
  'Hi Chris, your booking on 25/09/2024 20:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-17T08:42:17+01:00',
  'outbound-api',
  'SM3e2e7d1edc282032a4c7bdc79e5c1112'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447702746498',
  'Hi Jazz, your booking on 25/09/2024 20:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-17T08:41:23+01:00',
  'outbound-api',
  'SM4fcc9e82b4a2cf4a0755465ffac8897a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447843951131',
  'Hi Lance, your booking on 25/09/2024 20:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-17T08:40:37+01:00',
  'outbound-api',
  'SM7f349e3921f5f1606c7220e697f78496'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447926203166',
  'Hi Sid, your booking on 25/09/2024 20:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-17T08:40:06+01:00',
  'outbound-api',
  'SM90cdbe8a74fb2af3d10e10b9322ab38a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447597537511',
  'Hi Lucy & Ken, your booking on 25/09/2024 20:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-17T08:39:31+01:00',
  'outbound-api',
  'SMd3b5686c57de9f115447ee3443f89999'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'Hi Rupi & Pav, your booking on 25/09/2024 20:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-17T08:38:31+01:00',
  'outbound-api',
  'SM69258a65b52727cb94e600eed46eebe7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Rob & Denise, your booking on 25/09/2024 20:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-17T08:37:26+01:00',
  'outbound-api',
  'SMdf560f8680ca5c85ec390d37360d264b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Julie & Brian, your booking on 25/09/2024 20:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-17T08:36:38+01:00',
  'outbound-api',
  'SM7261a5ede61b3826d3695c38ca005f62'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447557037448',
  'Hi Jazz, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-15T19:00:07+01:00',
  'outbound-api',
  'SMe829d3cdcf97a04282d029c365f4cf93'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447976326477',
  'Hi Andrew Marshall, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-15T19:00:07+01:00',
  'outbound-api',
  'SMf01a528621f0c1deed565da823795c3a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447557037448',
  'Hi Jazz, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-15T13:00:06+01:00',
  'outbound-api',
  'SM7cf00e920c3838940776007160b9926c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447557037448',
  'Hi Jazz, your booking on 15/09/2024 14:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-15T12:04:52+01:00',
  'outbound-api',
  'SM68c06be70ea1282e1bba72fd93a12f97'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447557037448',
  'Hi Jazz, we got your booking at The Anchor! We''ll notify you once reviewed. Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-15T12:03:11+01:00',
  'outbound-api',
  'SM9164bf8238f4c2b82688661e367aaa03'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447976326477',
  'Hi Andrew Marshall, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-14T15:00:07+01:00',
  'outbound-api',
  'SM382a06019ba1cd7bb515768b300a677e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447976326477',
  'Hi Andrew Marshall, your booking on 15/09/2024 14:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-14T14:10:09+01:00',
  'outbound-api',
  'SM8e0f0f121a79add4af01544029d2a9d0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447976326477',
  'Hi Andrew Marshall, we got your booking at The Anchor! We''ll notify you once reviewed. Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-13T09:06:54+01:00',
  'outbound-api',
  'SM6075b15162c04877a9360e7ae68de3ef'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-12T03:00:08+01:00',
  'outbound-api',
  'SM2436cebf76855065d332753a7b1f9eff'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Julie & Co, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-12T00:00:09+01:00',
  'outbound-api',
  'SM44facf634138e556c73ced5da13af21b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447889600378',
  'Hi Louise, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-12T00:00:08+01:00',
  'outbound-api',
  'SMc153f3c16e222d997f4e549a87364e72'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-10T22:00:07+01:00',
  'outbound-api',
  'SM8d4a98fbcd0f3a22e2704ffebc33bc23'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Julie & Co, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-10T19:00:07+01:00',
  'outbound-api',
  'SMe24cb8ec38902e312081aca10d9a3bad'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447889600378',
  'Hi Louise, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-10T19:00:06+01:00',
  'outbound-api',
  'SM1d53454a680422055ba0d26e5724b766'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447762477880',
  'Hi Andy Riddlestone, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'failed',
  '2024-09-08T18:00:09+01:00',
  'outbound-api',
  'SM27636d8b7f5e1e5c64e29adb413af059'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447762477880',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'failed',
  '2024-09-08T15:48:29+01:00',
  'outbound-reply',
  'SMfbf0e17fe25fb76a806996c9fa6f0500'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447762477880',
  '+447700106752',
  'Stop',
  'received',
  '2024-09-08T15:48:27+01:00',
  'inbound',
  'SMcecbd29ea751aec20581f6c45f02570b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447762477880',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2024-09-07T14:45:47+01:00',
  'outbound-reply',
  'SM0d04faac5b9092980eca7ab97364d5f2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447762477880',
  '+447700106752',
  'Hi, thanks for the reminder. Where can I find the Sunday menu, please? I find the weekdays menu on quick links but not the Sunday menu. Thanks.',
  'received',
  '2024-09-07T14:45:47+01:00',
  'inbound',
  'SM5d4b9cdf76a348f530835129a9e5f0f5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447762477880',
  'Hi Andy Riddlestone, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-07T13:00:07+01:00',
  'outbound-api',
  'SM002e51fa88fa8a1fef9ca36252b06ae4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447453888353',
  'Hi Dean Mason, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-06T00:00:07+01:00',
  'outbound-api',
  'SM1abd78907be0e1bd72d6e5ac7370c4b8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Julie & Co, your booking on 11/09/2024 18:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-05T17:08:13+01:00',
  'outbound-api',
  'SM91b53ba2aca643b1494ac90d15bd9f65'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447453888353',
  'Hi Dean Mason, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-05T17:00:06+01:00',
  'outbound-api',
  'SMc0c66f12dabbb5a0abff9e9306695be5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447453888353',
  'Hi Dean Mason, your booking on 05/09/2024 18:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-05T16:22:18+01:00',
  'outbound-api',
  'SMd6900eb97c3acd7b7c89ce98efd56e20'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447453888353',
  'Hi Dean Mason, we got your booking at The Anchor! We''ll notify you once reviewed. Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-05T16:09:22+01:00',
  'outbound-api',
  'SMae4c95ad2220cac84b2bc9ac75ec4315'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447897855232',
  'Hi Geoff Ralph, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-04T23:00:08+01:00',
  'outbound-api',
  'SMb4445b2390f44f7b2f9ac518bfa4c995'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447814806899',
  'Hi Alan Gosling, your booking on 18/09/2024 18:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-04T18:15:06+01:00',
  'outbound-api',
  'SM4ca6e6fcdab011e19de255f53678a11b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447814806899',
  'Hi Alan Gosling, we got your booking at The Anchor! We''ll notify you once reviewed. Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-04T18:14:18+01:00',
  'outbound-api',
  'SM9e220ae569afd231fbc2bfe996c61b29'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447897855232',
  'Hi Geoff Ralph, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-03T18:00:06+01:00',
  'outbound-api',
  'SMa9f48b0d7dce969dbf438f17fbd92347'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447897855232',
  'Hi Geoff Ralph, your booking on 04/09/2024 18:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-09-02T16:50:38+01:00',
  'outbound-api',
  'SMb5ce6cc149c33b9049105d15f9aa9f5e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:46+01:00',
  'outbound-api',
  'SMb3f29bcbcd542cc6c7dbbd88cfc9ce89'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447999348877',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:46+01:00',
  'outbound-api',
  'SM2bd739909069164d16415dd6a2d96d64'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985933562',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:45+01:00',
  'outbound-api',
  'SM3b566ad1cd38860c385defa89ea3a01d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:44+01:00',
  'outbound-api',
  'SM99317577bb8fe28526c5bf4282556225'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447956315214',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:44+01:00',
  'outbound-api',
  'SMbb3c12066b4aae3c4192f4f8dc3d1194'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447984282087',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:43+01:00',
  'outbound-api',
  'SM486f69fc76450e95d7d309f0ef3a9d1d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447983363278',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:43+01:00',
  'outbound-api',
  'SM879744ab01fc0cb47872ee95205e5ce6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447976043455',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:42+01:00',
  'outbound-api',
  'SM08da698c0fb107287f41bdda49a99b85'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447974077079',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:41+01:00',
  'outbound-api',
  'SM885ac1a29097f6d08f9d1962e8c56ec4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:41+01:00',
  'outbound-api',
  'SM5c6c32d96174e90f81bbc0a310a820f6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447968730441',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:41+01:00',
  'outbound-api',
  'SMf7bdf04486c458fe153d3d529553c934'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447962373977',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:40+01:00',
  'outbound-api',
  'SM65a71f930445253cfcd0d197f5fa543e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447961453206',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:40+01:00',
  'outbound-api',
  'SM8aed7513e67dd899663280494e45e2e1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447958360751',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:39+01:00',
  'outbound-api',
  'SMcc4bb4308bcf15a95ad04b8a103d0038'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447958269776',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:38+01:00',
  'outbound-api',
  'SM2d11d3898bf7766419c59f007f71f7ef'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447957967335',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:37+01:00',
  'outbound-api',
  'SMa462a77286ba48b2ae8260656a723be7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447957909524',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:37+01:00',
  'outbound-api',
  'SM383298641f16f4323ecd194a2deb8353'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447957413180',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:36+01:00',
  'outbound-api',
  'SM386f3363978120225400e4b877752c82'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:36+01:00',
  'outbound-api',
  'SM0406679beca5339b399da490c9f1396a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447951159909',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:35+01:00',
  'outbound-api',
  'SM984050da88ad9cf5e38eb07386be8a6a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447949465620',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:35+01:00',
  'outbound-api',
  'SM26449f06d1117661cdb5e585e331abdb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447947100347',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:34+01:00',
  'outbound-api',
  'SM352c590c2e69683aa69609d222b81030'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946233319',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:33+01:00',
  'outbound-api',
  'SM4eda2cc9674084451cd924da10ca0c3a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447944777913',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:33+01:00',
  'outbound-api',
  'SMad496c8fa002148dcd7f388670fbcf32'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447941909522',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:33+01:00',
  'outbound-api',
  'SM6fe2bf0bde65b7e5fc27b44cd65599d2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447941006017',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:32+01:00',
  'outbound-api',
  'SMf2084e0f563adc1b8146d3bd6ba56873'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940220875',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:31+01:00',
  'outbound-api',
  'SMbb6f9976b5f93e902bcf92a94b3de9b0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447940148047',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:31+01:00',
  'outbound-api',
  'SM77fe7bc872d653cf8e3cfd60892dbfa7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447939958957',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:30+01:00',
  'outbound-api',
  'SMab06bfdb45ba38e9f4dad5cf2abcbc52'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447935785513',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:30+01:00',
  'outbound-api',
  'SM1ac411bac4aa23953cd60def2bc749a5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447931748959',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:29+01:00',
  'outbound-api',
  'SMe7c311cb13f006107a7083e16e395b9f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447930933086',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:29+01:00',
  'outbound-api',
  'SMbf0b0d2355bd2e9268ff7e9a3d395212'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447923474998',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:28+01:00',
  'outbound-api',
  'SM09427b09c441584b71ab40daf1490827'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447919542034',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:27+01:00',
  'outbound-api',
  'SM0a6494ff929810c9152e44fcfaf14348'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447912859484',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:27+01:00',
  'outbound-api',
  'SM2ba82f0a75c246b56742bc0e5980f56c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447907135239',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:26+01:00',
  'outbound-api',
  'SMa70fa12d963b7cf09534093f594237db'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447903139807',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:25+01:00',
  'outbound-api',
  'SMdfb4b662bfcd375601b5c576fa884323'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447902606715',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:25+01:00',
  'outbound-api',
  'SMe64e6608b6acdeca61bc24827e6cf17d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447891236986',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:24+01:00',
  'outbound-api',
  'SMabcb417f8fb5c29969c671bdaf64c279'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447889679392',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:24+01:00',
  'outbound-api',
  'SMd8eefbb4af8962303c8efba0d3461f08'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447889600378',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:23+01:00',
  'outbound-api',
  'SM988e4842b65f011195fc56a225dde5cd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447887688484',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:23+01:00',
  'outbound-api',
  'SM049177e8827aa34f31554966933aff0a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447885647172',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:23+01:00',
  'outbound-api',
  'SMe33ded0e8408e3f9134103de511ba565'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447884238696',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:22+01:00',
  'outbound-api',
  'SMbc1fd016d2f0c2059c4afe378dd792a7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447875767053',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:22+01:00',
  'outbound-api',
  'SM82f48c74fafaba6876cfa886420d39af'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447864322491',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:22+01:00',
  'outbound-api',
  'SM0256955ab1fa25b4b46bddf3bbf4b5ff'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447860640494',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:21+01:00',
  'outbound-api',
  'SMfb1600394ab1d5e3ec0932b49e40ef21'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447858499686',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:20+01:00',
  'outbound-api',
  'SM47f363d972e442e890c3e28e051ad85b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447856532364',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:20+01:00',
  'outbound-api',
  'SMfc3764a20ab5db6fbe3c648fb952f904'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447856053809',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:19+01:00',
  'outbound-api',
  'SMece00d56383f887ecd5962d8859e891e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447852933804',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:19+01:00',
  'outbound-api',
  'SM8acddbcc9f3aa03eaf2b975a947e8345'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447851837100',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:19+01:00',
  'outbound-api',
  'SM5b14eabb09b198a7f2aac26be9b023ee'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447849207743',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:18+01:00',
  'outbound-api',
  'SM83ee97fd048ced3c0df7c972489ec361'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447843951131',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:18+01:00',
  'outbound-api',
  'SM6e8181da4f1792280ddb21e6c96d1ccd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447843880939',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:18+01:00',
  'outbound-api',
  'SMa453f6ba273c3e5c4832ecb26c7d8981'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447840547761',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:17+01:00',
  'outbound-api',
  'SMb11a5d9d0074d94bba26ce9771ed0dbf'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447833010800',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:16+01:00',
  'outbound-api',
  'SMf8cf16799084c7876819fbec55e43720'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447825304222',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:15+01:00',
  'outbound-api',
  'SMe45c58a0f82136d4c55d1f83e4f83dc0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447825225383',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:15+01:00',
  'outbound-api',
  'SM49a6ef84b147a73ff3683900286dde3d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447821250145',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:14+01:00',
  'outbound-api',
  'SM4115108e3fd81d2b785c058ca4d20dc3'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447808029531',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:13+01:00',
  'outbound-api',
  'SMe87c98b673c7be2f37e69f8caab91857'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447803717949',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:12+01:00',
  'outbound-api',
  'SM12181875fc0ed375e329c8a524877fa7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447802769253',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:12+01:00',
  'outbound-api',
  'SM3b2b77e4ae2af705b99168676eb2ff8d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447800745576',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:11+01:00',
  'outbound-api',
  'SM48127318f7104a7925df3247fbff0278'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447799113581',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:11+01:00',
  'outbound-api',
  'SMd4648cbaf922264f23c37c2f4150eb63'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447795514533',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:10+01:00',
  'outbound-api',
  'SMedbccd4662d96bb0c96488317087d042'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:09+01:00',
  'outbound-api',
  'SM3fb63564554fcfb0051ce0bd3c65845a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447792253288',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:09+01:00',
  'outbound-api',
  'SM64eca5380dfbb1ec2318de934abe2071'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447792195913',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:08+01:00',
  'outbound-api',
  'SMd006ab0ad7452392c52a7ba7acd7f576'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447790733670',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:08+01:00',
  'outbound-api',
  'SMe32db1283dcc08875f4accca8033cfd7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447788239129',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:07+01:00',
  'outbound-api',
  'SMf807b6f4e58024fa20a59e42dfcec85d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447786392116',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:06+01:00',
  'outbound-api',
  'SMe8304918c51c095f72af0c977bbc1158'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447776387754',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:06+01:00',
  'outbound-api',
  'SMc0603c11609c7e163810477ca2ee63be'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447775903610',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:05+01:00',
  'outbound-api',
  'SM89555cf7c07752b231f33e3618e044f4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447775446081',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:05+01:00',
  'outbound-api',
  'SMa15e69e80824fcaa1c553be59faaa0b0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447773087164',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'undelivered',
  '2024-08-31T15:47:05+01:00',
  'outbound-api',
  'SMcd648e0d3659e976066cd2c435e18b20'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447762477880',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:04+01:00',
  'outbound-api',
  'SMc5baa7fb7dbac9bab3632c3dd7af51a2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447748213214',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:04+01:00',
  'outbound-api',
  'SMb4645e258cf8bd745f8909f9259157fe'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447747827252',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:03+01:00',
  'outbound-api',
  'SM730ca221b80799ecd2c2b0061735961e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447739524181',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:03+01:00',
  'outbound-api',
  'SM4761f0f82e35db5411bdb0a9f689ffd2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447725203882',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:02+01:00',
  'outbound-api',
  'SM053ad1dc12fd7861d1deb59d8c24615e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447718577118',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:01+01:00',
  'outbound-api',
  'SMc9ce5c76cf7275844d3df50c9f79cb4b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447704283992',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:00+01:00',
  'outbound-api',
  'SM28072851541e070c921ed81d01d65495'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447597537511',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:47:00+01:00',
  'outbound-api',
  'SM03ca57fc8256f0f2bd062695b816ca7f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447595345167',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:59+01:00',
  'outbound-api',
  'SMe99de99cfa9fb16840711d0f25f453f4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447590122208',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:58+01:00',
  'outbound-api',
  'SMb1f28743b631133437fa963250ef19ec'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447570492770',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:58+01:00',
  'outbound-api',
  'SMbfa68b1b374a90c65339f0be2997cffb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447562235960',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:57+01:00',
  'outbound-api',
  'SMf4a70ecf5edf32934ac61a6e7d39243b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447546519071',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:56+01:00',
  'outbound-api',
  'SM57dc67cc4bfdeaa133cec7da79562e8a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447516053734',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:55+01:00',
  'outbound-api',
  'SM84a59a22c58ebc225c46872a0f0e750b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447515889622',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:55+01:00',
  'outbound-api',
  'SMa6634dd4c45981f1a89ad6a5d7b22be5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447513520317',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:54+01:00',
  'outbound-api',
  'SM0d27592509d12d38e51e2d1cd5382793'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447510312876',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:54+01:00',
  'outbound-api',
  'SMff02ad244cf43a083158b31c55ddda12'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447506868556',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:53+01:00',
  'outbound-api',
  'SM3489f37d1070a5b3ad1fe879cfda5aad'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447502562955',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:52+01:00',
  'outbound-api',
  'SM46e8e47e56b3d3d2bdc7d8fd1fe2fe9f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447498930215',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:51+01:00',
  'outbound-api',
  'SM744a451ba9efe97a17b238d2deb1bcc1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447490518054',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:51+01:00',
  'outbound-api',
  'SM59e6a9a52d911b4a10595e1ac9a0a5a5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447484347040',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:50+01:00',
  'outbound-api',
  'SM038702d88a91499caa0efdb47677b99e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447481948048',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:50+01:00',
  'outbound-api',
  'SM7498954d2f549298b63afeefcd4c8aeb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447477774222',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:49+01:00',
  'outbound-api',
  'SM2df992aa0339e4504e33fcb470b6e697'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447477565730',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:48+01:00',
  'outbound-api',
  'SM250ef628ef05a9787eed27549affee1c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447471071834',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:47+01:00',
  'outbound-api',
  'SM47bea630761752ba4864c7d6568cec06'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447468575857',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:47+01:00',
  'outbound-api',
  'SM3e570e5cf07414480e17dcc835af09a9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447456034967',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:46+01:00',
  'outbound-api',
  'SM11b3c5610dcc22987c6e7e37f2b043f2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447446690934',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:45+01:00',
  'outbound-api',
  'SM5e14c8c91fd14225cae30bfeca4d3e7a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447427754319',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'undelivered',
  '2024-08-31T15:46:44+01:00',
  'outbound-api',
  'SMe9a58b9e55890196895e9e71a02b0e0c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447419772158',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:43+01:00',
  'outbound-api',
  'SMb9c4270bf3f964591f7ede2d661da6af'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447401318888',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:43+01:00',
  'outbound-api',
  'SMe4329a6f4f22d3019ed5d4deff06de3f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447393862238',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:42+01:00',
  'outbound-api',
  'SMf9bb38d7a4ed0626f5e0520e4094bd68'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447392338040',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:42+01:00',
  'outbound-api',
  'SM2f1d1d41f04896d916379a9932591ad5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447384797023',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:42+01:00',
  'outbound-api',
  'SM8d62cb4bbd32ea69feb93b5ef8c6ec67'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447305119629',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:46:41+01:00',
  'outbound-api',
  'SMdfa32dead81e6e9234b8ad7da4880c49'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447153682634',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'sent',
  '2024-08-31T15:46:41+01:00',
  'outbound-api',
  'SM871bacacaeafb3ecfd021f8565cec7de'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'The Anchor''s Gameshow House Party: Fortunate Families is on 25th Sept! Fun, games, and prizes await. Limited tickets: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:44:36+01:00',
  'outbound-api',
  'SM37440839a5a0ac3a87a9559a640f958d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'The Anchor presents Gameshow House Party: Fortunate Families on 25th Sept! A night of fun, games, and prizes awaits. Tickets are limited, get yours now: https://bit.ly/4g8jcXv',
  'delivered',
  '2024-08-31T15:42:04+01:00',
  'outbound-api',
  'SMffe4ee3a5c2a874bcb35f9271fab972e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447762477880',
  'Hi Andy Riddlestone, your booking on 08/09/2024 13:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-31T14:47:16+01:00',
  'outbound-api',
  'SM0a30b1d90a6eddbd154fce99db11e1d4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447762477880',
  'Hi Andy Riddlestone, we got your booking at The Anchor! We''ll notify you once reviewed. Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-31T14:46:08+01:00',
  'outbound-api',
  'SM73a3a7e2ac78b9bc3f2948c4098cc587'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447889600378',
  'Hi Louise, your booking on 11/09/2024 18:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-30T08:11:04+01:00',
  'outbound-api',
  'SM6bcffb11e7834f6c9a8fa480c7e27eba'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447889600378',
  'Hi Louise, your booking on 11/09/2024 18:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-30T08:09:48+01:00',
  'outbound-api',
  'SM0d874a56158bfdf660c44d58b60aaf73'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447958360751',
  'Hi Rinky, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-30T01:00:10+01:00',
  'outbound-api',
  'SMad95d42821644358335ed0949fdb39eb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447958360751',
  'Hi Rinky, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-29T20:00:06+01:00',
  'outbound-api',
  'SM03803ad27bcdf1452564b2f252b1ced6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447958360751',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2024-08-29T19:45:21+01:00',
  'outbound-reply',
  'SM7ebd1bbe7e51b59a204e1b8b210ed437'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447958360751',
  '+447700106752',
  'Sorry just had a call from home... our alarm has gone off sorry will need to cancel',
  'received',
  '2024-08-29T19:45:21+01:00',
  'inbound',
  'SM25f4cf739cc86e88fff7170c185d6210'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447958360751',
  'Hi Rinky, your booking on 29/08/2024 20:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-29T19:26:58+01:00',
  'outbound-api',
  'SMf328ac5faef5242a619ed3cefa851e2c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire Honey, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-29T00:00:16+01:00',
  'outbound-api',
  'SMfbb409b4a4f3d1fb071480a4bf821a42'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447481948048',
  'Hi Dave & Wendy, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-29T00:00:15+01:00',
  'outbound-api',
  'SM8238172ba603089364afddcd9afa9ba5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Julie & Brian, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-29T00:00:15+01:00',
  'outbound-api',
  'SM7c654c8994784bda6a9fbf388442de73'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447843951131',
  'Hi Lance & Jazz, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-29T00:00:14+01:00',
  'outbound-api',
  'SM54bf2d586b273562562a4db4b4b0b14b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '4. Human Review',
  'Hi Rupi & Pav, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'failed',
  '2024-08-29T00:00:14+01:00',
  'outbound-api',
  'SM51f4d8bc6f8df14403ac6f79c3a5a9bc'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447397639335',
  'Hi Huda, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-29T00:00:13+01:00',
  'outbound-api',
  'SMa8c85bca31fb59090bcff35e082a2acf'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy''s Pal''s, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-29T00:00:13+01:00',
  'outbound-api',
  'SMc0c0f7e69036d2094fec6bf767f87de1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946754476',
  'Hi Nish, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-29T00:00:12+01:00',
  'outbound-api',
  'SMf48dfda20f27870dc8900ce1ad0274c5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447766048813',
  'Hi Chris, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-29T00:00:11+01:00',
  'outbound-api',
  'SMd06342a0c0a8d711c4997f6c0a135551'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Rob & Denise, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-29T00:00:11+01:00',
  'outbound-api',
  'SM44c3ea5abfd954402229f1068c0caef7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447890680950',
  'Hi Mummy Bear, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-29T00:00:10+01:00',
  'outbound-api',
  'SM084d4a7818b0a94b4dcd9052018e96b5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447771496954',
  'Hi Fran, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-29T00:00:10+01:00',
  'outbound-api',
  'SMd659eeb52ab33c808808a8a675452b34'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447875286505',
  'Hi Pauline Green, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-29T00:00:08+01:00',
  'outbound-api',
  'SMd13e87929667ab458a371dc99251c584'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy Jones, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-29T00:00:08+01:00',
  'outbound-api',
  'SM8c6df28e14c6d9ef3d51fd1603b4fbcc'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447863230107',
  'Hi Ronnie, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-29T00:00:07+01:00',
  'outbound-api',
  'SMc30028945dc1954018dd16eac33d2802'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447973560612',
  'Hi Caz, your booking on 11/09/2024 22:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-28T21:40:31+01:00',
  'outbound-api',
  'SMdf45477ce6a044ab348359997eda2ee8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447890680950',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2024-08-27T19:03:43+01:00',
  'outbound-reply',
  'SM657704cb13911efc595bfd5e0ac73b35'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447890680950',
  '+447700106752',
  '💋',
  'received',
  '2024-08-27T19:03:43+01:00',
  'inbound',
  'SM7462e81e96ef7f1f118ba305f9db7085'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire Honey, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-27T19:00:15+01:00',
  'outbound-api',
  'SM31b891700dcfceb3293f7f3657cd05be'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447481948048',
  'Hi Dave & Wendy, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-27T19:00:14+01:00',
  'outbound-api',
  'SM64e2f13da061c74486c7d1b915a34354'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Julie & Brian, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-27T19:00:14+01:00',
  'outbound-api',
  'SMd7de88743538c16c80c49910dcd6850e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '4. Human Review',
  'Hi Rupi & Pav, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'failed',
  '2024-08-27T19:00:14+01:00',
  'outbound-api',
  'SM5e83bb34a952d975f76bc67281c05baa'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447843951131',
  'Hi Lance & Jazz, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-27T19:00:13+01:00',
  'outbound-api',
  'SM0c2acd1196ad1d53be16e5ad3cecd025'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447397639335',
  'Hi Huda, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-27T19:00:12+01:00',
  'outbound-api',
  'SM15c340f15b2ff53bc9a5e14fcbb940b7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy''s Pal''s, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-27T19:00:11+01:00',
  'outbound-api',
  'SM645b4497ba5532b5c2a61691e37940d5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946754476',
  'Hi Nish, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-27T19:00:11+01:00',
  'outbound-api',
  'SMb697e18e8a3c9c00a8cd8f7262618164'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447766048813',
  'Hi Chris, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-27T19:00:10+01:00',
  'outbound-api',
  'SM2fa5157ef669f2d8590bd76fd2ac0801'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Rob & Denise, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-27T19:00:10+01:00',
  'outbound-api',
  'SM691b87010924258347492c23a9ecb511'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447890680950',
  'Hi Mummy Bear, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-27T19:00:09+01:00',
  'outbound-api',
  'SM906e31d71c01ca932e7181634019a89e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447771496954',
  'Hi Fran, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-27T19:00:08+01:00',
  'outbound-api',
  'SMd47958864c4cd3c60bdd36dc63452025'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447875286505',
  'Hi Pauline Green, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-27T19:00:07+01:00',
  'outbound-api',
  'SM7c929ee27c4415908fe39d940a6910a4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy Jones, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-27T19:00:06+01:00',
  'outbound-api',
  'SM7e9e7f4bbc8139be1f00e7a8030d0bc1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447863230107',
  'Hi Ronnie, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-27T19:00:06+01:00',
  'outbound-api',
  'SM253eb2fe65980eee8f3f9367e0366ba0'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447931748959',
  'Hi Sarah Boldero, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-24T18:00:08+01:00',
  'outbound-api',
  'SMa103e19fa361a03b792504798808d90c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447931748959',
  'Hi Sarah Boldero, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-23T13:00:06+01:00',
  'outbound-api',
  'SMdc603b95c300ba34345bda0024bd9f90'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447931748959',
  'Hi Sarah Boldero, your booking on 24/08/2024 12:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-19T16:08:24+01:00',
  'outbound-api',
  'SM9b3bb4f6ab803de7bc042ce414df3289'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447747637585',
  'Hi Jodie Varco, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-18T18:00:08+01:00',
  'outbound-api',
  'SM7333c18d7a0fc1ee19e6edd361778dcb'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447747637585',
  'Hi Jodie Varco, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-17T13:00:07+01:00',
  'outbound-api',
  'SMefa386fe6efbea0c99982bda41308536'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy Jones, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-16T18:16:56+01:00',
  'outbound-api',
  'SMf47e3f5c9e24d7a9496755ea9366a8d5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447597537511',
  'Hi Lucy & Ken, your booking on 28/08/2024 19:00 at The Anchor has been cancelled. We hope to welcome you another time. Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-16T18:16:34+01:00',
  'outbound-api',
  'SM8a11c23fb07b24d9c561943f55ecde71'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447771496954',
  'Hi Fran, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-16T18:15:58+01:00',
  'outbound-api',
  'SM90ab56895802b32d8ffa99014e137dc6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447771496954',
  'Hi Fran, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-16T18:15:31+01:00',
  'outbound-api',
  'SM8fef34ce557e7ec1c461f6e91c93b616'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Clare Honey, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-15T00:00:07+01:00',
  'outbound-api',
  'SMbf86b6b759bf942644f9422b6ac92cec'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946754476',
  'Hi Nish, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-14T23:08:36+01:00',
  'outbound-api',
  'SM4d2aedb714313217c848dbe350ad5ed7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire Honey, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-14T23:08:19+01:00',
  'outbound-api',
  'SM4ae8542687088e8e84ebf59d3a288030'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447946754476',
  'Hi Nish, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-14T21:39:49+01:00',
  'outbound-api',
  'SM380a8646ee5e9ab31844b86e0351a6a2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Claire Honey, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-14T21:39:00+01:00',
  'outbound-api',
  'SMe79844fc31c5f055cb37ae4b6a4df782'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447747637585',
  'Hi Jodie Varco, your booking on 18/08/2024 13:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-14T16:05:21+01:00',
  'outbound-api',
  'SM4d4d5a4a3482cff06261e3fd72e909dd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Clare Honey, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-13T19:00:06+01:00',
  'outbound-api',
  'SM80229636bfff883dc9770ab4486572cf'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447463764063',
  'Hi Karen Linn, thanks for visiting The Anchor! We hope you had a great time. Please leave a review: https://bit.ly/3JyLZ8d Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-09T23:00:07+01:00',
  'outbound-api',
  'SMcb0695807d0ab266419f4e10bb921c35'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447771496954',
  'Hi Fran, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T22:10:59+01:00',
  'outbound-api',
  'SM881d6fb3ae834c1461e6b88f0217cd33'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447481948048',
  'Hi Dave & Wendy, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:56:39+01:00',
  'outbound-api',
  'SM9b8114d82cba62774905467af4ca501e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Julie & Brian, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:56:32+01:00',
  'outbound-api',
  'SM7f7e5cee98ee90a1e87df9225d83af10'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447597537511',
  'Hi Lucy & Ken, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:56:25+01:00',
  'outbound-api',
  'SM14ec8a30a188e4772f31ad2059a51993'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447843951131',
  'Hi Lance & Jazz, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:56:00+01:00',
  'outbound-api',
  'SMf8cb03788840816ef921432da5981f93'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '4. Human Review',
  'Hi Rupi & Pav, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'failed',
  '2024-08-08T20:55:50+01:00',
  'outbound-api',
  'SM24937f55f5a8c28b6d476bb1592f2947'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447397639335',
  'Hi Huda, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:55:43+01:00',
  'outbound-api',
  'SM91b3bbe5181f9b6f033ec6a98ba82af1'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy''s Pal''s, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:55:36+01:00',
  'outbound-api',
  'SM17d6f65ad213f5a6f7c32e9fb1f402f9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447766048813',
  'Hi Chris, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:55:30+01:00',
  'outbound-api',
  'SM5800da7b31c8b9ce5b2569a11d76aefe'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Rob & Denise, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:55:22+01:00',
  'outbound-api',
  'SMafb2840101daf11506297f1c1ae94479'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447890680950',
  'Hi Mummy Bear, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:55:11+01:00',
  'outbound-api',
  'SMde07f0e2a79b9d559bf6963c7e127759'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447875286505',
  'Hi Pauline Green, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:55:00+01:00',
  'outbound-api',
  'SM18bdb86f0d4af9c416ef83144229772f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447863230107',
  'Hi Ronnie, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:54:19+01:00',
  'outbound-api',
  'SMe66f7bdc05406f83642dd3c77e9c7bd7'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy Jones, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:54:12+01:00',
  'outbound-api',
  'SMce10ac5d2495eed7213dfe2918684a89'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447771496954',
  'Hi Fran, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:54:00+01:00',
  'outbound-api',
  'SM5204452f0a84404e7edaaa606fefdd35'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447863230107',
  'Hi Ronnie, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:53:35+01:00',
  'outbound-api',
  'SM2094f8c8d88760c27637f55c5e54c00d'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447771496954',
  'Hi Fran, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:52:57+01:00',
  'outbound-api',
  'SM168dcdcae711fa84743fee7c099e06ba'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy Jones, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:52:12+01:00',
  'outbound-api',
  'SMca923bafb36c60e050a441f382e57c3b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447481948048',
  'Hi Dave & Wendy, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:51:14+01:00',
  'outbound-api',
  'SM0b37638dd0a60cb7ad63065a829b43bd'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447875286505',
  'Hi Pauline Green, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:50:22+01:00',
  'outbound-api',
  'SMd4a8f94684232fe6a31649185068fdbc'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447766048813',
  'Hi Chris, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:47:50+01:00',
  'outbound-api',
  'SM1db0523b775208e921d00f03cbb7e8b6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447954340912',
  'Hi Mandy''s Pal''s, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:47:08+01:00',
  'outbound-api',
  'SMaea72f1bc2fa541b6048d17e3c6fb7c4'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447397639335',
  'Hi Huda, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:46:32+01:00',
  'outbound-api',
  'SM4f134bd152d2dba38de9f81622aa46a2'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447890680950',
  'Hi Mummy Bear, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:45:56+01:00',
  'outbound-api',
  'SMa3052a0cc2e4d61d8d84d9596442bf83'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447843951131',
  'Hi Lance & Jazz, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:44:57+01:00',
  'outbound-api',
  'SM885e686348ecc9c976e9d694f5ea8d86'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '4. Human Review',
  'Hi Rupi & Pav, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'failed',
  '2024-08-08T20:44:05+01:00',
  'outbound-api',
  'SMe1e8f6b8475369c4ab1fa06d92978142'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447597537511',
  'Hi Lucy & Ken, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:40:51+01:00',
  'outbound-api',
  'SM5b44ac020f1107e29445dda9d5cd6ce5'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Rob & Denise, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:40:21+01:00',
  'outbound-api',
  'SMc6be883c14542d7234bfe34b047ce78f'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Hi Julie & Brian, your booking on 28/08/2024 19:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T20:39:30+01:00',
  'outbound-api',
  'SM217b90fc11b36b9703a09a86ab53ad55'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447463764063',
  'Hi Karen Linn, we''re looking forward to your visit tomorrow at The Anchor! See you soon! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-08T18:00:06+01:00',
  'outbound-api',
  'SM608894ebca7da57ea6e2e48aaccc988e'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447463764063',
  'Hi Karen Linn, your booking on 09/08/2024 18:00 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-07T12:12:22+01:00',
  'outbound-api',
  'SMc4d3adcb90698c3a563659163d992881'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447793080018',
  'Hi Clare Honey, your booking on 14/08/2024 18:30 at The Anchor is confirmed. We look forward to seeing you! Thanks, The Anchor WhatsApp/Call: 01753682707 / Email: manager@the-anchor.pub',
  'delivered',
  '2024-08-06T21:15:28+01:00',
  'outbound-api',
  'SM297061a87a0d0dc4eeb57feb0e41f8d8'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447990587315',
  'Test message https://bit.ly/3YcrFm3',
  'delivered',
  '2024-07-20T15:16:27+01:00',
  'outbound-api',
  'SM25826ce96b3dbcceba3f747b3999e432'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447875767053',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2024-07-16T19:12:51+01:00',
  'outbound-reply',
  'SM28f7a3f184c4e2b9b73b061d103a678a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447875767053',
  '+447700106752',
  'Loved “Hi Poppy verity, we’re looking forward to your vis…”',
  'received',
  '2024-07-16T19:12:51+01:00',
  'inbound',
  'SMef20a1f2c749877b4ca80cb63e37f632'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447833010800',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2024-07-11T20:12:56+01:00',
  'outbound-reply',
  'SMa77171f184785c09b95c58eb8b329eb9'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447833010800',
  '+447700106752',
  '👍',
  'received',
  '2024-07-11T20:12:56+01:00',
  'inbound',
  'SM634d65a87a3f22e41bd57c8389fa57a6'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447771496954',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2024-06-26T17:02:08+01:00',
  'outbound-reply',
  'SM9143523f1f2f1382d96f730c8591f842'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'undelivered',
  '2024-06-26T12:43:33+01:00',
  'outbound-reply',
  'SM3bf164d93cb40bf68f881503fbed6486'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447985751794',
  '+447700106752',
  'Thank you. We look forward to seeing you too and having a lovely evening xx',
  'received',
  '2024-06-26T12:43:33+01:00',
  'inbound',
  'SM0cdc5b78cd4801c55ced01ce98269b2b'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447962373977',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2024-06-16T13:01:02+01:00',
  'outbound-reply',
  'SM9dafa55ea98a553ef79307de4d7f49da'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447962373977',
  '+447700106752',
  'Hiya we are looking forward to some great food. 👍🏻',
  'received',
  '2024-06-16T13:01:02+01:00',
  'inbound',
  'SMc84303f3de472c97270d8a0fc9319b9c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447985751794',
  '+447700106752',
  'HELP',
  'received',
  '2024-06-02T16:31:32+01:00',
  'inbound',
  'SM215afe09ce512d989833f7a99caa8c49'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447985751794',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2024-06-02T16:31:06+01:00',
  'outbound-reply',
  'SM79fd65f23483667a24cb456520c5711c'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447985751794',
  '+447700106752',
  'Hi there thank you so much for confirming. We are looking forward to it. See you soon xx',
  'received',
  '2024-06-02T16:31:06+01:00',
  'inbound',
  'SMe4d907fc85e4558697a1efc3699e7d03'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447873284453',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2024-06-01T20:31:48+01:00',
  'outbound-reply',
  'SMc22497e393a45a2ddd6a1f42a9115951'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447873284453',
  '+447700106752',
  'Thanks',
  'received',
  '2024-06-01T20:31:47+01:00',
  'inbound',
  'SMa2f6554e70e24455f03d9d0a3cbd900a'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447700106752',
  '+447725119000',
  'Thanks for the message. Configure your number''s SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.Msg&Data rates may apply.',
  'delivered',
  '2024-06-01T20:30:27+01:00',
  'outbound-reply',
  'SM87daaa6046e0e1d7fd92e9e25ed00373'
);
INSERT INTO temp_message_import (from_number, to_number, body, status, sent_date, direction, sid) VALUES (
  '+447725119000',
  '+447700106752',
  'Hi thank you 😊 it''s Debbie 😆😆',
  'received',
  '2024-06-01T20:30:27+01:00',
  'inbound',
  'SM393e997f0e7cc05963ba9b2fe3609b98'
);

-- Execute the import and show results
SELECT * FROM import_message_history();

-- Clean up
DROP FUNCTION IF EXISTS import_message_history();
DROP FUNCTION IF EXISTS find_customer_by_phone(TEXT);
DROP FUNCTION IF EXISTS clean_phone_for_match(TEXT);
