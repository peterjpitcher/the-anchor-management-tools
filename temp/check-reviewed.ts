import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { count: reviewed } = await supabase.from('timeclock_sessions').select('*', { count: 'exact', head: true }).eq('is_reviewed', true);
  const { count: total } = await supabase.from('timeclock_sessions').select('*', { count: 'exact', head: true });
  console.log(`Total: ${total}, Still reviewed=true: ${reviewed}`);
}

main().catch(console.error);
