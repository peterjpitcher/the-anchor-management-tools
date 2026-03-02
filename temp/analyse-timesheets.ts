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

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface Row {
  firstName: string; lastName: string; name: string;
  date: string;
  startAt: Date | null;
  endAt: Date | null;
  breakHours: number;
  regularHours: number;
  ot: number;
  schedule: string;
  position: string;
  mgrNote: string;
  inNote: string;
  outNote: string;
}

async function parseAll(): Promise<Row[]> {
  const rows: Row[] = [];
  for (const file of ALL_FILES) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(BASE + file);
    const ws = wb.worksheets[0];
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      if (rn === 1) return;
      const v = row.values as (string | number | Date | null | undefined)[];
      const fn = String(v[1] ?? '').trim();
      const ln = String(v[2] ?? '').trim();
      const startRaw = v[5];
      const endRaw = v[6];
      rows.push({
        firstName: fn, lastName: ln, name: `${fn} ${ln}`,
        date: String(v[4] instanceof Date ? v[4].toISOString().substring(0, 10) : v[4] ?? '').substring(0, 10),
        startAt: startRaw instanceof Date ? startRaw : null,
        endAt: endRaw instanceof Date ? endRaw : null,
        breakHours: Number(v[7] ?? 0),
        regularHours: Number(v[8] ?? 0),
        ot: Number(v[10] ?? 0),
        schedule: String(v[13] ?? '').trim(),
        position: String(v[15] ?? '').trim(),
        mgrNote: String(v[16] ?? '').trim(),
        inNote: String(v[17] ?? '').trim(),
        outNote: String(v[18] ?? '').trim(),
      });
    });
  }
  return rows;
}

async function main() {
  const rows = await parseAll();
  console.log(`Total rows: ${rows.length}`);

  // Date range
  const dates = rows.map(r => r.date).filter(Boolean).sort();
  console.log(`Date range: ${dates[0]} → ${dates[dates.length - 1]}`);

  // Unique employees
  const nameSet = new Map<string, number>();
  for (const r of rows) {
    nameSet.set(r.name, (nameSet.get(r.name) ?? 0) + 1);
  }
  console.log(`\nUnique employees (${nameSet.size}):`);
  for (const [name, count] of [...nameSet.entries()].sort()) {
    console.log(`  ${name}: ${count} sessions`);
  }

  // Check against DB employees
  const { data: emps } = await sb.from('employees')
    .select('employee_id,first_name,last_name,email_address');
  const empMap = new Map<string, string>();
  for (const e of emps ?? []) {
    empMap.set(`${e.first_name.toLowerCase()} ${e.last_name.toLowerCase()}`, e.employee_id);
  }
  const missing = [...nameSet.keys()].filter(n => !empMap.has(n.toLowerCase()));
  if (missing.length) {
    console.log(`\nNot found in employees table: ${missing.join(', ')}`);
  } else {
    console.log('\nAll employees matched in DB.');
  }

  // Missing start/end times
  const noStart = rows.filter(r => !r.startAt);
  const noEnd = rows.filter(r => !r.endAt);
  console.log(`\nMissing start time: ${noStart.length}`);
  console.log(`Missing end time:   ${noEnd.length}`);
  if (noStart.length) console.log('  ', noStart.map(r => `${r.name} ${r.date}`));
  if (noEnd.length) console.log('  ', noEnd.map(r => `${r.name} ${r.date}`));

  // OT check
  const hasOT = rows.filter(r => r.ot > 0);
  console.log(`\nRecords with OT: ${hasOT.length}`);
  if (hasOT.length) hasOT.forEach(r => console.log(`  ${r.name} ${r.date} OT=${r.ot}h`));

  // Notes present
  const hasNotes = rows.filter(r => r.mgrNote || r.inNote || r.outNote);
  console.log(`\nRecords with notes: ${hasNotes.length}`);
  hasNotes.slice(0, 6).forEach(r =>
    console.log(`  ${r.name} ${r.date}: mgr="${r.mgrNote}" in="${r.inNote}" out="${r.outNote}"`)
  );

  // Sessions ending at midnight (overnight)
  const overnight = rows.filter(r => r.endAt && r.endAt.toISOString().includes('T00:00:00'));
  console.log(`\nOvernight sessions (end=midnight): ${overnight.length}`);

  // Check for duplicate entries (same person, same date, overlapping)
  const seen = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.name}|${r.date}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key)!.push(r);
  }
  const dups = [...seen.entries()].filter(([, v]) => v.length > 1);
  console.log(`\nSame-person same-date duplicates: ${dups.length}`);
  dups.slice(0, 5).forEach(([key, v]) =>
    console.log(`  ${key}: ${v.map(r => `${r.startAt?.toISOString().substring(11,16)}→${r.endAt?.toISOString().substring(11,16)}`).join(', ')}`)
  );
}
main().catch(console.error);
