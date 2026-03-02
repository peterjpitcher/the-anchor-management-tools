'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { revalidatePath } from 'next/cache';
import { logAuditEvent } from '@/app/actions/audit';
import { checkUserPermission } from '@/app/actions/rbac';

// Timeclock uses the service-role (admin) client so that clock in/out works
// on the public FOH kiosk without Supabase auth session.
const createClient = () => createAdminClient();

const TIMEZONE = 'Europe/London';

async function canManageTimeclock(options?: { allowPayrollApprove?: boolean }): Promise<boolean> {
  const canEdit = await checkUserPermission('timeclock', 'edit');
  if (canEdit) return true;
  if (options?.allowPayrollApprove) {
    return checkUserPermission('payroll', 'approve');
  }
  return false;
}

async function invalidatePayrollApprovalsForDate(
  supabase: ReturnType<typeof createAdminClient>,
  workDate: string,
): Promise<void> {
  const { data: periods } = await supabase
    .from('payroll_periods')
    .select('year, month')
    .lte('period_start', workDate)
    .gte('period_end', workDate);

  for (const period of periods ?? []) {
    await supabase
      .from('payroll_month_approvals')
      .delete()
      .eq('year', period.year)
      .eq('month', period.month);
  }
}

export type TimeclockSession = {
  id: string;
  employee_id: string;
  work_date: string;
  clock_in_at: string;
  clock_out_at: string | null;
  linked_shift_id: string | null;
  is_unscheduled: boolean;
  is_auto_close: boolean;
  auto_close_reason: string | null;
  is_reviewed: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Clock in
// Uses the anon Supabase client (FOH page has no auth).
// ---------------------------------------------------------------------------

export async function clockIn(employeeId: string): Promise<
  { success: true; data: TimeclockSession } | { success: false; error: string }
> {
  // Use service-role or anon client — FOH page is open access
  const supabase = await createClient();

  // Prevent double clock-in
  const { data: openSession } = await supabase
    .from('timeclock_sessions')
    .select('id')
    .eq('employee_id', employeeId)
    .is('clock_out_at', null)
    .single();

  if (openSession) {
    return { success: false, error: 'Already clocked in. Please clock out first.' };
  }

  const nowUtc = new Date();
  const nowLocal = toZonedTime(nowUtc, TIMEZONE);
  const workDate = nowLocal.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('timeclock_sessions')
    .insert({
      employee_id: employeeId,
      clock_in_at: nowUtc.toISOString(),
      work_date: workDate,
    })
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };

  // Attempt to link to a scheduled shift (same work_date, department not required, within 2hr window)
  await linkSessionToShift(data.id, employeeId, workDate, nowUtc);

  void logAuditEvent({
    operation_type: 'clock_in',
    resource_type: 'timeclock_session',
    resource_id: data.id,
    operation_status: 'success',
    additional_info: { employee_id: employeeId, work_date: workDate },
  });

  await invalidatePayrollApprovalsForDate(supabase, workDate);

  revalidatePath('/timeclock');
  return { success: true, data: data as TimeclockSession };
}

// ---------------------------------------------------------------------------
// Clock out
// ---------------------------------------------------------------------------

export async function clockOut(employeeId: string): Promise<
  { success: true; data: TimeclockSession } | { success: false; error: string }
> {
  const supabase = await createClient();

  const { data: openSession, error: findError } = await supabase
    .from('timeclock_sessions')
    .select('*')
    .eq('employee_id', employeeId)
    .is('clock_out_at', null)
    .single();

  if (findError || !openSession) {
    return { success: false, error: 'No open clock-in session found.' };
  }

  const nowUtc = new Date();

  const { data, error } = await supabase
    .from('timeclock_sessions')
    .update({ clock_out_at: nowUtc.toISOString() })
    .eq('id', openSession.id)
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };

  void logAuditEvent({
    operation_type: 'clock_out',
    resource_type: 'timeclock_session',
    resource_id: data.id,
    operation_status: 'success',
    additional_info: { employee_id: employeeId, clock_out_at: nowUtc.toISOString() },
  });

  await invalidatePayrollApprovalsForDate(supabase, openSession.work_date as string);

  revalidatePath('/timeclock');
  return { success: true, data: data as TimeclockSession };
}

