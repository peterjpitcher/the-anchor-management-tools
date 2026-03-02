/**
 * Historical timeclock import — Dec 2024 to Feb 2026
 * - Maps name aliases (Mandy Jones → Amanda Jones, Jordon Bownman → Jordan Bowman)
 * - Corrects BST (local UK time stored as UTC in Excel) → actual UTC
 * - Matches sessions to planned rota shifts by start_time proximity
 * - Multiple sessions same day: keep separate if each matches a distinct shift,
 *   otherwise merge into one session per day
 * - Marks all as is_reviewed = true (pre-approved historical data)
 */

import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';

const BASE = '/Users/peterpitcher/Cursor/anchor-management-tools/temp/Excels for Import/';
const ALL_FILES = [
  'Timesheets - Dec 20 - Jan 24, 2025 (1).xlsx',
  'Timesheets - Jan 25 - Feb 24, 2025 (1).xlsx',
  'Timesheets - Feb 25 - Mar 24, 2025 (1).xlsx',
  'Timesheets - Mar 25 - Apr 24, 2025 (3).xlsx',
  'Timesheets - Apr 25 - May 24, 2025 (2).xlsx',
  'Timesheets - May 25 - Jun 24, 2025 (1).xlsx',
  'Timesheets - Jun 25 - Jul 24, 2025 (3).xlsx',
  'Timesheets - Jul 25 - Aug 24, 2025 (2).xlsx',
  'Timesheets - Aug 25 - Sep 24, 2025 (1).xlsx',
  'Timesheets - Sep 25 - Oct 24, 2025 (1).xlsx',
  'Timesheets - Oct 25 - Nov 24, 2025.xlsx',
  'Timesheets - Nov 25 - Dec 18, 2025 (1).xlsx',
  'Timesheets - Dec 19 - Jan 24, 2026 (2).xlsx',
  'Timesheets - Jan 25 - Feb 24, 2026 (1).xlsx',
];

// Name aliases: Excel name → DB name
const NAME_ALIASES: Record<string, string> = {
  'mandy jones':   'amanda jones',
  'jordon bownman': 'jordan bowman',
};

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ---------------------------------------------------------------------------
// BST correction
// Excel exports UK local times tagged as UTC. We subtract 1h for BST dates.
// BST 2025: 2025-03-30 01:00 UTC → 2025-10-26 01:00 UTC
// BST 2024: 2024-03-31 01:00 UTC → 2024-10-27 01:00 UTC (Dec 2024 = GMT, no issue)
// ---------------------------------------------------------------------------
const BST_RANGES = [
  { start: new Date('2024-03-31T01:00:00Z'), end: new Date('2024-10-27T01:00:00Z') },
  { start: new Date('2025-03-30T01:00:00Z'), end: new Date('2025-10-26T01:00:00Z') },
];

