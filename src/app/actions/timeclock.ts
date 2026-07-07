'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { revalidatePath } from 'next/cache';
import { logAuditEvent } from '@/app/actions/audit';
import { checkUserPermission } from '@/app/actions/rbac';
import {
  normalizeTimeclockPin,
  phoneLastFourMatchesPin,
  verifyTimeclockPin,
} from '@/lib/timeclock/pin';
import { hasPremium } from '@/lib/rota/pay-calculator';

// Timeclock uses the service-role (admin) client so that clock in/out works
// on the public kiosk without Supabase auth session.
const createClient = () => createAdminClient();

const TIMEZONE = 'Europe/London';
const MANAGER_IPAD_EMAIL = 'manager@the-anchor.pub';

/**
 * PostgREST returns `numeric` columns as STRINGS ("1.50"), which breaks strict
 * equality checks (=== 1.5) downstream. Coerce a premium multiplier/override to
 * a finite number, or null when absent/blank/NaN.
 */
function coercePremiumNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

async function canManageTimeclock(options?: { allowPayrollApprove?: boolean }): Promise<boolean> {
  const canEdit = await checkUserPermission('timeclock', 'edit');
  if (canEdit) return true;
  if (options?.allowPayrollApprove) {
    return checkUserPermission('payroll', 'approve');
  }
  return false;
}

async function canUseAuthenticatedTimeclock(): Promise<boolean> {
  const [canClock, canEdit] = await Promise.all([
    checkUserPermission('timeclock', 'clock'),
    checkUserPermission('timeclock', 'edit'),
  ]);
  if (canClock || canEdit) {
    return true;
  }

  return canUseManagerFohKioskTimeclock();
}

async function canUseManagerFohKioskTimeclock(): Promise<boolean> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id || user.email?.toLowerCase() !== MANAGER_IPAD_EMAIL) {
    return false;
  }

  return checkUserPermission('table_bookings', 'view', user.id);
}

