'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkUserPermission } from '@/app/actions/rbac';
import { revalidatePath } from 'next/cache';
import {
  calculateActualPaidHours,
  calculatePaidHours,
  computeSessionPremiumPay,
  resolveSessionPremium,
  resolveShiftWindowInstants,
  type SessionPremium,
} from '@/lib/rota/pay-calculator';
import { updateTimeclockSession, createTimeclockSession, deleteTimeclockSession } from '@/app/actions/timeclock';
import { buildPayrollWorkbook, getPayrollFilename, type PayrollRow } from '@/lib/rota/excel-export';
import { buildPayrollEmailHtml, buildEarningsAlertEmailHtml, type PayrollEmployeeSummary, type LeavingEmployee } from '@/lib/rota/email-templates';
import { sendEmail } from '@/lib/email/emailService';
import { differenceInYears, parseISO } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { logAuditEvent } from '@/app/actions/audit';
import { getRotaSettings } from '@/app/actions/rota-settings';
import { PAYROLL_COULDNT_WORK_FLAG } from '@/lib/rota/payroll-flags';
import { formatDateInLondon, getTodayIsoDate } from '@/lib/dateUtils';
import { hasPayrollVariance, validatePayrollPeriodRange } from '@/lib/rota/payroll-guards';
import {
  PAYROLL_PERIOD_FUTURE_MONTHS,
} from '@/lib/rota/payroll-periods';
import {
  ensurePayrollPeriodsAheadRecords,
  getOrCreatePayrollPeriodForDateRecord,
  getOrCreatePayrollPeriodRecord,
} from '@/lib/rota/payroll-period-store';

// ---------------------------------------------------------------------------
// Payroll periods
// ---------------------------------------------------------------------------

export type PayrollPeriod = {
  id: string;
  year: number;
  month: number;
  period_start: string; // YYYY-MM-DD
  period_end: string;   // YYYY-MM-DD
};

async function assertPayrollPeriodAccess(): Promise<void> {
  const [canViewPayroll, canViewTimeclock, canViewRota] = await Promise.all([
    checkUserPermission('payroll', 'view'),
    checkUserPermission('timeclock', 'view'),
    checkUserPermission('rota', 'view'),
  ]);

  if (!canViewPayroll && !canViewTimeclock && !canViewRota) {
    throw new Error('Permission denied');
  }
}

function toLocalHHMM(isoUtc: string | null | undefined): string | null {
  if (!isoUtc) return null;
  const local = toZonedTime(new Date(isoUtc), 'Europe/London');
  return local.getHours().toString().padStart(2, '0') + ':' + local.getMinutes().toString().padStart(2, '0');
}

async function invalidatePayrollApproval(
  supabase: ReturnType<typeof createAdminClient>,
  year: number,
  month: number,
): Promise<void> {
  await supabase
    .from('payroll_month_approvals')
    .delete()
    .eq('year', year)
    .eq('month', month);
}

function payrollMonthLabel(year: number, month: number): string {
  return formatDateInLondon(`${year}-${String(month).padStart(2, '0')}-01T12:00:00Z`, {
    month: 'long',
    year: 'numeric',
  });
}

export async function getOrCreatePayrollPeriod(year: number, month: number): Promise<PayrollPeriod> {
  await assertPayrollPeriodAccess();
  return getOrCreatePayrollPeriodRecord(year, month);
}

export async function getOrCreatePayrollPeriodForDate(anchorDateIso: string = getTodayIsoDate()): Promise<PayrollPeriod> {
  await assertPayrollPeriodAccess();
  return getOrCreatePayrollPeriodForDateRecord(anchorDateIso);
}

export async function ensurePayrollPeriodsAhead(
  anchorDateIso: string = getTodayIsoDate(),
  futureMonths: number = PAYROLL_PERIOD_FUTURE_MONTHS,
): Promise<PayrollPeriod[]> {
  await assertPayrollPeriodAccess();
  return ensurePayrollPeriodsAheadRecords(anchorDateIso, futureMonths);
}

