import ExcelJS from 'exceljs';
import { formatPayrollFlags } from './payroll-flags';

export type PayrollRow = {
  employeeName: string;
  employeeId: string;
  date: string;           // ISO date "YYYY-MM-DD"
  department: string;
  plannedHours: number | null;
  actualHours: number | null;
  hourlyRate: number | null;
  totalPay: number | null;      // premium-inclusive (base + premium)
  flags: string;          // comma-separated: "auto_close", "unscheduled", "variance", "couldnt_work"
  plannedStart: string | null;  // HH:MM
  plannedEnd: string | null;    // HH:MM
  actualStart: string | null;   // HH:MM Europe/London
  actualEnd: string | null;     // HH:MM Europe/London
  shiftId: string | null;
  sessionId: string | null;   // timeclock_session id (for edit/delete)
  note: string | null;        // payroll reconciliation note (editable on payroll page)
  sessionNote: string | null; // note from timeclock manager (read-only on payroll page)
  sickReason?: string | null; // Couldn't Work reason for marker rows
  // Premium-rate breakdown (optional for backward compatibility with snapshots
  // frozen before the premium feature — those rows have these undefined and are
  // treated as no premium: standardHours = actualHours, premiumHours 0, ×1.0).
  standardHours?: number | null; // hours paid at the base rate
  premiumHours?: number | null;  // hours paid at the premium (effective) rate
  multiplier?: number | null;    // premium multiplier of the premium portion (1 when none)
  effectiveRate?: number | null; // £/hr applied to premiumHours
  premiumReason?: string | null; // manager-supplied reason, if any
  // FULL pay of the premium hours = round2(premiumHours × effectiveRate). This is
  // the total the premium hours cost, NOT the uplift above base. The Excel/email
  // "Premium Hours" + inclusive "Total Pay" surfaces read this same full-pay
  // meaning. (The portal shows a different "uplift" quantity — premiumHours ×
  // (effectiveRate − baseRate) — under a different name; do not conflate them.)
  premiumPay?: number | null;
};

/**
 * Back-compat view of a row's premium split. Rows from a pre-feature snapshot
 * lack the premium fields; those are treated as no premium (all hours standard).
 */
function premiumBreakdown(row: PayrollRow): {
  standardHours: number;
  premiumHours: number;
  multiplier: number;
} {
  const premiumHours = row.premiumHours ?? 0;
  const standardHours = row.standardHours ?? row.actualHours ?? 0;
  const multiplier = premiumHours > 0 ? (row.multiplier ?? 1) : 1;
  return { standardHours, premiumHours, multiplier };
}

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
    { header: 'Employee Name',   key: 'employeeName',   width: 22 },
    { header: 'Employee ID',     key: 'employeeId',     width: 36 },
    { header: 'Date',            key: 'date',           width: 12 },
    { header: 'Department',      key: 'department',     width: 12 },
    { header: 'Planned Hours',   key: 'plannedHours',   width: 14 },
    { header: 'Actual Hours',    key: 'actualHours',    width: 14 },
    { header: 'Standard Hours',  key: 'standardHours',  width: 14 },
    { header: 'Premium Hours',   key: 'premiumHours',   width: 14 },
    { header: 'Premium ×',       key: 'multiplier',     width: 11 },
    { header: 'Hourly Rate (£)', key: 'hourlyRate',     width: 14 },
    { header: 'Total Pay (£)',   key: 'totalPay',       width: 14 },
    { header: 'Flags',           key: 'flags',          width: 32 },
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
    const { standardHours, premiumHours, multiplier } = premiumBreakdown(row);
    const hasActual = row.actualHours != null;
    const dataRow = ws.addRow({
      ...row,
      // Only show the split when there is worked time to attribute.
      standardHours: hasActual ? standardHours : 'N/A',
      premiumHours: hasActual ? premiumHours : 'N/A',
      // Blank when there is no premium so the accountant only sees a factor
      // on rows that actually carry one.
      multiplier: premiumHours > 0 ? multiplier : '',
      hourlyRate: row.hourlyRate != null ? row.hourlyRate : 'N/A',
      totalPay: row.totalPay != null ? row.totalPay : 'N/A',
      flags: formatPayrollFlags(row.flags),
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
  const totalStandardHours = rows.reduce((sum, r) => sum + premiumBreakdown(r).standardHours, 0);
  const totalPremiumHours = rows.reduce((sum, r) => sum + premiumBreakdown(r).premiumHours, 0);
  ws.addRow({}); // blank separator
  const totalsRow = ws.addRow({
    employeeName: 'TOTAL',
    actualHours: Math.round(totalActualHours * 100) / 100,
    standardHours: Math.round(totalStandardHours * 100) / 100,
    premiumHours: Math.round(totalPremiumHours * 100) / 100,
    totalPay: Math.round(totalPay * 100) / 100,
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
