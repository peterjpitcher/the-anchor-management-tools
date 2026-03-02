import ExcelJS from 'exceljs';

const BASE = '/Users/peterpitcher/Cursor/anchor-management-tools/temp/Excels for Import/';
const FILES = [
  'Timesheets - Jun 25 - Jul 24, 2025 (3).xlsx',
  'Timesheets - Dec 19 - Jan 24, 2026 (2).xlsx',
  'Timesheets - Jan 25 - Feb 24, 2026 (1).xlsx',
];

async function main() {
  // Also do a full count across all files
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

  console.log('=== Row counts per file ===');
  let totalRows = 0;
  for (const f of ALL_FILES) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(BASE + f);
    const ws = wb.worksheets[0];
    const dataRows = ws.rowCount - 1; // minus header
    totalRows += dataRows;
    console.log(`  ${f.replace('Timesheets - ', '').replace(/\.xlsx$/, '')}: ${dataRows} rows`);
  }
  console.log(`  TOTAL: ${totalRows} rows\n`);

  console.log('=== Sample from summer + recent files ===');
  for (const FILE of FILES) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(BASE + FILE);
    const ws = wb.worksheets[0];
    console.log(`\n--- ${FILE.split('/').pop()} (${ws.rowCount - 1} data rows) ---`);
    let count = 0;
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      if (rn === 1 || count++ > 3) return;
      const v = row.values as (string | number | Date | null)[];
      const startD = v[5] as Date;
      const endD = v[6] as Date;
      console.log(`  ${v[1]} ${v[2]} | ${String(v[4]).substring(0, 10)} | clock_in=${startD instanceof Date ? startD.toISOString() : v[5]} | clock_out=${endD instanceof Date ? endD.toISOString() : v[6]} | break=${v[7]}h | sched="${v[13]}" | pos="${v[15]}" | notes: mgr="${v[16]??''}" in="${v[17]??''}" out="${v[18]??''}"`);
    });
  }
}
main().catch(console.error);
