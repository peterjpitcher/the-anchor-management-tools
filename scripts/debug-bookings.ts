import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkBookings() {
  console.log('Checking private bookings...');

  // Fetch all bookings
  const { data: bookings, error } = await supabase
    .from('private_bookings')
    .select('id, event_date, status, customer_name, event_type');

  if (error) {
    console.error('Error fetching bookings:', error);
    return;
  }

  console.log(`Found ${bookings?.length} bookings:`);
  bookings?.forEach(b => {
    console.log(`- ${b.event_date} | ${b.status} | ${b.customer_name}`);
  });
}

checkBookings();
