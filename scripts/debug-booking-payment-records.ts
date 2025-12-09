
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

async function checkPayment() {
  const { data: booking, error: bookingError } = await supabase
    .from('table_bookings')
    .select('id')
    .eq('booking_reference', 'TB-2025-0500')
    .single();

  if (bookingError || !booking) {
      console.error("Booking not found");
      return;
  }

  const { data: payments, error } = await supabase
    .from('table_booking_payments')
    .select('*')
    .eq('booking_id', booking.id);

  if (error) {
    console.error('Error fetching payments:', error);
    return;
  }

  console.log('Payment Records:');
  console.log(JSON.stringify(payments, null, 2));
}

checkPayment();
