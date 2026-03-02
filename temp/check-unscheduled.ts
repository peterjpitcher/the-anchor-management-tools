import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: sessions } = await supabase
    .from('timeclock_sessions')
    .select('id, employee_id, work_date, clock_in_at, linked_shift_id, is_unscheduled')
    .eq('is_unscheduled', true)
    .order('work_date');

  console.log(`Total unscheduled sessions: ${sessions?.length ?? 0}\n`);

  let hasMatchingShift = 0;
  let noMatchingShift = 0;

  for (const s of sessions ?? []) {
    const { data: shifts } = await supabase
      .from('rota_shifts')
      .select('id, start_time, status')
      .eq('employee_id', s.employee_id)
      .eq('shift_date', s.work_date);

    if (shifts?.length) {
      hasMatchingShift++;
      console.log(`HAS SHIFT: ${s.work_date} emp=${s.employee_id.slice(0,8)} clockIn=${s.clock_in_at?.slice(11,16)}Z shifts=[${shifts.map(sh => sh.start_time + '/' + sh.status).join(', ')}]`);
    } else {
      noMatchingShift++;
      console.log(`NO SHIFT:  ${s.work_date} emp=${s.employee_id.slice(0,8)}`);
    }
  }

  console.log(`\nHas matching shift (can be reconciled): ${hasMatchingShift}`);
  console.log(`Truly unscheduled (no shift):           ${noMatchingShift}`);
}

main().catch(console.error);
