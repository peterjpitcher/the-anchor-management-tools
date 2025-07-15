#!/usr/bin/env tsx

import * as dotenv from 'dotenv';
import path from 'path';
import { createAdminClient } from '../src/lib/supabase/server';
import { generatePhoneVariants } from '../src/lib/utils';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkCustomerPhone() {
  const phone = process.argv[2] || '+447990587315';
  
  console.log(`🔍 Checking customer with phone: ${phone}\n`);
  
  const supabase = createAdminClient();
  const phoneVariants = generatePhoneVariants(phone);
  
  console.log('Phone variants to check:');
  console.log(phoneVariants);
  
  // Check customers table
  console.log('\n1. Checking customers table...');
  const { data: customers, error: customerError } = await supabase
    .from('customers')
    .select('id, first_name, last_name, mobile_number, sms_opt_in, sms_opt_out')
    .or(phoneVariants.map(variant => `mobile_number.eq.${variant}`).join(','));
    
  if (customerError) {
    console.error('❌ Error:', customerError);
  } else {
    console.log(`Found ${customers?.length || 0} customers:`);
    customers?.forEach(c => {
      console.log(`- ${c.first_name} ${c.last_name} (${c.mobile_number}) - ID: ${c.id}`);
    });
  }
  
  // Check recent pending bookings
  console.log('\n2. Checking recent pending bookings...');
  const { data: pendingBookings, error: pbError } = await supabase
    .from('pending_bookings')
    .select('*')
    .eq('mobile_number', phone)
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (pbError) {
    console.error('❌ Error:', pbError);
  } else {
    console.log(`Found ${pendingBookings?.length || 0} pending bookings:`);
    pendingBookings?.forEach(pb => {
      console.log(`- Token: ${pb.token}`);
      console.log(`  Customer ID: ${pb.customer_id || 'NULL'}`);
      console.log(`  Created: ${pb.created_at}`);
    });
  }
}

checkCustomerPhone().catch(console.error);