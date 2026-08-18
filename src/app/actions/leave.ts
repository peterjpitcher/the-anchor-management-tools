'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkUserPermission } from '@/app/actions/rbac';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  eachIsoDateInRange,
  formatDateDdMmmmYyyy,
  formatTime12Hour,
  getTodayIsoDate,
  isValidIsoDate,
} from '@/lib/dateUtils';
import { sendEmail } from '@/lib/email/emailService';
import {
  buildHolidaySubmittedEmailHtml,
  buildHolidayDecisionEmailHtml,
} from '@/lib/rota/email-templates';
import { logAuditEvent } from '@/app/actions/audit';
import { displayName } from '@/lib/employees/display-name';
import { getRotaSettings } from '@/app/actions/rota-settings';
import {
  recordHolidayAuditOnly,
  recordHolidayReliabilityEvents,
} from '@/services/employee-reliability';
import {
  countAllowanceDays,
  getHolidayYear,
  getHolidayYearBounds,
} from '@/lib/leave/working-days';
import {
  consumesAllowance,
  DEFAULT_LEAVE_TYPE,
  getAllowanceConsumingTypes,
} from '@/lib/leave/leave-types';

export type LeaveRequest = {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  note: string | null;
  status: 'pending' | 'approved' | 'declined';
  manager_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  holiday_year: number;
  created_at: string;
  updated_at: string;
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Submit a leave request (employee)
// ---------------------------------------------------------------------------

const SubmitLeaveSchema = z.object({
  employeeId: z.string().uuid(),
  startDate: z.string().regex(ISO_DATE_PATTERN),
  endDate: z.string().regex(ISO_DATE_PATTERN),
  note: z.string().max(500).nullable().optional(),
});

const UpdateLeaveDatesSchema = z.object({
  requestId: z.string().uuid(),
  startDate: z.string().refine(isValidIsoDate, 'Start date must be a valid date'),
  endDate: z.string().refine(isValidIsoDate, 'End date must be a valid date'),
});

type UpdateLeaveDatesRpcResult = {
  success?: boolean;
  error?: string;
  code?: string;
  conflicts?: unknown;
};

type EmployeeLeaveSettings = {
  holiday_allowance_days?: number | null;
};

// Returns true if the current session user IS the employee identified by employeeId
async function isOwnEmployeeRecord(employeeId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from('employees')
    .select('employee_id')
    .eq('employee_id', employeeId)
    .eq('auth_user_id', user.id)
    .in('status', ['Active', 'Started Separation'])
    .maybeSingle();
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// Approved leave can never sit on top of a rostered shift (spec F2, decision D1)
//
// Approval is refused while a clashing shift exists. There is no override. The
// clashing shifts come back with the refusal so the manager can be shown exactly
// what is in the way and go and clear or reassign each one.
//
// The check is NOT done here. It is done inside the Postgres functions added by
// 20260819000002, in the same transaction as the leave write and under the same
// advisory lock that write_rota_shifts_with_leave_guard takes (decision D8). An
// application preflight cannot close this: the manager approves, the preflight
// reads an empty rota, somebody drags a shift onto that employee and commits
// while the request is still pending, and then the approval commits. Both guards
// pass and the shift lands on approved leave. Everything below only turns the
// structured refusal those functions return into something a manager can read.
//
// The boundary rule is decision D7 and lives in public.rota_shift_leave_dates,
// shared by both directions, so a shift blocked one way cannot slip through the
// other.
// ---------------------------------------------------------------------------

export type LeaveShiftConflict = {
  shiftId: string;
  shiftDate: string;
  leaveDate: string;
  startTime: string;
  endTime: string;
  department: string | null;
  shiftName: string | null;
  isOvernight: boolean;
};

/** What the guarded leave functions in 20260819000002 return. */
type LeaveGuardResult = {
  status: 'approved' | 'booked' | 'rota_conflict' | 'not_found' | 'not_pending' | 'overlap' | 'invalid_range';
  conflicts?: unknown;
  request_id?: string;
  leave_dates?: string[];
};

/** One row of public.rota_shifts_clashing_with_leave, as returned through PostgREST. */
type LeaveConflictRow = {
  shift_id: string;
  shift_date: string;
  leave_date: string;
  start_time: string;
  end_time: string;
  department: string | null;
  shift_name: string | null;
  is_overnight: boolean | null;
};

function mapLeaveConflicts(rows: unknown): LeaveShiftConflict[] {
  if (!Array.isArray(rows)) return [];
  return (rows as LeaveConflictRow[]).map(row => ({
    shiftId: row.shift_id,
    shiftDate: row.shift_date,
    leaveDate: row.leave_date,
    startTime: row.start_time,
    endTime: row.end_time,
    department: row.department ?? null,
    shiftName: row.shift_name ?? null,
    isOvernight: Boolean(row.is_overnight),
  }));
}

function describeLeaveConflict(conflict: LeaveShiftConflict): string {
  const times = `${formatTime12Hour(conflict.startTime)} to ${formatTime12Hour(conflict.endTime)}`;
  const label = conflict.shiftName || conflict.department || 'shift';
  return `${formatDateDdMmmmYyyy(conflict.shiftDate)}, ${times}, ${label}`;
}

function buildLeaveConflictError(conflicts: LeaveShiftConflict[]): string {
  const listed = conflicts.slice(0, 3).map(describeLeaveConflict).join('; ');
  const remaining = conflicts.length - Math.min(conflicts.length, 3);
  const more = remaining > 0 ? `, and ${remaining} more` : '';
  const subject = conflicts.length === 1 ? 'a rostered shift' : `${conflicts.length} rostered shifts`;
  const object = conflicts.length === 1 ? 'it' : 'them';
  return `This holiday clashes with ${subject}: ${listed}${more}. Reassign or remove ${object} on the rota, then approve the holiday.`;
}

export async function submitLeaveRequest(input: z.infer<typeof SubmitLeaveSchema>): Promise<
  { success: true; data: LeaveRequest } | { success: false; error: string }
> {
  const parsed = SubmitLeaveSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const { startDate, endDate, employeeId, note } = parsed.data;

  const canRequest = await checkUserPermission('leave', 'request');
  const canCreate = await checkUserPermission('leave', 'create');
  const selfService = !canRequest && !canCreate ? await isOwnEmployeeRecord(employeeId) : false;
  if (!canRequest && !canCreate && !selfService) return { success: false, error: 'Permission denied' };

  if (new Date(endDate) < new Date(startDate)) {
    return { success: false, error: 'End date must be on or after start date' };
  }

  const todayLocal = getTodayIsoDate();
  if (startDate < todayLocal) {
    return { success: false, error: 'Leave requests cannot be submitted for past dates' };
  }

  const supabase = await createClient();

  // Check for overlapping non-declined requests and fetch rota settings in parallel
  const [overlappingRes, rotaSettings] = await Promise.all([
    supabase
      .from('leave_requests')
      .select('id')
      .eq('employee_id', employeeId)
      .neq('status', 'declined')
      .lte('start_date', endDate)
      .gte('end_date', startDate),
    getRotaSettings(),
  ]);

  const { data: overlapping } = overlappingRes;
  if (overlapping && overlapping.length > 0) {
    return { success: false, error: 'You already have a leave request covering some of these dates' };
  }

  const { holidayYearStartMonth, holidayYearStartDay } = rotaSettings;
  const holidayYear = getHolidayYear(startDate, holidayYearStartMonth, holidayYearStartDay);
  const { data: { user } } = await supabase.auth.getUser();

  // Insert request
  const { data: request, error: reqError } = await supabase
    .from('leave_requests')
    .insert({
      employee_id: employeeId,
      start_date: startDate,
      end_date: endDate,
      note: note ?? null,
      holiday_year: holidayYear,
      created_by: user?.id ?? null,
    })
    .select('*')
    .single();

  if (reqError) return { success: false, error: reqError.message };

  // Expand leave days immediately (used for rota overlay even while pending)
  const dayRows = eachIsoDateInRange(startDate, endDate).map(leaveDate => ({
    request_id: request.id,
    employee_id: employeeId,
    leave_date: leaveDate,
  }));

  // Use ON CONFLICT DO NOTHING — employee may already have a day from another request
  const { error: leaveDaysError } = await supabase.from('leave_days').upsert(dayRows, { onConflict: 'employee_id,leave_date', ignoreDuplicates: true });
  if (leaveDaysError) return { success: false, error: leaveDaysError.message };

  // Send confirmation email to employee
  const { data: employee } = await supabase
    .from('employees')
    .select('email_address, first_name, preferred_name')
    .eq('employee_id', employeeId)
    .single();

  if (employee?.email_address) {
    const emailSubject = `Holiday Request Received — ${startDate} to ${endDate}`;
    const emailResult = await sendEmail({
      to: employee.email_address,
      subject: emailSubject,
      html: buildHolidaySubmittedEmailHtml(
        displayName(employee, 'there'),
        startDate,
        endDate,
      ),
    });

    await supabase.from('rota_email_log').insert({
      email_type: 'holiday_submitted',
      entity_type: 'leave_request',
      entity_id: request.id,
      to_addresses: [employee.email_address],
      subject: emailSubject,
      status: emailResult.success ? 'sent' : 'failed',
      error_message: emailResult.success ? null : emailResult.error ?? null,
      sent_by: user?.id ?? null,
    });
  }

  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'create',
    resource_type: 'leave_request',
    resource_id: request.id,
    operation_status: 'success',
    new_values: { employee_id: employeeId, start_date: startDate, end_date: endDate },
  });

  await recordHolidayReliabilityEvents({
    leave: request as LeaveRequest,
    source: 'holiday_request',
    userId: user?.id,
    userEmail: user?.email ?? null,
    includeRequested: true,
  });

  revalidatePath('/rota/leave');
  revalidatePath('/portal/leave');
  revalidatePath(`/employees/${employeeId}`);
  return { success: true, data: request as LeaveRequest };
}

