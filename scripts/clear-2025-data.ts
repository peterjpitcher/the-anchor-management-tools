
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

async function clear2025Data() {
  console.log('🧹 Clearing Cashing Up data for 2025...');

  const startDate = '2025-01-01';
  const endDate = '2025-12-31';

  // 1. Get IDs of sessions to delete
  const { data: sessions, error: fetchError } = await supabase
    .from('cashup_sessions')
    .select('id')
    .gte('session_date', startDate)
    .lte('session_date', endDate);

  if (fetchError) {
    console.error('Error fetching sessions:', fetchError);
    return;
  }

  if (!sessions || sessions.length === 0) {
    console.log('No sessions found for 2025.');
    return;
  }

  const sessionIds = sessions.map(s => s.id);
  console.log(`Found ${sessionIds.length} sessions to delete.`);

  // 2. Delete Cash Counts (Cascade should handle this, but explicit delete is safer/cleaner if cascade fails)
  // Actually, FK constraints usually have ON DELETE CASCADE. Let's check migration.
  // Migration 20251122000000_cashing_up_module.sql:
  // cashup_cash_counts ... REFERENCES cashup_sessions(id) ON DELETE CASCADE
  // cashup_payment_breakdowns ... REFERENCES cashup_sessions(id) ON DELETE CASCADE
  // So deleting sessions is sufficient.

  // 3. Delete Sessions
  const { error: deleteError, count } = await supabase
    .from('cashup_sessions')
    .delete()
    .in('id', sessionIds);

  if (deleteError) {
    console.error('Error deleting sessions:', deleteError);
  } else {
    console.log(`✅ Successfully deleted ${sessionIds.length} sessions (and related records via cascade).`);
  }
}

clear2025Data().catch(console.error);
