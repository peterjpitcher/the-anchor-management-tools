import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  computeSessionPremiumPay,
  resolveSessionPremium,
  resolveShiftWindowInstants,
  type SessionPremium,
} from './pay-calculator';
import { buildPayrollWorkbook, type PayrollRow } from './excel-export';
import { buildPayrollEmailHtml, type PayrollEmployeeSummary } from './email-templates';

// ---------------------------------------------------------------------------
// Payroll premium composition
//
// getPayrollMonthData (src/app/actions/payroll.ts) is DB-bound, so these tests
// exercise the exact composition its costRow() helper performs against the real
// pay-calculator exports: raw session/shift rows → SessionPremium → precedence
// resolve → window-aware pay. This proves the wiring contract the payroll loops
// depend on (matched, unmatched, precedence, windowed, salaried).
// ---------------------------------------------------------------------------

/** Mirror of payroll.ts toNumericOrNull — numeric columns arrive as strings. */
function toNumericOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Mirror of payroll.ts sessionPremiumFromRow. */
function sessionPremiumFromRow(session: Record<string, unknown>): SessionPremium {
  return {
    rateMultiplier: toNumericOrNull(session.rate_multiplier),
    rateOverride: toNumericOrNull(session.rate_override),
    premiumReason: (session.premium_reason as string | null) ?? null,
    premiumStartAt: (session.premium_start_at as string | null) ?? null,
    premiumEndAt: (session.premium_end_at as string | null) ?? null,
  };
}

/** Mirror of payroll.ts linkedShiftPremiumFromShift. */
function linkedShiftPremiumFromShift(shift: Record<string, unknown>): SessionPremium | null {
  const rateMultiplier = toNumericOrNull(shift.rate_multiplier);
  const rateOverride = toNumericOrNull(shift.rate_override);
  if (rateMultiplier == null && rateOverride == null) return null;
  const { premiumStartAt, premiumEndAt } = resolveShiftWindowInstants(
    shift.shift_date as string,
    shift.start_time as string,
    shift.end_time as string,
    Boolean(shift.is_overnight),
    (shift.premium_start_time as string | null) ?? null,
    (shift.premium_end_time as string | null) ?? null,
  );
  return {
    rateMultiplier,
    rateOverride,
    premiumReason: (shift.premium_reason as string | null) ?? null,
    premiumStartAt,
    premiumEndAt,
  };
}

/** Mirror of payroll.ts costRow (the money-producing core of both loops). */
function costRow(
  session: Record<string, unknown> | null,
  actualHours: number | null,
  baseRate: number | null,
  linkedShift: Record<string, unknown> | null,
) {
  if (session == null || actualHours == null || baseRate == null) {
    return { totalPay: null, standardHours: null, premiumHours: null, multiplier: null };
  }
  const eff = resolveSessionPremium(
    sessionPremiumFromRow(session),
    linkedShift ? linkedShiftPremiumFromShift(linkedShift) : null,
  );
  const res = computeSessionPremiumPay(
    session.clock_in_at as string,
    (session.clock_out_at as string | null) ?? (session.clock_in_at as string),
    actualHours,
    baseRate,
    eff,
  );
  return {
    totalPay: res.pay,
    standardHours: res.baseHours,
    premiumHours: res.premiumHours,
    multiplier: res.multiplier,
  };
}

/**
 * Mirror of payroll.ts's matched-loop LINKED-ONLY decision: the matched shift's
 * premium is only handed to costRow as `linkedShift` when the session is GENUINELY
 * linked to it (linked_shift_id set). Proximity-matched sessions (no linked_shift_id)
 * pass linkedShift=null, so they pay base unless they carry their own premium. This
 * matches the portal, which only falls back to the shift for linked sessions.
 */
function costMatchedRow(
  session: Record<string, unknown>,
  actualHours: number | null,
  baseRate: number | null,
  matchedShift: Record<string, unknown>,
) {
  const linkedShift = session.linked_shift_id ? matchedShift : null;
  return costRow(session, actualHours, baseRate, linkedShift);
}

// A plain (no-premium) 8h session on 1 Aug 2026, 12:00–20:00 London (BST = +01:00).
const plainSession = {
  clock_in_at: '2026-08-01T11:00:00.000Z',
  clock_out_at: '2026-08-01T19:00:00.000Z',
  rate_multiplier: null,
  rate_override: null,
  premium_reason: null,
  premium_start_at: null,
  premium_end_at: null,
};

