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

async function checkBookingDuplicates() {
  console.log('🔍 Checking for Booking Issues...\n');
  
  try {
    // 1. Check for duplicate tokens (should be impossible due to unique constraint)
    console.log('1️⃣ Checking for duplicate tokens...');
    const { data: allBookings } = await supabase
      .from('pending_bookings')
      .select('token, id, created_at')
      .order('created_at', { ascending: false });
      
    if (allBookings) {
      const tokenCounts = new Map<string, number>();
      allBookings.forEach(booking => {
        const count = tokenCounts.get(booking.token) || 0;
        tokenCounts.set(booking.token, count + 1);
      });
      
      const duplicates = Array.from(tokenCounts.entries()).filter(([_, count]) => count > 1);
      if (duplicates.length > 0) {
        console.log('❌ Found duplicate tokens:');
        duplicates.forEach(([token, count]) => {
          console.log(`   Token ${token}: ${count} occurrences`);
        });
      } else {
        console.log('✅ No duplicate tokens found');
      }
    }
    
    // 2. Check for bookings with missing events
    console.log('\n2️⃣ Checking for bookings with missing events...');
    const { data: bookingsWithEvents } = await supabase
      .from('pending_bookings')
      .select(`
        id,
        token,
        event_id,
        events!inner(id)
      `);
      
    const { data: allPendingBookings } = await supabase
      .from('pending_bookings')
      .select('id, token, event_id');
      
    if (allPendingBookings && bookingsWithEvents) {
      const missingEvents = allPendingBookings.filter(
        pb => !bookingsWithEvents.find(bwe => bwe.id === pb.id)
      );
      
      if (missingEvents.length > 0) {
        console.log(`❌ Found ${missingEvents.length} bookings with missing events:`);
        missingEvents.forEach(pb => {
          console.log(`   Token: ${pb.token}, Event ID: ${pb.event_id}`);
        });
      } else {
        console.log('✅ All bookings have valid events');
      }
    }
    
    // 3. Check recent errors in the last hour
    console.log('\n3️⃣ Checking recent pending bookings (last hour)...');
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentBookings } = await supabase
      .from('pending_bookings')
      .select('token, created_at, confirmed_at, expires_at')
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: false });
      
    if (recentBookings && recentBookings.length > 0) {
      console.log(`Found ${recentBookings.length} recent bookings:`);
      recentBookings.forEach(booking => {
        const status = booking.confirmed_at ? 'Confirmed' : 
                      new Date(booking.expires_at) < new Date() ? 'Expired' : 'Pending';
        console.log(`   ${booking.token.substring(0, 8)}... - ${status} (created: ${new Date(booking.created_at).toLocaleTimeString()})`);
      });
    } else {
      console.log('No recent bookings in the last hour');
    }
    
    // 4. Test RLS policies
    console.log('\n4️⃣ Testing RLS policies...');
    
    // Test as anonymous user
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
    
    const { count: anonCount, error: anonError } = await anonSupabase
      .from('pending_bookings')
      .select('*', { count: 'exact', head: true });
      
    if (anonError) {
      console.log('❌ Anonymous users cannot access pending_bookings:', anonError.message);
    } else {
      console.log(`✅ Anonymous users can see ${anonCount} pending bookings`);
    }
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

checkBookingDuplicates();