export async function updatePayrollPeriod(
  year: number,
  month: number,
  periodStart: string,
  periodEnd: string,
): Promise<{ success: true; data: PayrollPeriod } | { success: false; error: string }> {
  const canApprove = await checkUserPermission('payroll', 'approve');
  if (!canApprove) return { success: false, error: 'Permission denied' };

  const validationError = validatePayrollPeriodRange(periodStart, periodEnd);
  if (validationError) return { success: false, error: validationError };

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('payroll_periods')
    .upsert(
      { year, month, period_start: periodStart, period_end: periodEnd },
      { onConflict: 'year,month' },
    )
    .select('id, year, month, period_start, period_end')
    .single();

  if (error) return { success: false, error: error.message };

  await invalidatePayrollApproval(supabase, year, month);

  revalidatePath('/rota/payroll');
  return { success: true, data: data as PayrollPeriod };
}

export type PayrollMonthApproval = {
  id: string;
  year: number;
  month: number;
  approved_at: string;
  approved_by: string;
  snapshot: unknown;
  email_sent_at: string | null;
  email_sent_by: string | null;
};

// ---------------------------------------------------------------------------
// Get payroll review data for a month
// Returns planned vs actual per hourly employee
// ---------------------------------------------------------------------------

export async function getPayrollMonthData(year: number, month: number): Promise<
  { success: true; data: PayrollRow[]; employees: PayrollEmployeeSummary[] } | { success: false; error: string }
