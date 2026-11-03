import 'server-only';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { settleWrite } from '@/lib/supabase/settle-write';
import { logAuditEvent } from '@/app/actions/audit';
import { getRotaSettings } from '@/app/actions/rota-settings';
import { formatDate, getTodayIsoDate, shiftIsoDate } from '@/lib/dateUtils';
import { consumesAllowance, getAllowanceConsumingTypes } from '@/lib/leave/leave-types';
import {
  countAllowanceDays,
  formatHolidayDays,
  getHolidayEntitlement,
  getHolidayYear,
  getHolidayYearBounds,
  getUntakenHoliday,
} from '@/lib/leave/working-days';

type AdminClient = ReturnType<typeof createAdminClient>;

type ActorUser = {
  user_id?: string | null;
  user_email?: string | null;
};

type FinalizeEmployeeSeparationOptions = {
  adminClient?: AdminClient;
  actorUser?: ActorUser | null;
  todayIso?: string;
  source?: 'manual' | 'automatic';
  blockShiftsOnOrAfterToday?: boolean;
};

export type FinalizeEmployeeSeparationResult =
  | {
      success: true;
      employmentEndDate: string;
      authUserDeleted: boolean;
      /** Set when the person is Former but something after the status change needs a person. */
      warning?: string;
    }
  | { success: false; error: string; code?: string };

/**
 * Up to three dates as "5 November 2026, 6 November 2026", for a message that names them. The
 * employee page's own format (its Leaving banner), so a refusal and the page beside it agree.
 */
function listDates(dates: string[]): string {
  return [...new Set(dates)].map((date) => formatDate(date)).join(', ');
}

/** A leave request that ran past the last working day, and what was done to it. */
type LeaveAfterLastDay = {
  requestId: string;
  status: 'pending' | 'approved';
  startDate: string;
  endDate: string;
  /** The first day taken off: the request's start, or the day after the last working day. */
  removedFrom: string;
  /** True when the whole request was after the last working day and was deleted. */
  deleted: boolean;
};

type LeaveRequestPastLastDay = {
  id: string;
  status: 'pending' | 'approved';
  start_date: string;
  end_date: string;
};

/**
 * Leave cannot be taken after the last working day: they no longer work here. Marking a leaver as
 * Former used to be refused while any leave sat after today, so holiday booked before they handed
 * in their notice stalled the nightly job for good (3 November 2026: a last working day of 28
 * October, approved holiday from 1 to 8 November booked in August). Leave between the last working
 * day and today was not even looked at, and still counted against their allowance.
 *
 * Done when they become Former and not when the separation starts, so a separation that is
 * cancelled keeps its holiday. A request that runs past the last working day is cut to end on it;
 * one that starts after it is deleted, as a manager's Delete does. Then every leave day after the
 * last working day goes, which also clears days left behind by a declined request. Pending
 * requests are treated the same way: nobody can approve leave after someone has left.
 */
