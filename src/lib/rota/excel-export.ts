import ExcelJS from 'exceljs';

export type PayrollRow = {
  employeeName: string;
  employeeId: string;
  date: string;           // ISO date "YYYY-MM-DD"
  department: string;
  plannedHours: number | null;
  actualHours: number | null;
  hourlyRate: number | null;
  totalPay: number | null;
  flags: string;          // comma-separated: "auto_close", "unscheduled", "variance", "sick"
  plannedStart: string | null;  // HH:MM
  plannedEnd: string | null;    // HH:MM
  actualStart: string | null;   // HH:MM Europe/London
  actualEnd: string | null;     // HH:MM Europe/London
  shiftId: string | null;
  sessionId: string | null;   // timeclock_session id (for edit/delete)
  note: string | null;        // payroll reconciliation note (editable on payroll page)
  sessionNote: string | null; // note from timeclock manager (read-only on payroll page)
};

/**
 * Builds a payroll XLSX workbook as a Buffer.
 * Single worksheet, grouped by employee then date.
 * File name convention: payroll_YYYY_MM.xlsx
 */
export async function buildPayrollWorkbook(
  year: number,
  month: number,
  rows: PayrollRow[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Anchor Management Tools';
  workbook.created = new Date();

  const ws = workbook.addWorksheet('Payroll Detail', {
    pageSetup: { fitToPage: true, fitToWidth: 1 },
  });

  // Column definitions
  ws.columns = [
    { header: 'Employee Name',  key: 'employeeName',  width: 22 },
    { header: 'Employee ID',    key: 'employeeId',    width: 36 },
    { header: 'Date',           key: 'date',          width: 12 },
    { header: 'Department',     key: 'department',    width: 12 },
    { header: 'Planned Hours',  key: 'plannedHours',  width: 14 },
    { header: 'Actual Hours',   key: 'actualHours',   width: 14 },
    { header: 'Hourly Rate (£)', key: 'hourlyRate',   width: 14 },
    { header: 'Total Pay (£)',  key: 'totalPay',      width: 14 },
    { header: 'Flags',          key: 'flags',         width: 32 },
  ];

  // Style header row
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F5C2E' }, // dark green
  };
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.alignment = { vertical: 'middle' };
  headerRow.height = 20;

  // Add data rows
  rows.forEach(row => {
    const dataRow = ws.addRow({
      ...row,
      hourlyRate: row.hourlyRate != null ? row.hourlyRate : 'N/A',
      totalPay: row.totalPay != null ? row.totalPay : 'N/A',
    });

    // Highlight flagged rows
    if (row.flags) {
      dataRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFF3CD' }, // light amber
      };
    }
  });

  // Totals row
  const totalPay = rows.reduce((sum, r) => sum + (r.totalPay ?? 0), 0);
  const totalActualHours = rows.reduce((sum, r) => sum + (r.actualHours ?? 0), 0);
  ws.addRow({}); // blank separator
  const totalsRow = ws.addRow({
    employeeName: 'TOTAL',
    actualHours: totalActualHours,
    totalPay,
  });
  totalsRow.font = { bold: true };
  totalsRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8F5E9' },
  };

  // Freeze header row
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // Auto-filter
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: ws.columns.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function getPayrollFilename(year: number, month: number): string {
  return `payroll_${year}_${String(month).padStart(2, '0')}.xlsx`;
}
