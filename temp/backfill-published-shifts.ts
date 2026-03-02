/**
 * Backfill rota_published_shifts for all published weeks that have no snapshot.
 * Needed because the historical import set weeks to 'published' without creating the snapshot.
 */
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Find published weeks with no snapshot entries
  const { data: weeks } = await sb
    .from('rota_weeks')
    .select('id, week_start')
    .eq('status', 'published');

  console.log(`Published weeks: ${weeks?.length ?? 0}`);

  let filled = 0, skipped = 0, totalShifts = 0;

  for (const week of weeks ?? []) {
    // Check if snapshot already exists
    const { count } = await sb
      .from('rota_published_shifts')
      .select('*', { count: 'exact', head: true })
      .eq('week_id', week.id);

    if ((count ?? 0) > 0) { skipped++; continue; }

    // Get all non-cancelled shifts for this week
    const { data: shifts } = await sb
      .from('rota_shifts')
      .select('id, week_id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name')
      .eq('week_id', week.id)
      .neq('status', 'cancelled');

    if (!shifts?.length) { skipped++; continue; }

    const now = new Date().toISOString();
    const { error } = await sb.from('rota_published_shifts').insert(
      shifts.map(s => ({ ...s, published_at: now }))
    );

    if (error) {
      console.error(`  ✗ Week ${week.week_start}: ${error.message}`);
    } else {
      filled++;
      totalShifts += shifts.length;
      process.stdout.write(`  ✓ ${week.week_start}: ${shifts.length} shifts\n`);
    }
  }

  console.log(`\nBackfill complete: ${filled} weeks filled, ${skipped} skipped`);
  console.log(`Total shifts snapshotted: ${totalShifts}`);
}
main().catch(console.error);