async function verifyClockIdentity(
  employee: {
    timeclock_pin_hash?: string | null;
    mobile_number?: string | null;
    phone_number?: string | null;
  },
  pin?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalizedPin = normalizeTimeclockPin(pin);

  if (normalizedPin) {
    const matchesStoredPin = employee.timeclock_pin_hash
      ? verifyTimeclockPin(normalizedPin, employee.timeclock_pin_hash)
      : phoneLastFourMatchesPin(normalizedPin, employee.mobile_number, employee.phone_number);

    if (matchesStoredPin) {
      return { ok: true };
    }

    return { ok: false, error: 'Timeclock PIN did not match.' };
  }

  if (await canUseAuthenticatedTimeclock()) {
    return { ok: true };
  }

  return { ok: false, error: 'Enter your timeclock PIN.' };
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

  if (!periods?.length) return;

  // Parallelise deletes across periods instead of awaiting them serially
  await Promise.all(
    periods.map(period =>
      supabase
        .from('payroll_month_approvals')
        .delete()
        .eq('year', period.year)
        .eq('month', period.month),
    ),
  );
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
  manager_note: string | null;
  // Premium hourly rate (time-and-a-half / double-time / bespoke). NULL multiplier
  // AND NULL override => no premium (×1.0). rate_override wins over rate_multiplier.
  // NULL window (start/end) with a premium set => premium applies to the whole session.
  // Window is stored as timestamptz so overlap across midnight is unambiguous.
  rate_multiplier: number | null;
  rate_override: number | null;
  premium_reason: string | null;
  premium_start_at: string | null;
  premium_end_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * The five session premium fields a manager may set/override on a timeclock
 * entry. Passed as camelCase and mapped to snake_case columns on write.
 *
 * Semantics: NULL multiplier AND NULL override => clear any premium (×1.0).
 * rateOverride wins over rateMultiplier. NULL window (start/end) with a premium
 * set => whole session. Window values are ISO timestamptz strings.
 */
export type SessionPremiumInput = {
  rateMultiplier: number | null;
  rateOverride: number | null;
  premiumReason: string | null;
  premiumStartAt: string | null;
  premiumEndAt: string | null;
};

// Columns selected for a timeclock session row, including premium fields.
const SESSION_COLUMNS =
  'id, employee_id, work_date, clock_in_at, clock_out_at, linked_shift_id, ' +
  'is_unscheduled, is_auto_close, auto_close_reason, is_reviewed, notes, ' +
  'manager_note, rate_multiplier, rate_override, premium_reason, ' +
  'premium_start_at, premium_end_at, created_at, updated_at';

// ---------------------------------------------------------------------------
// Clock in
// Uses the service-role (admin) client — the public kiosk has no auth session.
// ---------------------------------------------------------------------------

export async function clockIn(employeeId: string, pin?: string): Promise<
  { success: true; data: TimeclockSession } | { success: false; error: string }
> {
  const supabase = await createClient();

  const { data: employee } = await supabase
    .from('employees')
    .select('employee_id, status, mobile_number, phone_number, timeclock_pin_hash')
    .eq('employee_id', employeeId)
    .single();
  if (!employee) return { success: false, error: 'Employee not found' };
  if (!['Active', 'Started Separation'].includes(employee.status)) return { success: false, error: 'Employee is not active' };

  const identity = await verifyClockIdentity(employee as {
    timeclock_pin_hash?: string | null;
    mobile_number?: string | null;
    phone_number?: string | null;
  }, pin);
  if (!identity.ok) return { success: false, error: identity.error };

  // Prevent double clock-in — explicit null check narrows the race window
  const { data: openSession } = await supabase
    .from('timeclock_sessions')
    .select('id')
    .eq('employee_id', employeeId)
    .is('clock_out_at', null)
    .limit(1)
    .maybeSingle();

  if (openSession) {
    return { success: false, error: 'Already clocked in. Please clock out first.' };
  }

  const nowUtc = new Date();
  const workDate = formatInTimeZone(nowUtc, TIMEZONE, 'yyyy-MM-dd');

  const { data, error } = await supabase
    .from('timeclock_sessions')
    .insert({
      employee_id: employeeId,
      clock_in_at: nowUtc.toISOString(),
      work_date: workDate,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return { success: false, error: 'Already clocked in. Please clock out first.' };
    }
    return { success: false, error: error.message };
  }

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
  revalidatePath('/rota/timeclock');
  return { success: true, data: data as TimeclockSession };
}

// ---------------------------------------------------------------------------
// Clock out
// ---------------------------------------------------------------------------

export async function clockOut(employeeId: string, pin?: string): Promise<
  { success: true; data: TimeclockSession } | { success: false; error: string }
> {
  const supabase = await createClient();

  const { data: employee } = await supabase
    .from('employees')
    .select('employee_id, status, mobile_number, phone_number, timeclock_pin_hash')
    .eq('employee_id', employeeId)
    .single();
  if (!employee) return { success: false, error: 'Employee not found' };
  if (!['Active', 'Started Separation'].includes(employee.status)) return { success: false, error: 'Employee is not active' };

  const identity = await verifyClockIdentity(employee as {
    timeclock_pin_hash?: string | null;
    mobile_number?: string | null;
    phone_number?: string | null;
  }, pin);
  if (!identity.ok) return { success: false, error: identity.error };

  const { data: openSession, error: findError } = await supabase
    .from('timeclock_sessions')
    .select('id, work_date')
    .eq('employee_id', employeeId)
    .is('clock_out_at', null)
    .limit(1)
    .maybeSingle();

  if (findError || !openSession) {
    return { success: false, error: 'No open clock-in session found.' };
  }

  const nowUtc = new Date();

  const { data, error } = await supabase
    .from('timeclock_sessions')
    .update({ clock_out_at: nowUtc.toISOString() })
    .eq('id', openSession.id)
    .is('clock_out_at', null)
    .select('*')
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: 'No open clock-in session found.' };

  void logAuditEvent({
    operation_type: 'clock_out',
    resource_type: 'timeclock_session',
    resource_id: data.id,
    operation_status: 'success',
    additional_info: { employee_id: employeeId, clock_out_at: nowUtc.toISOString() },
  });

  await invalidatePayrollApprovalsForDate(supabase, openSession.work_date as string);

  revalidatePath('/timeclock');
  revalidatePath('/rota/timeclock');
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

  const { data: shiftsRaw } = await supabase
    .from('rota_shifts')
    .select('id, start_time, end_time, shift_date, is_overnight')
    .eq('employee_id', employeeId)
    .eq('shift_date', workDate)
    .eq('status', 'scheduled');

  const shifts = (shiftsRaw ?? []) as unknown as LinkableShift[];

  if (!shifts.length) {
    // Mark as unscheduled
    await supabase
      .from('timeclock_sessions')
      .update({ is_unscheduled: true })
      .eq('id', sessionId);
    return;
  }

  // Find the shift whose start time is closest to clock-in, within ±2 hours
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  let bestShift: (typeof shifts)[number] | null = null;
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
      bestShift = shift;
    }
  }

  if (bestShift) {
    // Link only. We deliberately do NOT copy the shift's premium onto the
    // session — the session premium columns represent an EXPLICIT manager
    // override, and un-overridden sessions resolve their premium LIVE from the
    // linked shift (payroll/portal both do this via resolveSessionPremium).
    // Copying at clock-in caused stale premiums (shift edited later) and
    // inherited-promotion bugs (a shift premium looked like a manual override).
    await supabase
      .from('timeclock_sessions')
      .update({ linked_shift_id: bestShift.id })
      .eq('id', sessionId);
  } else {
    await supabase
      .from('timeclock_sessions')
      .update({ is_unscheduled: true })
      .eq('id', sessionId);
  }
}