function toActualUTC(d: Date): Date {
  for (const { start, end } of BST_RANGES) {
    if (d >= start && d < end) {
      return new Date(d.getTime() - 60 * 60 * 1000);
    }
  }
  return d;
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function dateToHHMM(d: Date): string {
  // Extract HH:MM from a Date that was corrected to actual UTC
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// ---------------------------------------------------------------------------
// Parse Excel files
// ---------------------------------------------------------------------------
interface RawSession {
  excelName: string;     // original name as in file
  name: string;          // normalised (alias applied)
  workDate: string;      // YYYY-MM-DD (Excel date column, already local)
  clockIn: Date;         // actual UTC
  clockOut: Date;        // actual UTC
  clockInHHMM: string;   // for shift matching
  mgrNote: string;
  inNote: string;
  outNote: string;
}

async function parseAll(): Promise<RawSession[]> {
  const rows: RawSession[] = [];
  for (const file of ALL_FILES) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(BASE + file);
    const ws = wb.worksheets[0];
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      if (rn === 1) return;
      const v = row.values as (string | number | Date | null | undefined)[];
      const fn = String(v[1] ?? '').trim();
      const ln = String(v[2] ?? '').trim();
      const excelName = `${fn} ${ln}`;
      const normName = NAME_ALIASES[excelName.toLowerCase()] ?? excelName.toLowerCase();

      const dateVal = v[4];
      const startVal = v[5];
      const endVal   = v[6];

      if (!(startVal instanceof Date) || !(endVal instanceof Date)) return;

      const workDate = (dateVal instanceof Date)
        ? dateVal.toISOString().substring(0, 10)
        : String(dateVal ?? '').substring(0, 10);

      const clockIn  = toActualUTC(startVal);
      const clockOut = toActualUTC(endVal);

      rows.push({
        excelName, name: normName, workDate,
        clockIn, clockOut,
        clockInHHMM: dateToHHMM(clockIn),
        mgrNote: String(v[16] ?? '').trim(),
        inNote:  String(v[17] ?? '').trim(),
        outNote: String(v[18] ?? '').trim(),
      });
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Build employee map (name → employee_id)
// ---------------------------------------------------------------------------
async function buildEmpMap(): Promise<Map<string, string>> {
  const { data, error } = await sb.from('employees')
    .select('employee_id,first_name,last_name');
  if (error) throw new Error(error.message);
  const map = new Map<string, string>();
  for (const e of data ?? []) {
    map.set(`${e.first_name.toLowerCase()} ${e.last_name.toLowerCase()}`, e.employee_id);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Load rota shifts keyed by employee_id:work_date → [{start_time, id}]
// ---------------------------------------------------------------------------
async function loadShifts(): Promise<Map<string, { id: string; startHHMM: string }[]>> {
  const { data, error } = await sb.from('rota_shifts')
    .select('id,employee_id,shift_date,start_time');
  if (error) throw new Error(error.message);
  const map = new Map<string, { id: string; startHHMM: string }[]>();
  for (const s of data ?? []) {
    const key = `${s.employee_id}:${s.shift_date}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push({ id: s.id, startHHMM: s.start_time.substring(0, 5) });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Match a session's start time to the closest available shift
// Returns shift id or null. Removes the matched shift from the pool.
// ---------------------------------------------------------------------------
function findBestShift(
  pool: { id: string; startHHMM: string }[],
  sessionStartHHMM: string,
  maxDiffMins = 90,
): string | null {
  if (pool.length === 0) return null;
  const sessionMins = toMinutes(sessionStartHHMM);
  let best: { idx: number; diff: number } | null = null;
  for (let i = 0; i < pool.length; i++) {
    const diff = Math.abs(toMinutes(pool[i].startHHMM) - sessionMins);
    if (!best || diff < best.diff) best = { idx: i, diff };
  }
  if (!best || best.diff > maxDiffMins) return null;
  const [matched] = pool.splice(best.idx, 1);
  return matched.id;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const raw       = await parseAll();
  const empMap    = await buildEmpMap();
  const shiftMap  = await loadShifts();

  console.log(`Parsed ${raw.length} raw sessions`);

  // Resolve employee IDs
  type Resolved = RawSession & { empId: string };
  const resolved: Resolved[] = [];
  let skipped = 0;
  for (const r of raw) {
    const empId = empMap.get(r.name);
    if (!empId) { console.warn(`  ✗ No employee: "${r.excelName}" (${r.workDate})`); skipped++; continue; }
    resolved.push({ ...r, empId });
  }
  if (skipped) console.log(`Skipped ${skipped} rows (no employee match)`);

  // Group by employee+date
  const groups = new Map<string, Resolved[]>();
  for (const r of resolved) {
    const key = `${r.empId}:${r.workDate}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  // Build insert rows
  type InsertRow = {
    employee_id: string; work_date: string;
    clock_in_at: string; clock_out_at: string;
    linked_shift_id: string | null;
    is_unscheduled: boolean; is_reviewed: boolean;
    manager_note: string | null;
  };

  const insertRows: InsertRow[] = [];
  let mergedCount = 0;
  let linkedCount = 0;

  for (const [key, sessions] of groups) {
    const [empId, workDate] = key.split(':');
    // Clone shift pool (we'll splice from it as we match)
    const shiftPool = [...(shiftMap.get(key) ?? [])];

    // Sort sessions by clock_in ascending
    sessions.sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime());

    if (sessions.length === 1) {
      const s = sessions[0];
      const linkedShiftId = findBestShift(shiftPool, s.clockInHHMM);
      if (linkedShiftId) linkedCount++;
      const note = [s.mgrNote, s.inNote, s.outNote].filter(Boolean).join(' | ') || null;
      insertRows.push({
        employee_id: empId, work_date: workDate,
        clock_in_at: s.clockIn.toISOString(),
        clock_out_at: s.clockOut.toISOString(),
        linked_shift_id: linkedShiftId,
        is_unscheduled: !linkedShiftId,
        is_reviewed: true,
        manager_note: note,
      });
    } else {
      // Multiple sessions on same day — try to match each to a distinct shift
      const matched: Array<{ session: Resolved; shiftId: string | null }> = [];
      for (const s of sessions) {
        const shiftId = findBestShift(shiftPool, s.clockInHHMM);
        matched.push({ session: s, shiftId });
      }

      const allMatched = matched.every(m => m.shiftId !== null);

      if (allMatched) {
        // Each session maps to a distinct shift → keep separate
        for (const m of matched) {
          linkedCount++;
          const note = [m.session.mgrNote, m.session.inNote, m.session.outNote].filter(Boolean).join(' | ') || null;
          insertRows.push({
            employee_id: empId, work_date: workDate,
            clock_in_at: m.session.clockIn.toISOString(),
            clock_out_at: m.session.clockOut.toISOString(),
            linked_shift_id: m.shiftId,
            is_unscheduled: false,
            is_reviewed: true,
            manager_note: note,
          });
        }
      } else {
        // Can't fully pair — merge into one session
        mergedCount++;
        const first = sessions[0];
        const last  = sessions[sessions.length - 1];
        const combinedNotes = sessions
          .flatMap(s => [s.mgrNote, s.inNote, s.outNote])
          .filter(Boolean)
          .join(' | ') || null;
        // Try to match merged session to any shift
        const shiftId = matched.find(m => m.shiftId)?.shiftId ?? null;
        if (shiftId) linkedCount++;
        insertRows.push({
          employee_id: empId, work_date: workDate,
          clock_in_at: first.clockIn.toISOString(),
          clock_out_at: last.clockOut.toISOString(),
          linked_shift_id: shiftId,
          is_unscheduled: !shiftId,
          is_reviewed: true,
          manager_note: combinedNotes,
        });
      }
    }
  }

  console.log(`\nSessions to insert: ${insertRows.length}`);
  console.log(`  Linked to shifts: ${linkedCount}`);
  console.log(`  Split sessions merged: ${mergedCount}`);
  console.log(`  Unscheduled (no shift match): ${insertRows.filter(r => r.is_unscheduled).length}`);

  // Insert in batches of 200
  const BATCH = 200;
  let inserted = 0, errors = 0;
  for (let i = 0; i < insertRows.length; i += BATCH) {
    const batch = insertRows.slice(i, i + BATCH);
    const { error } = await sb.from('timeclock_sessions').insert(batch);
    if (error) {
      console.error(`  ✗ Batch ${Math.floor(i / BATCH) + 1}: ${error.message}`);
      errors += batch.length;
    } else {
      inserted += batch.length;
    }
  }

  console.log(`\n=== Complete ===`);
  console.log(`  Inserted: ${inserted}`);
  if (errors) console.log(`  Errors:   ${errors}`);
}
main().catch(console.error);
