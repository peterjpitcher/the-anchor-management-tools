import ExcelJS from 'exceljs';
import path from 'path';

const FILE = path.resolve(__dirname, 'Schedule for Jan 1, 2025 - Dec 31, 2026.xlsx');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);

  const ws = wb.worksheets[1]; // Schedules Summary
  console.log(`Total rows: ${ws.rowCount}\n`);

  const employees = new Map<string, { name: string; email: string; rows: number }>();
  const positions = new Map<string, number>();
  const statuses = new Map<string, number>();
  const midnightShifts: string[] = [];
  const missingEmail: string[] = [];
  let totalRows = 0;

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const vals = row.values as (string | number | null | undefined)[];
    // Cols: 1=Schedule, 2=Site, 3=Position, 4=OpenShiftCount, 5=FirstName, 6=LastName, 7=EmpID, 8=Email,
    //       9=ShiftStartDate, 10=ShiftStartTime, 11=ShiftEndTime, 12=UnpaidBreak, 13=ScheduledHours,
    //       14=HourlyRate, 15=LaborCost, 16=Status, 17=Notes
    const position = String(vals[3] ?? '');
    const firstName = String(vals[5] ?? '');
    const lastName = String(vals[6] ?? '');
    const email = String(vals[8] ?? '');
    const shiftDate = String(vals[9] ?? '');
    const endTime = String(vals[11] ?? '');
    const status = String(vals[16] ?? '');

    totalRows++;

    positions.set(position, (positions.get(position) ?? 0) + 1);
    statuses.set(status, (statuses.get(status) ?? 0) + 1);

    const key = email || `${firstName} ${lastName}`;
    if (!email || email === 'null' || email === '') {
      missingEmail.push(`Row ${rowNumber}: ${firstName} ${lastName}`);
    }
    if (!employees.has(key)) {
      employees.set(key, { name: `${firstName} ${lastName}`, email, rows: 0 });
    }
    employees.get(key)!.rows++;

    if (endTime.includes('12:00 am')) {
      midnightShifts.push(`Row ${rowNumber}: ${firstName} ${lastName} on ${shiftDate} ends at midnight`);
    }
  });

  console.log(`Total data rows: ${totalRows}`);
  console.log(`\n--- Statuses ---`);
  for (const [s, c] of [...statuses.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${c}`);
  }

  console.log(`\n--- Unique positions (${positions.size}) ---`);
  for (const [p, c] of [...positions.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  "${p}": ${c} shifts`);
  }

  console.log(`\n--- Unique employees (${employees.size}) ---`);
  for (const [, e] of [...employees.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    console.log(`  ${e.name} <${e.email}> — ${e.rows} shifts`);
  }

  console.log(`\n--- Midnight-end shifts (${midnightShifts.length}) ---`);
  midnightShifts.slice(0, 10).forEach(m => console.log(`  ${m}`));
  if (midnightShifts.length > 10) console.log(`  ... and ${midnightShifts.length - 10} more`);

  if (missingEmail.length) {
    console.log(`\n--- Missing email (${missingEmail.length}) ---`);
    missingEmail.forEach(m => console.log(`  ${m}`));
  }

  // Date range
  let minDate = '9999-99-99', maxDate = '0000-00-00';
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const vals = row.values as (string | null | undefined)[];
    const d = String(vals[9] ?? '').substring(0, 10);
    if (d && d < minDate) minDate = d;
    if (d && d > maxDate) maxDate = d;
  });
  console.log(`\nDate range: ${minDate} → ${maxDate}`);
}

main().catch(console.error);
