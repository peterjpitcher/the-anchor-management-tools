#!/usr/bin/env tsx

import * as dotenv from 'dotenv';
import path from 'path';
import { createAdminClient } from '../src/lib/supabase/server';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkPendingBooking() {
  const token = process.argv[2];
  
  if (!token) {
    console.error('Usage: tsx scripts/check-pending-booking.ts <token>');
    console.error('Example: tsx scripts/check-pending-booking.ts 5a9b40fd-3f59-4352-8960-ab04324324d9');
    process.exit(1);
  }

  console.log(`🔍 Checking pending booking with token: ${token}\n`);
  
  const supabase = createAdminClient();
  
  // 1. Check the pending booking
  console.log('1. Checking pending_bookings table...');
  const { data: pendingBooking, error: pbError } = await supabase
    .from('pending_bookings')
    .select('*')
    .eq('token', token)
    .single();
    
  if (pbError) {
    console.error('❌ Error fetching pending booking:', pbError);
    return;
  }
  
  if (!pendingBooking) {
    console.error('❌ No pending booking found with this token');
    return;
  }
  
  console.log('✅ Found pending booking:');
  console.log(JSON.stringify(pendingBooking, null, 2));
  
  // 2. Check if the event exists
  console.log('\n2. Checking if event exists...');
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('*')
    .eq('id', pendingBooking.event_id)
    .single();
    
  if (eventError) {
    console.error('❌ Error fetching event:', eventError);
  } else if (!event) {
    console.error('❌ Event does not exist with ID:', pendingBooking.event_id);
  } else {
    console.log('✅ Event found:');
    console.log(JSON.stringify(event, null, 2));
  }
  
  // 3. Check if customer exists (if customer_id is present)
  if (pendingBooking.customer_id) {
    console.log('\n3. Checking if customer exists...');
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', pendingBooking.customer_id)
      .single();
      
    if (customerError) {
      console.error('❌ Error fetching customer:', customerError);
    } else if (!customer) {
      console.error('❌ Customer does not exist with ID:', pendingBooking.customer_id);
    } else {
      console.log('✅ Customer found:');
      console.log(JSON.stringify(customer, null, 2));
    }
  } else {
    console.log('\n3. No customer_id (new customer)');
  }
  
  // 4. Test the full query that the page uses
  console.log('\n4. Testing the full query used by the booking confirmation page...');
  const { data: fullQuery, error: fullError } = await supabase
    .from('pending_bookings')
    .select(`
      id,
      token,
      event_id,
      mobile_number,
      customer_id,
      expires_at,
      confirmed_at,
      metadata,
      event:events(
        id,
        name,
        date,
        time,
        capacity
      ),
      customer:customers(
        id,
        first_name,
        last_name
      )
    `)
    .eq('token', token)
    .single();
    
  if (fullError) {
    console.error('❌ Full query failed:', fullError);
  } else if (!fullQuery) {
    console.error('❌ Full query returned no data');
  } else {
    console.log('✅ Full query succeeded:');
    console.log(JSON.stringify(fullQuery, null, 2));
  }
  
  // 5. Check expiry
  console.log('\n5. Checking expiry...');
  const expiresAt = new Date(pendingBooking.expires_at);
  const now = new Date();
  
  console.log(`Expires at: ${expiresAt.toISOString()}`);
  console.log(`Current time: ${now.toISOString()}`);
  console.log(`Valid for: ${Math.round((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60))} hours`);
  
  if (expiresAt < now) {
    console.log('❌ Token has expired');
  } else {
    console.log('✅ Token is still valid');
  }
}

checkPendingBooking().catch(console.error);