// ---------------------------------------------------------------------------
// Get currently clocked-in sessions (for the FOH display)
// ---------------------------------------------------------------------------

export async function getOpenSessions(): Promise<
  { success: true; data: (TimeclockSession & { employee_name: string })[] } | { success: false; error: string }
> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('timeclock_sessions')
    .select(`
      *,
      employees!timeclock_sessions_employee_id_fkey(first_name, last_name)
    `)
    .is('clock_out_at', null)
    .order('clock_in_at', { ascending: true });

  if (error) return { success: false, error: error.message };

  const result = (data ?? []).map((row: Record<string, unknown>) => {
    const emp = row.employees as { first_name: string | null; last_name: string | null } | null;
    return {
      ...row,
      employee_name: [emp?.first_name, emp?.last_name].filter(Boolean).join(' ') || 'Unknown',
    };
  });

  return { success: true, data: result as (TimeclockSession & { employee_name: string })[] };
}

// ---------------------------------------------------------------------------
// Internal: link a new timeclock session to its scheduled shift
// Matches same work_date, same employee, clock-in within 2 hours of shift start.
// ---------------------------------------------------------------------------

async function linkSessionToShift(
  sessionId: string,
  employeeId: string,
  workDate: string,
  clockInAt: Date,
): Promise<void> {
  const supabase = await createClient();

  const { data: shifts } = await supabase
    .from('rota_shifts')
    .select('id, start_time')
    .eq('employee_id', employeeId)
    .eq('shift_date', workDate)
    .eq('status', 'scheduled');

  if (!shifts?.length) {
    // Mark as unscheduled
    await supabase
      .from('timeclock_sessions')
      .update({ is_unscheduled: true })
      .eq('id', sessionId);
    return;
  }

  // Find the shift whose start time is closest to clock-in, within ±2 hours
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  let bestShiftId: string | null = null;
  let bestDiff = Infinity;

  for (const shift of shifts) {
    const [h, m] = shift.start_time.split(':').map(Number);
    // shift times are stored in Europe/London local — convert correctly to UTC
    const shiftStartUtc = fromZonedTime(
      `${workDate}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`,
      TIMEZONE,
    );
    const diff = Math.abs(clockInAt.getTime() - shiftStartUtc.getTime());
    if (diff < TWO_HOURS_MS && diff < bestDiff) {
      bestDiff = diff;
      bestShiftId = shift.id;
    }
  }

  if (bestShiftId) {
    await supabase
      .from('timeclock_sessions')
      .update({ linked_shift_id: bestShiftId })
      .eq('id', sessionId);
  } else {
    await supabase
      .from('timeclock_sessions')
      .update({ is_unscheduled: true })
      .eq('id', sessionId);
  }
}

// ---------------------------------------------------------------------------
// Get timeclock sessions for a date range (manager review)
// ---------------------------------------------------------------------------

export type TimeclockSessionWithEmployee = TimeclockSession & {
  employee_name: string;
  clock_in_local: string;      // HH:MM Europe/London
  clock_out_local: string | null;
  planned_start: string | null; // HH:MM from linked rota_shift
  planned_end: string | null;   // HH:MM from linked rota_shift
};

