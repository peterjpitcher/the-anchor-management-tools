import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function run() {
  const { data: depts } = await sb.from('departments').select('*');
  console.log('departments:', JSON.stringify(depts, null, 2));
  const { data: budgets } = await sb.from('department_budgets').select('*').order('budget_year').order('department');
  console.log('department_budgets:', JSON.stringify(budgets, null, 2));
}
run().catch(console.error);
