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

async function checkInvalidPhoneNumbers() {
  console.log('Checking for customers with invalid phone numbers...\n');

  // Get all customers
  const { data: customers, error } = await supabase
    .from('customers')
    .select('id, first_name, last_name, mobile_number')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching customers:', error);
    return;
  }

  const invalidCustomers = customers.filter(customer => {
    if (!customer.mobile_number) return false;
    return !phoneRegex.test(customer.mobile_number);
  });

  console.log(`Total customers: ${customers.length}`);
  console.log(`Customers with invalid phone numbers: ${invalidCustomers.length}\n`);

  if (invalidCustomers.length > 0) {
    console.log('Invalid phone numbers found:');
    console.log('=====================================');
    
    invalidCustomers.forEach((customer, index) => {
      console.log(`\n${index + 1}. ${customer.first_name} ${customer.last_name} (ID: ${customer.id})`);
      console.log(`   Current: "${customer.mobile_number}"`);
      
      // Suggest fixes
      let suggested = customer.mobile_number;
      
      // Remove common formatting characters
      suggested = suggested.replace(/[\s\-\(\)\.]/g, '');
      
      // Check if it's already got country code
      if (suggested.startsWith('+44')) {
        suggested = suggested.substring(3); // Remove +44
        suggested = '0' + suggested; // Add leading 0
      } else if (suggested.startsWith('44')) {
        suggested = suggested.substring(2); // Remove 44
        suggested = '0' + suggested; // Add leading 0
      } else if (!suggested.startsWith('0') && suggested.length === 10) {
        suggested = '0' + suggested; // Add missing leading 0
      }
      
      // Remove any non-digit characters
      suggested = suggested.replace(/[^0-9]/g, '');
      
      const isValidAfterFix = phoneRegex.test(suggested);
      console.log(`   Suggested: "${suggested}" ${isValidAfterFix ? '✓' : '✗'}`);
      
      if (!isValidAfterFix) {
        console.log(`   WARNING: Cannot auto-fix this number`);
      }
    });
    
    console.log('\n=====================================');
    console.log('\nTo fix these issues, you can either:');
    console.log('1. Run the cleanup script to auto-fix phone numbers');
    console.log('2. Update the migration to clean data before applying constraints');
    console.log('3. Manually fix the phone numbers in the database');
  } else {
    console.log('✅ All customer phone numbers are valid!');
  }
}

checkInvalidPhoneNumbers().catch(console.error);