import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function run() {
  const { data, error } = await sb.from('employees').select('employee_id,first_name,last_name,email_address,status,job_title');
  if (error) { console.error(error); return; }
  console.log('All employees:');
  data?.forEach(e => console.log(`  ${e.first_name} ${e.last_name} | ${e.email_address ?? 'no email'} | ${e.status} | ${e.job_title ?? 'no title'}`));
}
run().catch(console.error);