// ---------------------------------------------------------------------------
// Approve or decline a leave request (manager)
// ---------------------------------------------------------------------------

export async function reviewLeaveRequest(
  requestId: string,
  decision: 'approved' | 'declined',
  managerNote?: string,
): Promise<{ success: true } | { success: false; error: string; conflicts?: LeaveShiftConflict[] }> {
  const canApprove = await checkUserPermission('leave', 'approve');
  if (!canApprove) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: request, error: fetchError } = await supabase
    .from('leave_requests')
    .select('id, status, start_date, end_date, employee_id, note, created_at, employees(email_address, first_name, preferred_name)')
    .eq('id', requestId)
    .single();

  if (fetchError || !request) return { success: false, error: 'Request not found' };
  if (request.status !== 'pending') return { success: false, error: 'Request is not pending' };

  const reviewedAt = new Date().toISOString();

  if (decision === 'approved') {
    // Approving turns this into real leave, so the rota has to be clear (D1). The
    // check and the status change happen together inside the database, under the
    // employee leave lock, so a shift assignment landing at the same moment either
    // is seen by the check or waits for this approval to finish (D8).
    const admin = createAdminClient();
    const { data: guardData, error: guardError } = await admin.rpc('approve_leave_request_with_rota_guard', {
      p_request_id: requestId,
      p_reviewed_by: user?.id ?? null,
      p_manager_note: managerNote ?? null,
      p_reviewed_at: reviewedAt,
    });

    if (guardError) return { success: false, error: guardError.message };

    const guard = guardData as LeaveGuardResult | null;
    if (!guard) return { success: false, error: 'Could not approve this holiday' };
    if (guard.status === 'not_found') return { success: false, error: 'Request not found' };
    if (guard.status === 'not_pending') return { success: false, error: 'Request was already reviewed' };
    if (guard.status === 'rota_conflict') {
      const conflicts = mapLeaveConflicts(guard.conflicts);
      return { success: false, error: buildLeaveConflictError(conflicts), conflicts };
    }
    if (guard.status !== 'approved') {
      return { success: false, error: 'Could not approve this holiday' };
    }
  } else {
    const { data: reviewedRow, error } = await supabase
      .from('leave_requests')
      .update({
        status: decision,
        manager_note: managerNote ?? null,
        reviewed_by: user?.id,
        reviewed_at: reviewedAt,
        updated_at: reviewedAt,
      })
      .eq('id', requestId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (error) return { success: false, error: error.message };
    if (!reviewedRow) return { success: false, error: 'Request was already reviewed' };
  }

  // If declined, remove the pending leave_days
  if (decision === 'declined') {
    const { error: deleteDaysError } = await supabase.from('leave_days').delete().eq('request_id', requestId);
    if (deleteDaysError) return { success: false, error: deleteDaysError.message };
  }

  // Send decision email to employee
  const employee = (request as unknown as { employees: { email_address: string; first_name: string; preferred_name: string | null } | null }).employees;
  if (employee?.email_address) {
    const decisionSubject = `Holiday Request ${decision === 'approved' ? 'Approved' : 'Declined'}`;
    const decisionResult = await sendEmail({
      to: employee.email_address,
      subject: decisionSubject,
      html: buildHolidayDecisionEmailHtml(
        displayName(employee, 'there'),
        request.start_date,
        request.end_date,
        decision,
        managerNote,
      ),
    });

    await supabase.from('rota_email_log').insert({
      email_type: 'holiday_decision',
      entity_type: 'leave_request',
      entity_id: requestId,
      to_addresses: [employee.email_address],
      subject: decisionSubject,
      status: decisionResult.success ? 'sent' : 'failed',
      error_message: decisionResult.success ? null : decisionResult.error ?? null,
      sent_by: user?.id ?? null,
    });
  }

  void logAuditEvent({
    user_id: user?.id,
    operation_type: decision === 'approved' ? 'approve' : 'decline',
    resource_type: 'leave_request',
    resource_id: requestId,
    operation_status: 'success',
    new_values: { status: decision, manager_note: managerNote },
  });

  const reviewedLeave: LeaveRequest = {
    id: request.id,
    employee_id: request.employee_id,
    start_date: request.start_date,
    end_date: request.end_date,
    note: request.note ?? null,
    status: decision,
    manager_note: managerNote ?? null,
    reviewed_by: user?.id ?? null,
    reviewed_at: reviewedAt,
    holiday_year: 0,
    created_at: request.created_at,
    updated_at: reviewedAt,
  };

  if (decision === 'approved') {
    await recordHolidayReliabilityEvents({
      leave: reviewedLeave,
      source: 'holiday_approval',
      userId: user?.id,
      userEmail: user?.email ?? null,
      includeApproved: true,
      includeLate: true,
    });
  } else {
    await recordHolidayAuditOnly({
      leave: reviewedLeave,
      action: 'holiday_declined',
      userId: user?.id,
      userEmail: user?.email ?? null,
      additionalInfo: { manager_note: managerNote ?? null },
    });
  }

  revalidatePath('/rota');
  revalidatePath('/rota/leave');
  revalidatePath('/portal/leave');
  revalidatePath(`/employees/${request.employee_id}`);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Book approved holiday directly (manager flow — skips pending review)
// ---------------------------------------------------------------------------

export async function bookApprovedHoliday(input: {
  employeeId: string;
  startDate: string;
  endDate: string;
  note?: string | null;
}): Promise<
  { success: true; leaveDays: { employee_id: string; leave_date: string; request_id: string; status: 'approved' }[] } |
  { success: false; error: string; conflicts?: LeaveShiftConflict[] }
> {
  const parsed = SubmitLeaveSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const canCreate = await checkUserPermission('leave', 'create');
  if (!canCreate) return { success: false, error: 'Permission denied' };

  const { startDate, endDate, employeeId, note } = parsed.data;

  if (new Date(endDate) < new Date(startDate)) {
    return { success: false, error: 'End date must be on or after start date' };
  }

  const supabase = await createClient();

  const { holidayYearStartMonth, holidayYearStartDay } = await getRotaSettings();
  const holidayYear = getHolidayYear(startDate, holidayYearStartMonth, holidayYearStartDay);
  const { data: { user } } = await supabase.auth.getUser();
  const bookedAt = new Date().toISOString();

  // This books approved leave outright, so the same block applies as at approval (D1),
  // and for the same reason it happens inside the database under the employee leave
  // lock rather than as a preflight query out here (D8). The overlap check moves in
  // with it so both refusals are decided against the same locked snapshot.
  const admin = createAdminClient();
  const { data: guardData, error: guardError } = await admin.rpc('book_approved_leave_with_rota_guard', {
    p_employee_id: employeeId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_note: note ?? null,
    p_holiday_year: holidayYear,
    p_created_by: user?.id ?? null,
    p_booked_at: bookedAt,
  });

  if (guardError) return { success: false, error: guardError.message };

  const guard = guardData as LeaveGuardResult | null;
  if (!guard) return { success: false, error: 'Could not book this holiday' };
  if (guard.status === 'overlap') {
    return { success: false, error: 'Employee already has leave covering some of these dates' };
  }
  if (guard.status === 'invalid_range') {
    return { success: false, error: 'End date must be on or after start date' };
  }
  if (guard.status === 'rota_conflict') {
    const conflicts = mapLeaveConflicts(guard.conflicts);
    return { success: false, error: buildLeaveConflictError(conflicts), conflicts };
  }
  if (guard.status !== 'booked' || !guard.request_id) {
    return { success: false, error: 'Could not book this holiday' };
  }

  const request: LeaveRequest = {
    id: guard.request_id,
    employee_id: employeeId,
    start_date: startDate,
    end_date: endDate,
    note: note ?? null,
    status: 'approved',
    manager_note: null,
    reviewed_by: user?.id ?? null,
    reviewed_at: bookedAt,
    holiday_year: holidayYear,
    created_at: bookedAt,
    updated_at: bookedAt,
  };

  const dayRows = (guard.leave_dates ?? eachIsoDateInRange(startDate, endDate)).map(leaveDate => ({
    request_id: request.id,
    employee_id: employeeId,
    leave_date: leaveDate,
  }));

  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'create',
    resource_type: 'leave_request',
    resource_id: request.id,
    operation_status: 'success',
    new_values: { employee_id: employeeId, start_date: startDate, end_date: endDate, status: 'approved' },
  });

  await recordHolidayReliabilityEvents({
    leave: request,
    source: 'holiday_direct_booking',
    userId: user?.id,
    userEmail: user?.email ?? null,
    includeRequested: true,
    includeApproved: true,
    includeLate: true,
  });

  revalidatePath('/rota');
  revalidatePath('/rota/leave');
  revalidatePath(`/employees/${employeeId}`);

  return {
    success: true,
    leaveDays: dayRows.map(r => ({ ...r, status: 'approved' as const })),
  };
}

