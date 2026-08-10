'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from '@/app/actions/audit';
import { getTodayIsoDate } from '@/lib/dateUtils';
import { displayName } from '@/lib/employees/display-name';
import { moveShift } from '@/app/actions/rota';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A staff member who has asked to pick up an unfilled shift. */
export type ReassignVolunteer = {
  request_id: string;
  employee_id: string;
  employee_name: string;
  note: string | null;
  requested_at: string;
};

/**
 * Why a shift has nobody on it. A shift can be free because somebody turned it
 * down, because a manager took them off it, or because it was created open and
 * never belonged to anybody. The queue always says which, so an empty slot is
 * never ambiguous.
 */
export type ReassignOrigin =
  | { kind: 'rejected'; who: string; at: string; note: string | null }
  | { kind: 'unassigned'; who: string | null; reason: string | null }
  | { kind: 'never_assigned' };

/** An unfilled future shift, with the reason it is unfilled. */
export type ReassignOpenShift = {
  shift_id: string;
  week_start: string | null;
  shift_date: string;
  start_time: string;
  end_time: string;
  is_overnight: boolean;
  unpaid_break_minutes: number;
  department: string;
  name: string | null;
  notes: string | null;
  origin: ReassignOrigin;
  volunteers: ReassignVolunteer[];
};

/** A rejection whose shift is no longer sitting open. */
export type ReassignCoveredShift = {
  rejection_id: string;
  shift_id: string;
  week_start: string | null;
  shift_date: string;
  start_time: string;
  end_time: string;
  is_overnight: boolean;
  department: string;
  name: string | null;
  rejected_by_name: string;
  rejected_at: string;
  rejection_note: string | null;
  covered_by_name: string | null;
  outcome: 'covered' | 'cancelled' | 'deleted';
};

/**
 * A request still at `pending` whose shift is no longer open. These never
 * resolved because the manager filled the shift on the grid instead of using the
 * approval link in the email.
 */
export type ReassignStaleRequest = {
  request_id: string;
  shift_id: string;
  employee_name: string;
  shift_date: string | null;
  start_time: string | null;
  end_time: string | null;
  requested_at: string;
  reason: 'already_filled' | 'shift_in_past' | 'shift_deleted';
};

export type ReassignQueue = {
  openShifts: ReassignOpenShift[];
  covered: ReassignCoveredShift[];
  staleRequests: ReassignStaleRequest[];
};

/** How far back the "recently turned down" history reaches. */
const COVERED_HISTORY_DAYS = 90;

type ShiftRow = {
  id: string;
  week_id: string;
  employee_id: string | null;
  shift_date: string;
  start_time: string;
  end_time: string;
  unpaid_break_minutes: number;
  department: string;
  status: string;
  notes: string | null;
  is_overnight: boolean;
  is_open_shift: boolean;
  name: string | null;
  original_employee_id: string | null;
  reassigned_from_id: string | null;
  reassignment_reason: string | null;
};

type RejectionRow = {
  id: string;
  shift_id: string;
  employee_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  department: string;
  is_overnight: boolean;
  name: string | null;
  rejection_note: string | null;
  rejected_at: string;
};

type RequestRow = {
  id: string;
  shift_id: string;
  employee_id: string;
  note: string | null;
  requested_at: string;
};

type EmployeeNameRow = {
  employee_id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
};

const SHIFT_COLUMNS =
  'id, week_id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name, original_employee_id, reassigned_from_id, reassignment_reason';

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Everything needed to clear the reassignment queue in one place: every
 * unfilled future shift across all weeks, who turned it down and why, who has
 * volunteered, what has since been covered, and which requests were left
 * dangling.
 */
export async function getReassignmentQueue(): Promise<
  { success: true; data: ReassignQueue } | { success: false; error: string }