> {
  const canView = await checkUserPermission('payroll', 'view');
  if (!canView) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();

  const period = await getOrCreatePayrollPeriodRecord(year, month);
  const monthStart = period.period_start;
  const monthEnd = period.period_end;
  const todayIso = getTodayIsoDate();

  // Fetch everything needed in parallel — shifts, sessions, and all rate-lookup tables.
  // Rate data is fetched once here and computed in-memory below, replacing the previous
  // pattern of calling getHourlyRate() per shift (which did 5 DB round-trips each).
  const [
    { data: shifts, error: shiftsError },
    { data: sessions, error: sessionsError },
    { data: paySettings, error: paySettingsError },
    { data: rateOverrides, error: rateOverridesError },
    { data: ageBands, error: ageBandsError },
    { data: bandRates, error: bandRatesError },
  ] = await Promise.all([
    supabase
      .from('rota_shifts')
      .select(`
        *,
        employees!rota_shifts_employee_id_fkey(employee_id, first_name, last_name, date_of_birth)
      `)
      .gte('shift_date', monthStart)
      .lte('shift_date', monthEnd)
      .neq('status', 'cancelled')
      .order('employee_id')
      .order('shift_date')
      .order('start_time'),
    supabase
      .from('timeclock_sessions')
      .select(`
        *,
        employees!timeclock_sessions_employee_id_fkey(employee_id, first_name, last_name, date_of_birth)
      `)
      .gte('work_date', monthStart)
      .lte('work_date', monthEnd)
      .order('work_date')
      .order('clock_in_at'),
    supabase
      .from('employee_pay_settings')
      .select('employee_id, pay_type'),
    // Load all overrides — sorted DESC so first match per employee is the most recent
    supabase
      .from('employee_rate_overrides')
      .select('employee_id, hourly_rate, effective_from')
      .order('employee_id')
      .order('effective_from', { ascending: false }),
    supabase
      .from('pay_age_bands')
      .select('id, min_age, max_age')
      .eq('is_active', true),
    supabase
      .from('pay_band_rates')
      .select('band_id, hourly_rate, effective_from')
      .order('band_id')
      .order('effective_from', { ascending: false }),
  ]);

  if (shiftsError || sessionsError || paySettingsError || rateOverridesError || ageBandsError || bandRatesError) {
    const failedDatasets = [
      shiftsError && 'shifts',
      sessionsError && 'sessions',
      paySettingsError && 'pay settings',
      rateOverridesError && 'rate overrides',
      ageBandsError && 'age bands',
      bandRatesError && 'band rates',
    ].filter(Boolean).join(', ');
    return { success: false, error: `Failed to load payroll data: ${failedDatasets}` };
  }

  const salaryEmployeeIds = new Set(
    (paySettings ?? [])
      .filter(s => s.pay_type === 'salaried')
      .map(s => s.employee_id),
  );

  // Build a DOB map from both shifts and sessions joins
  const dobMap = new Map<string, string>();
  for (const s of shifts ?? []) {
    const emp = (s as Record<string, unknown>).employees as { employee_id: string; date_of_birth: string | null } | null;
    if (emp?.date_of_birth) dobMap.set(emp.employee_id, emp.date_of_birth);
  }
  for (const s of sessions ?? []) {
    const emp = (s as Record<string, unknown>).employees as { employee_id: string; date_of_birth: string | null } | null;
    if (emp?.date_of_birth && !dobMap.has(emp.employee_id)) dobMap.set(emp.employee_id, emp.date_of_birth);
  }

  // In-memory rate calculator — no DB calls, uses pre-fetched data above
  function getHourlyRateSync(
    employeeId: string,
    shiftDate: string,
  ): { rate: number; source: 'override' | 'age_band' } | null {
    if (salaryEmployeeIds.has(employeeId)) return null;

    // Most-recent override on or before shiftDate (already sorted DESC)
    const override = (rateOverrides ?? []).find(
      o => o.employee_id === employeeId && o.effective_from <= shiftDate,
    );
    if (override) return { rate: Number(override.hourly_rate), source: 'override' };

    const dob = dobMap.get(employeeId);
    if (!dob) return null;

    const ageOnShiftDate = differenceInYears(parseISO(shiftDate), parseISO(dob));
    const matchingBand = (ageBands ?? []).find(
      b => ageOnShiftDate >= b.min_age && (b.max_age === null || ageOnShiftDate <= b.max_age),
    );
    if (!matchingBand) return null;

    // Most-recent band rate on or before shiftDate (already sorted DESC)
    const bandRate = (bandRates ?? []).find(
      r => r.band_id === matchingBand.id && r.effective_from <= shiftDate,
    );
    if (!bandRate) return null;

    return { rate: Number(bandRate.hourly_rate), source: 'age_band' };
  }

  // Postgres `numeric` columns come back over the wire as STRINGS (e.g. "1.50"),
  // not JS numbers. Coerce them so `rateMultiplier`/`rateOverride` are real
  // numbers everywhere downstream (===, arithmetic, the frozen snapshot). Empty /
  // null / NaN all collapse to null ("no premium").
  function toNumericOrNull(value: unknown): number | null {
    if (value == null || value === '') return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }

  // Read the five session premium columns off a raw timeclock_sessions row.
  // These arrive via `select('*')`; NULL multiplier + NULL override = no premium.
  function sessionPremiumFromRow(session: Record<string, unknown>): SessionPremium {
    return {
      rateMultiplier: toNumericOrNull(session.rate_multiplier),
      rateOverride: toNumericOrNull(session.rate_override),
      premiumReason: (session.premium_reason as string | null) ?? null,
      premiumStartAt: (session.premium_start_at as string | null) ?? null,
      premiumEndAt: (session.premium_end_at as string | null) ?? null,
    };
  }

  // Convert a matched shift's time-of-day premium window into instants clamped
  // onto the shift date (overnight-aware), so the paid path can measure overlap
  // against the actual clock-in/out. Returns null when the shift carries no
  // premium, so the precedence resolver falls through to ×1.0.
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

  // Cost a worked session, applying the resolved premium (session → shift → ×1.0).
  // Returns null when there is nothing to cost (no hours worked or no base rate,
  // i.e. salaried/undeterminable), leaving totalPay null as before.
  function costRow(
    session: Record<string, unknown> | null,
    actualHours: number | null,
    baseRate: number | null,
    linkedShift: Record<string, unknown> | null,
  ): {
    totalPay: number | null;
    standardHours: number | null;
    premiumHours: number | null;
    multiplier: number | null;
    effectiveRate: number | null;
    premiumReason: string | null;
    premiumPay: number | null;
  } {
    if (session == null || actualHours == null || baseRate == null) {
      return {
        totalPay: null,
        standardHours: null,
        premiumHours: null,
        multiplier: null,
        effectiveRate: null,
        premiumReason: null,
        premiumPay: null,
      };
    }

    const sessionPremium = sessionPremiumFromRow(session);
    const linkedShiftPremium = linkedShift ? linkedShiftPremiumFromShift(linkedShift) : null;
    const eff = resolveSessionPremium(sessionPremium, linkedShiftPremium);
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
      effectiveRate: res.effectiveRate,
      premiumReason: res.premiumReason,
      premiumPay: Math.round(res.premiumHours * res.effectiveRate * 100) / 100,
    };
  }

  const rows: PayrollRow[] = [];
  const allSessions = (sessions ?? []) as Array<Record<string, unknown>>;
  const consumedSessionIds = new Set<string>();
  const linkedSessionsByShiftId = new Map<string, Array<Record<string, unknown>>>();
  const unlinkedSessionsByEmployeeDate = new Map<string, Array<Record<string, unknown>>>();

  for (const session of allSessions) {
    const linkedShiftId = session.linked_shift_id as string | null;
    if (linkedShiftId) {
      const current = linkedSessionsByShiftId.get(linkedShiftId) ?? [];
      current.push(session);
      linkedSessionsByShiftId.set(linkedShiftId, current);
      continue;
    }
    const key = `${session.employee_id as string}:${session.work_date as string}`;
    const current = unlinkedSessionsByEmployeeDate.get(key) ?? [];
    current.push(session);
    unlinkedSessionsByEmployeeDate.set(key, current);
  }

  const consumeSession = (session: Record<string, unknown>): Record<string, unknown> | null => {
    const sessionId = session.id as string;
    if (consumedSessionIds.has(sessionId)) return null;
    consumedSessionIds.add(sessionId);
    return session;
  };

  const takeLinkedSessionForShift = (shiftId: string): Record<string, unknown> | null => {
    const linked = linkedSessionsByShiftId.get(shiftId) ?? [];
    for (const session of linked) {
      const consumed = consumeSession(session);
      if (consumed) return consumed;
    }
    return null;
  };

  const takeBestUnlinkedSession = (
    employeeId: string,
    shiftDate: string,
    shiftStartTime: string,
  ): Record<string, unknown> | null => {
    const key = `${employeeId}:${shiftDate}`;
    const candidates = unlinkedSessionsByEmployeeDate.get(key) ?? [];
    if (candidates.length === 0) return null;

    const normalizedStart = shiftStartTime.slice(0, 5);
    const shiftStartUtc = fromZonedTime(`${shiftDate}T${normalizedStart}:00`, 'Europe/London').getTime();
    let bestIndex = -1;
    let bestDiff = Number.POSITIVE_INFINITY;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const candidateId = candidate.id as string;
      if (consumedSessionIds.has(candidateId)) continue;
      const candidateStart = new Date(candidate.clock_in_at as string).getTime();
      const diff = Math.abs(candidateStart - shiftStartUtc);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = i;
      }
    }

    if (bestIndex === -1) return null;
    return consumeSession(candidates[bestIndex]) ?? null;
  };

  for (const shift of shifts ?? []) {
    const emp = (shift as Record<string, unknown>).employees as {
      employee_id: string;
      first_name: string | null;
      last_name: string | null;
    } | null;

    if (!emp) continue;
    if (salaryEmployeeIds.has(shift.employee_id)) continue;

    const employeeName = [emp.first_name, emp.last_name].filter(Boolean).join(' ');
    const isCouldntWork = shift.status === 'sick';
    const plannedHours = isCouldntWork
      ? null
      : calculatePaidHours(
        shift.start_time,
        shift.end_time,
        shift.unpaid_break_minutes,
        shift.is_overnight,
      );

    const session =
      isCouldntWork
        ? null
        : takeLinkedSessionForShift(shift.id) ??
          takeBestUnlinkedSession(shift.employee_id, shift.shift_date, shift.start_time);

    const actualHours = session
      ? calculateActualPaidHours(session.clock_in_at as string, (session.clock_out_at as string | null) ?? null) ?? null
      : null;

    const rateResult = getHourlyRateSync(shift.employee_id, shift.shift_date);
    const hourlyRate = rateResult?.rate ?? null;
    // Linked-only shift premium: the linked shift's premium is only applied to a
    // session that is GENUINELY linked to it (linked_shift_id set). Sessions matched
    // by proximity (takeBestUnlinkedSession) carry no linked_shift_id, so they get
    // no shift premium — only their own explicit premium, else base. This mirrors
    // the portal (which only falls back to the shift for linked sessions), so an
    // employee's portal figure and the accountant total agree.
    const linkedShift = session && (session.linked_shift_id as string | null)
      ? (shift as Record<string, unknown>)
      : null;
    const cost = costRow(session, actualHours, hourlyRate, linkedShift);
    const totalPay = cost.totalPay;

    const flagParts: string[] = [];
    if (session?.is_auto_close) flagParts.push('auto_close');
    if (session?.is_unscheduled) flagParts.push('unscheduled');
    if (isCouldntWork) flagParts.push(PAYROLL_COULDNT_WORK_FLAG);
    if (hasPayrollVariance(plannedHours, actualHours, shift.shift_date, todayIso)) {
      flagParts.push('variance');
    }

    const sickReason = typeof shift.sick_reason === 'string' && shift.sick_reason.trim()
      ? shift.sick_reason.trim()
      : null;

    rows.push({
      employeeName,
      employeeId: shift.employee_id,
      date: shift.shift_date,
      department: shift.department,
      plannedHours,
      actualHours,
      hourlyRate,
      totalPay,
      flags: flagParts.join(', '),
      plannedStart: isCouldntWork ? null : shift.start_time ?? null,
      plannedEnd: isCouldntWork ? null : shift.end_time ?? null,
      actualStart: session ? toLocalHHMM(session.clock_in_at as string) : null,
      actualEnd: session ? toLocalHHMM((session.clock_out_at as string | null) ?? null) : null,
      shiftId: shift.id,
      sessionId: (session?.id as string | undefined) ?? null,
      note: null, // populated after note fetch below
      sessionNote: [session?.notes, session?.manager_note].filter(Boolean).join(' · ') || null,
      sickReason: isCouldntWork ? sickReason : null,
      standardHours: cost.standardHours,
      premiumHours: cost.premiumHours,
      multiplier: cost.multiplier,
      effectiveRate: cost.effectiveRate,
      premiumReason: cost.premiumReason,
      premiumPay: cost.premiumPay,
    });
  }

  // Add any unmatched sessions so worked time is never silently dropped.
  for (const session of allSessions) {
    const sessionId = session.id as string;
    if (consumedSessionIds.has(sessionId)) continue;
    if (salaryEmployeeIds.has(session.employee_id as string)) continue;

    const emp = session.employees as {
      employee_id: string;
      first_name: string | null;
      last_name: string | null;
    } | null;

    const employeeName = emp
      ? [emp.first_name, emp.last_name].filter(Boolean).join(' ')
      : 'Unknown';

    const actualHours = calculateActualPaidHours(session.clock_in_at as string, (session.clock_out_at as string | null) ?? null) ?? null;
    const rateResult = getHourlyRateSync(session.employee_id as string, session.work_date as string);
    const hourlyRate = rateResult?.rate ?? null;
    // Unmatched/unscheduled sessions have no linked shift — session premium only.
    const cost = costRow(session, actualHours, hourlyRate, null);
    const totalPay = cost.totalPay;

    const flagParts: string[] = [];
    if ((session.is_unscheduled as boolean) || !(session.linked_shift_id as string | null)) {
      flagParts.push('unscheduled');
    } else {
      flagParts.push('unmatched_session');
    }
    if (session.is_auto_close as boolean) flagParts.push('auto_close');

    rows.push({
      employeeName,
      employeeId: session.employee_id as string,
      date: session.work_date as string,
      department: '',
      plannedHours: null,
      actualHours,
      hourlyRate,
      totalPay,
      flags: flagParts.join(', '),
      plannedStart: null,
      plannedEnd: null,
      actualStart: toLocalHHMM(session.clock_in_at as string),
      actualEnd: toLocalHHMM((session.clock_out_at as string | null) ?? null),
      shiftId: null,
      sessionId: sessionId,
      note: null,
      sessionNote: [session.notes, session.manager_note].filter(Boolean).join(' · ') || null,
      sickReason: null,
      standardHours: cost.standardHours,
      premiumHours: cost.premiumHours,
      multiplier: cost.multiplier,
      effectiveRate: cost.effectiveRate,
      premiumReason: cost.premiumReason,
      premiumPay: cost.premiumPay,
    });
  }

  // Fetch reconciliation notes for all shifts in this period
  const shiftIds = rows.map(r => r.shiftId).filter(Boolean) as string[];
  if (shiftIds.length > 0) {
    const { data: notes } = await supabase
      .from('reconciliation_notes')
      .select('entity_id, note')
      .eq('entity_type', 'shift')
      .in('entity_id', shiftIds);

    if (notes?.length) {
      // Use most-recent note per shift (table is ordered by created_at desc by default — use last inserted)
      const noteByShift = new Map<string, string>();
      for (const n of notes) noteByShift.set(n.entity_id, n.note);
      for (const row of rows) {
        if (row.shiftId) row.note = noteByShift.get(row.shiftId) ?? null;
      }
    }
  }

  // Aggregate per-employee summaries for email body. Hours split into standard
  // vs premium so the accountant sees the breakdown; totalPay stays inclusive.
  const byEmployee = new Map<string, PayrollEmployeeSummary>();
  for (const row of rows) {
    // Back-compat guard mirrors the Excel builder: when a row carries no premium
    // fields, all its actual hours count as standard.
    const rowPremiumHours = row.premiumHours ?? 0;
    const rowStandardHours = row.standardHours ?? row.actualHours ?? 0;
    const existing = byEmployee.get(row.employeeId);
    if (existing) {
      existing.plannedHours += row.plannedHours ?? 0;
      existing.actualHours += row.actualHours ?? 0;
      existing.standardHours = (existing.standardHours ?? 0) + rowStandardHours;
      existing.premiumHours = (existing.premiumHours ?? 0) + rowPremiumHours;
      existing.totalPay = (existing.totalPay ?? 0) + (row.totalPay ?? 0);
    } else {
      byEmployee.set(row.employeeId, {
        name: row.employeeName,
        plannedHours: row.plannedHours ?? 0,
        actualHours: row.actualHours ?? 0,
        standardHours: rowStandardHours,
        premiumHours: rowPremiumHours,
        hourlyRate: row.hourlyRate,
        totalPay: row.totalPay,
      });
    }
  }

  // Round aggregated hours to 2dp so floating-point accumulation doesn't leak
  // into the email figures.
  for (const summary of byEmployee.values()) {
    summary.plannedHours = Math.round(summary.plannedHours * 100) / 100;
    summary.actualHours = Math.round(summary.actualHours * 100) / 100;
    if (summary.standardHours != null) summary.standardHours = Math.round(summary.standardHours * 100) / 100;
    if (summary.premiumHours != null) summary.premiumHours = Math.round(summary.premiumHours * 100) / 100;
    if (summary.totalPay != null) summary.totalPay = Math.round(summary.totalPay * 100) / 100;
  }

  return { success: true, data: rows, employees: Array.from(byEmployee.values()) };
}