// ---------------------------------------------------------------------------
// Get leave requests for a manager view
// ---------------------------------------------------------------------------

export async function getLeaveRequests(filters?: {
  status?: 'pending' | 'approved' | 'declined';
  employeeId?: string;
  holidayYear?: number;
}): Promise<{ success: true; data: LeaveRequest[] } | { success: false; error: string }> {
  const canView = await checkUserPermission('leave', 'view');
  if (!canView) {
    // Allow portal employees to view their own requests
    const selfService = filters?.employeeId ? await isOwnEmployeeRecord(filters.employeeId) : false;
    if (!selfService) return { success: false, error: 'Permission denied' };
  }

  const supabase = await createClient();
  let query = supabase
    .from('leave_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.employeeId) query = query.eq('employee_id', filters.employeeId);
  if (filters?.holidayYear) query = query.eq('holiday_year', filters.holidayYear);

  const { data, error } = await query;
  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as LeaveRequest[] };
}

// ---------------------------------------------------------------------------
// Get holiday usage count for an employee in a given year
// ---------------------------------------------------------------------------

export async function getHolidayUsage(employeeId: string, holidayYear: number): Promise<
  { success: true; count: number; pendingCount: number; allowance: number; overThreshold: boolean } | { success: false; error: string }
> {
  const canView = await checkUserPermission('leave', 'view');
  if (!canView && !(await isOwnEmployeeRecord(employeeId))) {
    return { success: false, error: 'Permission denied' };
  }

  const supabase = await createClient();

  const [paySettingRes, rotaSettings, allowanceConsuming] = await Promise.all([
    supabase
      .from('employee_pay_settings')
      .select('holiday_allowance_days')
      .eq('employee_id', employeeId)
      .maybeSingle(),
    getRotaSettings(),
    getAllowanceConsumingTypes(supabase),
  ]);

  if (paySettingRes.error) return { success: false, error: paySettingRes.error.message };

  const paySetting = paySettingRes.data as EmployeeLeaveSettings | null;
  const { defaultHolidayDays, holidayYearStartMonth, holidayYearStartDay } = rotaSettings;
  const allowance = paySetting?.holiday_allowance_days ?? defaultHolidayDays;

  // Select the DATED rows inside the holiday year rather than filtering requests on their
  // holiday_year column. A request running 28 December to 3 January is then charged to the
  // year each of its days actually falls in, instead of wholly to the year it started in.
  const { startDate, endDate } = getHolidayYearBounds(
    holidayYear,
    holidayYearStartMonth,
    holidayYearStartDay,
  );

  const { data: dayRows, error: dayRowsError } = await supabase
    .from('leave_days')
    .select('leave_date, leave_requests!inner(status, leave_type)')
    .eq('employee_id', employeeId)
    .gte('leave_date', startDate)
    .lte('leave_date', endDate);

  if (dayRowsError) return { success: false, error: dayRowsError.message };

  type DayRow = {
    leave_date: string;
    leave_requests:
      | { status: string; leave_type: string | null }
      | { status: string; leave_type: string | null }[]
      | null;
  };

  const countByStatus = (status: string) =>
    countAllowanceDays(
      ((dayRows ?? []) as DayRow[])
        .map(row => {
          const request = Array.isArray(row.leave_requests) ? row.leave_requests[0] : row.leave_requests;
          if (!request || request.status !== status) return null;
          return {
            leave_date: String(row.leave_date),
            consumes_allowance: consumesAllowance(request.leave_type, allowanceConsuming),
          };
        })
        .filter((row): row is { leave_date: string; consumes_allowance: boolean } => row !== null),
    );

  const total = countByStatus('approved');
  const pendingTotal = countByStatus('pending');

  return { success: true, count: total, pendingCount: pendingTotal, allowance, overThreshold: allowance > 0 && total >= allowance };
}