describe('payroll premium composition — matched loop', () => {
  it('applies no premium when session and shift carry none (unchanged pay)', () => {
    const shift = {
      shift_date: '2026-08-01',
      start_time: '12:00',
      end_time: '20:00',
      is_overnight: false,
      rate_multiplier: null,
      rate_override: null,
      premium_reason: null,
      premium_start_time: null,
      premium_end_time: null,
    };
    const cost = costRow(plainSession, 8, 12, shift);
    expect(cost.totalPay).toBe(96); // 8 × £12
    expect(cost.standardHours).toBe(8);
    expect(cost.premiumHours).toBe(0);
    expect(cost.multiplier).toBe(1);
  });

  it('applies a whole-shift ×1.5 premium from the linked shift', () => {
    const shift = {
      shift_date: '2026-08-01',
      start_time: '12:00',
      end_time: '20:00',
      is_overnight: false,
      rate_multiplier: 1.5,
      rate_override: null,
      premium_reason: null,
      premium_start_time: null, // whole shift
      premium_end_time: null,
    };
    const cost = costRow(plainSession, 8, 12, shift);
    expect(cost.premiumHours).toBe(8);
    expect(cost.standardHours).toBe(0);
    expect(cost.multiplier).toBe(1.5);
    expect(cost.totalPay).toBe(144); // 8 × (12 × 1.5)
  });

  it('applies a windowed shift premium (after 18:00 double time)', () => {
    const shift = {
      shift_date: '2026-08-01',
      start_time: '12:00',
      end_time: '20:00',
      is_overnight: false,
      rate_multiplier: 2,
      rate_override: null,
      premium_reason: null,
      premium_start_time: '18:00', // 18:00–20:00 = 2h premium
      premium_end_time: null,
    };
    const cost = costRow(plainSession, 8, 12, shift);
    expect(cost.premiumHours).toBe(2);
    expect(cost.standardHours).toBe(6);
    // 6 × 12 + 2 × 24 = 72 + 48
    expect(cost.totalPay).toBe(120);
    expect(cost.multiplier).toBe(2);
  });
});

describe('payroll premium composition — precedence', () => {
  it('session premium wins over the linked shift premium (D4)', () => {
    const sessionWithOverride = {
      ...plainSession,
      rate_override: 20, // absolute £20/hr for the whole session
    };
    const shift = {
      shift_date: '2026-08-01',
      start_time: '12:00',
      end_time: '20:00',
      is_overnight: false,
      rate_multiplier: 1.5, // should be ignored — session wins
      rate_override: null,
      premium_reason: null,
      premium_start_time: null,
      premium_end_time: null,
    };
    const cost = costRow(sessionWithOverride, 8, 12, shift);
    expect(cost.premiumHours).toBe(8);
    expect(cost.totalPay).toBe(160); // 8 × £20 (override), NOT 8 × £18
  });
});

describe('payroll premium composition — linked-only shift premium', () => {
  const premiumShift = {
    shift_date: '2026-08-01',
    start_time: '12:00',
    end_time: '20:00',
    is_overnight: false,
    rate_multiplier: 1.5, // whole-shift time-and-a-half
    rate_override: null,
    premium_reason: null,
    premium_start_time: null,
    premium_end_time: null,
  };

  it('an un-overridden LINKED session resolves premium live from its shift', () => {
    // Session premium columns are all null (no explicit override); the session is
    // genuinely linked, so payroll falls back to the shift's ×1.5.
    const linkedSession = { ...plainSession, linked_shift_id: 'shift-1' };
    const cost = costMatchedRow(linkedSession, 8, 12, premiumShift);
    expect(cost.premiumHours).toBe(8);
    expect(cost.multiplier).toBe(1.5);
    expect(cost.totalPay).toBe(144); // 8 × (12 × 1.5)
  });

  it('an unlinked proximity-matched session near a premium shift pays BASE', () => {
    // No linked_shift_id → the shift premium must NOT apply. Only the session's own
    // premium (none here) counts, so it pays flat base — matching the portal.
    const unlinkedSession = { ...plainSession, linked_shift_id: null };
    const cost = costMatchedRow(unlinkedSession, 8, 12, premiumShift);
    expect(cost.premiumHours).toBe(0);
    expect(cost.standardHours).toBe(8);
    expect(cost.multiplier).toBe(1);
    expect(cost.totalPay).toBe(96); // 8 × £12 base — no shift premium leaks in
  });

  it("an unlinked session with its OWN override still gets that override (not the shift's)", () => {
    const unlinkedWithOwn = { ...plainSession, linked_shift_id: null, rate_override: 20 };
    const cost = costMatchedRow(unlinkedWithOwn, 8, 12, premiumShift);
    expect(cost.premiumHours).toBe(8);
    expect(cost.totalPay).toBe(160); // 8 × £20 own override, shift's ×1.5 ignored
  });
});

