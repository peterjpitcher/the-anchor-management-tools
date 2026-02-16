#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

// UK phone number regex pattern from the migration
const phoneRegex = /^(\+?44|0)?[0-9]{10,11}$/;

async function checkInvalidPhoneNumbers() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-invalid-phone-numbers is strictly read-only; do not pass --confirm.')
  }

  const supabase = createAdminClient()

  console.log('Checking for customers with invalid phone numbers...\n');

  // Get all customers
  const { data: customers, error } = await supabase
    .from('customers')
    .select('id, first_name, last_name, mobile_number')
    .order('created_at', { ascending: true });

  if (error) {
    markFailure('Error fetching customers.', error)
    return
  }

  const rows = (assertScriptQuerySucceeded({
    operation: 'Load customers for phone validation',
    error: null,
    data: customers ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    first_name: string | null
    last_name: string | null
    mobile_number: string | null
  }>

  const invalidCustomers = rows.filter(customer => {
    if (!customer.mobile_number) return false
    return !phoneRegex.test(customer.mobile_number)
  });

  console.log(`Total customers: ${rows.length}`)
  console.log(`Customers with invalid phone numbers: ${invalidCustomers.length}\n`)

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

void checkInvalidPhoneNumbers().catch((error) => {
  markFailure('check-invalid-phone-numbers failed.', error)
})