// ---------------------------------------------------------------------------
// Get a single leave request by ID (manager view from rota)
// ---------------------------------------------------------------------------

export async function getLeaveRequestById(
  requestId: string,
): Promise<{ success: true; data: LeaveRequest } | { success: false; error: string }> {
  const canView = await checkUserPermission('leave', 'view');
  if (!canView) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('id', requestId)
    .single();

  if (error || !data) return { success: false, error: error?.message ?? 'Not found' };
  return { success: true, data: data as LeaveRequest };
}

// ---------------------------------------------------------------------------
// Delete a leave request and all its leave_days (manager)
// ---------------------------------------------------------------------------

export async function deleteLeaveRequest(
  requestId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const canEdit = await checkUserPermission('leave', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };

  const parsedRequestId = z.string().uuid().safeParse(requestId);
  if (!parsedRequestId.success) return { success: false, error: parsedRequestId.error.message };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: deletedRequest, error } = await supabase
    .from('leave_requests')
    .delete()
    .eq('id', parsedRequestId.data)
    .select('id, employee_id, start_date, end_date, note, status, manager_note, reviewed_by, reviewed_at, holiday_year, created_at, updated_at')
    .single();
  if (error || !deletedRequest) {
    if (error?.code === 'PGRST116') return { success: false, error: 'Request not found' };
    return { success: false, error: error?.message ?? 'Request not found' };
  }

  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'delete',
    resource_type: 'leave_request',
    resource_id: parsedRequestId.data,
    operation_status: 'success',
  });

  await recordHolidayAuditOnly({
    leave: deletedRequest as LeaveRequest,
    action: 'holiday_deleted',
    userId: user?.id,
    userEmail: user?.email ?? null,
  });

  revalidatePath('/rota');
  revalidatePath('/rota/leave');
  revalidatePath('/portal/leave');
  revalidatePath(`/employees/${deletedRequest.employee_id}`);
  return { success: true };
}

