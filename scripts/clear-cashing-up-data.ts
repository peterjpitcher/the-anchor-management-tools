import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Missing Supabase URL or Service Role Key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function clearCashingUpData() {
  console.log('🧹 Clearing Cashing Up data...');

  // 1. Delete Cash Counts
  const { error: countsError, count: countsCount } = await supabase
    .from('cashup_cash_counts')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000'); // Hack to match all rows, or use empty filter with allow delete policy if needed, but service role bypasses RLS.
    // Actually, without a WHERE clause, delete() might be blocked by Supabase safety unless 'neq' or similar is used, or if we allow full table delete. 
    // Using a condition that is always true like id IS NOT NULL is safer for the library.
    // But usually delete() requires a filter. 
    // Let's use .gt('id', '00000000-0000-0000-0000-000000000000') assuming UUIDs.
  
  // Better approach: Select all IDs first? No, that's slow.
  // .neq('id', '00000000-0000-0000-0000-000000000000') is a common pattern for "all".
  // Or just .not('id', 'is', null)

  if (countsError) {
    console.error('Error deleting cash counts:', countsError);
  } else {
    console.log(`Deleted cash counts.`);
  }

  // 2. Delete Payment Breakdowns
  const { error: breakdownsError } = await supabase
    .from('cashup_payment_breakdowns')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (breakdownsError) {
    console.error('Error deleting payment breakdowns:', breakdownsError);
  } else {
    console.log(`Deleted payment breakdowns.`);
  }

  // 3. Delete Sessions
  const { error: sessionsError } = await supabase
    .from('cashup_sessions')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (sessionsError) {
    console.error('Error deleting sessions:', sessionsError);
  } else {
    console.log(`Deleted sessions.`);
  }

  console.log('✅ Cashing Up data cleared!');
}

clearCashingUpData().catch(console.error);
