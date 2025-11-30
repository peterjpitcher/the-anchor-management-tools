
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function debugBusinessHours() {
  console.log('--- Debugging Business Hours (Sunday) ---');

  // 1. Fetch current state
  const { data: sunday, error } = await supabase
    .from('business_hours')
    .select('*')
    .eq('day_of_week', 0)
    .single();

  if (error) {
    console.error('Error fetching Sunday hours:', error);
    return;
  }

  console.log('Current Sunday DB Record:');
  console.log(JSON.stringify(sunday, null, 2));

  const config = sunday.schedule_config;
  console.log('Schedule Config:', JSON.stringify(config, null, 2));

  if (Array.isArray(config)) {
      const lunch = config.find((c: any) => c.booking_type === 'sunday_lunch');
      console.log('Found Sunday Lunch Config:', lunch);
  } else {
      console.log('Config is not an array');
  }
}

debugBusinessHours();