// ---------------------------------------------------------------------------
// Approve a payroll month
// ---------------------------------------------------------------------------

export async function approvePayrollMonth(year: number, month: number): Promise<
  { success: true; data: PayrollMonthApproval } | { success: false; error: string }
> {
  const canApprove = await checkUserPermission('payroll', 'approve');
  if (!canApprove) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  // Build snapshot at approval time
  const reviewData = await getPayrollMonthData(year, month);
  if (!reviewData.success) return { success: false, error: reviewData.error };
  if (reviewData.data.length === 0) {
    return { success: false, error: 'No payroll rows to approve' };
  }

  const snapshot = {
    rows: reviewData.data,
    employees: reviewData.employees,
    approved_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('payroll_month_approvals')
    .upsert({ year, month, approved_by: user.id, snapshot }, { onConflict: 'year,month' })
    .select('id, year, month, approved_at, approved_by, snapshot, email_sent_at, email_sent_by')
    .single();

  if (error) return { success: false, error: error.message };

  void logAuditEvent({
    user_id: user.id,
    operation_type: 'approve',
    resource_type: 'payroll_month',
    resource_id: `${year}-${String(month).padStart(2, '0')}`,
    operation_status: 'success',
    new_values: { year, month },
  });

  revalidatePath('/rota/payroll');
  return { success: true, data: data as PayrollMonthApproval };
}

// ---------------------------------------------------------------------------
// Send accountant email with Excel attachment
// ---------------------------------------------------------------------------

export async function sendPayrollEmail(year: number, month: number): Promise<
  { success: true } | { success: false; error: string }
> {
  const canSend = await checkUserPermission('payroll', 'send');
  if (!canSend) return { success: false, error: 'Permission denied' };

  const { accountantEmail: ACCOUNTANT_EMAIL, managerEmail: MANAGER_EMAIL } = await getRotaSettings();
  if (!ACCOUNTANT_EMAIL) return { success: false, error: 'Accountant email is not configured — set it in Settings → Rota Settings' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  // Load approved snapshot
  const { data: approval } = await supabase
    .from('payroll_month_approvals')
    .select('id, year, month, approved_at, approved_by, snapshot, email_sent_at, email_sent_by')
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();

  if (!approval) return { success: false, error: 'Month has not been approved yet' };

  const snapshot = approval.snapshot as { rows: PayrollRow[]; employees: PayrollEmployeeSummary[] };

  // Load the payroll period to get the period_end date
  const period = await getOrCreatePayrollPeriodRecord(year, month);

  // Find employees leaving or already separated with employment_end_date within this payroll period
  const { data: leavingRaw } = await supabase
    .from('employees')
    .select('first_name, last_name, employment_end_date')
    .in('status', ['Started Separation', 'Former'])
    .not('employment_end_date', 'is', null)
    .gte('employment_end_date', period.period_start)
    .lte('employment_end_date', period.period_end);

  const leavingEmployees: LeavingEmployee[] = (leavingRaw ?? [])
    .filter(e => e.employment_end_date)
    .map(e => ({
      name: [e.first_name, e.last_name].filter(Boolean).join(' ') || 'Unknown',
      employmentEndDate: e.employment_end_date!,
    }));

  // Build Excel
  const xlsxBuffer = await buildPayrollWorkbook(year, month, snapshot.rows);
  const filename = getPayrollFilename(year, month);

  // Build email body
  const monthLabel = payrollMonthLabel(year, month);
  const htmlBody = buildPayrollEmailHtml(year, month, snapshot.employees, leavingEmployees);

  // Get sender's email for CC
  const { data: senderProfile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', user.id)
    .maybeSingle();

  const ccEmails = senderProfile?.email ? [senderProfile.email] : [];

  const result = await sendEmail({
    to: ACCOUNTANT_EMAIL,
    cc: ccEmails,
    subject: `Payroll — ${monthLabel}`,
    html: htmlBody,
    attachments: [
      {
        name: filename,
        content: xlsxBuffer,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ],
  });

  const logStatus = result.success ? 'sent' : 'failed';

  await supabase.from('rota_email_log').insert({
    email_type: 'payroll_export',
    entity_type: 'payroll_month',
    entity_id: approval.id,
    to_addresses: [ACCOUNTANT_EMAIL],
    cc_addresses: ccEmails,
    subject: `Payroll — ${monthLabel}`,
    status: logStatus,
    error_message: result.success ? null : result.error ?? null,
    message_id: result.success ? result.messageId ?? null : null,
    sent_by: user.id,
  });

  if (!result.success) return { success: false, error: 'Email send failed' };

  // Record email sent timestamp on approval — non-fatal if it fails
  const { error: timestampError } = await supabase
    .from('payroll_month_approvals')
    .update({ email_sent_at: new Date().toISOString(), email_sent_by: user.id })
    .eq('id', approval.id);
  if (timestampError) {
    console.error('[sendPayrollEmail] Failed to update email_sent_at:', timestampError.message);
  }

  void logAuditEvent({
    user_id: user.id,
    operation_type: 'send',
    resource_type: 'payroll_month',
    resource_id: `${year}-${String(month).padStart(2, '0')}`,
    operation_status: 'success',
    additional_info: { to: ACCOUNTANT_EMAIL, month_label: monthLabel },
  });

  // Send earnings alert to manager if any employee earned over £833 this month
  const EARNINGS_THRESHOLD = 833;
  const overThreshold = snapshot.employees
    .filter(e => (e.totalPay ?? 0) > EARNINGS_THRESHOLD)
    .map(e => ({ name: e.name, totalPay: e.totalPay! }));

  if (overThreshold.length > 0 && MANAGER_EMAIL) {
    const alertHtml = buildEarningsAlertEmailHtml(year, month, overThreshold);
    await sendEmail({
      to: MANAGER_EMAIL,
      subject: `URGENT: Earnings alert — ${overThreshold.length === 1 ? overThreshold[0].name : `${overThreshold.length} employees`} over £${EARNINGS_THRESHOLD} in ${monthLabel}`,
      html: alertHtml,
    });
  }

  revalidatePath('/rota/payroll');
  return { success: true };
}

// ---------------------------------------------------------------------------
// Reconciliation notes (per shift)
// ---------------------------------------------------------------------------

export async function upsertShiftNote(
  shiftId: string,
  note: string,
  year?: number,
  month?: number,
): Promise<{ success: true } | { success: false; error: string }> {
  const canApprove = await checkUserPermission('payroll', 'approve');
  if (!canApprove) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  if (note.trim()) {
    // Atomic upsert — unique constraint on (entity_type, entity_id) ensures one note per entity
    const { error: upsertError } = await supabase
      .from('reconciliation_notes')
      .upsert(
        { entity_type: 'shift', entity_id: shiftId, note: note.trim(), created_by: user.id, updated_at: new Date().toISOString() },
        { onConflict: 'entity_type,entity_id' },
      );
    if (upsertError) return { success: false, error: upsertError.message };
  } else {
    // Empty note — delete any existing note for this entity
    const { error: deleteError } = await supabase
      .from('reconciliation_notes')
      .delete()
      .eq('entity_type', 'shift')
      .eq('entity_id', shiftId);
    if (deleteError) return { success: false, error: deleteError.message };
  }

  if (typeof year === 'number' && typeof month === 'number') {
    await invalidatePayrollApproval(createAdminClient(), year, month);
  }

  revalidatePath('/rota/payroll');
  return { success: true };
}

// ---------------------------------------------------------------------------
// Edit actual times on a payroll row (creates session if none exists)
// ---------------------------------------------------------------------------

export async function updatePayrollRowTimes(
  sessionId: string | null,
  employeeId: string,
  workDate: string,
  clockInTime: string,        // HH:MM local
  clockOutTime: string | null, // HH:MM local or null
  year: number,
  month: number,
): Promise<{ success: true } | { success: false; error: string }> {
  const canApprove = await checkUserPermission('payroll', 'approve');
  if (!canApprove) return { success: false, error: 'Permission denied' };

  // The payroll screen edits times only — it never supplies a premium here.
  //  - UPDATE branch: omitting `premium` makes updateTimeclockSession PRESERVE the
  //    session's existing premium (re-clamped to the new interval), so a time edit
  //    never silently drops an override.
  //  - CREATE branch: omitting `premium` inserts the session with NO premium
  //    columns (all NULL). That is deliberate — the row carries no spurious premium
  //    and, because its premium columns are null, payroll resolves premium LIVE.
  //    Such a create is unlinked (no linked_shift_id), so under the linked-only rule
  //    it pays base unless it later gains its own explicit override — matching the
  //    portal. If the payroll screen ever edits premium, forward it via `premium`.
  const result = sessionId
    ? await updateTimeclockSession(sessionId, workDate, clockInTime, clockOutTime, undefined, { allowPayrollApprove: true })
    : await createTimeclockSession(employeeId, workDate, clockInTime, clockOutTime, undefined, { allowPayrollApprove: true });

  if (!result.success) return result;

  const supabase = createAdminClient();
  await invalidatePayrollApproval(supabase, year, month);

  revalidatePath('/rota/payroll');
  return { success: true };
}

// ---------------------------------------------------------------------------
// Delete a payroll row: removes session if present, cancels shift if not
// ---------------------------------------------------------------------------

export async function deletePayrollRow(
  sessionId: string | null,
  shiftId: string | null,
  year: number,
  month: number,
): Promise<{ success: true } | { success: false; error: string }> {
  const canApprove = await checkUserPermission('payroll', 'approve');
  if (!canApprove) return { success: false, error: 'Permission denied' };
  const sessionClient = await createClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  if (sessionId) {
    const result = await deleteTimeclockSession(sessionId, { allowPayrollApprove: true });
    if (!result.success) return result;
  } else if (shiftId) {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('rota_shifts')
      .update({ status: 'cancelled' })
      .eq('id', shiftId);
    if (error) return { success: false, error: error.message };
  } else {
    return { success: false, error: 'Nothing to delete' };
  }

  const supabase = createAdminClient();
  await invalidatePayrollApproval(supabase, year, month);

  await logAuditEvent({
    user_id: user.id,
    ...(user.email && { user_email: user.email }),
    operation_type: 'delete',
    resource_type: sessionId ? 'timeclock_session' : 'rota_shift',
    resource_id: sessionId ?? shiftId ?? undefined,
    operation_status: 'success',
    additional_info: {
      source: 'payroll_row_delete',
      payroll_year: year,
      payroll_month: month,
    },
  }).catch(() => {});

  revalidatePath('/rota/payroll');
  return { success: true };
}
