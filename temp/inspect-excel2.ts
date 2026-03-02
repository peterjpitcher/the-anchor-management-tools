import ExcelJS from 'exceljs';
import path from 'path';

const FILE = path.resolve(__dirname, 'Schedule for Jan 1, 2025 - Dec 31, 2026.xlsx');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);

  console.log(`Sheets (${wb.worksheets.length}):`);
  for (const ws of wb.worksheets) {
    console.log(`\n=== Sheet: "${ws.name}" (${ws.rowCount} rows x ${ws.columnCount} cols) ===`);
  }

  // Focus on the second sheet (Schedule Detail) if it exists, otherwise first
  const ws = wb.worksheets[1] ?? wb.worksheets[0];
  console.log(`\n--- Inspecting sheet: "${ws.name}" ---`);

  // Print header row
  const headerRow = ws.getRow(1);
  const headers = (headerRow.values as (string | null | undefined)[]).slice(1);
  console.log('Headers:', JSON.stringify(headers));

  // Print first 20 data rows
  for (let r = 2; r <= Math.min(21, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const vals = (row.values as (ExcelJS.CellValue | null | undefined)[]).slice(1);
    // For any date cells, format them
    const formatted = vals.map(v => {
      if (v instanceof Date) return v.toISOString();
      if (v && typeof v === 'object' && 'formula' in (v as object)) return `=FORMULA`;
      return v;
    });
    console.log(`Row ${r}:`, JSON.stringify(formatted));
  }

  // Also sample some rows from the first sheet (Hourly Summary)
  const ws1 = wb.worksheets[0];
  console.log(`\n--- Hourly Summary sheet: first 5 data rows ---`);
  for (let r = 2; r <= Math.min(6, ws1.rowCount); r++) {
    const row = ws1.getRow(r);
    // Only first 10 columns
    const vals = (row.values as (ExcelJS.CellValue | null | undefined)[]).slice(1, 11);
    const formatted = vals.map(v => {
      if (v instanceof Date) return v.toISOString();
      return v;
    });
    console.log(`Row ${r} (cols 1-10):`, JSON.stringify(formatted));
  }

  // Show a sample of what's in the daily columns for one employee
  console.log(`\n--- Hourly Summary: Employee 1, first 14 dates ---`);
  const empRow = ws1.getRow(2);
  const empVals = (empRow.values as (ExcelJS.CellValue | null | undefined)[]).slice(1, 22);
  const formatted2 = empVals.map(v => {
    if (v instanceof Date) return v.toISOString();
    return v;
  });
  console.log(JSON.stringify(formatted2));
}

main().catch(console.error);
