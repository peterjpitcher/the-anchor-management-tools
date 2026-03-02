import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function run() {
  const { data } = await sb.from('rota_shifts')
    .select('shift_date, start_time, end_time, name, template_id')
    .gte('shift_date', '2026-02-23')
    .lte('shift_date', '2026-03-01')
    .order('shift_date').order('start_time');
  data?.forEach(s =>
    console.log(s.shift_date, s.start_time, s.end_time, '|', s.name ?? '(no name)', '| tmpl:', !!s.template_id)
  );
  const named = data?.filter(s => s.name).length ?? 0;
  console.log(`\n${named}/${data?.length} shifts have names`);
}
run().catch(console.error);