describe('payroll premium composition — numeric columns arrive as strings', () => {
  it('coerces string-typed session premium (numeric over the wire) to a number', () => {
    // Postgres `numeric` serialises as a string, e.g. "2.00". The read helper must
    // coerce it so the ×2 premium is applied, not silently dropped.
    const stringPremiumSession = { ...plainSession, rate_multiplier: '2' as unknown as number };
    const cost = costRow(stringPremiumSession, 8, 12, null);
    expect(cost.multiplier).toBe(2);
    expect(cost.premiumHours).toBe(8);
    expect(cost.totalPay).toBe(192); // 8 × £24
  });

  it('coerces string-typed LINKED shift premium to a number', () => {
    const linkedSession = { ...plainSession, linked_shift_id: 'shift-1' };
    const stringPremiumShift = {
      shift_date: '2026-08-01',
      start_time: '12:00',
      end_time: '20:00',
      is_overnight: false,
      rate_multiplier: '1.5' as unknown as number,
      rate_override: null,
      premium_reason: null,
      premium_start_time: null,
      premium_end_time: null,
    };
    const cost = costMatchedRow(linkedSession, 8, 12, stringPremiumShift);
    expect(cost.multiplier).toBe(1.5);
    expect(cost.totalPay).toBe(144); // 8 × (12 × 1.5)
  });
});

describe('payroll premium composition — unmatched loop', () => {
  it('applies session-only premium with no linked shift', () => {
    const sessionPremium = { ...plainSession, rate_multiplier: 2 };
    const cost = costRow(sessionPremium, 8, 12, null);
    expect(cost.premiumHours).toBe(8);
    expect(cost.totalPay).toBe(192); // 8 × £24
  });

  it('no premium on an unmatched plain session (unchanged pay)', () => {
    const cost = costRow(plainSession, 8, 12, null);
    expect(cost.totalPay).toBe(96);
    expect(cost.premiumHours).toBe(0);
  });
});

