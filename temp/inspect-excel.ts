import ExcelJS from 'exceljs';
import path from 'path';

const FILE = path.resolve(__dirname, 'Schedule for Jan 1, 2025 - Dec 31, 2026.xlsx');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);

  console.log(`Sheets (${wb.worksheets.length}):`);
  for (const ws of wb.worksheets) {
    console.log(`\n=== Sheet: "${ws.name}" (${ws.rowCount} rows x ${ws.columnCount} cols) ===`);

    // Print first 10 rows to understand structure
    let rowsPrinted = 0;
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowsPrinted >= 15) return;
      const values = (row.values as (string | number | null | undefined)[]).slice(1); // remove index 0
      console.log(`Row ${rowNumber}: ${JSON.stringify(values)}`);
      rowsPrinted++;
    });

    if (ws.rowCount > 15) {
      console.log(`  ... (${ws.rowCount - 15} more rows)`);
    }
  }
}

main().catch(console.error);
