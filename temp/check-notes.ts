import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function run() {
  const { data, error } = await sb.from('timeclock_sessions')
    .select('work_date,manager_note,employee_id')
    .not('manager_note', 'is', null)
    .order('work_date')
    .limit(10);
  if (error) { console.error(error); return; }
  console.log(`Sessions with manager_note: (showing first 10)`);
  data?.forEach(r => console.log(`  ${r.work_date}: "${r.manager_note}"`));

  const { count } = await sb.from('timeclock_sessions')
    .select('*', { count: 'exact', head: true })
    .not('manager_note', 'is', null);
  console.log(`\nTotal sessions with notes: ${count}`);

  const { count: total } = await sb.from('timeclock_sessions')
    .select('*', { count: 'exact', head: true });
  console.log(`Total sessions: ${total}`);
}
run().catch(console.error);
