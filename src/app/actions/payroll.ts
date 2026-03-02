'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkUserPermission } from '@/app/actions/rbac';
import { revalidatePath } from 'next/cache';
import { calculateActualPaidHours, calculatePaidHours } from '@/lib/rota/pay-calculator';
import { updateTimeclockSession, createTimeclockSession, deleteTimeclockSession } from '@/app/actions/timeclock';
import { buildPayrollWorkbook, getPayrollFilename, type PayrollRow } from '@/lib/rota/excel-export';
import { buildPayrollEmailHtml, buildEarningsAlertEmailHtml, type PayrollEmployeeSummary, type LeavingEmployee } from '@/lib/rota/email-templates';
import { sendEmail } from '@/lib/email/emailService';
import { format, differenceInYears, parseISO } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { logAuditEvent } from '@/app/actions/audit';
import { getRotaSettings } from '@/app/actions/rota-settings';

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

/** Default: 25th of previous month → 24th of close month */
function defaultPeriodDates(year: number, month: number): { period_start: string; period_end: string } {
  // period_end = 24th of the close month
  const end = new Date(Date.UTC(year, month - 1, 24));
  // period_start = 25th of the previous month (handles Jan → Dec of prior year correctly)
  const start = new Date(Date.UTC(year, month - 2, 25));
  return {
    period_start: end.toISOString().split('T')[0].replace(/-\d{2}$/, m => m).replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, mo, d) => `${y}-${mo}-${d}`),
    period_end:   end.toISOString().split('T')[0],
  };
}

// Use simpler implementation
function isoDate(d: Date): string {
  return d.toISOString().split('T')[0];
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

export async function getOrCreatePayrollPeriod(year: number, month: number): Promise<PayrollPeriod> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from('payroll_periods')
    .select('*')
    .eq('year', year)
    .eq('month', month)
    .single();

  if (existing) return existing as PayrollPeriod;

  const end = new Date(Date.UTC(year, month - 1, 24));
  const start = new Date(Date.UTC(year, month - 2, 25));

  const { data: created, error } = await supabase
    .from('payroll_periods')
    .insert({ year, month, period_start: isoDate(start), period_end: isoDate(end) })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return created as PayrollPeriod;
}