async function removeLeaveAfterLastWorkingDay(
  adminClient: AdminClient,
  employeeId: string,
  lastWorkingDay: string,
  actorUser: ActorUser | null | undefined,
): Promise<{ success: true; removed: LeaveAfterLastDay[] } | { success: false; error: string; code: string }> {
  const failure = {
    success: false as const,
    error: 'Could not remove the holiday booked after their last working day, so they have not been marked as Former. Please try again.',
    code: 'leave_removal_failed',
  };
  const dayAfter = shiftIsoDate(lastWorkingDay, 1);
  if (!dayAfter) return failure;

  const { data: requests, error: requestsError } = await adminClient
    .from('leave_requests')
    .select('id, status, start_date, end_date')
    .eq('employee_id', employeeId)
    .in('status', ['pending', 'approved'])
    .gt('end_date', lastWorkingDay)
    .order('start_date', { ascending: true });

  if (requestsError) {
    console.error('[finalizeEmployeeSeparation] Failed to load leave after the last working day:', {
      employeeId,
      code: requestsError.code,
      message: requestsError.message,
    });
    return { success: false, error: 'Failed to check booked leave.', code: 'leave_check_failed' };
  }

  const removed: LeaveAfterLastDay[] = [];
  for (const request of (requests ?? []) as LeaveRequestPastLastDay[]) {
    const deleted = request.start_date > lastWorkingDay;
    if (deleted) {
      // leave_days cascades from leave_requests.
      const requestDeleted = await settleWrite(
        adminClient
          .from('leave_requests')
          .delete()
          .eq('id', request.id)
          .eq('employee_id', employeeId),
        { table: 'leave_requests', what: 'Deleting leave after the last working day', ids: { employeeId, requestId: request.id } },
      );
      if (!requestDeleted) return failure;
    } else {
      // A plain update, not update_leave_request_dates: that re-checks every kept day against the
      // rota, so a clash on a day that stays could refuse this every night. Only days are taken
      // away here. The start date stays, so the holiday year does too; the days go below.
      const requestCut = await settleWrite(
        adminClient
          .from('leave_requests')
          .update({ end_date: lastWorkingDay })
          .eq('id', request.id)
          .eq('employee_id', employeeId),
        { table: 'leave_requests', what: 'Cutting leave back to the last working day', ids: { employeeId, requestId: request.id } },
      );
      if (!requestCut) return failure;
    }

    removed.push({
      requestId: request.id,
      status: request.status,
      startDate: request.start_date,
      endDate: request.end_date,
      removedFrom: deleted ? request.start_date : dayAfter,
      deleted,
    });

    try {
      await logAuditEvent({
        user_id: actorUser?.user_id ?? undefined,
        user_email: actorUser?.user_email ?? undefined,
        operation_type: deleted ? 'delete' : 'update',
        resource_type: 'leave_request',
        resource_id: request.id,
        operation_status: 'success',
        old_values: { start_date: request.start_date, end_date: request.end_date, status: request.status },
        new_values: deleted ? undefined : { start_date: request.start_date, end_date: lastWorkingDay, status: request.status },
        additional_info: { source: 'employee_separation', reason: 'after_last_working_day', employee_id: employeeId },
      });
    } catch (auditError) {
      console.error('[finalizeEmployeeSeparation] Audit log for removed leave failed:', auditError);
    }
  }

  // The days of every request cut back above, and any a declined request left behind (they are
  // cleared after the decline, in a separate write that can fail).
  const strayDaysCleared = await settleWrite(
    adminClient
      .from('leave_days')
      .delete()
      .eq('employee_id', employeeId)
      .gt('leave_date', lastWorkingDay),
    { table: 'leave_days', what: 'Clearing leave days after the last working day', ids: { employeeId } },
  );
  if (!strayDaysCleared) return failure;

  return { success: true, removed };
}

/** A leaver's holiday for one holiday year, worked out to their last working day. */
type UntakenHoliday = {
  holidayYear: number;
  /** What they earned in the year to their last working day (pro-rated). */
  entitlement: number;
  /** Allowance days they took in the year up to their last working day. */
  taken: number;
  /** Earned less taken: negative when they took more than they had earned. */
  untaken: number;
};

/**
 * A leaver's untaken holiday at their last working day, for their final pay: what they earned in
 * the holiday year to that day (getHolidayEntitlement pro-rates it), less the allowance days they
 * took in it. Payroll does not read leave, so without this nobody had a figure to pay.
 *
 * Read after the leave after their last day has been removed. Null when it cannot be worked out:
 * the separation never waits on it, and the note then says to check it by hand.
 */
