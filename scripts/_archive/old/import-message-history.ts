import { createClient } from '@supabase/supabase-js';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';

// Load environment variables
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface MessageImport {
  phone_number: string; // Customer's phone number
  direction: 'inbound' | 'outbound';
  body: string;
  timestamp: string; // ISO 8601 format
  status?: string;
  message_sid?: string;
}

async function findCustomerByPhone(phoneNumber: string) {
  // Clean the phone number
  const digitsOnly = phoneNumber.replace(/\D/g, '');
  
  // Create variants
  const variants = [];
  
  // If it's a UK number starting with 0
  if (phoneNumber.startsWith('0')) {
    variants.push(phoneNumber); // 07990587315
    variants.push('+44' + phoneNumber.substring(1)); // +447990587315
    variants.push('44' + phoneNumber.substring(1)); // 447990587315
  }
  
  // If it's already in international format
  if (phoneNumber.startsWith('+44') || digitsOnly.startsWith('44')) {
    const baseNumber = phoneNumber.startsWith('+') ? phoneNumber : '+' + phoneNumber;
    variants.push(baseNumber); // +447990587315
    variants.push(baseNumber.substring(1)); // 447990587315
    variants.push('0' + baseNumber.substring(3)); // 07990587315
  }
  
  // Try to find customer with any variant
  for (const variant of variants) {
    const { data: customers } = await supabase
      .from('customers')
      .select('id, mobile_number')
      .eq('mobile_number', variant)
      .limit(1);
    
    if (customers && customers.length > 0) {
      return customers[0];
    }
  }
  
  return null;
}

async function importMessages(csvPath: string) {
  // Read and parse CSV
  const fileContent = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true
  }) as MessageImport[];
  
  console.log(`Found ${records.length} messages to import`);
  
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const record of records) {
    try {
      // Find customer
      const customer = await findCustomerByPhone(record.phone_number);
      
      if (!customer) {
        console.log(`Skipping message - no customer found for ${record.phone_number}`);
        skipped++;
        continue;
      }
      
      // Prepare message data
      const messageData = {
        customer_id: customer.id,
        direction: record.direction,
        body: record.body,
        status: record.status || (record.direction === 'inbound' ? 'received' : 'delivered'),
        twilio_status: record.status || (record.direction === 'inbound' ? 'received' : 'delivered'),
        message_sid: record.message_sid || `IMPORT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        twilio_message_sid: record.message_sid || `IMPORT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        created_at: record.timestamp,
        from_number: record.direction === 'inbound' ? record.phone_number : process.env.TWILIO_PHONE_NUMBER,
        to_number: record.direction === 'outbound' ? record.phone_number : process.env.TWILIO_PHONE_NUMBER,
        message_type: 'sms',
        // Mark all imported messages as read
        read_at: new Date().toISOString()
      };
      
      const { error } = await supabase
        .from('messages')
        .insert(messageData);
      
      if (error) {
        console.error(`Error importing message for ${record.phone_number}:`, error);
        errors++;
      } else {
        imported++;
        console.log(`Imported ${record.direction} message for ${customer.mobile_number}`);
      }
      
    } catch (err) {
      console.error(`Error processing record:`, err);
      errors++;
    }
  }
  
  console.log('\nImport Summary:');
  console.log(`Total records: ${records.length}`);
  console.log(`Imported: ${imported}`);
  console.log(`Skipped (no customer): ${skipped}`);
  console.log(`Errors: ${errors}`);
}

// Check command line arguments
const csvPath = process.argv[2];

if (!csvPath) {
  console.log('Usage: npx tsx scripts/import-message-history.ts <path-to-csv>');
  console.log('\nCSV Format:');
  console.log('phone_number,direction,body,timestamp,status,message_sid');
  console.log('07990587315,inbound,"Hello, I would like to book",2024-12-01T10:30:00Z,received,');
  console.log('+447990587315,outbound,"Hi! Thanks for your message",2024-12-01T10:35:00Z,delivered,SM123456');
  process.exit(1);
}

// Run import
importMessages(csvPath).catch(console.error);