export async function updatePayrollPeriod(
  year: number,
  month: number,
  periodStart: string,
  periodEnd: string,
): Promise<{ success: true; data: PayrollPeriod } | { success: false; error: string }> {
  const canApprove = await checkUserPermission('payroll', 'approve');
  if (!canApprove) return { success: false, error: 'Permission denied' };

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('payroll_periods')
    .upsert(
      { year, month, period_start: periodStart, period_end: periodEnd },
      { onConflict: 'year,month' },
    )
    .select('*')
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

  const period = await getOrCreatePayrollPeriod(year, month);
  const monthStart = period.period_start;
  const monthEnd = period.period_end;

  // Fetch everything needed in parallel — shifts, sessions, and all rate-lookup tables.
  // Rate data is fetched once here and computed in-memory below, replacing the previous
  // pattern of calling getHourlyRate() per shift (which did 5 DB round-trips each).
  const [
    { data: shifts, error: shiftsError },
    { data: sessions },
    { data: paySettings },
    { data: rateOverrides },
    { data: ageBands },
    { data: bandRates },
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

  if (shiftsError) return { success: false, error: shiftsError.message };

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
    const plannedHours = calculatePaidHours(
      shift.start_time,
      shift.end_time,
      shift.unpaid_break_minutes,
      shift.is_overnight,
    );

    const session =
      takeLinkedSessionForShift(shift.id) ??
      takeBestUnlinkedSession(shift.employee_id, shift.shift_date, shift.start_time);

    const actualHours = session
      ? calculateActualPaidHours(session.clock_in_at as string, (session.clock_out_at as string | null) ?? null) ?? null
      : null;

    const rateResult = getHourlyRateSync(shift.employee_id, shift.shift_date);
    const hourlyRate = rateResult?.rate ?? null;
    const totalPay = actualHours !== null && hourlyRate !== null
      ? Math.round(actualHours * hourlyRate * 100) / 100
      : null;

    const flagParts: string[] = [];
    if (session?.is_auto_close) flagParts.push('auto_close');
    if (session?.is_unscheduled) flagParts.push('unscheduled');
    if (shift.status === 'sick') flagParts.push('sick');
    if (plannedHours !== null && actualHours !== null && Math.abs(plannedHours - actualHours) > 0.5) {
      flagParts.push('variance');
    }

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
      plannedStart: shift.start_time ?? null,
      plannedEnd: shift.end_time ?? null,
      actualStart: session ? toLocalHHMM(session.clock_in_at as string) : null,
      actualEnd: session ? toLocalHHMM((session.clock_out_at as string | null) ?? null) : null,
      shiftId: shift.id,
      sessionId: (session?.id as string | undefined) ?? null,
      note: null, // populated after note fetch below
      sessionNote: (session?.notes as string | null) ?? null,
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
    const totalPay = actualHours !== null && hourlyRate !== null
      ? Math.round(actualHours * hourlyRate * 100) / 100
      : null;

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
      sessionNote: (session.notes as string | null) ?? null,
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

  // Aggregate per-employee summaries for email body
  const byEmployee = new Map<string, PayrollEmployeeSummary>();
  for (const row of rows) {
    const existing = byEmployee.get(row.employeeId);
    if (existing) {
      existing.plannedHours += row.plannedHours ?? 0;
      existing.actualHours += row.actualHours ?? 0;
      existing.totalPay = (existing.totalPay ?? 0) + (row.totalPay ?? 0);
    } else {
      byEmployee.set(row.employeeId, {
        name: row.employeeName,
        plannedHours: row.plannedHours ?? 0,
        actualHours: row.actualHours ?? 0,
        hourlyRate: row.hourlyRate,
        totalPay: row.totalPay,
      });
    }
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

  // Build snapshot at approval time
  const reviewData = await getPayrollMonthData(year, month);
  if (!reviewData.success) return { success: false, error: reviewData.error };

  const snapshot = {
    rows: reviewData.data,
    employees: reviewData.employees,
    approved_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('payroll_month_approvals')
    .upsert({ year, month, approved_by: user!.id, snapshot }, { onConflict: 'year,month' })
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };

  void logAuditEvent({
    user_id: user?.id,
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

  // Load approved snapshot
  const { data: approval } = await supabase
    .from('payroll_month_approvals')
    .select('*')
    .eq('year', year)
    .eq('month', month)
    .single();

  if (!approval) return { success: false, error: 'Month has not been approved yet' };

  const snapshot = approval.snapshot as { rows: PayrollRow[]; employees: PayrollEmployeeSummary[] };

  // Load the payroll period to get the period_end date
  const period = await getOrCreatePayrollPeriod(year, month);

  // Find employees in 'Started Separation' with employment_end_date within this payroll period
  const { data: leavingRaw } = await supabase
    .from('employees')
    .select('first_name, last_name, employment_end_date')
    .eq('status', 'Started Separation')
    .not('employment_end_date', 'is', null)
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
  const monthLabel = format(new Date(year, month - 1, 1), 'MMMM yyyy');
  const htmlBody = buildPayrollEmailHtml(year, month, snapshot.employees, leavingEmployees);

  // Get sender's email for CC
  const { data: senderProfile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', user!.id)
    .single();

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
    sent_by: user!.id,
  });

  if (!result.success) return { success: false, error: 'Email send failed' };

  // Record email sent timestamp on approval
  await supabase
    .from('payroll_month_approvals')
    .update({ email_sent_at: new Date().toISOString(), email_sent_by: user!.id })
    .eq('id', approval.id);

  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'send',
    resource_type: 'payroll_month',
    resource_id: `${year}-${String(month).padStart(2, '0')}`,
    operation_status: 'success',
    additional_info: { to: ACCOUNTANT_EMAIL, month_label: format(new Date(year, month - 1, 1), 'MMMM yyyy') },
  });

  // Send earnings alert to manager if any employee earned over £833 this month
  const EARNINGS_THRESHOLD = 833;
  const overThreshold = snapshot.employees
    .filter(e => (e.totalPay ?? 0) > EARNINGS_THRESHOLD)
    .map(e => ({ name: e.name, totalPay: e.totalPay! }));

  if (overThreshold.length > 0 && MANAGER_EMAIL) {
    const alertHtml = buildEarningsAlertEmailHtml(year, month, overThreshold);
    const monthLabel = format(new Date(year, month - 1, 1), 'MMMM yyyy');
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
): Promise<{ success: true } | { success: false; error: string }> {
  const canApprove = await checkUserPermission('payroll', 'approve');
  if (!canApprove) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Upsert: delete existing then insert, so we always have one note per shift
  await supabase
    .from('reconciliation_notes')
    .delete()
    .eq('entity_type', 'shift')
    .eq('entity_id', shiftId);

  if (note.trim()) {
    const { error } = await supabase
      .from('reconciliation_notes')
      .insert({ entity_type: 'shift', entity_id: shiftId, note: note.trim(), created_by: user!.id });

    if (error) return { success: false, error: error.message };
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

  revalidatePath('/rota/payroll');
  return { success: true };
}