export async function cancelOwnLeaveRequest(
  requestId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsedRequestId = z.string().uuid().safeParse(requestId);
  if (!parsedRequestId.success) return { success: false, error: parsedRequestId.error.message };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'You must be signed in to cancel a holiday request' };

  const { data: employee, error: employeeError } = await supabase
    .from('employees')
    .select('employee_id')
    .eq('auth_user_id', user.id)
    .in('status', ['Active', 'Started Separation'])
    .maybeSingle();

  if (employeeError) return { success: false, error: employeeError.message };
  if (!employee?.employee_id) {
    return { success: false, error: 'Your account is not linked to an active employee profile' };
  }

  const { data: deletedRequest, error } = await supabase
    .from('leave_requests')
    .delete()
    .eq('id', parsedRequestId.data)
    .eq('employee_id', employee.employee_id)
    .eq('status', 'pending')
    .select('id, employee_id, start_date, end_date, note, status, manager_note, reviewed_by, reviewed_at, holiday_year, created_at, updated_at')
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!deletedRequest) {
    return { success: false, error: 'Only pending holiday requests can be cancelled' };
  }

  void logAuditEvent({
    user_id: user.id,
    operation_type: 'cancel',
    resource_type: 'leave_request',
    resource_id: parsedRequestId.data,
    operation_status: 'success',
    old_values: deletedRequest,
    additional_info: { source: 'staff_portal' },
  });

  await recordHolidayAuditOnly({
    leave: deletedRequest as LeaveRequest,
    action: 'holiday_cancelled',
    userId: user.id,
    userEmail: user.email ?? null,
  });

  revalidatePath('/rota');
  revalidatePath('/rota/leave');
  revalidatePath('/portal/leave');
  revalidatePath(`/employees/${employee.employee_id}`);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Update leave request date range (manager) — regenerates leave_days
