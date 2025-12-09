
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkBooking() {
  const { data: booking, error } = await supabase
    .from('table_bookings')
    .select('*')
    .eq('booking_reference', 'TB-2025-0500')
    .single();

  if (error) {
    console.error('Error fetching booking:', error);
    return;
  }

  console.log('Booking Details:');
  console.log(JSON.stringify(booking, null, 2));
}

checkBooking();
