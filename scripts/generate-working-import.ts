import fs from 'fs';
import path from 'path';

interface TwilioMessage {
  From: string;
  To: string;
  Body: string;
  Status: string;
  SentDate: string;
  Direction: string;
  Sid: string;
}

function parseTwilioExport(filePath: string): TwilioMessage[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  
  const dataLines = lines.slice(2);
  const messages: TwilioMessage[] = [];
  
  for (const line of dataLines) {
    const cleanLine = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    const parts = cleanLine.split(' | ').map(part => part.trim());
    
    if (parts.length < 7) continue;
    
    messages.push({
      From: parts[0],
      To: parts[1],
      Body: parts[2],
      Status: parts[3],
      SentDate: parts[4],
      Direction: parts[5],
      Sid: parts[6]
    });
  }
  
  return messages;
}

function escapeString(str: string): string {
  return str.replace(/'/g, "''");
}

function generateWorkingSQL(messages: TwilioMessage[]): string {
  const statements: string[] = [];
  
  // Header
  statements.push(`-- Working import script for message history
-- Generated from Twilio export

-- Create helper functions
CREATE OR REPLACE FUNCTION clean_phone_for_match(phone TEXT)
RETURNS TEXT AS $$
BEGIN
  phone := regexp_replace(phone, '[^0-9]', '', 'g');
  IF phone LIKE '44%' THEN
    RETURN '+' || phone;
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
  clean_phone := clean_phone_for_match(phone);
  variants := ARRAY[
    phone,
    clean_phone,
    regexp_replace(clean_phone, '^\\+44', '0'),
    regexp_replace(clean_phone, '^\\+', '')
  ];
  
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

-- Import messages
DO $$
DECLARE
  imported INT := 0;
  skipped INT := 0;
  duplicates INT := 0;
  errors INT := 0;
  cust_id UUID;
BEGIN`);

  // Generate import statements for each message
  for (const msg of messages) {
    const direction = msg.Direction === 'inbound' ? 'inbound' : 'outbound';
    const customerPhone = msg.Direction === 'inbound' ? msg.From : msg.To;
    
    statements.push(`
  -- Message ${msg.Sid}
  IF NOT EXISTS (SELECT 1 FROM messages WHERE message_sid = '${msg.Sid}') THEN
    cust_id := find_customer_by_phone('${customerPhone}');
    
    IF cust_id IS NOT NULL THEN
      BEGIN
        INSERT INTO messages (
          customer_id, direction, message_sid, twilio_message_sid, body, status, twilio_status,
          from_number, to_number, message_type, created_at, read_at
        ) VALUES (
          cust_id, '${direction}', '${msg.Sid}', '${msg.Sid}',
          '${escapeString(msg.Body)}', '${msg.Status}', '${msg.Status}',
          '${msg.From}', '${msg.To}', 'sms',
          '${msg.SentDate}'::timestamp with time zone, NOW()
        );
        imported := imported + 1;
      EXCEPTION WHEN OTHERS THEN
        errors := errors + 1;
        IF errors <= 5 THEN
          RAISE NOTICE 'Error importing %: %', '${msg.Sid}', SQLERRM;
        END IF;
      END;
    ELSE
      skipped := skipped + 1;
    END IF;
  ELSE
    duplicates := duplicates + 1;
  END IF;`);
  }

  // Footer
  statements.push(`
  RAISE NOTICE 'Import complete: Imported=%, Skipped=%, Duplicates=%, Errors=%', 
    imported, skipped, duplicates, errors;
END;
$$;

-- Clean up functions
DROP FUNCTION IF EXISTS find_customer_by_phone(TEXT);
DROP FUNCTION IF EXISTS clean_phone_for_match(TEXT);`);

  return statements.join('\n');
}

// Process files
const tempDir = path.join(__dirname, '../temporary');
const files = fs.readdirSync(tempDir).filter(f => f.startsWith('sms-log-') && f.endsWith('.md'));

console.log(`Found ${files.length} files to process`);

let allMessages: TwilioMessage[] = [];
for (const file of files) {
  console.log(`Processing ${file}...`);
  const messages = parseTwilioExport(path.join(tempDir, file));
  console.log(`  Found ${messages.length} messages`);
  allMessages = allMessages.concat(messages);
}

console.log(`\nTotal messages: ${allMessages.length}`);
console.log(`Generating SQL...`);

const sql = generateWorkingSQL(allMessages);
const outputPath = path.join(__dirname, '../supabase/migrations/20241215_final_working_import.sql');
fs.writeFileSync(outputPath, sql);

console.log(`\nSQL migration generated: ${outputPath}`);
console.log('This version:');
console.log('- Checks for duplicates before inserting');
console.log('- Handles errors gracefully');
console.log('- Shows detailed progress');
console.log('- Works with current table structure');