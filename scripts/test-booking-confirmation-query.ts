import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../.env.local') });

async function testBookingConfirmationQuery() {
  console.log('Testing booking confirmation query...\n');

  // Use the anon key to simulate browser access
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  try {
    // First, test if we can access pending_bookings at all
    console.log('1. Testing basic access to pending_bookings...');
    const { data: basicData, error: basicError } = await supabase
      .from('pending_bookings')
      .select('id, token')
      .limit(1);

    if (basicError) {
      console.error('❌ Cannot access pending_bookings:', basicError);
      console.log('Error code:', basicError.code);
      console.log('Error message:', basicError.message);
      console.log('Error details:', JSON.stringify(basicError, null, 2));
    } else {
      console.log('✅ Can access pending_bookings table');
      console.log('Sample data:', basicData);
    }

    // Test the exact query from the booking confirmation page
    console.log('\n2. Testing full query with joins...');
    const testToken = 'test-token-that-doesnt-exist';
    const { data, error } = await supabase
      .from('pending_bookings')
      .select(`
        *,
        event:events(
          id,
          name,
          date,
          time,
          location,
          capacity
        ),
        customer:customers(
          id,
          first_name,
          last_name
        )
      `)
      .eq('token', testToken)
      .single();

    if (error) {
      console.error('❌ Query failed:', error);
      console.log('Error code:', error.code);
      console.log('Error message:', error.message);
      console.log('Error hint:', (error as any).hint);
      console.log('Error details:', JSON.stringify(error, null, 2));
    } else {
      console.log('✅ Query structure is valid');
      console.log('Data:', data);
    }

    // Test if we can access events table directly
    console.log('\n3. Testing direct access to events...');
    const { data: eventsData, error: eventsError } = await supabase
      .from('events')
      .select('id, name')
      .limit(1);

    if (eventsError) {
      console.error('❌ Cannot access events:', eventsError);
    } else {
      console.log('✅ Can access events table');
    }

    // Test if we can access customers table directly
    console.log('\n4. Testing direct access to customers...');
    const { data: customersData, error: customersError } = await supabase
      .from('customers')
      .select('id, first_name')
      .limit(1);

    if (customersError) {
      console.error('❌ Cannot access customers:', customersError);
    } else {
      console.log('✅ Can access customers table');
    }

    // Check RLS status
    console.log('\n5. Checking table information...');
    const { data: tableInfo, error: tableError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .in('table_name', ['pending_bookings', 'events', 'customers']);

    if (tableError) {
      console.log('Cannot access table information (this is normal for anon role)');
    } else {
      console.log('Tables found:', tableInfo?.map(t => t.table_name));
    }

  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

testBookingConfirmationQuery();