export async function getTimeclockSessionsForWeek(
  weekStart: string,
  weekEnd: string,
): Promise<{ success: true; data: TimeclockSessionWithEmployee[] } | { success: false; error: string }> {
  const canView = await checkUserPermission('timeclock', 'view');
  if (!canView) return { success: false, error: 'Permission denied' };

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('timeclock_sessions')
    .select(`
      *,
      employees!timeclock_sessions_employee_id_fkey(first_name, last_name),
      rota_shifts!linked_shift_id(start_time, end_time)
    `)
    .gte('work_date', weekStart)
    .lte('work_date', weekEnd)
    .order('work_date')
    .order('clock_in_at');

  if (error) return { success: false, error: error.message };

  const result = (data ?? []).map((row: Record<string, unknown>) => {
    const emp = row.employees as { first_name: string | null; last_name: string | null } | null;
    const shift = row.rota_shifts as { start_time: string; end_time: string } | null;
    const clockIn = new Date(row.clock_in_at as string);
    const clockOut = row.clock_out_at ? new Date(row.clock_out_at as string) : null;

    const fmt = (d: Date) => toZonedTime(d, TIMEZONE).toISOString().split('T')[1].slice(0, 5);

    return {
      ...(row as TimeclockSession),
      employee_name: [emp?.first_name, emp?.last_name].filter(Boolean).join(' ') || 'Unknown',
      clock_in_local: fmt(clockIn),
      clock_out_local: clockOut ? fmt(clockOut) : null,
      planned_start: shift?.start_time?.slice(0, 5) ?? null,
      planned_end: shift?.end_time?.slice(0, 5) ?? null,
    };
  });

  return { success: true, data: result as TimeclockSessionWithEmployee[] };
}

// ---------------------------------------------------------------------------
// Create a timeclock session manually (manager adding missed clock-in)
// ---------------------------------------------------------------------------

