import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// UK phone number regex pattern from the migration
const phoneRegex = /^(\+?44|0)?[0-9]{10,11}$/;

function cleanPhoneNumber(phone: string): { cleaned: string; valid: boolean } {
  let cleaned = phone;
  
  // Remove common formatting characters
  cleaned = cleaned.replace(/[\s\-\(\)\.]/g, '');
  
  // Handle country codes
  if (cleaned.startsWith('+44')) {
    cleaned = cleaned.substring(3); // Remove +44
    cleaned = '0' + cleaned; // Add leading 0
  } else if (cleaned.startsWith('44') && cleaned.length > 11) {
    cleaned = cleaned.substring(2); // Remove 44
    cleaned = '0' + cleaned; // Add leading 0
  } else if (!cleaned.startsWith('0') && cleaned.length === 10) {
    cleaned = '0' + cleaned; // Add missing leading 0
  }
  
  // Remove any non-digit characters
  cleaned = cleaned.replace(/[^0-9]/g, '');
  
  // Check validity
  const valid = phoneRegex.test(cleaned);
  
  return { cleaned, valid };
}

async function cleanupPhoneNumbers() {
  console.log('Starting phone number cleanup...\n');

  // Get all customers with phone numbers
  const { data: customers, error } = await supabase
    .from('customers')
    .select('id, first_name, last_name, mobile_number')
    .not('mobile_number', 'is', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching customers:', error);
    return;
  }

  let updated = 0;
  let failed = 0;
  const failedCustomers: any[] = [];

  console.log(`Checking ${customers.length} customers...\n`);

  for (const customer of customers) {
    const { cleaned, valid } = cleanPhoneNumber(customer.mobile_number);
    
    if (cleaned !== customer.mobile_number) {
      if (valid) {
        // Update the customer record
        const { error: updateError } = await supabase
          .from('customers')
          .update({ mobile_number: cleaned })
          .eq('id', customer.id);
        
        if (updateError) {
          console.error(`Failed to update customer ${customer.id}:`, updateError);
          failed++;
          failedCustomers.push(customer);
        } else {
          console.log(`✓ Updated ${customer.first_name} ${customer.last_name}: "${customer.mobile_number}" → "${cleaned}"`);
          updated++;
        }
      } else {
        console.log(`✗ Cannot fix ${customer.first_name} ${customer.last_name}: "${customer.mobile_number}" (invalid format)`);
        failed++;
        failedCustomers.push(customer);
      }
    }
  }

  console.log('\n=====================================');
  console.log(`Cleanup Summary:`);
  console.log(`- Total customers checked: ${customers.length}`);
  console.log(`- Successfully updated: ${updated}`);
  console.log(`- Failed to fix: ${failed}`);
  console.log('=====================================\n');

  if (failedCustomers.length > 0) {
    console.log('Failed customers that need manual intervention:');
    failedCustomers.forEach((customer, index) => {
      console.log(`${index + 1}. ${customer.first_name} ${customer.last_name} (ID: ${customer.id}): "${customer.mobile_number}"`);
    });
    
    console.log('\nThese phone numbers need to be manually corrected in the database.');
    console.log('They should follow the format: 07xxxxxxxxx or 01xxxxxxxxx (11 digits starting with 0)');
  } else {
    console.log('✅ All phone numbers have been successfully cleaned!');
    console.log('\nYou can now run the migration again.');
  }
}

// Ask for confirmation before running
console.log('This script will update customer phone numbers in the database.');
console.log('It will clean formatting and attempt to fix common issues.');
console.log('\nPress Ctrl+C to cancel, or wait 5 seconds to continue...\n');

setTimeout(() => {
  cleanupPhoneNumbers().catch(console.error);
}, 5000);