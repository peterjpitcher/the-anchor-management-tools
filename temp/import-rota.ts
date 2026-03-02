/**
 * Historical rota import v2 — Jan 2025 to May 2026
 * - Merges consecutive split shifts (same employee, same date, end==next.start)
 * - Matches merged shifts to existing templates by (start, end, dept, day_of_week)
 * - Custom shifts (no template_id) for everything that doesn't match
 */

import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import path from 'path';

const FILE = path.resolve(__dirname, 'Schedule for Jan 1, 2025 - Dec 31, 2026.xlsx');
const TODAY = '2026-03-01';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function to24h(t: string): string {
  const m = t.match(/^(\d+):(\d+)\s*(am|pm)$/i)!;
  let h = parseInt(m[1]); const min = parseInt(m[2]); const ap = m[3].toLowerCase();
  if (ap === 'pm' && h !== 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function toMin(t: string): number { const [h, m] = t.split(':').map(Number); return h * 60 + m; }

function isOvernight(start24: string, end24: string): boolean {
  return toMin(end24) <= toMin(start24);
}

function getDayOfWeek(dateStr: string): number { // Mon=0 … Sun=6
  const d = new Date(dateStr + 'T00:00:00Z');
  const js = d.getUTCDay(); // 0=Sun
  return js === 0 ? 6 : js - 1;
}

function getMondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const diff = d.getUTCDay() === 0 ? -6 : 1 - d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split('T')[0];
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

function positionToDept(p: string): string {
  if (p.startsWith('Bar')) return 'bar';
  if (p === 'Chef') return 'kitchen';
  if (p === 'Sunday Runner') return 'runner';
  throw new Error(`Unknown position: "${p}"`);
}

// ---------------------------------------------------------------------------
// Parse Excel → raw rows
// ---------------------------------------------------------------------------

interface RawRow {
  name: string; email: string; date: string;
  position: string; dept: string;
  start24: string; end24: string;
  unpaidBreakMins: number; status: string;
}

async function parseExcel(): Promise<RawRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets[1];
  const rows: RawRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn === 1) return;
    const v = row.values as (string | number | null | undefined)[];
    const fn = String(v[5] ?? '').trim();
    if (fn === 'OpenShift' || fn === '') return;
    rows.push({
      name:          `${fn} ${String(v[6] ?? '').trim()}`,
      email:         String(v[8] ?? '').trim().toLowerCase(),
      date:          String(v[9] ?? '').trim().substring(0, 10),
      position:      String(v[3] ?? '').trim(),
      dept:          positionToDept(String(v[3] ?? '').trim()),
      start24:       to24h(String(v[10] ?? '').trim()),
      end24:         to24h(String(v[11] ?? '').trim()),
      unpaidBreakMins: Math.round(Number(v[12] ?? 0) * 60),
      status:        String(v[16] ?? '').trim(),
    });
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Merge consecutive splits (same employee, same date, end == next.start)
// ---------------------------------------------------------------------------

interface MergedRow extends RawRow { wasUnpublished: boolean; merged: boolean; }

function mergeConsecutiveSplits(raw: RawRow[]): MergedRow[] {
  // Filter first
  const filtered = raw.filter(r =>
    !(r.status === 'Unpublished' && r.date <= TODAY)
  );

  // Group by (email, date)
  const grouped = new Map<string, RawRow[]>();
  for (const r of filtered) {
    const key = `${r.email}|${r.date}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  const result: MergedRow[] = [];
  for (const group of grouped.values()) {
    group.sort((a, b) => toMin(a.start24) - toMin(b.start24));
    let i = 0;
    while (i < group.length) {
      const cur = group[i];
      if (i + 1 < group.length) {
        const nxt = group[i + 1];
        if (nxt.start24 === cur.end24 && nxt.dept === cur.dept) {
          // Merge: take start from cur, end from nxt, break from both
          result.push({
            ...cur,
            end24:          nxt.end24,
            unpaidBreakMins: cur.unpaidBreakMins + nxt.unpaidBreakMins,
            wasUnpublished: cur.status === 'Unpublished' || nxt.status === 'Unpublished',
            merged:         true,
          });
          i += 2;
          continue;
        }
      }
      result.push({ ...cur, wasUnpublished: cur.status === 'Unpublished', merged: false });
      i++;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Load templates — key by "start|end|dept|dayOfWeek"
// ---------------------------------------------------------------------------

type Template = { id: string; name: string; start_time: string; end_time: string; department: string; day_of_week: number };

async function loadTemplates(): Promise<Map<string, Template>> {
  const { data, error } = await supabase.from('rota_shift_templates').select('id,name,start_time,end_time,department,day_of_week');
  if (error) throw new Error(error.message);
  const map = new Map<string, Template>();
  for (const t of data as Template[]) {
    const key = `${t.start_time.substring(0, 5)}|${t.end_time.substring(0, 5)}|${t.department}|${t.day_of_week}`;
    map.set(key, t);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Employee map
// ---------------------------------------------------------------------------

async function buildEmployeeMap(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('employees').select('employee_id,first_name,last_name,email_address');
  if (error) throw new Error(error.message);
  const map = new Map<string, string>();
  for (const e of data) {
    if (e.email_address) map.set(e.email_address.toLowerCase(), e.employee_id);
    map.set(`${e.first_name.toLowerCase()} ${e.last_name.toLowerCase()}`, e.employee_id);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 1. Clear existing weeks (cascades to shifts)
  console.log('=== Clearing existing rota data ===');
  const { error: delErr } = await supabase
    .from('rota_weeks')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (delErr) { console.error('Delete failed:', delErr.message); return; }
  console.log('  Cleared rota_weeks (shifts cascade)');

  // 2. Parse & merge
  console.log('\n=== Parsing & merging splits ===');
  const raw = await parseExcel();
  const merged = mergeConsecutiveSplits(raw);
  console.log(`  Raw rows: ${raw.length} → merged shifts: ${merged.length}`);

  // 3. Templates & employee map
  const templateMap = await loadTemplates();
  const empMap      = await buildEmployeeMap();
  console.log(`  Templates loaded: ${templateMap.size}`);

  // 4. Transform
  type ShiftRecord = {
    employeeId: string; shiftDate: string; weekStart: string;
    start24: string; end24: string; unpaidBreakMins: number;
    dept: string; overnight: boolean;
    templateId: string | null; templateName: string | null;
    wasUnpublished: boolean;
  };

  const shifts: ShiftRecord[] = [];
  let skippedNoEmp = 0;
  let templatedCount = 0;

  for (const r of merged) {
    let empId = empMap.get(r.email);
    if (!empId) {
      const nameKey = r.name.toLowerCase();
      empId = empMap.get(nameKey);
    }
    if (!empId) { skippedNoEmp++; console.warn(`  ✗ No match: ${r.name} <${r.email}>`); continue; }

    const dow = getDayOfWeek(r.date);
    const overnight = isOvernight(r.start24, r.end24);
    const tmplKey = `${r.start24}|${r.end24}|${r.dept}|${dow}`;
    const tmpl = templateMap.get(tmplKey) ?? null;
    if (tmpl) templatedCount++;

    shifts.push({
      employeeId: empId, shiftDate: r.date, weekStart: getMondayOf(r.date),
      start24: r.start24, end24: r.end24, unpaidBreakMins: r.unpaidBreakMins,
      dept: r.dept, overnight, templateId: tmpl?.id ?? null, templateName: tmpl?.name ?? null,
      wasUnpublished: r.wasUnpublished,
    });
  }

  console.log(`  Shifts to import: ${shifts.length}  (${templatedCount} templated, ${shifts.length - templatedCount} custom)`);
  if (skippedNoEmp) console.log(`  Skipped (no employee): ${skippedNoEmp}`);

  // 5. Group by week
  const weekMap = new Map<string, { hasUnpublished: boolean; shifts: ShiftRecord[] }>();
  for (const s of shifts) {
    if (!weekMap.has(s.weekStart)) weekMap.set(s.weekStart, { hasUnpublished: false, shifts: [] });
    const w = weekMap.get(s.weekStart)!;
    if (s.wasUnpublished) w.hasUnpublished = true;
    w.shifts.push(s);
  }

  const sortedWeeks = [...weekMap.keys()].sort();
  console.log(`\n  Weeks: ${sortedWeeks.length}  (${sortedWeeks[0]} → ${sortedWeeks[sortedWeeks.length - 1]})`);

  // 6. Insert
  let weeksOk = 0, shiftsOk = 0, shiftsErr = 0;

  for (const weekStart of sortedWeeks) {
    const weekEnd = addDays(weekStart, 6);
    const { hasUnpublished, shifts: ws } = weekMap.get(weekStart)!;
    void weekEnd;

    const { data: weekData, error: weekErr } = await supabase
      .from('rota_weeks')
      .upsert({ week_start: weekStart, status: hasUnpublished ? 'draft' : 'published' }, { onConflict: 'week_start' })
      .select('id').single();

    if (weekErr || !weekData) { console.error(`  ✗ Week ${weekStart}: ${weekErr?.message}`); shiftsErr += ws.length; continue; }
    weeksOk++;

    const rows = ws.map(s => ({
      week_id:              weekData.id,
      employee_id:          s.employeeId,
      template_id:          s.templateId,
      name:                 s.templateName,   // show template name on shift card
      shift_date:           s.shiftDate,
      start_time:           s.start24,
      end_time:             s.end24,
      unpaid_break_minutes: s.unpaidBreakMins,
      department:           s.dept,
      status:               'scheduled',
      is_overnight:         s.overnight,
    }));

    const { error: shiftErr } = await supabase.from('rota_shifts').insert(rows);
    if (shiftErr) {
      console.error(`  ✗ Shifts week ${weekStart}: ${shiftErr.message}`);
      shiftsErr += rows.length;
    } else {
      shiftsOk += rows.length;
      const templated = rows.filter(r => r.template_id).length;
      process.stdout.write(
        `  ✓ ${weekStart}  ${ws.length} shifts (${templated} tmpl, ${ws.length - templated} custom)${hasUnpublished ? ' [draft]' : ''}\n`
      );
    }
  }

  console.log('\n=== Complete ===');
  console.log(`  Weeks:           ${weeksOk}`);
  console.log(`  Shifts inserted: ${shiftsOk}  (${templatedCount} with template, ${shiftsOk - templatedCount} custom)`);
  if (shiftsErr) console.log(`  Shifts errored:  ${shiftsErr}`);
}

main().catch(console.error);
