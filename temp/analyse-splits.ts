/**
 * Analyse split shifts (same employee, same date, consecutive times)
 * and show what the merged patterns look like vs what templates exist.
 */
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import path from 'path';

const FILE = path.resolve(__dirname, 'Schedule for Jan 1, 2025 - Dec 31, 2026.xlsx');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function to24h(t: string) {
  const m = t.match(/^(\d+):(\d+)\s*(am|pm)$/i)!;
  let h = parseInt(m[1]); const min = parseInt(m[2]); const ap = m[3].toLowerCase();
  if (ap === 'pm' && h !== 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
function toMin(t: string) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function dayOfWeek(dateStr: string) { // Mon=0..Sun=6
  const d = new Date(dateStr + 'T00:00:00Z');
  const jsDay = d.getUTCDay(); // 0=Sun
  return jsDay === 0 ? 6 : jsDay - 1;
}
const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function positionToDept(p: string) {
  if (p.startsWith('Bar')) return 'bar';
  if (p === 'Chef') return 'kitchen';
  if (p === 'Sunday Runner') return 'runner';
  return '?';
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets[1];

  type Row = { name: string; email: string; date: string; position: string; start24: string; end24: string; dept: string };
  const rows: Row[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn === 1) return;
    const v = row.values as (string | number | null | undefined)[];
    const fn = String(v[5] ?? '').trim();
    if (fn === 'OpenShift' || fn === '') return;
    const ln = String(v[6] ?? '').trim();
    const status = String(v[16] ?? '').trim();
    if (status === 'Unpublished' && String(v[9] ?? '').trim() <= '2026-03-01') return;
    const start24 = to24h(String(v[10] ?? '').trim());
    const end24 = to24h(String(v[11] ?? '').trim());
    rows.push({ name: `${fn} ${ln}`, email: String(v[8] ?? '').trim().toLowerCase(),
      date: String(v[9] ?? '').trim().substring(0, 10),
      position: String(v[3] ?? '').trim(), start24, end24,
      dept: positionToDept(String(v[3] ?? '').trim()) });
  });

  // Group by (email+date), sort by start, detect consecutive
  const grouped = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.email}|${r.date}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  let splitCount = 0;
  const splitExamples: string[] = [];
  const mergedRows: (Row & { merged: boolean })[] = [];

  for (const [, group] of grouped) {
    group.sort((a, b) => toMin(a.start24) - toMin(b.start24));
    let i = 0;
    while (i < group.length) {
      const cur = group[i];
      if (i + 1 < group.length) {
        const next = group[i + 1];
        if (next.start24 === cur.end24 && next.dept === cur.dept) {
          // Consecutive split — merge
          splitCount++;
          if (splitExamples.length < 8) {
            splitExamples.push(`  ${cur.name} on ${cur.date} (${DOW[dayOfWeek(cur.date)]}): ${cur.start24}-${cur.end24} + ${next.start24}-${next.end24} → ${cur.start24}-${next.end24}`);
          }
          mergedRows.push({ ...cur, end24: next.end24, merged: true });
          i += 2;
          continue;
        }
      }
      mergedRows.push({ ...cur, merged: false });
      i++;
    }
  }

  console.log(`\nTotal after filter: ${rows.length} rows → ${mergedRows.length} merged shifts (${splitCount} splits merged)`);
  console.log(`\nSplit examples:`);
  splitExamples.forEach(e => console.log(e));

  // Load templates
  const { data: templates } = await supabase.from('rota_shift_templates').select('*');
  const templateKey = (t: { start_time: string; end_time: string; department: string; day_of_week: number }) =>
    `${t.start_time.substring(0,5)}|${t.end_time.substring(0,5)}|${t.department}|${t.day_of_week}`;
  const templateMap = new Map(templates!.map(t => [templateKey(t), t]));

  // Analyse matches
  const patternCount = new Map<string, { count: number; hasTemplate: boolean; templateName?: string }>();
  for (const r of mergedRows) {
    const dow = dayOfWeek(r.date);
    const end24 = r.end24 === '00:00' ? '00:00' : r.end24; // midnight stays 00:00
    const key = `${r.start24}|${end24}|${r.dept}|${dow}`;
    const friendly = `${DOW[dow]} ${r.dept} ${r.start24}–${r.end24}`;
    if (!patternCount.has(friendly)) {
      const tmpl = templateMap.get(key);
      patternCount.set(friendly, { count: 0, hasTemplate: !!tmpl, templateName: tmpl?.name });
    }
    patternCount.get(friendly)!.count++;
  }

  console.log(`\n--- Shift patterns (sorted by count) ---`);
  const sorted = [...patternCount.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [pattern, { count, hasTemplate, templateName }] of sorted) {
    const status = hasTemplate ? `✓ → "${templateName}"` : '✗ custom';
    console.log(`  ${String(count).padStart(3)}x  ${pattern.padEnd(30)}  ${status}`);
  }
}

main().catch(console.error);
