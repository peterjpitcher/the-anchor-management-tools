import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function run() {
  // Fix holiday year to April 6 (UK tax year) — consistent with code defaults
  const upserts = [
    { key: 'rota_holiday_year_start_month', value: { value: 4 } },
    { key: 'rota_holiday_year_start_day',   value: { value: 6 } },
  ];
  for (const row of upserts) {
    const { error } = await sb.from('system_settings').upsert({ key: row.key, value: row.value }, { onConflict: 'key' });
    if (error) console.error(`✗ ${row.key}:`, error.message);
    else console.log(`✓ ${row.key} = ${JSON.stringify(row.value)}`);
  }
}
run().catch(console.error);