// ---------------------------------------------------------------------------

export async function updateLeaveRequestDates(
  requestId: string,
  startDate: string,
  endDate: string,
): Promise<{ success: true } | { success: false; error: string; conflicts?: LeaveShiftConflict[] }> {
  const canEdit = await checkUserPermission('leave', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };

  const parsed = UpdateLeaveDatesSchema.safeParse({ requestId, startDate, endDate });
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const {
    requestId: parsedRequestId,
    startDate: parsedStartDate,
    endDate: parsedEndDate,
  } = parsed.data;

  if (parsedEndDate < parsedStartDate) {
    return { success: false, error: 'End date must be on or after start date' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: request, error: fetchError } = await supabase
    .from('leave_requests')
    .select('id, employee_id, status, start_date, end_date, note, manager_note, reviewed_by, reviewed_at, holiday_year, created_at, updated_at')
    .eq('id', parsedRequestId)
    .single();
  if (fetchError || !request) return { success: false, error: 'Request not found' };
  if (request.status === 'declined') {
    return { success: false, error: 'Declined holiday requests cannot be edited' };
  }

  const { data: overlapping, error: overlappingError } = await supabase
    .from('leave_requests')
    .select('id')
    .eq('employee_id', request.employee_id)
    .neq('id', parsedRequestId)
    .neq('status', 'declined')
    .lte('start_date', parsedEndDate)
    .gte('end_date', parsedStartDate);
  if (overlappingError) return { success: false, error: overlappingError.message };
  if (overlapping && overlapping.length > 0) {
    return { success: false, error: 'Employee already has leave covering some of these dates' };
  }

  // An edit to an already-approved request extends approved leave over the new dates,
  // so it has to clear the rota exactly as an approval does (D1). The whole resulting
  // date set is checked, not just the dates being added: a date that is kept is still
  // approved leave, and a shift sitting on it is still a clash. update_leave_request_dates
  // does that check itself, under the employee leave lock and in the same transaction
  // as the write (D8), and returns the clashing shifts with a 'rota_conflict' code.

  const { holidayYearStartMonth, holidayYearStartDay } = await getRotaSettings();
  const holidayYear = getHolidayYear(parsedStartDate, holidayYearStartMonth, holidayYearStartDay);
  const admin = createAdminClient();

  const { data: rpcData, error: rpcError } = await admin.rpc('update_leave_request_dates', {
    p_request_id: parsedRequestId,
    p_start_date: parsedStartDate,
    p_end_date: parsedEndDate,
    p_holiday_year: holidayYear,
  });

  if (rpcError) return { success: false, error: rpcError.message };

  const rpcResult = rpcData as UpdateLeaveDatesRpcResult | null;
  if (!rpcResult?.success) {
    if (rpcResult?.code === 'rota_conflict') {
      const conflicts = mapLeaveConflicts(rpcResult.conflicts);
      return { success: false, error: buildLeaveConflictError(conflicts), conflicts };
    }
    return { success: false, error: rpcResult?.error ?? 'Failed to update holiday dates' };
  }

  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'update',
    resource_type: 'leave_request',
    resource_id: parsedRequestId,
    operation_status: 'success',
    new_values: { start_date: parsedStartDate, end_date: parsedEndDate, holiday_year: holidayYear },
  });

  const updatedLeave: LeaveRequest = {
    ...(request as LeaveRequest),
    start_date: parsedStartDate,
    end_date: parsedEndDate,
    holiday_year: holidayYear,
    updated_at: new Date().toISOString(),
  };

  await recordHolidayAuditOnly({
    leave: updatedLeave,
    action: 'holiday_updated',
    userId: user?.id,
    userEmail: user?.email ?? null,
    additionalInfo: {
      previous_start_date: request.start_date,
      previous_end_date: request.end_date,
      new_start_date: parsedStartDate,
      new_end_date: parsedEndDate,
    },
  });

  if (request.status === 'approved') {
    await recordHolidayReliabilityEvents({
      leave: updatedLeave,
      source: 'holiday_edit',
      userId: user?.id,
      userEmail: user?.email ?? null,
      includeLate: true,
    });
  }

  revalidatePath('/rota');
  revalidatePath('/rota/leave');
  revalidatePath('/portal/leave');
  revalidatePath(`/employees/${request.employee_id}`);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Dated leave rows for one employee (employee record, Holidays tab)
