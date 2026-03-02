import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Get all templates
  const { data: templates, error: tErr } = await supabase
    .from('rota_shift_templates')
    .select('id, name');
  if (tErr) throw new Error(tErr.message);

  console.log(`Templates: ${templates.length}`);

  let updated = 0;
  for (const t of templates) {
    const { count, error } = await supabase
      .from('rota_shifts')
      .update({ name: t.name })
      .eq('template_id', t.id)
      .is('name', null);  // only fill blanks
    if (error) {
      console.error(`  ✗ Template "${t.name}": ${error.message}`);
    } else {
      console.log(`  ✓ "${t.name}": ${count ?? '?'} shifts updated`);
      updated += count ?? 0;
    }
  }

  console.log(`\nTotal shifts updated: ${updated}`);
}

main().catch(console.error);
