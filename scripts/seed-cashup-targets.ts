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

const DEFAULT_TARGETS = [
  { day_of_week: 1, amount: 350 },  // Monday
  { day_of_week: 2, amount: 450 },  // Tuesday
  { day_of_week: 3, amount: 600 },  // Wednesday
  { day_of_week: 4, amount: 600 },  // Thursday
  { day_of_week: 5, amount: 950 },  // Friday
  { day_of_week: 6, amount: 1400 }, // Saturday
  { day_of_week: 0, amount: 800 },  // Sunday
];

async function seedTargets() {
  console.log('Seeding cashup targets...');

  // Get the first site ID (assuming single site for now based on previous context)
  const { data: sites, error: siteError } = await supabase
    .from('sites')
    .select('id')
    .limit(1)
    .single();

  if (siteError || !sites) {
    console.error('Error fetching site:', siteError);
    return;
  }

  const siteId = sites.id;
  const effectiveFrom = '2024-01-01'; // Set to a past date so it applies to now

  const rows = DEFAULT_TARGETS.map(t => ({
    site_id: siteId,
    day_of_week: t.day_of_week,
    target_amount: t.amount,
    effective_from: effectiveFrom,
    // No user ID needed for admin seed or can use a system ID if required, but RLS might be bypassed by service key
  }));

  const { error } = await supabase
    .from('cashup_targets')
    .upsert(rows, { onConflict: 'site_id, day_of_week, effective_from' });

  if (error) {
    console.error('Error seeding targets:', error);
  } else {
    console.log('Successfully seeded default targets for site:', siteId);
  }
}

seedTargets();