/** A scheduled shift row shape used when linking a session to it. */
type LinkableShift = {
  id: string;
  start_time: string;
  end_time: string;
  shift_date: string;
  is_overnight: boolean | null;
};

/**
 * Clamp a premium window (timestamptz instants) to a session's worked interval.
 * A NULL bound stays NULL (open-ended: start=NULL means "from clock-in",
 * end=NULL means "to clock-out"), so a whole-session premium (both NULL) is
 * preserved. When clockOut is not yet known, the end bound is left unclamped.
 */
function clampPremiumWindow(
  premiumStartAt: Date | null,
  premiumEndAt: Date | null,
  clockInAt: Date,
  clockOutAt: Date | null,
): { startAt: string | null; endAt: string | null } {
  const inMs = clockInAt.getTime();
  const outMs = clockOutAt ? clockOutAt.getTime() : null;

  let startAt: string | null = null;
  if (premiumStartAt) {
    let ms = Math.max(premiumStartAt.getTime(), inMs);
    if (outMs != null) ms = Math.min(ms, outMs);
    startAt = new Date(ms).toISOString();
  }

  let endAt: string | null = null;
  if (premiumEndAt) {
    let ms = Math.max(premiumEndAt.getTime(), inMs);
    if (outMs != null) ms = Math.min(ms, outMs);
    endAt = new Date(ms).toISOString();
  }

  return { startAt, endAt };
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
  // Premium as scheduled on the linked shift, so the manager review UI can offer
  // the shift default and show whether the session already differs from it.
  shift_rate_multiplier: number | null;
  shift_rate_override: number | null;
  shift_premium_reason: string | null;
  shift_premium_start_time: string | null; // HH:MM local, NULL = whole shift
  shift_premium_end_time: string | null;   // HH:MM local, NULL = whole shift
  premium_start_local: string | null;      // HH:MM Europe/London, NULL = whole session
  premium_end_local: string | null;        // HH:MM Europe/London, NULL = whole session
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
      ${SESSION_COLUMNS},
      employees!timeclock_sessions_employee_id_fkey(first_name, last_name),
      rota_shifts!linked_shift_id(start_time, end_time, rate_multiplier, rate_override, premium_reason, premium_start_time, premium_end_time)
    `)
    .gte('work_date', weekStart)
    .lte('work_date', weekEnd)
    .order('work_date')
    .order('clock_in_at');

  if (error) return { success: false, error: error.message };

  const result = (data ?? []).map((row: Record<string, unknown>) => {
    const emp = row.employees as { first_name: string | null; last_name: string | null } | null;
    const shift = row.rota_shifts as {
      start_time: string;
      end_time: string;
      rate_multiplier: number | null;
      rate_override: number | null;
      premium_reason: string | null;
      premium_start_time: string | null;
      premium_end_time: string | null;
    } | null;
    const clockIn = new Date(row.clock_in_at as string);
    const clockOut = row.clock_out_at ? new Date(row.clock_out_at as string) : null;
    const premiumStart = row.premium_start_at ? new Date(row.premium_start_at as string) : null;
    const premiumEnd = row.premium_end_at ? new Date(row.premium_end_at as string) : null;

    const fmt = (d: Date) => formatInTimeZone(d, TIMEZONE, 'HH:mm');

    return {
      ...(row as TimeclockSession),
      // PostgREST returns `numeric` columns as STRINGS. Coerce every premium
      // multiplier/override to a real number so the UI's `=== 1.5 / === 2`
      // choice detection doesn't silently fall through to 'none' and wipe it.
      rate_multiplier: coercePremiumNumber(row.rate_multiplier),
      rate_override: coercePremiumNumber(row.rate_override),
      employee_name: [emp?.first_name, emp?.last_name].filter(Boolean).join(' ') || 'Unknown',
      clock_in_local: fmt(clockIn),
      clock_out_local: clockOut ? fmt(clockOut) : null,
      planned_start: shift?.start_time?.slice(0, 5) ?? null,
      planned_end: shift?.end_time?.slice(0, 5) ?? null,
      shift_rate_multiplier: coercePremiumNumber(shift?.rate_multiplier),
      shift_rate_override: coercePremiumNumber(shift?.rate_override),
      shift_premium_reason: shift?.premium_reason ?? null,
      shift_premium_start_time: shift?.premium_start_time ? shift.premium_start_time.slice(0, 5) : null,
      shift_premium_end_time: shift?.premium_end_time ? shift.premium_end_time.slice(0, 5) : null,
      premium_start_local: premiumStart ? fmt(premiumStart) : null,
      premium_end_local: premiumEnd ? fmt(premiumEnd) : null,
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
  options?: { allowPayrollApprove?: boolean; premium?: SessionPremiumInput | null },
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
  let clockOutUtc = clockOutTime
    ? fromZonedTime(new Date(`${workDate}T${clockOutTime}:00`), TIMEZONE)
    : null;

  // Automatically handle overnight shifts — if clock-out appears to be before
  // clock-in, assume it crossed midnight and advance by one day.
  if (clockOutUtc && clockOutUtc <= clockInUtc) {
    clockOutUtc = new Date(clockOutUtc.getTime() + 24 * 60 * 60 * 1000);
  }

  const premiumValidation = validateSessionPremium(options?.premium);
  if (!premiumValidation.ok) return { success: false, error: premiumValidation.error };

  // Persist premium clamped to the new worked interval when the caller supplies it.
  const premiumColumns = options?.premium
    ? normalizeSessionPremiumColumns(options.premium, clockInUtc, clockOutUtc)
    : {};

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
      ...premiumColumns,
    })
    .select(`${SESSION_COLUMNS}, employees!timeclock_sessions_employee_id_fkey(first_name, last_name)`)
    .single();

  if (error) return { success: false, error: error.message };

  const row = data as Record<string, unknown>;
  const emp = row.employees as { first_name: string | null; last_name: string | null } | null;
  const fmt = (d: Date) => formatInTimeZone(d, TIMEZONE, 'HH:mm');
  const premiumStart = row.premium_start_at ? new Date(row.premium_start_at as string) : null;
  const premiumEnd = row.premium_end_at ? new Date(row.premium_end_at as string) : null;

  const session: TimeclockSessionWithEmployee = {
    ...(row as TimeclockSession),
    // Coerce PostgREST numeric strings back to numbers (see coercePremiumNumber).
    rate_multiplier: coercePremiumNumber(row.rate_multiplier),
    rate_override: coercePremiumNumber(row.rate_override),
    employee_name: [emp?.first_name, emp?.last_name].filter(Boolean).join(' ') || 'Unknown',
    clock_in_local: fmt(clockInUtc),
    clock_out_local: clockOutUtc ? fmt(clockOutUtc) : null,
    planned_start: null,
    planned_end: null,
    shift_rate_multiplier: null,
    shift_rate_override: null,
    shift_premium_reason: null,
    shift_premium_start_time: null,
    shift_premium_end_time: null,
    premium_start_local: premiumStart ? fmt(premiumStart) : null,
    premium_end_local: premiumEnd ? fmt(premiumEnd) : null,
  };

  void logAuditEvent({
    operation_type: 'create',
    resource_type: 'timeclock_session',
    resource_id: data.id,
    operation_status: 'success',
    additional_info: {
      employee_id: employeeId,
      work_date: workDate,
      manual: true,
      ...(options?.premium ? { premium: premiumColumns } : {}),
    },
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
  options?: { allowPayrollApprove?: boolean; premium?: SessionPremiumInput | null },
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
  let clockOutUtc = clockOutTime
    ? fromZonedTime(new Date(`${workDate}T${clockOutTime}:00`), TIMEZONE)
    : null;

  // Automatically handle overnight shifts — if clock-out appears to be before
  // clock-in, assume it crossed midnight and advance by one day.
  if (clockOutUtc && clockOutUtc <= clockInUtc) {
    clockOutUtc = new Date(clockOutUtc.getTime() + 24 * 60 * 60 * 1000);
  }

  const premiumValidation = validateSessionPremium(options?.premium);
  if (!premiumValidation.ok) return { success: false, error: premiumValidation.error };

  const supabase = createAdminClient();

  // Read the current premium so we can PRESERVE it across a pure time/notes edit
  // and re-clamp its stored window to the (possibly moved) worked interval.
  const { data: existing } = await supabase
    .from('timeclock_sessions')
    .select('rate_multiplier, rate_override, premium_reason, premium_start_at, premium_end_at')
    .eq('id', sessionId)
    .single();

  const oldPremium = {
    rate_multiplier: existing?.rate_multiplier ?? null,
    rate_override: existing?.rate_override ?? null,
    premium_reason: existing?.premium_reason ?? null,
    premium_start_at: existing?.premium_start_at ?? null,
    premium_end_at: existing?.premium_end_at ?? null,
  };

  // Premium is only changed when explicitly provided by the caller. On a
  // times/notes-only edit we keep whatever premium is already on the session,
  // re-clamping its window to the new interval so a time move doesn't leave the
  // premium window outside the worked hours.
  const premiumColumns = options?.premium
    ? normalizeSessionPremiumColumns(options.premium, clockInUtc, clockOutUtc)
    : reclampExistingPremiumColumns(oldPremium, clockInUtc, clockOutUtc);

  const { data, error } = await supabase
    .from('timeclock_sessions')
    .update({
      clock_in_at: clockInUtc.toISOString(),
      clock_out_at: clockOutUtc?.toISOString() ?? null,
      // If a manager has set a clock-out manually, clear the auto-close flag
      ...(clockOutUtc ? { is_auto_close: false, auto_close_reason: null } : {}),
      notes: notes ?? null,
      ...premiumColumns,
    })
    .eq('id', sessionId)
    .select(SESSION_COLUMNS)
    .single();

  if (error) return { success: false, error: error.message };

  void logAuditEvent({
    operation_type: 'update',
    resource_type: 'timeclock_session',
    resource_id: sessionId,
    operation_status: 'success',
    additional_info: {
      work_date: workDate,
      ...(options?.premium
        ? { premium_old: oldPremium, premium_new: premiumColumns }
        : {}),
    },
  });

  await invalidatePayrollApprovalsForDate(supabase, workDate);

  revalidatePath('/rota/timeclock');
  return { success: true, data: data as unknown as TimeclockSession };
}

// ---------------------------------------------------------------------------
// Premium helpers (session write path)
// ---------------------------------------------------------------------------

/** A £/hr override is capped so a fat-fingered rate can't slip past. */
const RATE_OVERRIDE_MAX = 100;
/** Free-text reason length cap (mirrors the sensible bound on the shift path). */
const PREMIUM_REASON_MAX = 200;

/**
 * Validate a caller-supplied session premium. Mirrors the DB CHECK constraints
 * so a bad value is rejected with a clear message before hitting the database.
 * Numeric fields may arrive as PostgREST strings, so coerce before comparing.
 */
function validateSessionPremium(
  premium: SessionPremiumInput | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!premium) return { ok: true };

  const rateMultiplier = premium.rateMultiplier == null ? null : Number(premium.rateMultiplier);
  const rateOverride = premium.rateOverride == null ? null : Number(premium.rateOverride);

  if (rateMultiplier != null && (Number.isNaN(rateMultiplier) || rateMultiplier < 1 || rateMultiplier > 3)) {
    return { ok: false, error: 'Rate multiplier must be between 1.0 and 3.0' };
  }
  if (rateOverride != null && (Number.isNaN(rateOverride) || rateOverride <= 0 || rateOverride > RATE_OVERRIDE_MAX)) {
    return { ok: false, error: `Rate override must be greater than £0 and at most £${RATE_OVERRIDE_MAX.toFixed(2)}/hr` };
  }

  // A window with both bounds must run forwards. NULL bounds are open-ended
  // (start=NULL from clock-in, end=NULL to clock-out) so they never reverse.
  if (premium.premiumStartAt && premium.premiumEndAt) {
    const startMs = new Date(premium.premiumStartAt).getTime();
    const endMs = new Date(premium.premiumEndAt).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      return { ok: false, error: 'Premium time window is invalid' };
    }
    if (endMs <= startMs) {
      return { ok: false, error: 'The premium end time must be after the premium start time' };
    }
  }

  return { ok: true };
}

/**
 * Convert a caller-supplied premium into the DB columns to write, clamping the
 * window to the worked interval. When neither multiplier nor override is set the
 * premium is cleared entirely (all five columns NULL => ×1.0).
 */
function normalizeSessionPremiumColumns(
  premium: SessionPremiumInput,
  clockInUtc: Date,
  clockOutUtc: Date | null,
): {
  rate_multiplier: number | null;
  rate_override: number | null;
  premium_reason: string | null;
  premium_start_at: string | null;
  premium_end_at: string | null;
} {
  if (!hasPremium({ rateMultiplier: premium.rateMultiplier, rateOverride: premium.rateOverride })) {
    return {
      rate_multiplier: null,
      rate_override: null,
      premium_reason: null,
      premium_start_at: null,
      premium_end_at: null,
    };
  }

  const startAt = premium.premiumStartAt ? new Date(premium.premiumStartAt) : null;
  const endAt = premium.premiumEndAt ? new Date(premium.premiumEndAt) : null;
  const clamped = clampPremiumWindow(startAt, endAt, clockInUtc, clockOutUtc);

  const trimmedReason = premium.premiumReason?.trim() || null;

  return {
    // Coerce in case the caller passed a PostgREST string ("1.50").
    rate_multiplier: premium.rateMultiplier == null ? null : Number(premium.rateMultiplier),
    rate_override: premium.rateOverride == null ? null : Number(premium.rateOverride),
    premium_reason: trimmedReason ? trimmedReason.slice(0, PREMIUM_REASON_MAX) : null,
    premium_start_at: clamped.startAt,
    premium_end_at: clamped.endAt,
  };
}

/**
 * Re-clamp a session's already-stored premium window to a (possibly moved)
 * worked interval, preserving the rate/reason untouched. Used on times-only
 * edits so a clock-time move keeps the premium window inside the worked hours.
 */
function reclampExistingPremiumColumns(
  existing: {
    rate_multiplier: number | null;
    rate_override: number | null;
    premium_reason: string | null;
    premium_start_at: string | null;
    premium_end_at: string | null;
  },
  clockInUtc: Date,
  clockOutUtc: Date | null,
): {
  premium_start_at: string | null;
  premium_end_at: string | null;
} {
  // No premium on the session: nothing to re-clamp (leave columns as-is).
  if (!hasPremium({ rateMultiplier: existing.rate_multiplier, rateOverride: existing.rate_override })) {
    return { premium_start_at: null, premium_end_at: null };
  }

  const startAt = existing.premium_start_at ? new Date(existing.premium_start_at) : null;
  const endAt = existing.premium_end_at ? new Date(existing.premium_end_at) : null;
  const clamped = clampPremiumWindow(startAt, endAt, clockInUtc, clockOutUtc);
  return { premium_start_at: clamped.startAt, premium_end_at: clamped.endAt };
}

// ---------------------------------------------------------------------------
// Approve a timeclock session (manager sign-off)
// ---------------------------------------------------------------------------

export async function approveTimeclockSession(
  sessionId: string,
  options?: { allowPayrollApprove?: boolean },
): Promise<{ success: true } | { success: false; error: string }> {
  const canManage = await canManageTimeclock(options);
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