> {
  const canView = await checkUserPermission('rota', 'view');
  if (!canView) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const today = getTodayIsoDate();
  const historyFrom = addDaysIso(today, -COVERED_HISTORY_DAYS);

  const [openShiftsResult, rejectionsResult, pendingRequestsResult] = await Promise.all([
    supabase
      .from('rota_shifts')
      .select(SHIFT_COLUMNS)
      .eq('is_open_shift', true)
      .eq('status', 'scheduled')
      .gte('shift_date', today)
      .order('shift_date', { ascending: true })
      .order('start_time', { ascending: true }),
    supabase
      .from('rota_shift_rejections')
      .select('id, shift_id, employee_id, shift_date, start_time, end_time, department, is_overnight, name, rejection_note, rejected_at')
      .gte('shift_date', historyFrom)
      .order('rejected_at', { ascending: false }),
    supabase
      .from('rota_open_shift_requests')
      .select('id, shift_id, employee_id, note, requested_at')
      .eq('status', 'pending')
      .order('requested_at', { ascending: true }),
  ]);

  if (openShiftsResult.error) return { success: false, error: openShiftsResult.error.message };
  if (rejectionsResult.error) return { success: false, error: rejectionsResult.error.message };
  if (pendingRequestsResult.error) return { success: false, error: pendingRequestsResult.error.message };

  const openShiftRows = (openShiftsResult.data ?? []) as unknown as ShiftRow[];
  const rejectionRows = (rejectionsResult.data ?? []) as unknown as RejectionRow[];
  const requestRows = (pendingRequestsResult.data ?? []) as unknown as RequestRow[];

  // Shifts behind a rejection or a dangling request are usually NOT in the open
  // list any more (they were filled or cancelled), so look those up separately.
  const openShiftIds = new Set(openShiftRows.map(shift => shift.id));
  const extraShiftIds = [
    ...new Set(
      [...rejectionRows.map(row => row.shift_id), ...requestRows.map(row => row.shift_id)]
        .filter(id => !openShiftIds.has(id)),
    ),
  ];

  const [extraShiftsResult, weeksResult] = await Promise.all([
    extraShiftIds.length
      ? supabase.from('rota_shifts').select(SHIFT_COLUMNS).in('id', extraShiftIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('rota_weeks').select('id, week_start'),
  ]);

  if (extraShiftsResult.error) return { success: false, error: extraShiftsResult.error.message };

  const shiftById = new Map<string, ShiftRow>();
  for (const shift of [...openShiftRows, ...((extraShiftsResult.data ?? []) as unknown as ShiftRow[])]) {
    shiftById.set(shift.id, shift);
  }

  const weekStartById = new Map<string, string>(
    ((weeksResult.data ?? []) as Array<{ id: string; week_start: string }>).map(week => [week.id, week.week_start]),
  );

  // One name lookup covering everybody referenced anywhere on the page.
  const employeeIds = [
    ...new Set(
      [
        ...rejectionRows.map(row => row.employee_id),
        ...requestRows.map(row => row.employee_id),
        ...[...shiftById.values()].flatMap(shift => [
          shift.employee_id,
          shift.original_employee_id,
          shift.reassigned_from_id,
        ]),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  const { data: employeeRows } = employeeIds.length
    ? await supabase
        .from('employees')
        .select('employee_id, first_name, last_name, preferred_name')
        .in('employee_id', employeeIds)
    : { data: [] };
  const nameById = new Map<string, string>(
    ((employeeRows ?? []) as EmployeeNameRow[]).map(row => [row.employee_id, displayName(row, 'Unknown')]),
  );

  // Rejections come back newest first, so the first hit per shift is the latest.
  const latestRejectionByShift = new Map<string, RejectionRow>();
  for (const rejection of rejectionRows) {
    if (!latestRejectionByShift.has(rejection.shift_id)) {
      latestRejectionByShift.set(rejection.shift_id, rejection);
    }
  }

  const isStillOpen = (shift: ShiftRow | undefined): boolean =>
    Boolean(shift && shift.is_open_shift && shift.status === 'scheduled' && shift.shift_date >= today);

  const volunteersByShift = new Map<string, ReassignVolunteer[]>();
  const staleRequests: ReassignStaleRequest[] = [];
  for (const request of requestRows) {
    const shift = shiftById.get(request.shift_id);
    if (isStillOpen(shift)) {
      const existing = volunteersByShift.get(request.shift_id) ?? [];
      existing.push({
        request_id: request.id,
        employee_id: request.employee_id,
        employee_name: nameById.get(request.employee_id) ?? 'Unknown',
        note: request.note,
        requested_at: request.requested_at,
      });
      volunteersByShift.set(request.shift_id, existing);
      continue;
    }

    staleRequests.push({
      request_id: request.id,
      shift_id: request.shift_id,
      employee_name: nameById.get(request.employee_id) ?? 'Unknown',
      shift_date: shift?.shift_date ?? null,
      start_time: shift?.start_time ?? null,
      end_time: shift?.end_time ?? null,
      requested_at: request.requested_at,
      reason: !shift ? 'shift_deleted' : shift.shift_date < today ? 'shift_in_past' : 'already_filled',
    });
  }

  /**
   * A rejection row is the richest source (it carries the staff member's own
   * words), so it wins. Failing that the shift itself may remember who it was
   * taken off and why. If neither exists the shift was created open and has
   * never belonged to anybody, which is worth saying out loud.
   */
  const originOf = (shift: ShiftRow): ReassignOrigin => {
    const rejection = latestRejectionByShift.get(shift.id);
    if (rejection) {
      return {
        kind: 'rejected',
        who: nameById.get(rejection.employee_id) ?? 'Unknown',
        at: rejection.rejected_at,
        note: rejection.rejection_note,
      };
    }

    const previousId = shift.reassigned_from_id ?? shift.original_employee_id;
    if (previousId || shift.reassignment_reason) {
      return {
        kind: 'unassigned',
        who: previousId ? (nameById.get(previousId) ?? 'Unknown') : null,
        reason: shift.reassignment_reason,
      };
    }

    return { kind: 'never_assigned' };
  };

  const openShifts: ReassignOpenShift[] = openShiftRows.map(shift => ({
    shift_id: shift.id,
    week_start: weekStartById.get(shift.week_id) ?? null,
    shift_date: shift.shift_date,
    start_time: shift.start_time,
    end_time: shift.end_time,
    is_overnight: shift.is_overnight,
    unpaid_break_minutes: shift.unpaid_break_minutes,
    department: shift.department,
    name: shift.name,
    notes: shift.notes,
    origin: originOf(shift),
    volunteers: volunteersByShift.get(shift.id) ?? [],
  }));

  const covered: ReassignCoveredShift[] = [];
  for (const rejection of rejectionRows) {
    const shift = shiftById.get(rejection.shift_id);
    if (isStillOpen(shift)) continue; // still outstanding, already listed above

    let outcome: ReassignCoveredShift['outcome'] = 'covered';
    if (!shift) outcome = 'deleted';
    else if (shift.status === 'cancelled') outcome = 'cancelled';

    covered.push({
      rejection_id: rejection.id,
      shift_id: rejection.shift_id,
      week_start: shift ? (weekStartById.get(shift.week_id) ?? null) : null,
      shift_date: rejection.shift_date,
      start_time: rejection.start_time,
      end_time: rejection.end_time,
      is_overnight: rejection.is_overnight,
      department: rejection.department,
      name: rejection.name,
      rejected_by_name: nameById.get(rejection.employee_id) ?? 'Unknown',
      rejected_at: rejection.rejected_at,
      rejection_note: rejection.rejection_note,
      covered_by_name: shift?.employee_id ? (nameById.get(shift.employee_id) ?? 'Unknown') : null,
      outcome,
    });
  }

  return { success: true, data: { openShifts, covered, staleRequests } };
}

/**
 * Cheap count of shifts still needing somebody, for the nav badge. Kept separate
 * from `getReassignmentQueue` so the weekly rota page does not pay for the whole
 * queue just to render a number.
 */
export async function getUnfilledShiftCount(): Promise<number> {
  const canView = await checkUserPermission('rota', 'view');
  if (!canView) return 0;

  const supabase = await createClient();
  const { count, error } = await supabase
    .from('rota_shifts')
    .select('id', { count: 'exact', head: true })
    .eq('is_open_shift', true)
    .eq('status', 'scheduled')
    .gte('shift_date', getTodayIsoDate());

  if (error) return 0;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

function staleReasonMessage(reason: string | null): string {
  switch (reason) {
    case 'employee_shift_overlap':
      return 'They are already working an overlapping shift.';
    case 'employee_sick_marker':
      return 'They are marked as unable to work that day.';
    case 'employee_on_leave':
      return 'They are on approved leave that day.';
    case 'request_changed':
    case 'request_missing':
      return 'That request has already been decided.';
    case 'live_shift_changed':
    case 'published_shift_changed':
      return 'The shift changed since this page loaded. Refresh and try again.';
    case 'shift_missing':
    case 'published_shift_missing':
      return 'That shift no longer exists.';
    default:
      return 'The shift is no longer available. Refresh and try again.';
  }
}

/**
 * Approve a volunteer for an open shift. Reuses the same hardened RPC as the
 * manager email link, so the row locks and the overlap / sickness / leave checks
 * all still apply. Writes both the draft and the published rota, so it takes
 * effect for staff immediately.
 */
export async function approveOpenShiftVolunteer(
  requestId: string,
): Promise<{ success: true; weekStart: string | null } | { success: false; error: string }> {
  const [canEdit, canPublish] = await Promise.all([
    checkUserPermission('rota', 'edit'),
    checkUserPermission('rota', 'publish'),
  ]);
  if (!canEdit || !canPublish) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  const admin = createAdminClient();
  const { data: request, error: requestError } = await admin
    .from('rota_open_shift_requests')
    .select('id, shift_id, employee_id, status')
    .eq('id', requestId)
    .maybeSingle();

  if (requestError) return { success: false, error: requestError.message };
  if (!request) return { success: false, error: 'Request not found' };
  if (request.status !== 'pending') return { success: false, error: 'This request has already been decided' };

  const { data: shift, error: shiftError } = await admin
    .from('rota_shifts')
    .select('id, shift_date, start_time, end_time, unpaid_break_minutes, department, is_overnight, name')
    .eq('id', request.shift_id)
    .maybeSingle();

  if (shiftError) return { success: false, error: shiftError.message };
  if (!shift) return { success: false, error: 'Shift not found' };

  // The queue renders live data, so what is on screen IS the expected state.
  const { data, error } = await admin.rpc('approve_rota_open_shift_request', {
    p_request_id: request.id,
    p_shift_id: request.shift_id,
    p_employee_id: request.employee_id,
    p_actor_user_id: user.id,
    p_expected_shift_date: shift.shift_date,
    p_expected_start_time: shift.start_time,
    p_expected_end_time: shift.end_time,
    p_expected_unpaid_break_minutes: shift.unpaid_break_minutes,
    p_expected_department: shift.department,
    p_expected_is_overnight: shift.is_overnight,
    p_expected_name: shift.name,
  });

  if (error) return { success: false, error: error.message };

  const result = ((Array.isArray(data) ? data[0] : data) ?? null) as
    | { status: string; week_start: string | null; reason: string | null }
    | null;

  if (!result || result.status !== 'approved') {
    return { success: false, error: staleReasonMessage(result?.reason ?? null) };
  }

  void logAuditEvent({
    user_id: user.id,
    user_email: user.email ?? undefined,
    operation_type: 'approve_open_shift_request',
    resource_type: 'rota_shift',
    resource_id: request.shift_id,
    operation_status: 'success',
    old_values: { employee_id: null, is_open_shift: true },
    new_values: { employee_id: request.employee_id, is_open_shift: false, acceptance_status: 'accepted' },
    additional_info: { request_id: request.id, source: 'reassignment_queue' },
  });

  revalidatePath('/rota/reassign');
  revalidatePath('/rota');
  revalidatePath('/portal/shifts');
  revalidatePath(`/employees/${request.employee_id}`);

  return { success: true, weekStart: result.week_start ?? null };
}

/** Turn a volunteer down without filling the shift. */
export async function declineOpenShiftVolunteer(
  requestId: string,
  managerNote?: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const canEdit = await checkUserPermission('rota', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  const now = new Date().toISOString();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('rota_open_shift_requests')
    .update({
      status: 'declined',
      decided_at: now,
      decided_by: user.id,
      manager_note: managerNote?.trim() || null,
      updated_at: now,
    })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select('id, shift_id')
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: 'This request has already been decided' };

  void logAuditEvent({
    user_id: user.id,
    user_email: user.email ?? undefined,
    operation_type: 'decline_open_shift_request',
    resource_type: 'rota_shift',
    resource_id: data.shift_id,
    operation_status: 'success',
    new_values: { request_id: data.id, status: 'declined' },
    additional_info: { source: 'reassignment_queue' },
  });

  revalidatePath('/rota/reassign');
  revalidatePath('/rota');
  revalidatePath('/portal/shifts');
  return { success: true };
}

/**
 * Assign an unfilled shift to anybody, the same operation as dragging it onto
 * their row on the grid. Like any grid edit this lands in the draft, so the week
 * still needs republishing before staff see it.
 */
export async function assignOpenShiftFromQueue(
  shiftId: string,
  employeeId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const canEdit = await checkUserPermission('rota', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data: shift, error } = await supabase
    .from('rota_shifts')
    .select('id, shift_date, is_open_shift, status')
    .eq('id', shiftId)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!shift) return { success: false, error: 'Shift not found' };
  if (!shift.is_open_shift || shift.status !== 'scheduled') {
    return { success: false, error: 'That shift is no longer open. Refresh and try again.' };
  }

  const result = await moveShift(shiftId, employeeId, shift.shift_date as string);
  if (!result.success) return { success: false, error: result.error };

  revalidatePath('/rota/reassign');
  return { success: true };
}

/** Clear a dangling request that no longer has an open shift behind it. */
export async function dismissStaleOpenShiftRequest(
  requestId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  return declineOpenShiftVolunteer(requestId, 'Shift was no longer available');
}
