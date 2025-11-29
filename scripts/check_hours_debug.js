
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or Key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkHours() {
  console.log('Checking Sunday business hours...');
  
  const { data: businessHours, error } = await supabase
    .from('business_hours')
    .select('*')
    .eq('day_of_week', 0); // Sunday

  if (error) {
    console.error('Error fetching business hours:', error);
    return;
  }

  console.log('Business Hours for Sunday:', JSON.stringify(businessHours, null, 2));

  console.log('Checking Special Hours for 2025-12-07...');
  const { data: specialHours, error: specialError } = await supabase
    .from('special_hours')
    .select('*')
    .eq('date', '2025-12-07');

  if (specialError) {
    console.error('Error fetching special hours:', specialError);
    return;
  }

  console.log('Special Hours for 2025-12-07:', JSON.stringify(specialHours, null, 2));
}

checkHours();
