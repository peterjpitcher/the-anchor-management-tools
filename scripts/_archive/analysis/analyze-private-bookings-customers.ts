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

async function analyze() {
  console.log('🔍 Analyzing Private Bookings Customer Data...\n');
  
  // Count private bookings without customer_id
  const { count: standalone } = await supabase
    .from('private_bookings')
    .select('*', { count: 'exact', head: true })
    .is('customer_id', null);
    
  // Count total private bookings
  const { count: total } = await supabase
    .from('private_bookings')
    .select('*', { count: 'exact', head: true });
    
  if (!total || total === 0) {
    console.log('No private bookings found.');
    return;
  }
    
  console.log(`📊 Private Bookings Analysis:`);
  console.log(`   Total bookings: ${total}`);
  console.log(`   Without customer link: ${standalone} (${Math.round((standalone!/total)*100)}%)`);
  console.log(`\n🚨 Potential lost customers: ${standalone}`);
  
  // Get sample of standalone bookings
  const { data: samples } = await supabase
    .from('private_bookings')
    .select('id, customer_first_name, customer_last_name, contact_email, contact_phone, event_date')
    .is('customer_id', null)
    .order('event_date', { ascending: false })
    .limit(5);
    
  if (samples && samples.length > 0) {
    console.log('\n📋 Recent bookings without customer records:');
    samples.forEach((booking, i) => {
      console.log(`   ${i + 1}. ${booking.customer_first_name} ${booking.customer_last_name}`);
      console.log(`      Phone: ${booking.contact_phone || 'Not provided'}`);
      console.log(`      Email: ${booking.contact_email || 'Not provided'}`);
      console.log(`      Event: ${new Date(booking.event_date).toLocaleDateString()}\n`);
    });
  }
  
  // Check for potential duplicates
  console.log('🔍 Checking for potential duplicate customers...');
  const { data: privateBookings } = await supabase
    .from('private_bookings')
    .select('contact_phone')
    .is('customer_id', null)
    .not('contact_phone', 'is', null);
    
  if (privateBookings && privateBookings.length > 0) {
    const phones = privateBookings.map(b => b.contact_phone);
    
    // Check if these phones exist in customers table
    const { data: existingCustomers } = await supabase
      .from('customers')
      .select('mobile_number')
      .in('mobile_number', phones);
      
    if (existingCustomers && existingCustomers.length > 0) {
      console.log(`\n⚠️  Found ${existingCustomers.length} phone numbers that already exist in customers table!`);
      console.log('   These are missed linking opportunities.');
    }
  }
}

analyze();