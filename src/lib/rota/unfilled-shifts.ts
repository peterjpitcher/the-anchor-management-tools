import type { createAdminClient } from '@/lib/supabase/admin';
import { displayName } from '@/lib/employees/display-name';

/**
 * Shifts with nobody on them, and the rejection that freed each one.
 *
 * Shared by the weekly manager alert, which looks eight weeks ahead, and the
 * daily urgent check, which looks one week ahead. They ask the same question
 * over different horizons, so they must not carry separate copies of the query:
 * a fix to one would silently leave the other reporting something different
 * about the same shift.
 */

/** How far ahead the daily urgent check looks. */
export const URGENT_UNFILLED_HORIZON_DAYS = 7;

type OpenShiftRow = {
  id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  department: string;
  name: string | null;
};

type RejectionRow = {
  shift_id: string;
  employee_id: string;
  rejection_note: string | null;
  rejected_at: string;
};

type EmployeeNameRow = {
  employee_id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
};

export type UnfilledShift = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  department: string;
  templateName: string | null;
  rejectedByName: string | null;
  rejectionNote: string | null;
};

/**
 * A query that failed. Recorded rather than swallowed: a database fault used to
 * look exactly like "nothing to report" and silently suppressed the whole alert.
 */
export type UnfilledQueryFailure = { step: string; message: string };

export function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0];
}

/** Whole days from today to the shift date. Zero means the shift is today. */
export function daysUntil(todayIso: string, shiftDateIso: string): number {
  const today = new Date(`${todayIso}T00:00:00Z`).getTime();
  const shift = new Date(`${shiftDateIso}T00:00:00Z`).getTime();
  return Math.round((shift - today) / 86_400_000);
}

export async function getUnfilledShifts(
  supabase: ReturnType<typeof createAdminClient>,
  todayIso: string,
  horizonDays: number,
): Promise<{ shifts: UnfilledShift[]; failures: UnfilledQueryFailure[] }> {
  const failures: UnfilledQueryFailure[] = [];

  const { data: shiftRows, error: shiftsError } = await supabase
    .from('rota_shifts')
    .select('id, shift_date, start_time, end_time, department, name')
    .eq('is_open_shift', true)
    .eq('status', 'scheduled')
    .gte('shift_date', todayIso)
    .lte('shift_date', addDaysIso(todayIso, horizonDays))
    .order('shift_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (shiftsError) {
    return { shifts: [], failures: [{ step: 'unfilled_shifts', message: shiftsError.message }] };
  }

  const shifts = (shiftRows ?? []) as OpenShiftRow[];
  if (shifts.length === 0) return { shifts: [], failures };

  const { data: rejectionRows, error: rejectionsError } = await supabase
    .from('rota_shift_rejections')
    .select('shift_id, employee_id, rejection_note, rejected_at')
    .in('shift_id', shifts.map(shift => shift.id))
    .order('rejected_at', { ascending: false });

  if (rejectionsError) {
    failures.push({ step: 'shift_rejections', message: rejectionsError.message });
  }

  const rejections = (rejectionRows ?? []) as RejectionRow[];
  const latestByShift = new Map<string, RejectionRow>();
  for (const rejection of rejections) {
    if (!latestByShift.has(rejection.shift_id)) latestByShift.set(rejection.shift_id, rejection);
  }

  const employeeIds = [...new Set(rejections.map(rejection => rejection.employee_id))];
  const { data: employeeRows, error: employeesError } = employeeIds.length
    ? await supabase
        .from('employees')
        .select('employee_id, first_name, last_name, preferred_name')
        .in('employee_id', employeeIds)
    : { data: [] as EmployeeNameRow[], error: null };

  if (employeesError) {
    failures.push({ step: 'rejection_employee_names', message: employeesError.message });
  }

  const nameById = new Map<string, string>(
    ((employeeRows ?? []) as EmployeeNameRow[]).map(row => [row.employee_id, displayName(row, 'a staff member')]),
  );

  return {
    shifts: shifts.map(shift => {
      const rejection = latestByShift.get(shift.id) ?? null;
      return {
        id: shift.id,
        date: shift.shift_date,
        startTime: shift.start_time,
        endTime: shift.end_time,
        department: shift.department,
        templateName: shift.name,
        rejectedByName: rejection ? (nameById.get(rejection.employee_id) ?? 'a staff member') : null,
        rejectionNote: rejection?.rejection_note ?? null,
      };
    }),
    failures,
  };
}