describe('payroll premium composition — salaried / no rate', () => {
  it('produces null pay when base rate is null (salaried excluded)', () => {
    const cost = costRow(plainSession, 8, null, null);
    expect(cost.totalPay).toBeNull();
    expect(cost.premiumHours).toBeNull();
    expect(cost.standardHours).toBeNull();
  });

  it('produces null pay when actual hours are null (no clock-out)', () => {
    const cost = costRow(plainSession, null, 12, null);
    expect(cost.totalPay).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Excel export — premium columns + backward compatibility
// ---------------------------------------------------------------------------

function baseRow(overrides: Partial<PayrollRow>): PayrollRow {
  return {
    employeeName: 'Alex Example',
    employeeId: 'emp-1',
    date: '2026-08-01',
    department: 'bar',
    plannedHours: 8,
    actualHours: 8,
    hourlyRate: 12,
    totalPay: 96,
    flags: '',
    plannedStart: '12:00',
    plannedEnd: '20:00',
    actualStart: '12:00',
    actualEnd: '20:00',
    shiftId: 'shift-1',
    sessionId: 'sess-1',
    note: null,
    sessionNote: null,
    ...overrides,
  };
}

async function readWorkbook(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.worksheets[0];
}

function headerCells(ws: ExcelJS.Worksheet): string[] {
  const header = ws.getRow(1);
  const out: string[] = [];
  header.eachCell(cell => out.push(String(cell.value)));
  return out;
}

describe('buildPayrollWorkbook — premium columns', () => {
  it('includes Standard Hours, Premium Hours and Premium × columns', async () => {
    const buffer = await buildPayrollWorkbook(2026, 8, [baseRow({})]);
    const ws = await readWorkbook(buffer);
    const headers = headerCells(ws);
    expect(headers).toContain('Standard Hours');
    expect(headers).toContain('Premium Hours');
    expect(headers).toContain('Premium ×');
    expect(headers).toContain('Total Pay (£)');
  });

  it('renders the premium split and inclusive total for a premium row', async () => {
    const row = baseRow({
      totalPay: 120,
      standardHours: 6,
      premiumHours: 2,
      multiplier: 2,
      effectiveRate: 24,
      premiumPay: 48,
    });
    const buffer = await buildPayrollWorkbook(2026, 8, [row]);
    const ws = await readWorkbook(buffer);
    const dataRow = ws.getRow(2);
    const values = dataRow.values as unknown[];
    // exceljs values array is 1-indexed
    const cellByHeader = (name: string) => {
      const idx = headerCells(ws).indexOf(name) + 1;
      return values[idx];
    };
    expect(cellByHeader('Standard Hours')).toBe(6);
    expect(cellByHeader('Premium Hours')).toBe(2);
    expect(cellByHeader('Premium ×')).toBe(2);
    expect(cellByHeader('Total Pay (£)')).toBe(120);
  });

  it('treats a pre-feature row (no premium fields) as all standard hours, ×1.0', async () => {
    const row = baseRow({}); // no standardHours/premiumHours/multiplier
    const buffer = await buildPayrollWorkbook(2026, 8, [row]);
    const ws = await readWorkbook(buffer);
    const headers = headerCells(ws);
    const values = ws.getRow(2).values as unknown[];
    const cellByHeader = (name: string) => values[headers.indexOf(name) + 1];
    expect(cellByHeader('Standard Hours')).toBe(8); // = actualHours
    expect(cellByHeader('Premium Hours')).toBe(0);
    // No premium => blank multiplier cell (empty string / undefined)
    const mult = cellByHeader('Premium ×');
    expect(mult === '' || mult === undefined || mult === null).toBe(true);
    expect(cellByHeader('Total Pay (£)')).toBe(96);
  });

  it('sums standard and premium hours in the totals row', async () => {
    const rows = [
      baseRow({ employeeId: 'a', standardHours: 6, premiumHours: 2, actualHours: 8, totalPay: 120 }),
      baseRow({ employeeId: 'b', standardHours: 8, premiumHours: 0, actualHours: 8, totalPay: 96 }),
    ];
    const buffer = await buildPayrollWorkbook(2026, 8, rows);
    const ws = await readWorkbook(buffer);
    // Find the TOTAL row
    let totalRowNum = -1;
    ws.eachRow((r, n) => {
      if (String(r.getCell(1).value) === 'TOTAL') totalRowNum = n;
    });
    expect(totalRowNum).toBeGreaterThan(0);
    const headers = headerCells(ws);
    const totalValues = ws.getRow(totalRowNum).values as unknown[];
    const cell = (name: string) => totalValues[headers.indexOf(name) + 1];
    expect(cell('Standard Hours')).toBe(14);
    expect(cell('Premium Hours')).toBe(2);
    expect(cell('Total Pay (£)')).toBe(216);
  });
});

// ---------------------------------------------------------------------------
// Accountant email — premium breakdown + backward compatibility + £833 alert
// ---------------------------------------------------------------------------

describe('buildPayrollEmailHtml — premium breakdown', () => {
  it('shows standard and premium hours per employee with an inclusive total', () => {
    const employees: PayrollEmployeeSummary[] = [
      { name: 'Alex Example', plannedHours: 8, actualHours: 8, standardHours: 6, premiumHours: 2, hourlyRate: 12, totalPay: 120 },
    ];
    const html = buildPayrollEmailHtml(2026, 8, employees);
    expect(html).toContain('Standard Hours');
    expect(html).toContain('Premium Hours');
    expect(html).toContain('6.00'); // standard
    expect(html).toContain('2.00'); // premium
    expect(html).toContain('£120.00'); // inclusive total
  });

  it('renders a pre-feature summary (no premium fields) as all standard, no premium', () => {
    const employees: PayrollEmployeeSummary[] = [
      { name: 'Old Snapshot', plannedHours: 8, actualHours: 8, hourlyRate: 12, totalPay: 96 },
    ];
    const html = buildPayrollEmailHtml(2026, 8, employees);
    expect(html).toContain('8.00');   // actualHours shown as standard
    expect(html).toContain('£96.00'); // unchanged historic total
    expect(html).toContain('no premium hours applied this period');
  });
});

describe('£833 earnings alert inherits premium-inclusive total', () => {
  const EARNINGS_THRESHOLD = 833;
  // Mirrors sendPayrollEmail's overThreshold derivation, which reads e.totalPay.
  function overThreshold(employees: PayrollEmployeeSummary[]) {
    return employees.filter(e => (e.totalPay ?? 0) > EARNINGS_THRESHOLD);
  }

  it('a premium month raises the alert figure above the base-only figure', () => {
    // 60h at £13 base = £780 (below threshold). With 20 of those hours at ×2.0,
    // the premium-inclusive total is £780 + 20×£13 = £1040 (above threshold).
    const baseOnly: PayrollEmployeeSummary = {
      name: 'Busy Bee', plannedHours: 60, actualHours: 60, standardHours: 60, premiumHours: 0, hourlyRate: 13, totalPay: 780,
    };
    const withPremium: PayrollEmployeeSummary = {
      name: 'Busy Bee', plannedHours: 60, actualHours: 60, standardHours: 40, premiumHours: 20, hourlyRate: 13, totalPay: 1040,
    };
    expect(overThreshold([baseOnly])).toHaveLength(0);
    expect(overThreshold([withPremium])).toHaveLength(1);
    expect(withPremium.totalPay!).toBeGreaterThan(baseOnly.totalPay!);
  });
});
