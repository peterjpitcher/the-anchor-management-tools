import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function run() {
  const tables = ['rota_published_shifts', 'rota_weeks', 'rota_shifts', 'timeclock_sessions', 'leave_requests', 'leave_days'];
  for (const t of tables) {
    const { count, error } = await sb.from(t).select('*', { count: 'exact', head: true });
    console.log(`${t}: ${error ? '❌ ' + error.message : count + ' rows'}`);
  }

  // Check system_settings for rota keys  
  const { data: settings } = await sb.from('system_settings').select('key,value').ilike('key', '%rota%');
  console.log('\nsystem_settings rota keys:', JSON.stringify(settings));
}
run().catch(console.error);