// ---------------------------------------------------------------------------

export type EmployeeLeaveDay = {
  request_id: string;
  leave_date: string;
  status: 'pending' | 'approved' | 'declined';
  leave_type: string;
  consumes_allowance: boolean;
};

/**
 * Every dated leave row for one employee, annotated with whether it consumes allowance.
 *
 * The Holidays tab used to total a request's header dates, which charged a request spanning
 * new year wholly to the year it began in, and excluded weekends. Totalling these dated rows
 * instead makes the tab agree with the employees roster, because both now feed the same
 * countAllowanceDays function.
 */
export async function getEmployeeLeaveDays(employeeId: string): Promise<
  { success: true; data: EmployeeLeaveDay[] } | { success: false; error: string }
> {
  const canView = await checkUserPermission('leave', 'view');
  if (!canView && !(await isOwnEmployeeRecord(employeeId))) {
    return { success: false, error: 'Permission denied' };
  }

  const supabase = await createClient();
  const allowanceConsuming = await getAllowanceConsumingTypes(supabase);

  const { data, error } = await supabase
    .from('leave_days')
    .select('request_id, leave_date, leave_requests!inner(status, leave_type)')
    .eq('employee_id', employeeId)
    .order('leave_date', { ascending: true });

  if (error) return { success: false, error: error.message };

  type Row = {
    request_id: string;
    leave_date: string;
    leave_requests:
      | { status: string; leave_type: string | null }
      | { status: string; leave_type: string | null }[]
      | null;
  };

  const rows = ((data ?? []) as Row[])
    .map(row => {
      const request = Array.isArray(row.leave_requests) ? row.leave_requests[0] : row.leave_requests;
      if (!request) return null;
      const leaveType = request.leave_type ?? DEFAULT_LEAVE_TYPE;
      return {
        request_id: row.request_id,
        leave_date: String(row.leave_date),
        status: request.status as EmployeeLeaveDay['status'],
        leave_type: leaveType,
        consumes_allowance: consumesAllowance(leaveType, allowanceConsuming),
      };
    })
    .filter((row): row is EmployeeLeaveDay => row !== null);

  return { success: true, data: rows };
}
