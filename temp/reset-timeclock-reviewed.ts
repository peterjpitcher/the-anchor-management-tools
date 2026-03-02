import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { error, count } = await supabase
    .from('timeclock_sessions')
    .update({ is_reviewed: false })
    .eq('is_reviewed', true)
    .select('*', { count: 'exact', head: true });

  if (error) { console.error(error.message); process.exit(1); }
  console.log(`Reset ${count} sessions to is_reviewed = false`);
}

main().catch(console.error);