export async function createTimeclockSession(
  employeeId: string,
  workDate: string,            // YYYY-MM-DD
  clockInTime: string,         // HH:MM local
  clockOutTime: string | null, // HH:MM local or null
  notes?: string | null,
  options?: { allowPayrollApprove?: boolean },
): Promise<{ success: true; data: TimeclockSessionWithEmployee } | { success: false; error: string }> {
  const canManage = await canManageTimeclock(options);
  if (!canManage) return { success: false, error: 'Permission denied' };

  if (!/^\d{2}:\d{2}$/.test(clockInTime)) {
    return { success: false, error: 'Invalid clock-in time' };
  }
  if (clockOutTime !== null && !/^\d{2}:\d{2}$/.test(clockOutTime)) {
    return { success: false, error: 'Invalid clock-out time' };
  }

  const clockInUtc = fromZonedTime(new Date(`${workDate}T${clockInTime}:00`), TIMEZONE);
  const clockOutUtc = clockOutTime
    ? fromZonedTime(new Date(`${workDate}T${clockOutTime}:00`), TIMEZONE)
    : null;

  if (clockOutUtc && clockOutUtc <= clockInUtc) {
    return { success: false, error: 'Clock-out must be after clock-in' };
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('timeclock_sessions')
    .insert({
      employee_id: employeeId,
      work_date: workDate,
      clock_in_at: clockInUtc.toISOString(),
      clock_out_at: clockOutUtc?.toISOString() ?? null,
      is_reviewed: false,
      notes: notes ?? null,
    })
    .select(`*, employees!timeclock_sessions_employee_id_fkey(first_name, last_name)`)
    .single();

  if (error) return { success: false, error: error.message };

  const row = data as Record<string, unknown>;
  const emp = row.employees as { first_name: string | null; last_name: string | null } | null;
  const fmt = (d: Date) => toZonedTime(d, TIMEZONE).toISOString().split('T')[1].slice(0, 5);

  const session: TimeclockSessionWithEmployee = {
    ...(row as TimeclockSession),
    employee_name: [emp?.first_name, emp?.last_name].filter(Boolean).join(' ') || 'Unknown',
    clock_in_local: fmt(clockInUtc),
    clock_out_local: clockOutUtc ? fmt(clockOutUtc) : null,
    planned_start: null,
    planned_end: null,
  };

  void logAuditEvent({
    operation_type: 'create',
    resource_type: 'timeclock_session',
    resource_id: data.id,
    operation_status: 'success',
    additional_info: { employee_id: employeeId, work_date: workDate, manual: true },
  });

  await invalidatePayrollApprovalsForDate(supabase, workDate);

  revalidatePath('/rota/timeclock');
  return { success: true, data: session };
}

// ---------------------------------------------------------------------------
// Update a timeclock session (manager correction)
// Times are supplied as HH:MM in Europe/London local time for the work_date.
// ---------------------------------------------------------------------------

export async function updateTimeclockSession(
  sessionId: string,
  workDate: string,
  clockInTime: string,        // HH:MM local
  clockOutTime: string | null, // HH:MM local or null
  notes?: string | null,
  options?: { allowPayrollApprove?: boolean },
): Promise<{ success: true; data: TimeclockSession } | { success: false; error: string }> {
  const canManage = await canManageTimeclock(options);
  if (!canManage) return { success: false, error: 'Permission denied' };

  if (!/^\d{2}:\d{2}$/.test(clockInTime)) {
    return { success: false, error: 'Invalid clock-in time' };
  }
  if (clockOutTime !== null && !/^\d{2}:\d{2}$/.test(clockOutTime)) {
    return { success: false, error: 'Invalid clock-out time' };
  }

  const clockInUtc = fromZonedTime(new Date(`${workDate}T${clockInTime}:00`), TIMEZONE);
  const clockOutUtc = clockOutTime
    ? fromZonedTime(new Date(`${workDate}T${clockOutTime}:00`), TIMEZONE)
    : null;

  if (clockOutUtc && clockOutUtc <= clockInUtc) {
    return { success: false, error: 'Clock-out must be after clock-in' };
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('timeclock_sessions')
    .update({
      clock_in_at: clockInUtc.toISOString(),
      clock_out_at: clockOutUtc?.toISOString() ?? null,
      // If a manager has set a clock-out manually, clear the auto-close flag
      ...(clockOutUtc ? { is_auto_close: false, auto_close_reason: null } : {}),
      notes: notes ?? null,
    })
    .eq('id', sessionId)
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };

  await invalidatePayrollApprovalsForDate(supabase, workDate);

  revalidatePath('/rota/timeclock');
  return { success: true, data: data as TimeclockSession };
}

// ---------------------------------------------------------------------------
// Approve a timeclock session (manager sign-off)
// ---------------------------------------------------------------------------

export async function approveTimeclockSession(
  sessionId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const canManage = await canManageTimeclock();
  if (!canManage) return { success: false, error: 'Permission denied' };

  const supabase = createAdminClient();

  const { error } = await supabase
    .from('timeclock_sessions')
    .update({ is_reviewed: true })
    .eq('id', sessionId);

  if (error) return { success: false, error: error.message };

  void logAuditEvent({
    operation_type: 'approve',
    resource_type: 'timeclock_session',
    resource_id: sessionId,
    operation_status: 'success',
  });

  revalidatePath('/rota/timeclock');
  return { success: true };
}

// ---------------------------------------------------------------------------
// Delete a timeclock session (manager only)
// ---------------------------------------------------------------------------

export async function deleteTimeclockSession(
  sessionId: string,
  options?: { allowPayrollApprove?: boolean },
): Promise<{ success: true } | { success: false; error: string }> {
  const canManage = await canManageTimeclock(options);
  if (!canManage) return { success: false, error: 'Permission denied' };

  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from('timeclock_sessions')
    .select('work_date')
    .eq('id', sessionId)
    .single();

  const { error } = await supabase
    .from('timeclock_sessions')
    .delete()
    .eq('id', sessionId);

  if (error) return { success: false, error: error.message };

  void logAuditEvent({
    operation_type: 'delete',
    resource_type: 'timeclock_session',
    resource_id: sessionId,
    operation_status: 'success',
  });

  if (existing?.work_date) {
    await invalidatePayrollApprovalsForDate(supabase, existing.work_date as string);
  }

  revalidatePath('/rota/timeclock');
  return { success: true };
}
