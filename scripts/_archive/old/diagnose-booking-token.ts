import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function diagnoseBookingToken(token: string) {
  console.log('🔍 Diagnosing Booking Token:', token);
  console.log('=' .repeat(60));
  
  try {
    // 1. Check pending_bookings table
    console.log('\n1️⃣ Checking pending_bookings table...');
    const { data: pendingBookings, error: pbError } = await supabase
      .from('pending_bookings')
      .select('*')
      .eq('token', token);
      
    if (pbError) {
      console.error('❌ Error querying pending_bookings:', pbError);
    } else {
      console.log(`✅ Found ${pendingBookings?.length || 0} pending booking(s)`);
      if (pendingBookings && pendingBookings.length > 0) {
        pendingBookings.forEach((pb, i) => {
          console.log(`\nPending Booking ${i + 1}:`);
          console.log('  ID:', pb.id);
          console.log('  Token:', pb.token);
          console.log('  Event ID:', pb.event_id);
          console.log('  Mobile:', pb.mobile_number);
          console.log('  Customer ID:', pb.customer_id);
          console.log('  Expires:', new Date(pb.expires_at).toLocaleString());
          console.log('  Confirmed:', pb.confirmed_at ? new Date(pb.confirmed_at).toLocaleString() : 'No');
          console.log('  Created:', new Date(pb.created_at).toLocaleString());
        });
      }
    }
    
    // 2. Try the exact query from the page (without joins first)
    console.log('\n2️⃣ Testing page query (without joins)...');
    const { data: singleData, error: singleError } = await supabase
      .from('pending_bookings')
      .select('*')
      .eq('token', token)
      .single();
      
    if (singleError) {
      console.error('❌ Single query error:', singleError.message);
      console.error('   Error code:', singleError.code);
      console.error('   Full error:', JSON.stringify(singleError, null, 2));
    } else {
      console.log('✅ Single query successful');
    }
    
    // 3. Check if there are any other tokens that might be similar
    console.log('\n3️⃣ Checking for similar tokens...');
    const tokenPrefix = token.substring(0, 8);
    const { data: similarTokens } = await supabase
      .from('pending_bookings')
      .select('token, created_at')
      .like('token', `${tokenPrefix}%`)
      .order('created_at', { ascending: false })
      .limit(5);
      
    if (similarTokens && similarTokens.length > 0) {
      console.log(`Found ${similarTokens.length} token(s) starting with ${tokenPrefix}:`);
      similarTokens.forEach(t => {
        console.log(`  ${t.token} (created: ${new Date(t.created_at).toLocaleString()})`);
      });
    }
    
    // 4. Check the event if we found a pending booking
    if (pendingBookings && pendingBookings.length > 0) {
      const eventId = pendingBookings[0].event_id;
      console.log('\n4️⃣ Checking associated event...');
      const { data: event, error: eventError } = await supabase
        .from('events')
        .select('id, name, date, time, capacity')
        .eq('id', eventId)
        .single();
        
      if (eventError) {
        console.error('❌ Error fetching event:', eventError.message);
      } else if (event) {
        console.log('✅ Event found:');
        console.log('  Name:', event.name);
        console.log('  Date:', event.date);
        console.log('  Time:', event.time);
        console.log('  Capacity:', event.capacity);
      }
    }
    
    // 5. Test with RLS as anonymous user
    console.log('\n5️⃣ Testing with anonymous access (simulating public page)...');
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const anonSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      anonKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );
    
    const { data: anonData, error: anonError } = await anonSupabase
      .from('pending_bookings')
      .select('*')
      .eq('token', token)
      .single();
      
    if (anonError) {
      console.error('❌ Anonymous access error:', anonError.message);
      console.error('   This might be an RLS policy issue');
    } else {
      console.log('✅ Anonymous access successful');
    }
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Get token from command line
const token = process.argv[2];
if (!token) {
  console.error('❌ Please provide a token as an argument');
  console.error('Usage: tsx scripts/diagnose-booking-token.ts <token>');
  process.exit(1);
}

diagnoseBookingToken(token);