async function getUntakenHolidayAtLastDay(
  adminClient: AdminClient,
  employeeId: string,
  employmentStartDate: string | null,
  employmentEndDate: string,
): Promise<UntakenHoliday | null> {
  try {
    const [rotaSettings, payResult, allowanceConsuming] = await Promise.all([
      getRotaSettings(),
      adminClient
        .from('employee_pay_settings')
        .select('holiday_allowance_days')
        .eq('employee_id', employeeId)
        .maybeSingle(),
      getAllowanceConsumingTypes(adminClient),
    ]);

    if (payResult.error) {
      console.error('[finalizeEmployeeSeparation] Failed to load the holiday allowance:', {
        employeeId,
        code: payResult.error.code,
        message: payResult.error.message,
      });
      return null;
    }

    const { holidayYearStartMonth: startMonth, holidayYearStartDay: startDay } = rotaSettings;
    const holidayYear = getHolidayYear(employmentEndDate, startMonth, startDay);
    const { startDate: yearStart } = getHolidayYearBounds(holidayYear, startMonth, startDay);

    const { data: dayRows, error: daysError } = await adminClient
      .from('leave_days')
      .select('leave_date, leave_requests!inner(status, leave_type)')
      .eq('employee_id', employeeId)
      .eq('leave_requests.status', 'approved')
      .gte('leave_date', yearStart)
      .lte('leave_date', employmentEndDate);

    if (daysError) {
      console.error('[finalizeEmployeeSeparation] Failed to load the holiday taken:', {
        employeeId,
        code: daysError.code,
        message: daysError.message,
      });
      return null;
    }

    type DayRow = {
      leave_date: string;
      leave_requests: { leave_type: string | null } | { leave_type: string | null }[] | null;
    };
    const taken = countAllowanceDays(
      ((dayRows ?? []) as DayRow[]).map((row) => {
        const request = Array.isArray(row.leave_requests) ? row.leave_requests[0] : row.leave_requests;
        return {
          leave_date: String(row.leave_date),
          consumes_allowance: consumesAllowance(request?.leave_type, allowanceConsuming),
        };
      }),
    );

    const allowanceDays = (payResult.data as { holiday_allowance_days: number | null } | null)?.holiday_allowance_days;
    const { entitlement } = getHolidayEntitlement({
      allowance: allowanceDays ?? rotaSettings.defaultHolidayDays,
      holidayYear,
      startMonth,
      startDay,
      employmentStartDate,
      employmentEndDate,
    });

    return { holidayYear, entitlement, taken, untaken: getUntakenHoliday(entitlement, taken) };
  } catch (error) {
    console.error('[finalizeEmployeeSeparation] Could not work out the untaken holiday:', {
      employeeId,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** The note for their record: what they earned, what they took and what is left for final pay. */
function describeUntakenHoliday(employmentEndDate: string, holiday: UntakenHoliday | null): string {
  const lastDay = formatDate(employmentEndDate);
  if (!holiday) {
    return `Their untaken holiday at their last working day (${lastDay}) could not be worked out. Check their Holidays tab before their final pay.`;
  }
  const year = `${holiday.holidayYear}/${String(holiday.holidayYear + 1).slice(2)}`;
  const earned = `Holiday at their last working day (${lastDay}): earned ${formatHolidayDays(holiday.entitlement)} in the ${year} holiday year and took ${formatHolidayDays(holiday.taken)}`;
  if (holiday.untaken > 0) {
    return `${earned}, leaving ${formatHolidayDays(holiday.untaken)} untaken to include in their final pay.`;
  }
  if (holiday.untaken === 0) return `${earned}, leaving none untaken.`;
  return `${earned}: ${formatHolidayDays(-holiday.untaken)} more than they had earned. Check their final pay.`;
}

/** "1 November 2026 to 8 November 2026 (approved, 8 days)", one entry per request. */
function describeRemovedLeave(entry: LeaveAfterLastDay): string {
  const from = new Date(`${entry.removedFrom}T12:00:00Z`).getTime();
  const to = new Date(`${entry.endDate}T12:00:00Z`).getTime();
  const days = Math.round((to - from) / 86_400_000) + 1;
  const range = entry.removedFrom === entry.endDate
    ? formatDate(entry.endDate)
    : `${formatDate(entry.removedFrom)} to ${formatDate(entry.endDate)}`;
  const status = entry.status === 'approved' ? 'approved' : 'waiting for a decision';
  return `${range} (${status}, ${days} day${days === 1 ? '' : 's'})`;
}

export async function finalizeEmployeeSeparation(
  employeeId: string,
  options: FinalizeEmployeeSeparationOptions = {},
): Promise<FinalizeEmployeeSeparationResult> {
  const adminClient = options.adminClient ?? createAdminClient();
  const source = options.source ?? 'manual';
  // The London date. The UTC date is still yesterday from 00:00 to 00:59 BST, which refused a
  // last working day of today when access was revoked by hand in that hour.
  const today = options.todayIso ?? getTodayIsoDate();
  const now = new Date().toISOString();

  const { data: employee, error: employeeError } = await adminClient
    .from('employees')
    .select('auth_user_id, email_address, status, employment_start_date, employment_end_date')
    .eq('employee_id', employeeId)
    .maybeSingle();

  if (employeeError) {
    return { success: false, error: 'Failed to load employee.', code: 'employee_fetch_failed' };
  }

  if (!employee) {
    return { success: false, error: 'Employee not found.', code: 'employee_not_found' };
  }

  if (employee.status === 'Former') {
    return { success: false, error: 'Employee is already a former employee.', code: 'already_former' };
  }

  if (employee.status === 'Onboarding') {
    return {
      success: false,
      error: 'Cannot revoke access for an employee who has not yet been activated. Use delete instead.',
      code: 'onboarding_employee',
    };
  }

  if (employee.employment_end_date && employee.employment_end_date > today) {
    return {
      success: false,
      // No "update the end date" advice: during a separation the date is locked (EmployeeService
      // updateEmployee), and changing it means cancelling the separation and starting it again.
      error: `Their last working day is ${formatDate(employee.employment_end_date)}. They can be marked as Former from that day.`,
      code: 'last_working_day_in_future',
    };
  }

  const employmentEndDate = employee.employment_end_date ?? today;

  // Up to three, so the refusal can name them: "still has future rota shifts" alone left the
  // nightly job's skip unexplained and gave nobody anything to go and fix. Scheduled shifts only:
  // a shift marked sick is not work anyone has to cover, and begin_employee_separation never
  // releases sick shifts, so one dated after the last working day stalled the nightly job.
  const shiftDateFilter = options.blockShiftsOnOrAfterToday
    ? adminClient
        .from('rota_shifts')
        .select('id, shift_date')
        .eq('employee_id', employeeId)
        .eq('status', 'scheduled')
        .gte('shift_date', today)
        .order('shift_date', { ascending: true })
        .limit(3)
    : adminClient
        .from('rota_shifts')
        .select('id, shift_date')
        .eq('employee_id', employeeId)
        .eq('status', 'scheduled')
        .gt('shift_date', today)
        .order('shift_date', { ascending: true })
        .limit(3);

  const [openSessionResult, blockingShiftResult, lateClockInResult] = await Promise.all([
    adminClient
      .from('timeclock_sessions')
      .select('id')
      .eq('employee_id', employeeId)
      .is('clock_out_at', null)
      .limit(1),
    shiftDateFilter,
    // Clocking in after the last working day means they worked after it: either the date is wrong
    // or their final pay has hours after it. Said, not refused, so the separation still finishes.
    adminClient
      .from('timeclock_sessions')
      .select('work_date')
      .eq('employee_id', employeeId)
      .gt('work_date', employmentEndDate)
      .order('work_date', { ascending: true })
      .limit(3),
  ]);

  if (openSessionResult.error) {
    return { success: false, error: 'Failed to check open timeclock sessions.', code: 'timeclock_check_failed' };
  }

  if (blockingShiftResult.error) {
    return { success: false, error: 'Failed to check future rota shifts.', code: 'shift_check_failed' };
  }

  if ((openSessionResult.data ?? []).length > 0) {
    return {
      success: false,
      error: 'This employee is currently clocked in. Clock them out before marking them as Former.',
      code: 'open_timeclock_session',
    };
  }

  if ((blockingShiftResult.data ?? []).length > 0) {
    const dates = listDates((blockingShiftResult.data as Array<{ shift_date: string }>).map(row => row.shift_date));
    return {
      success: false,
      error: `This employee still has rota shifts on ${dates}. Reassign or cancel those shifts before marking them as Former.`,
      code: 'future_rota_shifts',
    };
  }

  // Removed rather than refused (see removeLeaveAfterLastWorkingDay). If it fails, stop here and
  // leave the employee in their current status so the action can be retried.
  const leaveRemoval = await removeLeaveAfterLastWorkingDay(adminClient, employeeId, employmentEndDate, options.actorUser);
  if (!leaveRemoval.success) {
    return { success: false, error: leaveRemoval.error, code: leaveRemoval.code };
  }

  if (leaveRemoval.removed.length > 0) {
    // Written now, not after the status change, so the record says what happened to their
    // holiday even if a later step stops the separation and it is tried again.
    await settleWrite(
      adminClient
        .from('employee_notes')
        .insert({
          employee_id: employeeId,
          note_text: `Holiday booked after their last working day (${formatDate(employmentEndDate)}) was removed because they have left: ${leaveRemoval.removed.map(describeRemovedLeave).join('; ')}.`,
          created_by_user_id: options.actorUser?.user_id ?? null,
        }),
      { table: 'employee_notes', what: 'Adding the removed leave note', ids: { employeeId } },
    );
  }

  // Clear future template pre-assignments before status changes so old templates
  // cannot put a former employee back on generated rotas. If this fails, stop here and
  // leave the employee in their current status so the action can be retried.
  const templatesCleared = await settleWrite(
    adminClient
      .from('rota_shift_templates')
      .update({ employee_id: null })
      .eq('employee_id', employeeId),
    { table: 'rota_shift_templates', what: 'Clearing template assignments for the leaving employee', ids: { employeeId } },
  );

  if (!templatesCleared) {
    return {
      success: false,
      error: 'Could not remove this employee from the rota templates, so they have not been marked as Former. Please try again.',
      code: 'template_unassign_failed',
    };
  }

  // Removing roles is a hard security prerequisite. If this fails, leave the
  // employee in their current status so the action can be retried.
  if (employee.auth_user_id) {
    const { error: rolesError } = await adminClient
      .from('user_roles')
      .delete()
      .eq('user_id', employee.auth_user_id);

    if (rolesError) {
      console.error('[finalizeEmployeeSeparation] CRITICAL: Failed to delete user roles:', rolesError);
      return {
        success: false,
        error: 'Failed to remove system access. Please try again or contact an administrator.',
        code: 'role_delete_failed',
      };
    }
  }

  // An open invite link would still let a former employee into onboarding. If expiring it
  // fails, stop here and leave the employee in their current status so the action can be retried.
  const invitesExpired = await settleWrite(
    adminClient
      .from('employee_invite_tokens')
      .update({ expires_at: now })
      .eq('employee_id', employeeId)
      .is('completed_at', null),
    { table: 'employee_invite_tokens', what: 'Expiring open invite tokens', ids: { employeeId } },
  );

  if (!invitesExpired) {
    return {
      success: false,
      error: 'Could not cancel this employee\'s open onboarding link, so they have not been marked as Former. Please try again.',
      code: 'invite_expiry_failed',
    };
  }

  const { data: updatedRows, error: updateError } = await adminClient
    .from('employees')
    .update({
      status: 'Former',
      employment_end_date: employmentEndDate,
      separation_shift_policy: null,
      separation_started_at: null,
      updated_at: now,
    })
    .eq('employee_id', employeeId)
    .in('status', ['Active', 'Started Separation'])
    .select('employee_id');

  if (updateError) {
    console.error('[finalizeEmployeeSeparation] Error updating status:', updateError);
    return { success: false, error: 'Failed to update employee status.', code: 'status_update_failed' };
  }

  if (!updatedRows || updatedRows.length === 0) {
    return { success: false, error: 'Employee status could not be updated.', code: 'status_update_empty' };
  }

  const warnings: string[] = [];
  if (lateClockInResult.error) {
    console.error('[finalizeEmployeeSeparation] Failed to check clock-ins after the last working day:', {
      employeeId,
      code: lateClockInResult.error.code,
      message: lateClockInResult.error.message,
    });
  } else if ((lateClockInResult.data ?? []).length > 0) {
    const dates = listDates((lateClockInResult.data as Array<{ work_date: string }>).map(row => row.work_date));
    warnings.push(`They clocked in on ${dates}, after their last working day of ${formatDate(employmentEndDate)}. Check that date and their final pay.`);
  }

  // Their open-shift requests can no longer be approved (approve_rota_open_shift_request refuses
  // anyone not Active or on notice) but stayed pending in the manager's queue for good.
  await settleWrite(
    adminClient
      .from('rota_open_shift_requests')
      .update({
        status: 'declined',
        decided_at: now,
        decided_by: options.actorUser?.user_id ?? null,
        manager_note: 'Declined automatically because they have left.',
        updated_at: now,
      })
      .eq('employee_id', employeeId)
      .eq('status', 'pending'),
    { table: 'rota_open_shift_requests', what: 'Declining the leaver\'s pending open shift requests', ids: { employeeId } },
  );

  // The link to the login is cleared only once the login is gone. Clearing it after a failed
  // delete left a live login that nothing pointed at, so nobody could find it to remove it. Their
  // roles were removed above, so a login left behind has no access while it waits.
  //
  // A soft delete, not a hard one. Anyone who has used the app is named on audit_logs and other
  // records whose foreign keys to auth.users have no ON DELETE action (every current member of
  // staff with a login on 3 November 2026), so a hard delete always failed. A soft delete keeps
  // the row those records point at, scrambles the email so it can be used again, signs them out
  // and stops any further sign-in. Like a hard delete, it cannot be undone.
  let authUserDeleted = false;
  let authLinkCleared = false;
  if (employee.auth_user_id) {
    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(employee.auth_user_id, true);
    if (authDeleteError) {
      console.error('[finalizeEmployeeSeparation] Failed to delete auth user:', authDeleteError);
      warnings.unshift('They are now Former and their permissions are removed, but their login could not be deleted. Ask an administrator to delete it.');
    } else {
      authUserDeleted = true;
      authLinkCleared = await settleWrite(
        adminClient
          .from('employees')
          .update({ auth_user_id: null })
          .eq('employee_id', employeeId),
        { table: 'employees', what: 'Clearing the auth user link', ids: { employeeId } },
      );
    }
  }

  // On their record for their final pay, whoever marked them as Former.
  const untakenHoliday = await getUntakenHolidayAtLastDay(
    adminClient,
    employeeId,
    employee.employment_start_date ?? null,
    employmentEndDate,
  );
  await settleWrite(
    adminClient
      .from('employee_notes')
      .insert({
        employee_id: employeeId,
        note_text: describeUntakenHoliday(employmentEndDate, untakenHoliday),
        created_by_user_id: options.actorUser?.user_id ?? null,
      }),
    { table: 'employee_notes', what: 'Adding the untaken holiday note', ids: { employeeId } },
  );

  if (source === 'automatic') {
    await settleWrite(
      adminClient
        .from('employee_notes')
        .insert({
          employee_id: employeeId,
          // Dates as the employee page shows them, not the stored 2026-11-03.
          note_text: `Automatically marked as Former on ${formatDate(today)} after last working day ${formatDate(employmentEndDate)}.`,
          created_by_user_id: null,
        }),
      { table: 'employee_notes', what: 'Adding the automatic separation note', ids: { employeeId } },
    );
  }

  try {
    await logAuditEvent({
      user_id: options.actorUser?.user_id ?? undefined,
      user_email: options.actorUser?.user_email ?? undefined,
      operation_type: 'access_revoked',
      resource_type: 'employee',
      resource_id: employeeId,
      operation_status: 'success',
      old_values: {
        status: employee.status,
        employment_end_date: employee.employment_end_date,
      },
      new_values: {
        status: 'Former',
        employment_end_date: employmentEndDate,
        auth_user_id_cleared: authLinkCleared,
      },
      additional_info: {
        source,
        untaken_holiday: untakenHoliday
          ? {
              holiday_year: untakenHoliday.holidayYear,
              earned_days: untakenHoliday.entitlement,
              taken_days: untakenHoliday.taken,
              untaken_days: untakenHoliday.untaken,
            }
          : null,
        ...(employee.auth_user_id ? { auth_user_deleted: authUserDeleted } : {}),
        ...(leaveRemoval.removed.length > 0
          ? {
              leave_removed: leaveRemoval.removed.map((entry) => ({
                leave_request_id: entry.requestId,
                status: entry.status,
                removed_from: entry.removedFrom,
                removed_to: entry.endDate,
                request_deleted: entry.deleted,
              })),
            }
          : {}),
      },
    });
  } catch (auditError) {
    console.error('[finalizeEmployeeSeparation] Audit log failed:', auditError);
  }

  revalidatePath('/employees');
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath('/rota');
  revalidatePath('/timeclock');

  const warning = warnings.length > 0 ? warnings.join(' ') : undefined;
  return { success: true, employmentEndDate, authUserDeleted, ...(warning ? { warning } : {}) };
}
