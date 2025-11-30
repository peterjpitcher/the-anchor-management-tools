
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

async function testUpdate() {
  console.log('--- Testing Update Sunday Hours ---');

  // 1. Get existing Sunday data to simulate form submission
  const { data: sunday } = await supabase
    .from('business_hours')
    .select('*')
    .eq('day_of_week', 0)
    .single();

  if (!sunday) {
    console.error('Sunday not found');
    return;
  }

  console.log('Current Sunday Config:', sunday.schedule_config);

  // 2. Modify the config
  const newConfig = [...sunday.schedule_config];
  const lunchIndex = newConfig.findIndex((c: any) => c.booking_type === 'sunday_lunch');
  if (lunchIndex !== -1) {
    newConfig[lunchIndex] = { ...newConfig[lunchIndex], starts_at: '13:00' };
  } else {
    console.log('Sunday lunch config not found, adding it');
    newConfig.push({
        name: 'Sunday Lunch',
        booking_type: 'sunday_lunch',
        starts_at: '13:00',
        ends_at: '17:00',
        capacity: 50
    });
  }

  console.log('New Config to Save:', newConfig);

  // 3. Construct FormData-like object and call the service logic manually
  // (We can't easily import the service because of Next.js 'use server' context issues in a standalone script,
  // so we'll mimic the DB update directly to see if the DB rejects it).
  
  const updatePayload = {
    ...sunday,
    schedule_config: newConfig,
    updated_at: new Date().toISOString()
  };

  console.log('Attempting DB Update...');
  const { data, error } = await supabase
    .from('business_hours')
    .update(updatePayload)
    .eq('day_of_week', 0)
    .select();

  if (error) {
    console.error('DB Update Failed:', error);
  } else {
    console.log('DB Update Success:', data);
  }
}

testUpdate();
