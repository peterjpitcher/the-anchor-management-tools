/**
 * One-off reconciliation: fix timeclock sessions marked is_unscheduled=true
 * that now have a matching rota shift (due to historical rota import).
 *
 * Run with: npx tsx temp/reconcile-timeclock.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

async function main() {
  // Fetch all unscheduled sessions
  const { data: sessions, error } = await supabase
    .from('timeclock_sessions')
    .select('id, employee_id, work_date, clock_in_at')
    .eq('is_unscheduled', true)
    .order('work_date');

  if (error) { console.error(error.message); process.exit(1); }
  console.log(`Found ${sessions?.length ?? 0} unscheduled sessions\n`);

  let linked = 0;
  let clearedOnly = 0;
  let skipped = 0;

  for (const session of sessions ?? []) {
    // Find all shifts for this employee on this work_date
    const { data: shifts } = await supabase
      .from('rota_shifts')
      .select('id, start_time')
      .eq('employee_id', session.employee_id)
      .eq('shift_date', session.work_date)
      .eq('status', 'scheduled');

    if (!shifts?.length) {
      console.log(`SKIP (no shift): ${session.work_date} session=${session.id.slice(0,8)}`);
      skipped++;
      continue;
    }

    // Find closest shift within ±3hr of clock-in
    const clockInMs = new Date(session.clock_in_at).getTime();
    let bestShiftId: string | null = null;
    let bestDiff = Infinity;

    for (const shift of shifts) {
      const [h, m] = shift.start_time.split(':').map(Number);
      const shiftStartMs = new Date(session.work_date + 'T00:00:00Z').getTime() + (h * 60 + m) * 60000;
      const diff = Math.abs(clockInMs - shiftStartMs);
      if (diff < THREE_HOURS_MS && diff < bestDiff) {
        bestDiff = diff;
        bestShiftId = shift.id;
      }
    }

    if (bestShiftId) {
      // Link and clear unscheduled flag
      const { error: updateErr } = await supabase
        .from('timeclock_sessions')
        .update({ is_unscheduled: false, linked_shift_id: bestShiftId })
        .eq('id', session.id);

      if (updateErr) {
        console.error(`ERROR: ${session.work_date} ${session.id.slice(0,8)}: ${updateErr.message}`);
      } else {
        console.log(`LINKED:  ${session.work_date} session=${session.id.slice(0,8)} → shift=${bestShiftId.slice(0,8)}`);
        linked++;
      }
    } else {
      // Shift exists on same day but clock-in is >3hr away — still clear the unscheduled flag
      // since we know the employee was scheduled, just clear the flag without linking
      const { error: updateErr } = await supabase
        .from('timeclock_sessions')
        .update({ is_unscheduled: false })
        .eq('id', session.id);

      if (updateErr) {
        console.error(`ERROR: ${session.work_date} ${session.id.slice(0,8)}: ${updateErr.message}`);
      } else {
        const mins = Math.round(bestDiff / 60000);
        console.log(`CLEARED: ${session.work_date} session=${session.id.slice(0,8)} (shift exists but ${mins}min gap — cleared flag, no link)`);
        clearedOnly++;
      }
    }
  }

  console.log(`\nDone!`);
  console.log(`  Linked (is_unscheduled=false + linked_shift_id set): ${linked}`);
  console.log(`  Cleared (is_unscheduled=false, shift too far):       ${clearedOnly}`);
  console.log(`  Skipped (truly no matching shift):                   ${skipped}`);
}

main().catch(err => { console.error(err); process.exit(1); });
