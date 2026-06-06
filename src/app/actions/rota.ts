'use server';

import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkUserPermission } from '@/app/actions/rbac';
import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { logAuditEvent } from '@/app/actions/audit';
import { sendRotaWeekEmails, sendRotaWeekChangeEmails, type DiffShiftRow } from '@/lib/rota/send-rota-emails';
import { getRotaSettings } from '@/app/actions/rota-settings';
import { sendEmail } from '@/lib/email/emailService';
import { fromZonedTime } from 'date-fns-tz';
import {
  buildOpenShiftRequestManagerEmailHtml,
  buildShiftRejectedManagerEmailHtml,
  type PortalShiftEmailSummary,
} from '@/lib/rota/email-templates';
import {
  buildRotaSummary,
  dayOfWeekForIsoDate,
  resolveSalesTargets,
  type RotaCashupActualRow,
  type RotaDaySummaryTotal,
  type RotaRateContext,
  type RotaSummary,
  type RotaSummaryPayrollPeriod,
  type RotaSummaryShift,
} from '@/lib/rota/summary';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RotaWeek = {
  id: string;
  week_start: string;
  status: 'draft' | 'published';
  published_at: string | null;
  published_by: string | null;
  has_unpublished_changes: boolean;
  created_at: string;
  updated_at: string;
};

export type RotaShift = {
  id: string;
  week_id: string;
  employee_id: string | null;
  template_id: string | null;
  shift_date: string;
  start_time: string;
  end_time: string;
  unpaid_break_minutes: number;
  department: string;
  status: 'scheduled' | 'sick' | 'cancelled';
  sick_reason: string | null;
  notes: string | null;
  is_overnight: boolean;
  is_open_shift: boolean;
  name: string | null;
  reassigned_from_id: string | null;
  reassigned_at: string | null;
  reassigned_by: string | null;
  reassignment_reason: string | null;
  acceptance_status: ShiftAcceptanceStatus | null;
  acceptance_decided_at: string | null;
  acceptance_decided_by: string | null;
  acceptance_note: string | null;
  auto_accept_reason: string | null;
  auto_accept_warning_sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ShiftAcceptanceStatus = 'pending' | 'accepted' | 'rejected' | 'auto_accepted';

export type OpenShiftRequest = {
  id: string;
  shift_id: string;
  employee_id: string;
  note: string | null;
  status: 'pending' | 'approved' | 'declined' | 'cancelled';
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
  manager_note: string | null;
  created_at: string;
  updated_at: string;
};

export type OpenShiftRequestSummary = {
  id: string;
  shift_id: string;
  employee_id: string;
  employee_name: string;
  note: string | null;
  status: 'pending' | 'approved' | 'declined' | 'cancelled';
  requested_at: string;
};

export type ShiftAuditTrailEntry = {
  id: string;
  shift_id: string;
  created_at: string;
  user_email: string | null;
  user_id: string | null;
  operation_type: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  additional_info: Record<string, unknown> | null;
};

export type RejectedShiftRecord = {
  id: string;
  shift_id: string;
  employee_id: string;
  week_id: string | null;
  shift_date: string;
  start_time: string;
  end_time: string;
  unpaid_break_minutes: number;
  department: string;
  notes: string | null;
  is_overnight: boolean;
  name: string | null;
  rejection_note: string | null;
  rejected_at: string;
  rejected_by: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun,1=Mon,...
  const diff = day === 0 ? -6 : 1 - day; // adjust so Mon=0
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function toIsoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

const SHIFT_AUTO_ACCEPT_POLICY_NOTE =
  'In line with our policy, all shifts must be accepted or rejected no less than two weeks before the shift.';

const SHIFT_ACCEPTANCE_CUTOFF_DAYS = 14;
const MANAGER_SHIFT_EMAIL = 'manager@the-anchor.pub';

const ACCEPTANCE_RESET_FIELDS = new Set([
  'start_time',
  'end_time',
  'unpaid_break_minutes',
  'status',
  'is_overnight',
  'department',
  'shift_date',
  'employee_id',
]);

function shiftStartInstant(shiftDate: string, startTime: string): Date {
  return fromZonedTime(`${shiftDate}T${startTime}`, 'Europe/London');
}

function isInsideAcceptanceCutoff(shiftDate: string, startTime: string, now: Date = new Date()): boolean {
  const shiftStart = shiftStartInstant(shiftDate, startTime);
  const cutoffMs = SHIFT_ACCEPTANCE_CUTOFF_DAYS * 24 * 60 * 60 * 1000;
  return shiftStart.getTime() - now.getTime() <= cutoffMs;
}

function initialAcceptanceForShift(input: {
  employee_id?: string | null;
  is_open_shift?: boolean | null;
  status?: string | null;
  shift_date: string;
  start_time: string;
}, now: Date = new Date()): {
  acceptance_status: ShiftAcceptanceStatus | null;
  acceptance_decided_at: string | null;
  acceptance_decided_by: string | null;
  acceptance_note: string | null;
  auto_accept_reason: string | null;
  auto_accept_warning_sent_at: string | null;
} {
  if (input.is_open_shift || !input.employee_id || input.status === 'sick' || input.status === 'cancelled') {
    return {
      acceptance_status: null,
      acceptance_decided_at: null,
      acceptance_decided_by: null,
      acceptance_note: null,
      auto_accept_reason: null,
      auto_accept_warning_sent_at: null,
    };
  }

  if (isInsideAcceptanceCutoff(input.shift_date, input.start_time, now)) {
    return {
      acceptance_status: 'auto_accepted',
      acceptance_decided_at: now.toISOString(),
      acceptance_decided_by: input.employee_id,
      acceptance_note: null,
      auto_accept_reason: SHIFT_AUTO_ACCEPT_POLICY_NOTE,
      auto_accept_warning_sent_at: null,
    };
  }

  return {
    acceptance_status: 'pending',
    acceptance_decided_at: null,
    acceptance_decided_by: null,
    acceptance_note: null,
    auto_accept_reason: null,
    auto_accept_warning_sent_at: null,
  };
}

function employeeDisplayName(employee: { first_name?: string | null; last_name?: string | null } | null | undefined): string {
  return [employee?.first_name, employee?.last_name].filter(Boolean).join(' ') || 'Unknown staff member';
}

function shiftEmailSummary(shift: {
  shift_date: string;
  start_time: string;
  end_time: string;
  department: string;
  name?: string | null;
}, employeeName?: string): PortalShiftEmailSummary {
  return {
    employeeName,
    date: shift.shift_date,
    startTime: shift.start_time,
    endTime: shift.end_time,
    department: shift.department,
    templateName: shift.name ?? null,
  };
}

async function getOwnPortalEmployee(supabase: Awaited<ReturnType<typeof createClient>>, employeeId?: string): Promise<{
  employee_id: string;
  first_name: string | null;
  last_name: string | null;
  email_address: string | null;
} | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  let query = supabase
    .from('employees')
    .select('employee_id, first_name, last_name, email_address')
    .eq('auth_user_id', user.id)
    .in('status', ['Active', 'Started Separation']);

  if (employeeId) query = query.eq('employee_id', employeeId);

  const { data } = await query.maybeSingle();
  return data as {
    employee_id: string;
    first_name: string | null;
    last_name: string | null;
    email_address: string | null;
  } | null;
}

async function recordCalendarCancellation(
  admin: ReturnType<typeof createAdminClient>,
  shift: {
    id: string;
    employee_id: string | null;
    week_id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    unpaid_break_minutes?: number | null;
    department: string;
    notes?: string | null;
    is_overnight?: boolean | null;
    name?: string | null;
  },
  reason: string,
): Promise<void> {
  if (!shift.employee_id) return;
  await admin
    .from('rota_shift_calendar_cancellations')
    .upsert({
      shift_id: shift.id,
      employee_id: shift.employee_id,
      week_id: shift.week_id,
      shift_date: shift.shift_date,
      start_time: shift.start_time,
      end_time: shift.end_time,
      unpaid_break_minutes: shift.unpaid_break_minutes ?? 0,
      department: shift.department,
      notes: shift.notes ?? null,
      is_overnight: Boolean(shift.is_overnight),
      name: shift.name ?? null,
      cancelled_at: new Date().toISOString(),
      reason,
    }, { onConflict: 'shift_id,employee_id' });
}

async function recordShiftRejection(
  admin: ReturnType<typeof createAdminClient>,
  shift: {
    id: string;
    employee_id: string | null;
    week_id: string | null;
    shift_date: string;
    start_time: string;
    end_time: string;
    unpaid_break_minutes?: number | null;
    department: string;
    notes?: string | null;
    is_overnight?: boolean | null;
    name?: string | null;
  },
  rejection: {
    employeeId: string;
    rejectedAt: string;
    rejectedBy: string;
    note: string | null;
  },
): Promise<void> {
  await admin
    .from('rota_shift_rejections')
    .insert({
      shift_id: shift.id,
      employee_id: rejection.employeeId,
      week_id: shift.week_id ?? null,
      shift_date: shift.shift_date,
      start_time: shift.start_time,
      end_time: shift.end_time,
      unpaid_break_minutes: shift.unpaid_break_minutes ?? 0,
      department: shift.department,
      notes: shift.notes ?? null,
      is_overnight: Boolean(shift.is_overnight),
      name: shift.name ?? null,
      rejection_note: rejection.note,
      rejected_at: rejection.rejectedAt,
      rejected_by: rejection.rejectedBy,
    });
}

function pickChangedValues(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map(key => [key, source[key] ?? null]));
}

function formatMonthLabel(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function defaultPayrollPeriodForDate(anchorDate: string): RotaSummaryPayrollPeriod {
  const [year, month, day] = anchorDate.split('-').map(Number);
  let periodYear = year;
  let periodMonth = month;

  if (day >= 25) {
    periodMonth += 1;
    if (periodMonth === 13) {
      periodMonth = 1;
      periodYear += 1;
    }
  }

  const end = new Date(Date.UTC(periodYear, periodMonth - 1, 24));
  const start = new Date(Date.UTC(periodYear, periodMonth - 2, 25));

  return {
    year: periodYear,
    month: periodMonth,
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
    label: formatMonthLabel(periodYear, periodMonth),
  };
}

async function getPayrollPeriodForDate(anchorDate: string): Promise<RotaSummaryPayrollPeriod> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('payroll_periods')
    .select('year, month, period_start, period_end')
    .lte('period_start', anchorDate)
    .gte('period_end', anchorDate)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data) {
    return {
      year: data.year as number,
      month: data.month as number,
      start: data.period_start as string,
      end: data.period_end as string,
      label: formatMonthLabel(data.year as number, data.month as number),
    };
  }

  return defaultPayrollPeriodForDate(anchorDate);
}

// ---------------------------------------------------------------------------
// Get or create a rota week row
// ---------------------------------------------------------------------------

export async function getOrCreateRotaWeek(weekStart: string): Promise<
  { success: true; data: RotaWeek } | { success: false; error: string }
> {
  const canView = await checkUserPermission('rota', 'view');
  if (!canView) return { success: false, error: 'Permission denied' };

  // Validate that weekStart is a Monday (UTC day-of-week = 1)
  const dayOfWeek = new Date(weekStart + 'T00:00:00Z').getUTCDay();
  if (dayOfWeek !== 1) return { success: false, error: 'weekStart must be a Monday' };

  const supabase = await createClient();

  // Require edit permission before attempting insert
  const canCreate = await checkUserPermission('rota', 'edit');

  const WEEK_SELECT = 'id, week_start, status, published_at, published_by, has_unpublished_changes, created_at, updated_at';

  // Attempt insert first; if a unique violation occurs (concurrent insert), fall back to select
  const { data: created, error: insertError } = canCreate
    ? await supabase
        .from('rota_weeks')
        .insert({ week_start: weekStart })
        .select(WEEK_SELECT)
        .single()
    : { data: null, error: { code: '', message: 'Permission denied' } as { code: string; message: string } };

  if (!insertError) return { success: true, data: created as RotaWeek };

  // code 23505 = unique_violation — week already exists (concurrent insert)
  if (insertError.code === '23505' || insertError.code === '') {
    const { data: existing, error: selectError } = await supabase
      .from('rota_weeks')
      .select(WEEK_SELECT)
      .eq('week_start', weekStart)
      .single();

    if (selectError || !existing) {
      if (!canCreate) return { success: false, error: 'Permission denied' };
      return { success: false, error: selectError?.message ?? 'Rota week not found' };
    }
    return { success: true, data: existing as RotaWeek };
  }

  return { success: false, error: insertError.message };
}

// ---------------------------------------------------------------------------
// Load a week's shifts with employee data
// ---------------------------------------------------------------------------

export async function getWeekShifts(weekStart: string, userId?: string): Promise<
  { success: true; data: RotaShift[] } | { success: false; error: string }
> {
  const canView = await checkUserPermission('rota', 'view', userId);
  if (!canView) return { success: false, error: 'Permission denied' };

  const supabase = createAdminClient();

  const sundayIso = addDaysIso(weekStart, 6);

  // Explicit column list matching RotaShift type — avoids fetching unnecessary columns
  const rotaShiftColumns = 'id, week_id, employee_id, template_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, sick_reason, notes, is_overnight, is_open_shift, name, reassigned_from_id, reassigned_at, reassigned_by, reassignment_reason, acceptance_status, acceptance_decided_at, acceptance_decided_by, acceptance_note, auto_accept_reason, auto_accept_warning_sent_at, created_at, updated_at' as const;
  const rotaShiftColumnsWithoutSickReason = 'id, week_id, employee_id, template_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name, reassigned_from_id, reassigned_at, reassigned_by, reassignment_reason, acceptance_status, acceptance_decided_at, acceptance_decided_by, acceptance_note, auto_accept_reason, auto_accept_warning_sent_at, created_at, updated_at' as const;
  const rotaShiftColumnsWithoutAcceptance = 'id, week_id, employee_id, template_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, sick_reason, notes, is_overnight, is_open_shift, name, reassigned_from_id, reassigned_at, reassigned_by, reassignment_reason, created_at, updated_at' as const;
  const rotaShiftColumnsWithoutSickReasonOrAcceptance = 'id, week_id, employee_id, template_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name, reassigned_from_id, reassigned_at, reassigned_by, reassignment_reason, created_at, updated_at' as const;

  type RotaShiftQueryResult = {
    data: Array<Partial<RotaShift>> | null;
    error: { code?: string; message: string } | null;
  };

  const loadShifts = async (columns: string): Promise<RotaShiftQueryResult> => {
    const result = await supabase
      .from('rota_shifts')
      .select(columns)
      .gte('shift_date', weekStart)
      .lte('shift_date', sundayIso)
      .order('shift_date')
      .order('start_time');
    return result as unknown as RotaShiftQueryResult;
  };

  let { data, error } = await loadShifts(rotaShiftColumns);

  if (error && isMissingSickReasonColumn(error)) {
    const fallback = await loadShifts(rotaShiftColumnsWithoutSickReason);
    data = fallback.data?.map(shift => ({ ...shift, sick_reason: null })) ?? null;
    error = fallback.error;
  }

  if (error && isMissingAcceptanceColumn(error)) {
    const fallback = await loadShifts(rotaShiftColumnsWithoutAcceptance);
    data = ((fallback.data ?? []) as Partial<RotaShift>[]).map(withEmptyAcceptanceFields);
    error = fallback.error;
  }

  if (error && isMissingSickReasonColumn(error)) {
    const fallback = await loadShifts(rotaShiftColumnsWithoutSickReasonOrAcceptance);
    data = fallback.data?.map(shift => withEmptyAcceptanceFields({ ...shift, sick_reason: null })) ?? null;
    error = fallback.error;
  }

  if (error) return { success: false, error: error.message };

  const liveRows = (data ?? []) as RotaShift[];
  const hasLiveScheduledShifts = liveRows.some(shift => !shift.status || shift.status === 'scheduled');
  if (hasLiveScheduledShifts) return { success: true, data: liveRows };

  const publishedShiftColumns = 'id, week_id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name, acceptance_status, acceptance_decided_at, acceptance_decided_by, acceptance_note, auto_accept_reason, auto_accept_warning_sent_at, published_at' as const;
  const publishedShiftColumnsWithoutAcceptance = 'id, week_id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name, published_at' as const;
  type PublishedShiftQueryResult = {
    data: Array<Partial<RotaShift> & { published_at?: string | null }> | null;
    error: { code?: string; message: string } | null;
  };
  const loadPublishedShifts = async (columns: string): Promise<PublishedShiftQueryResult> => {
    const result = await supabase
      .from('rota_published_shifts')
      .select(columns)
      .gte('shift_date', weekStart)
      .lte('shift_date', sundayIso)
      .order('shift_date')
      .order('start_time');
    return result as unknown as PublishedShiftQueryResult;
  };

  let { data: publishedRows, error: publishedError } = await loadPublishedShifts(publishedShiftColumns);
  if (publishedError && isMissingAcceptanceColumn(publishedError)) {
    const fallback = await loadPublishedShifts(publishedShiftColumnsWithoutAcceptance);
    publishedRows = ((fallback.data ?? []) as Partial<RotaShift>[]).map(withEmptyAcceptanceFields);
    publishedError = fallback.error;
  }

  if (publishedError) return { success: false, error: publishedError.message };

  type PublishedShiftRow = Omit<Partial<RotaShift>, 'created_at' | 'updated_at'> & {
    id: string;
    week_id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    unpaid_break_minutes: number;
    department: string;
    status: RotaShift['status'];
    is_overnight: boolean;
    is_open_shift: boolean;
    published_at: string | null;
  };

  const restoredShifts: RotaShift[] = ((publishedRows ?? []) as unknown as PublishedShiftRow[]).map(row => {
    const timestamp = row.published_at ?? new Date().toISOString();
    return {
      id: row.id,
      week_id: row.week_id,
      employee_id: row.employee_id ?? null,
      template_id: null,
      shift_date: row.shift_date,
      start_time: row.start_time,
      end_time: row.end_time,
      unpaid_break_minutes: row.unpaid_break_minutes ?? 0,
      department: row.department,
      status: row.status ?? 'scheduled',
      sick_reason: null,
      notes: row.notes ?? null,
      is_overnight: Boolean(row.is_overnight),
      is_open_shift: Boolean(row.is_open_shift),
      name: row.name ?? null,
      reassigned_from_id: null,
      reassigned_at: null,
      reassigned_by: null,
      reassignment_reason: null,
      acceptance_status: row.acceptance_status ?? null,
      acceptance_decided_at: row.acceptance_decided_at ?? null,
      acceptance_decided_by: row.acceptance_decided_by ?? null,
      acceptance_note: row.acceptance_note ?? null,
      auto_accept_reason: row.auto_accept_reason ?? null,
      auto_accept_warning_sent_at: row.auto_accept_warning_sent_at ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    };
  });

  if (restoredShifts.length === 0) return { success: true, data: liveRows };

  const canEdit = await checkUserPermission('rota', 'edit', userId);
  if (canEdit && restoredShifts.length > 0) {
    const admin = createAdminClient();
    await admin
      .from('rota_shifts')
      .upsert(restoredShifts.map(shift => ({
        id: shift.id,
        week_id: shift.week_id,
        employee_id: shift.employee_id,
        template_id: shift.template_id,
        shift_date: shift.shift_date,
        start_time: shift.start_time,
        end_time: shift.end_time,
        unpaid_break_minutes: shift.unpaid_break_minutes,
        department: shift.department,
        status: shift.status,
        sick_reason: shift.sick_reason,
        notes: shift.notes,
        is_overnight: shift.is_overnight,
        is_open_shift: shift.is_open_shift,
        name: shift.name,
        reassigned_from_id: shift.reassigned_from_id,
        reassigned_at: shift.reassigned_at,
        reassigned_by: shift.reassigned_by,
        reassignment_reason: shift.reassignment_reason,
        acceptance_status: shift.acceptance_status,
        acceptance_decided_at: shift.acceptance_decided_at,
        acceptance_decided_by: shift.acceptance_decided_by,
        acceptance_note: shift.acceptance_note,
        auto_accept_reason: shift.auto_accept_reason,
        auto_accept_warning_sent_at: shift.auto_accept_warning_sent_at,
        created_at: shift.created_at,
        updated_at: shift.updated_at,
      })), { onConflict: 'id' });
  }

  const restoredIds = new Set(restoredShifts.map(shift => shift.id));
  const liveRowsNotInSnapshot = liveRows.filter(shift => !restoredIds.has(shift.id));
  return { success: true, data: [...liveRowsNotInSnapshot, ...restoredShifts] };
}

function isMissingSickReasonColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = error.message?.toLowerCase() ?? '';
  return (error.code === '42703' && message.includes('sick_reason')) || (
    message.includes('sick_reason') &&
    (message.includes('does not exist') || message.includes('could not find'))
  );
}

function isMissingAcceptanceColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = error.message?.toLowerCase() ?? '';
  const missingColumn = message.includes('does not exist') || message.includes('could not find');
  return (error.code === '42703' && message.includes('acceptance_')) || (
    missingColumn &&
    (
      message.includes('acceptance_status') ||
      message.includes('acceptance_decided_at') ||
      message.includes('acceptance_decided_by') ||
      message.includes('acceptance_note') ||
      message.includes('auto_accept_reason') ||
      message.includes('auto_accept_warning_sent_at')
    )
  );
}

function withEmptyAcceptanceFields<T extends Partial<RotaShift>>(shift: T): T & Pick<
  RotaShift,
  'acceptance_status' |
  'acceptance_decided_at' |
  'acceptance_decided_by' |
  'acceptance_note' |
  'auto_accept_reason' |
  'auto_accept_warning_sent_at'
> {
  return {
    ...shift,
    acceptance_status: null,
    acceptance_decided_at: null,
    acceptance_decided_by: null,
    acceptance_note: null,
    auto_accept_reason: null,
    auto_accept_warning_sent_at: null,
  };
}

// ---------------------------------------------------------------------------
// Rota labour cost + sales target summary
// ---------------------------------------------------------------------------

function hiddenSalesTargets(days: string[]) {
  return Object.fromEntries(days.map(day => [day, {
    salesTarget: null,
    salesTargetSource: 'hidden' as const,
    salesTargetReason: null,
  }])) as Record<string, Pick<RotaDaySummaryTotal, 'salesTarget' | 'salesTargetSource' | 'salesTargetReason'>>;
}

function isMissingOptionalTargetOverridesRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = error.message?.toLowerCase() ?? '';
  return error.code === '42P01' || error.code === 'PGRST205' || message.includes('cashup_target_overrides');
}

export async function getRotaSummaryForWeek(
  weekStart: string,
  days: string[],
  employees: RotaEmployee[],
): Promise<{ success: true; data: RotaSummary; canViewSpend: boolean; canViewSalesTargets: boolean; canEditSalesTargets: boolean } | { success: false; error: string }> {
  const canView = await checkUserPermission('rota', 'view');
  if (!canView) return { success: false, error: 'Permission denied' };

  if (!days.length) return { success: false, error: 'No visible rota days provided' };

  const [canViewSpend, canViewSalesTargets, canEditSalesTargets, settings, payrollPeriod] = await Promise.all([
    checkUserPermission('payroll', 'view'),
    checkUserPermission('cashing_up', 'view'),
    checkUserPermission('cashing_up', 'edit'),
    getRotaSettings(),
    getPayrollPeriodForDate(weekStart),
  ]);

  const supabase = await createClient();
  const summaryStart = [payrollPeriod.start, days[0]].sort()[0];
  const summaryEnd = [payrollPeriod.end, days[days.length - 1]].sort().at(-1)!;

  const { data: summaryShifts, error: shiftsError } = await supabase
    .from('rota_shifts')
    .select('employee_id, shift_date, start_time, end_time, unpaid_break_minutes, is_overnight, is_open_shift, status')
    .gte('shift_date', summaryStart)
    .lte('shift_date', summaryEnd);

  if (shiftsError) return { success: false, error: shiftsError.message };

  let site: { id: string; name: string | null } | null = null;
  let salesTargets: Record<string, Pick<RotaDaySummaryTotal, 'salesTarget' | 'salesTargetSource' | 'salesTargetReason'>> = hiddenSalesTargets(days);

  if (canViewSalesTargets) {
    const { data: siteRow } = await supabase
      .from('sites')
      .select('id, name')
      .limit(1)
      .maybeSingle();

    if (siteRow?.id) {
      site = { id: siteRow.id, name: siteRow.name ?? null };
      const dayOfWeeks = [...new Set(days.map(dayOfWeekForIsoDate))];
      const [defaultTargetResult, overrideResult, actualResult] = await Promise.all([
        supabase
          .from('cashup_targets')
          .select('day_of_week, target_amount, effective_from')
          .eq('site_id', siteRow.id)
          .in('day_of_week', dayOfWeeks)
          .lte('effective_from', days[days.length - 1])
          .order('effective_from', { ascending: false }),
        supabase
          .from('cashup_target_overrides')
          .select('target_date, target_amount, reason')
          .eq('site_id', siteRow.id)
          .gte('target_date', days[0])
          .lte('target_date', days[days.length - 1]),
        supabase
          .from('cashup_sessions')
          .select('session_date, total_counted_amount, status')
          .eq('site_id', siteRow.id)
          .gte('session_date', days[0])
          .lte('session_date', days[days.length - 1]),
      ]);

      if (defaultTargetResult.error) return { success: false, error: defaultTargetResult.error.message };
      if (overrideResult.error && !isMissingOptionalTargetOverridesRelation(overrideResult.error)) {
        return { success: false, error: overrideResult.error.message };
      }
      if (actualResult.error) return { success: false, error: actualResult.error.message };

      salesTargets = resolveSalesTargets(
        days,
        (defaultTargetResult.data ?? []).map(row => ({
          day_of_week: row.day_of_week,
          target_amount: row.target_amount,
          effective_from: row.effective_from,
        })),
        (overrideResult.error ? [] : (overrideResult.data ?? [])).map(row => ({
          target_date: row.target_date,
          target_amount: row.target_amount,
          reason: row.reason ?? null,
        })),
        (actualResult.data ?? []) as RotaCashupActualRow[],
      );
    }
  }

  let rateContext: RotaRateContext | null = null;

  if (canViewSpend) {
    const admin = createAdminClient();
    const employeeIds = [
      ...new Set(
        ((summaryShifts ?? []) as RotaSummaryShift[])
          .map(shift => shift.employee_id)
          .filter((employeeId): employeeId is string => Boolean(employeeId)),
      ),
    ];

    const [
      paySettingsResult,
      rateOverridesResult,
      ageBandsResult,
      bandRatesResult,
      employeesResult,
    ] = await Promise.all([
      employeeIds.length
        ? admin.from('employee_pay_settings').select('employee_id, pay_type').in('employee_id', employeeIds)
        : Promise.resolve({ data: [], error: null }),
      employeeIds.length
        ? admin
            .from('employee_rate_overrides')
            .select('employee_id, hourly_rate, effective_from')
            .in('employee_id', employeeIds)
            .order('employee_id')
            .order('effective_from', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      admin.from('pay_age_bands').select('id, min_age, max_age').eq('is_active', true),
      admin
        .from('pay_band_rates')
        .select('band_id, hourly_rate, effective_from')
        .order('band_id')
        .order('effective_from', { ascending: false }),
      employeeIds.length
        ? admin.from('employees').select('employee_id, date_of_birth').in('employee_id', employeeIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const failedRateLoad = [paySettingsResult, rateOverridesResult, ageBandsResult, bandRatesResult, employeesResult]
      .find(result => result.error);
    if (failedRateLoad?.error) return { success: false, error: failedRateLoad.error.message };

    const salaryEmployeeIds = new Set(
      (paySettingsResult.data ?? [])
        .filter(row => row.pay_type === 'salaried')
        .map(row => row.employee_id),
    );
    const dobMap = new Map<string, string>();
    for (const row of employeesResult.data ?? []) {
      if (row.date_of_birth) dobMap.set(row.employee_id, row.date_of_birth);
    }

    rateContext = {
      salaryEmployeeIds,
      dobMap,
      rateOverrides: (rateOverridesResult.data ?? []) as RotaRateContext['rateOverrides'],
      ageBands: (ageBandsResult.data ?? []) as RotaRateContext['ageBands'],
      bandRates: (bandRatesResult.data ?? []) as RotaRateContext['bandRates'],
    };
  }

  const summary = buildRotaSummary({
    site,
    payrollPeriod,
    weekDays: days,
    periodShifts: (summaryShifts ?? []) as RotaSummaryShift[],
    employees,
    salesTargets,
    targetPercent: settings.wageTargetPercent,
    rateContext,
  });

  return {
    success: true,
    data: summary,
    canViewSpend,
    canViewSalesTargets,
    canEditSalesTargets,
  };
}

const UpsertRotaSalesTargetOverrideSchema = z.object({
  siteId: z.string().uuid(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  targetAmount: z.number().min(0).max(9999999),
  reason: z.string().max(200).nullable().optional(),
});

export async function upsertRotaSalesTargetOverride(input: z.infer<typeof UpsertRotaSalesTargetOverrideSchema>): Promise<
  { success: true; data: { site_id: string; target_date: string; target_amount: number; reason: string | null } } | { success: false; error: string }
> {
  const canEdit = await checkUserPermission('cashing_up', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };

  const parsed = UpsertRotaSalesTargetOverrideSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.errors[0]?.message ?? 'Invalid target override' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  const { data, error } = await supabase
    .from('cashup_target_overrides')
    .upsert({
      site_id: parsed.data.siteId,
      target_date: parsed.data.targetDate,
      target_amount: parsed.data.targetAmount,
      reason: parsed.data.reason?.trim() || null,
      created_by: user.id,
      updated_by: user.id,
    }, { onConflict: 'site_id,target_date' })
    .select('site_id, target_date, target_amount, reason')
    .single();

  if (error) return { success: false, error: error.message };

  void logAuditEvent({
    user_id: user.id,
    operation_type: 'update',
    resource_type: 'cashup_target_override',
    resource_id: `${parsed.data.siteId}:${parsed.data.targetDate}`,
    operation_status: 'success',
    new_values: {
      target_date: parsed.data.targetDate,
      target_amount: parsed.data.targetAmount,
      reason: parsed.data.reason ?? null,
    },
  });

  revalidatePath('/rota');
  revalidatePath('/cashing-up');
  revalidatePath('/cashing-up/dashboard');
  revalidatePath('/cashing-up/weekly');
  revalidateTag('dashboard');

  return {
    success: true,
    data: {
      site_id: data.site_id,
      target_date: data.target_date,
      target_amount: Number(data.target_amount),
      reason: data.reason ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Create a shift
// ---------------------------------------------------------------------------

const CreateShiftSchema = z.object({
  weekId: z.string().uuid(),
  employeeId: z.string().uuid().nullable().optional(),
  isOpenShift: z.boolean().default(false),
  templateId: z.string().uuid().nullable().optional(),
  name: z.string().nullable().optional(),
  shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).transform(t => t.slice(0, 5)),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).transform(t => t.slice(0, 5)),
  unpaidBreakMinutes: z.number().int().min(0).default(0),
  department: z.string().min(1),
  notes: z.string().nullable().optional(),
  isOvernight: z.boolean().default(false),
}).refine(
  d => d.isOpenShift || !!d.employeeId,
  { message: 'employeeId is required unless isOpenShift is true', path: ['employeeId'] },
);

export async function createShift(input: z.infer<typeof CreateShiftSchema>): Promise<
  { success: true; data: RotaShift } | { success: false; error: string }
> {
  const canCreate = await checkUserPermission('rota', 'create');
  if (!canCreate) return { success: false, error: 'Permission denied' };

  const parsed = CreateShiftSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: week, error: weekError } = await supabase
    .from('rota_weeks')
    .select('week_start')
    .eq('id', parsed.data.weekId)
    .single();

  if (weekError || !week) return { success: false, error: 'Rota week not found' };

  const weekStart = week.week_start as string;
  const weekEnd = addDaysIso(weekStart, 6);
  if (parsed.data.shiftDate < weekStart || parsed.data.shiftDate > weekEnd) {
    return { success: false, error: `Shift date must be within this rota week (${weekStart} to ${weekEnd})` };
  }

  const { data, error } = await supabase
    .from('rota_shifts')
    .insert({
      week_id: parsed.data.weekId,
      employee_id: parsed.data.isOpenShift ? null : (parsed.data.employeeId ?? null),
      is_open_shift: parsed.data.isOpenShift,
      template_id: parsed.data.templateId ?? null,
      name: parsed.data.name ?? null,
      shift_date: parsed.data.shiftDate,
      start_time: parsed.data.startTime,
      end_time: parsed.data.endTime,
      unpaid_break_minutes: parsed.data.unpaidBreakMinutes,
      department: parsed.data.department,
      notes: parsed.data.notes ?? null,
      is_overnight: parsed.data.isOvernight,
      ...initialAcceptanceForShift({
        employee_id: parsed.data.isOpenShift ? null : (parsed.data.employeeId ?? null),
        is_open_shift: parsed.data.isOpenShift,
        status: 'scheduled',
        shift_date: parsed.data.shiftDate,
        start_time: parsed.data.startTime,
      }),
      created_by: user?.id,
    })
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };

  // Mark week as having changes (if published)
  await supabase
    .from('rota_weeks')
    .update({ has_unpublished_changes: true })
    .eq('id', parsed.data.weekId)
    .eq('status', 'published');

  // Fire-and-forget: audit logging failure should not block the operation
  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'create',
    resource_type: 'rota_shift',
    resource_id: data.id,
    operation_status: 'success',
    new_values: { employee_id: parsed.data.employeeId, shift_date: parsed.data.shiftDate, department: parsed.data.department },
  });

  revalidatePath('/rota');
  return { success: true, data: data as RotaShift };
}

// ---------------------------------------------------------------------------
// Update a shift
// ---------------------------------------------------------------------------

export async function updateShift(
  shiftId: string,
  updates: Partial<Pick<RotaShift, 'start_time' | 'end_time' | 'unpaid_break_minutes' | 'notes' | 'status' | 'is_overnight' | 'department'>>,
): Promise<{ success: true; data: RotaShift } | { success: false; error: string }> {
  const canEdit = await checkUserPermission('rota', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: current, error: currentError } = await supabase
    .from('rota_shifts')
    .select('employee_id, is_open_shift, status, shift_date, start_time, end_time, unpaid_break_minutes, department, notes, is_overnight, acceptance_status, acceptance_decided_at, acceptance_decided_by, acceptance_note, auto_accept_reason, auto_accept_warning_sent_at')
    .eq('id', shiftId)
    .single();

  if (currentError || !current) return { success: false, error: 'Shift not found' };

  const currentValues = current as Record<string, unknown>;
  const updatePayload: Record<string, unknown> = { ...updates };
  const resetsAcceptance = Object.keys(updates).some(key => ACCEPTANCE_RESET_FIELDS.has(key));
  if (resetsAcceptance) {
    Object.assign(updatePayload, initialAcceptanceForShift({
      employee_id: current.employee_id as string | null,
      is_open_shift: current.is_open_shift as boolean,
      status: (updates.status ?? current.status) as string,
      shift_date: current.shift_date as string,
      start_time: (updates.start_time ?? current.start_time) as string,
    }));
  }

  const { data, error } = await supabase
    .from('rota_shifts')
    .update(updatePayload)
    .eq('id', shiftId)
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };

  // Mark week as having unpublished changes
  await supabase
    .from('rota_weeks')
    .update({ has_unpublished_changes: true })
    .eq('id', data.week_id)
    .eq('status', 'published');

  // Fire-and-forget: audit logging failure should not block the operation
  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'update',
    resource_type: 'rota_shift',
    resource_id: shiftId,
    operation_status: 'success',
    old_values: pickChangedValues(currentValues, Object.keys(updatePayload)),
    new_values: updatePayload,
  });

  revalidatePath('/rota');
  return { success: true, data: data as RotaShift };
}

// ---------------------------------------------------------------------------
// Delete a shift
// ---------------------------------------------------------------------------

export async function deleteShift(shiftId: string): Promise<
  { success: true } | { success: false; error: string }
> {
  const canDelete = await checkUserPermission('rota', 'delete');
  if (!canDelete) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Fetch to get week_id before deleting
  const { data: shift } = await supabase
    .from('rota_shifts')
    .select('week_id, employee_id, shift_date')
    .eq('id', shiftId)
    .single();

  const { error } = await supabase
    .from('rota_shifts')
    .delete()
    .eq('id', shiftId);

  if (error) return { success: false, error: error.message };

  if (shift?.week_id) {
    await supabase
      .from('rota_weeks')
      .update({ has_unpublished_changes: true })
      .eq('id', shift.week_id)
      .eq('status', 'published');
  }

  // Fire-and-forget: audit logging failure should not block the operation
  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'delete',
    resource_type: 'rota_shift',
    resource_id: shiftId,
    operation_status: 'success',
    old_values: { employee_id: shift?.employee_id, shift_date: shift?.shift_date },
  });

  revalidatePath('/rota');
  return { success: true };
}

// ---------------------------------------------------------------------------
// Mark shift as Couldn't Work
// ---------------------------------------------------------------------------

const MarkShiftSickSchema = z.object({
  shiftId: z.string().min(1),
  reason: z.string().trim().min(1, "Couldn't Work reason is required").max(500, "Couldn't Work reason must be 500 characters or fewer"),
});

const MarkEmployeeCouldntWorkSchema = z.object({
  weekId: z.string().uuid(),
  employeeId: z.string().uuid(),
  shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(1, "Couldn't Work reason is required").max(500, "Couldn't Work reason must be 500 characters or fewer"),
});

export async function markShiftSick(shiftId: string, reason: string): Promise<
  { success: true; data: RotaShift } | { success: false; error: string }
> {
  const canEdit = await checkUserPermission('rota', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };

  const parsed = MarkShiftSickSchema.safeParse({ shiftId, reason });
  if (!parsed.success) return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid Couldn't Work details" };

  const supabase = await createClient();

  let { data: current, error: fetchError } = await supabase
    .from('rota_shifts')
    .select('id, week_id, employee_id, shift_date, start_time, end_time, status, is_open_shift, sick_reason')
    .eq('id', parsed.data.shiftId)
    .single();

  if (fetchError && isMissingSickReasonColumn(fetchError)) {
    const fallback = await supabase
      .from('rota_shifts')
      .select('id, week_id, employee_id, shift_date, start_time, end_time, status, is_open_shift')
      .eq('id', parsed.data.shiftId)
      .single();

    current = fallback.data ? { ...fallback.data, sick_reason: null } : null;
    fetchError = fallback.error;
  }

  if (fetchError || !current) return { success: false, error: 'Shift not found' };
  if (current.is_open_shift || !current.employee_id) {
    return { success: false, error: "Open shifts cannot be marked as Couldn't Work" };
  }
  if (current.status === 'cancelled') {
    return { success: false, error: "Cancelled shifts cannot be marked as Couldn't Work" };
  }

  return markEmployeeCouldntWork({
    weekId: current.week_id,
    employeeId: current.employee_id,
    shiftDate: current.shift_date,
    reason: parsed.data.reason,
  });
}

export async function markEmployeeCouldntWork(input: z.infer<typeof MarkEmployeeCouldntWorkSchema>): Promise<
  { success: true; data: RotaShift } | { success: false; error: string }
> {
  const canEdit = await checkUserPermission('rota', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };

  const parsed = MarkEmployeeCouldntWorkSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid Couldn't Work details" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: week, error: weekError } = await supabase
    .from('rota_weeks')
    .select('week_start')
    .eq('id', parsed.data.weekId)
    .single();

  if (weekError || !week) return { success: false, error: 'Rota week not found' };

  const weekStart = week.week_start as string;
  const weekEnd = addDaysIso(weekStart, 6);
  if (parsed.data.shiftDate < weekStart || parsed.data.shiftDate > weekEnd) {
    return { success: false, error: `Couldn't Work date must be within this rota week (${weekStart} to ${weekEnd})` };
  }

  const { data: existingSickShifts, error: existingSickError } = await supabase
    .from('rota_shifts')
    .select('id, sick_reason')
    .eq('week_id', parsed.data.weekId)
    .eq('employee_id', parsed.data.employeeId)
    .eq('shift_date', parsed.data.shiftDate)
    .eq('status', 'sick')
    .order('created_at');

  if (existingSickError) return { success: false, error: existingSickError.message };

  const existingSickShift = existingSickShifts?.[0] as { id: string; sick_reason: string | null } | undefined;
  let marker: RotaShift;
  let previousReason: string | null = null;
  let markerCreated = false;

  if (existingSickShift) {
    const { data: updated, error: updateError } = await supabase
      .from('rota_shifts')
      .update({ sick_reason: parsed.data.reason })
      .eq('id', existingSickShift.id)
      .select('*')
      .single();

    if (updateError) {
      if (isMissingSickReasonColumn(updateError)) {
        return { success: false, error: "Couldn't Work reasons require the latest rota database migration before records can be saved" };
      }
      return { success: false, error: updateError.message };
    }

    marker = updated as RotaShift;
    previousReason = existingSickShift.sick_reason ?? null;
  } else {
    const { data, error } = await supabase
      .from('rota_shifts')
      .insert({
        week_id: parsed.data.weekId,
        employee_id: parsed.data.employeeId,
        is_open_shift: false,
        template_id: null,
        name: "Couldn't Work",
        shift_date: parsed.data.shiftDate,
        start_time: '00:00',
        end_time: '00:00',
        unpaid_break_minutes: 0,
        department: 'bar',
        status: 'sick',
        sick_reason: parsed.data.reason,
        notes: null,
        is_overnight: false,
        created_by: user?.id,
      })
      .select('*')
      .single();

    if (error) {
      if (isMissingSickReasonColumn(error)) {
        return { success: false, error: "Couldn't Work reasons require the latest rota database migration before records can be saved" };
      }
      return { success: false, error: error.message };
    }

    marker = data as RotaShift;
    markerCreated = true;
  }

  const { data: shiftsToOpen, error: shiftsToOpenError } = await supabase
    .from('rota_shifts')
    .select('id, week_id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, department, notes, is_overnight, name')
    .eq('week_id', parsed.data.weekId)
    .eq('employee_id', parsed.data.employeeId)
    .eq('shift_date', parsed.data.shiftDate)
    .eq('status', 'scheduled')
    .eq('is_open_shift', false);

  if (shiftsToOpenError) return { success: false, error: shiftsToOpenError.message };

  const shiftIdsToOpen = [...new Set((shiftsToOpen ?? []).map(shift => shift.id as string))];
  if (shiftIdsToOpen.length > 0) {
    const reassignedAt = new Date().toISOString();
    const reassignmentReason = `Couldn't Work: ${parsed.data.reason}`;
    const admin = createAdminClient();

    await Promise.all((shiftsToOpen ?? []).map(shift =>
      recordCalendarCancellation(admin, shift as Parameters<typeof recordCalendarCancellation>[1], "Couldn't Work"),
    ));

    const { error: moveError } = await supabase
      .from('rota_shifts')
      .update({
        employee_id: null,
        is_open_shift: true,
        acceptance_status: null,
        acceptance_decided_at: null,
        acceptance_decided_by: null,
        acceptance_note: null,
        auto_accept_reason: null,
        auto_accept_warning_sent_at: null,
        reassigned_from_id: parsed.data.employeeId,
        reassigned_at: reassignedAt,
        reassigned_by: user?.id,
        reassignment_reason: reassignmentReason,
      })
      .in('id', shiftIdsToOpen);

    if (moveError) return { success: false, error: moveError.message };

    const { error: publishedSnapshotError } = await admin
      .from('rota_published_shifts')
      .update({
        employee_id: null,
        is_open_shift: true,
        acceptance_status: null,
        acceptance_decided_at: null,
        acceptance_decided_by: null,
        acceptance_note: null,
        auto_accept_reason: null,
        auto_accept_warning_sent_at: null,
        published_at: reassignedAt,
      })
      .in('id', shiftIdsToOpen);

    if (publishedSnapshotError) {
      return { success: false, error: `Couldn't Work was recorded and shifts were moved to open shifts, but the employee portal could not be updated: ${publishedSnapshotError.message}` };
    }

    void Promise.all((shiftsToOpen ?? []).map(shift => logAuditEvent({
      user_id: user?.id,
      operation_type: 'open_shift',
      resource_type: 'rota_shift',
      resource_id: shift.id as string,
      operation_status: 'success',
      old_values: {
        employee_id: parsed.data.employeeId,
        is_open_shift: false,
        status: 'scheduled',
      },
      new_values: {
        employee_id: null,
        is_open_shift: true,
        acceptance_status: null,
      },
      additional_info: {
        reason: reassignmentReason,
        sick_marker_shift_id: marker.id,
      },
    })));
  }

  const auditInfo = {
    action: 'mark_shift_sick',
    shift_id: marker.id,
    shift_date: parsed.data.shiftDate,
    start_time: '00:00',
    end_time: '00:00',
    sick_reason: parsed.data.reason,
    created_from_empty_cell: markerCreated,
    moved_shift_ids_to_open: shiftIdsToOpen,
  };

  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'mark_sick',
    resource_type: 'rota_shift',
    resource_id: marker.id,
    operation_status: 'success',
    old_values: markerCreated ? {} : { status: 'sick', sick_reason: previousReason },
    new_values: { status: 'sick', sick_reason: parsed.data.reason, employee_id: parsed.data.employeeId },
    additional_info: auditInfo,
  });

  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'update',
    resource_type: 'employee',
    resource_id: parsed.data.employeeId,
    operation_status: 'success',
    old_values: { rota_shift_status: markerCreated ? null : 'sick', sick_reason: previousReason },
    new_values: { rota_shift_status: 'sick', sick_reason: parsed.data.reason },
    additional_info: {
      ...auditInfo,
      fields_changed: ['rota_shift_status', 'sick_reason', 'open_shift_coverage'],
    },
  });

  revalidatePath('/rota');
  revalidatePath('/rota/hours');
  revalidatePath('/portal/shifts');
  revalidatePath(`/employees/${parsed.data.employeeId}`);
  return { success: true, data: marker };
}

// ---------------------------------------------------------------------------
// Reassign a shift to a different employee
// ---------------------------------------------------------------------------

export async function reassignShift(
  shiftId: string,
  newEmployeeId: string,
  reason?: string,
): Promise<{ success: true; data: RotaShift } | { success: false; error: string }> {
  const canEdit = await checkUserPermission('rota', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Fetch current shift to capture original employee
  const { data: current, error: fetchError } = await supabase
    .from('rota_shifts')
    .select('*')
    .eq('id', shiftId)
    .single();

  if (fetchError || !current) return { success: false, error: 'Shift not found' };

  const { data, error } = await supabase
    .from('rota_shifts')
    .update({
      employee_id: newEmployeeId,
      is_open_shift: false,
      original_employee_id: current.original_employee_id ?? current.employee_id,
      reassigned_from_id: current.employee_id,
      reassigned_at: new Date().toISOString(),
      reassigned_by: user?.id,
      reassignment_reason: reason ?? null,
      ...initialAcceptanceForShift({
        employee_id: newEmployeeId,
        is_open_shift: false,
        status: current.status,
        shift_date: current.shift_date,
        start_time: current.start_time,
      }),
    })
    .eq('id', shiftId)
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };

  await supabase
    .from('rota_weeks')
    .update({ has_unpublished_changes: true })
    .eq('id', current.week_id)
    .eq('status', 'published');

  // Fire-and-forget: audit logging failure should not block the operation
  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'reassign',
    resource_type: 'rota_shift',
    resource_id: shiftId,
    operation_status: 'success',
    old_values: { employee_id: current.employee_id },
    new_values: { employee_id: newEmployeeId, reason },
  });

  revalidatePath('/rota');
  return { success: true, data: data as RotaShift };
}

// ---------------------------------------------------------------------------
// Get shifts for a specific employee across published weeks
// ---------------------------------------------------------------------------

export async function getEmployeeShifts(
  employeeId: string,
  fromDate: string,
  toDate: string,
): Promise<{ success: true; data: RotaShift[] } | { success: false; error: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  const canView = await checkUserPermission('rota', 'view');
  if (!canView) {
    const { data: ownRecord } = await supabase
      .from('employees')
      .select('employee_id')
      .eq('employee_id', employeeId)
      .eq('auth_user_id', user.id)
      .in('status', ['Active', 'Started Separation'])
      .maybeSingle();
    if (!ownRecord) return { success: false, error: 'Permission denied' };
  }

  // Read from the published snapshot — only what was explicitly published is visible to staff
  const { data, error } = await supabase
    .from('rota_published_shifts')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('status', 'scheduled')
    .or('acceptance_status.is.null,acceptance_status.in.(pending,accepted,auto_accepted)')
    .gte('shift_date', fromDate)
    .lte('shift_date', toDate)
    .order('shift_date')
    .order('start_time');

  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as RotaShift[] };
}

// ---------------------------------------------------------------------------
// Open shifts visible to staff on the portal (published weeks only)
// ---------------------------------------------------------------------------

export async function getOpenShiftsForPortal(
  fromDate: string,
  toDate: string,
): Promise<{ success: true; data: RotaShift[] } | { success: false; error: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  const { data: ownRecord } = await supabase
    .from('employees')
    .select('employee_id')
    .eq('auth_user_id', user.id)
    .in('status', ['Active', 'Started Separation'])
    .maybeSingle();
  if (!ownRecord) return { success: false, error: 'Permission denied' };

  // Read from the published snapshot — only what was explicitly published is visible to staff
  const { data, error } = await supabase
    .from('rota_published_shifts')
    .select('*')
    .eq('is_open_shift', true)
    .eq('status', 'scheduled')
    .gte('shift_date', fromDate)
    .lte('shift_date', toDate)
    .order('shift_date')
    .order('start_time');

  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []) as RotaShift[] };
}

const PortalShiftDecisionSchema = z.object({
  shiftId: z.string().uuid(),
});

const PortalShiftRejectSchema = z.object({
  shiftId: z.string().uuid(),
  note: z.string().max(500).nullable().optional(),
});

const PortalOpenShiftRequestSchema = z.object({
  shiftId: z.string().uuid(),
  note: z.string().max(500).nullable().optional(),
});

async function setPublishedAndLiveAcceptance(
  shiftId: string,
  employeeId: string,
  acceptance: ReturnType<typeof initialAcceptanceForShift> | {
    acceptance_status: ShiftAcceptanceStatus;
    acceptance_decided_at: string;
    acceptance_decided_by: string;
    acceptance_note: string | null;
    auto_accept_reason: string | null;
    auto_accept_warning_sent_at?: string | null;
  },
): Promise<{ data: RotaShift | null; error: string | null }> {
  const admin = createAdminClient();
  const updatePayload = {
    acceptance_status: acceptance.acceptance_status,
    acceptance_decided_at: acceptance.acceptance_decided_at,
    acceptance_decided_by: acceptance.acceptance_decided_by,
    acceptance_note: acceptance.acceptance_note,
    auto_accept_reason: acceptance.auto_accept_reason,
    auto_accept_warning_sent_at: acceptance.auto_accept_warning_sent_at ?? null,
  };

  const { data, error: publishedUpdateError } = await admin
    .from('rota_published_shifts')
    .update(updatePayload)
    .eq('id', shiftId)
    .eq('employee_id', employeeId)
    .select('*')
    .maybeSingle();

  if (publishedUpdateError) return { data: null, error: publishedUpdateError.message };
  if (!data) return { data: null, error: null };

  const { error: liveUpdateError } = await admin
    .from('rota_shifts')
    .update(updatePayload)
    .eq('id', shiftId)
    .eq('employee_id', employeeId);

  if (liveUpdateError) {
    console.error('Failed to sync portal shift acceptance onto rota_shifts', {
      shiftId,
      employeeId,
      error: liveUpdateError.message,
    });
  }

  return { data: data as RotaShift, error: null };
}

export async function acceptPortalShift(shiftId: string): Promise<
  { success: true; data: RotaShift; message?: string } | { success: false; error: string }
> {
  const parsed = PortalShiftDecisionSchema.safeParse({ shiftId });
  if (!parsed.success) return { success: false, error: 'Invalid shift' };

  const supabase = await createClient();
  const employee = await getOwnPortalEmployee(supabase);
  if (!employee) return { success: false, error: 'Unauthorized' };

  const admin = createAdminClient();
  const { data: shift, error } = await admin
    .from('rota_published_shifts')
    .select('*')
    .eq('id', parsed.data.shiftId)
    .eq('employee_id', employee.employee_id)
    .eq('is_open_shift', false)
    .eq('status', 'scheduled')
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!shift) return { success: false, error: 'Shift not found' };

  if (shift.acceptance_status === 'accepted' || shift.acceptance_status === 'auto_accepted') {
    return { success: true, data: shift as RotaShift };
  }

  const now = new Date();
  const insideCutoff = isInsideAcceptanceCutoff(shift.shift_date, shift.start_time, now);
  const nextAcceptance = insideCutoff
    ? {
        acceptance_status: 'auto_accepted' as const,
        acceptance_decided_at: now.toISOString(),
        acceptance_decided_by: employee.employee_id,
        acceptance_note: null,
        auto_accept_reason: SHIFT_AUTO_ACCEPT_POLICY_NOTE,
        auto_accept_warning_sent_at: null,
      }
    : {
        acceptance_status: 'accepted' as const,
        acceptance_decided_at: now.toISOString(),
        acceptance_decided_by: employee.employee_id,
        acceptance_note: null,
        auto_accept_reason: null,
        auto_accept_warning_sent_at: null,
      };

  const updated = await setPublishedAndLiveAcceptance(parsed.data.shiftId, employee.employee_id, nextAcceptance);
  if (updated.error) return { success: false, error: updated.error };
  if (!updated.data) return { success: false, error: 'Shift not found' };

  void logAuditEvent({
    user_id: (await supabase.auth.getUser()).data.user?.id,
    operation_type: insideCutoff ? 'auto_accept' : 'accept',
    resource_type: 'rota_shift',
    resource_id: parsed.data.shiftId,
    operation_status: 'success',
    new_values: { acceptance_status: nextAcceptance.acceptance_status },
  });

  revalidatePath('/portal/shifts');
  return {
    success: true,
    data: updated.data,
    ...(insideCutoff ? { message: 'This shift is inside the two-week cutoff and has been auto-accepted.' } : {}),
  };
}

export async function rejectPortalShift(input: z.infer<typeof PortalShiftRejectSchema>): Promise<
  { success: true; data: RotaShift | null; message?: string } | { success: false; error: string }
> {
  const parsed = PortalShiftRejectSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Invalid shift' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const employee = await getOwnPortalEmployee(supabase);
  if (!user || !employee) return { success: false, error: 'Unauthorized' };

  const admin = createAdminClient();
  const { data: shift, error } = await admin
    .from('rota_published_shifts')
    .select('*')
    .eq('id', parsed.data.shiftId)
    .eq('employee_id', employee.employee_id)
    .eq('is_open_shift', false)
    .eq('status', 'scheduled')
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!shift) return { success: false, error: 'Shift not found' };

  if (shift.acceptance_status === 'accepted' || shift.acceptance_status === 'auto_accepted') {
    return { success: false, error: 'This shift has already been accepted. Please contact Billy if you need to change it.' };
  }

  const now = new Date();
  if (isInsideAcceptanceCutoff(shift.shift_date, shift.start_time, now)) {
    const updated = await setPublishedAndLiveAcceptance(parsed.data.shiftId, employee.employee_id, {
      acceptance_status: 'auto_accepted',
      acceptance_decided_at: now.toISOString(),
      acceptance_decided_by: employee.employee_id,
      acceptance_note: null,
      auto_accept_reason: SHIFT_AUTO_ACCEPT_POLICY_NOTE,
      auto_accept_warning_sent_at: null,
    });
    if (updated.error) return { success: false, error: updated.error };
    if (!updated.data) return { success: false, error: 'Shift not found' };

    return {
      success: true,
      data: updated.data,
      message: 'This shift is inside the two-week cutoff and has been auto-accepted. Please contact Billy if you need to change it.',
    };
  }

  const rejectedAt = now.toISOString();
  const rejectionNote = parsed.data.note?.trim() || null;
  await recordCalendarCancellation(admin, shift as Parameters<typeof recordCalendarCancellation>[1], 'Rejected by staff');

  const openPayload = {
    employee_id: null,
    is_open_shift: true,
    acceptance_status: 'rejected',
    acceptance_decided_at: rejectedAt,
    acceptance_decided_by: employee.employee_id,
    acceptance_note: rejectionNote,
    auto_accept_reason: null,
    auto_accept_warning_sent_at: null,
    published_at: rejectedAt,
  };

  const { data: updated, error: publishedUpdateError } = await admin
    .from('rota_published_shifts')
    .update(openPayload)
    .eq('id', parsed.data.shiftId)
    .eq('employee_id', employee.employee_id)
    .select('*')
    .maybeSingle();

  if (publishedUpdateError) return { success: false, error: publishedUpdateError.message };

  await admin
    .from('rota_shifts')
    .update({
      employee_id: null,
      is_open_shift: true,
      acceptance_status: 'rejected',
      acceptance_decided_at: rejectedAt,
      acceptance_decided_by: employee.employee_id,
      acceptance_note: rejectionNote,
      auto_accept_reason: null,
      auto_accept_warning_sent_at: null,
      reassigned_from_id: employee.employee_id,
      reassigned_at: rejectedAt,
      reassigned_by: user.id,
      reassignment_reason: rejectionNote ? `Rejected by staff: ${rejectionNote}` : 'Rejected by staff',
    })
    .eq('id', parsed.data.shiftId);

  await recordShiftRejection(
    admin,
    shift as Parameters<typeof recordShiftRejection>[1],
    {
      employeeId: employee.employee_id,
      rejectedAt,
      rejectedBy: employee.employee_id,
      note: rejectionNote,
    },
  );

  const staffName = employeeDisplayName(employee);
  const subject = `Shift rejected: ${staffName} on ${shift.shift_date}`;
  let emailStatus: 'sent' | 'failed' = 'failed';
  let emailError: string | null = null;
  try {
    const emailResult = await sendEmail({
      to: MANAGER_SHIFT_EMAIL,
      subject,
      html: buildShiftRejectedManagerEmailHtml(shiftEmailSummary(shift, staffName), rejectionNote),
    });
    emailStatus = emailResult.success ? 'sent' : 'failed';
    emailError = emailResult.success ? null : emailResult.error ?? null;
  } catch (sendError) {
    emailStatus = 'failed';
    emailError = sendError instanceof Error ? sendError.message : String(sendError);
  }

  await admin.from('rota_email_log').insert({
    email_type: 'shift_rejected',
    entity_type: 'rota_shift',
    entity_id: parsed.data.shiftId,
    to_addresses: [MANAGER_SHIFT_EMAIL],
    subject,
    status: emailStatus,
    error_message: emailError,
    sent_by: user.id,
  });

  void logAuditEvent({
    user_id: user.id,
    operation_type: 'reject',
    resource_type: 'rota_shift',
    resource_id: parsed.data.shiftId,
    operation_status: 'success',
    old_values: { employee_id: employee.employee_id },
    new_values: { employee_id: null, is_open_shift: true, acceptance_status: 'rejected' },
  });

  revalidatePath('/portal/shifts');
  revalidatePath('/rota');
  revalidatePath(`/employees/${employee.employee_id}`);
  return { success: true, data: updated as RotaShift | null };
}

export async function requestOpenShift(input: z.infer<typeof PortalOpenShiftRequestSchema>): Promise<
  { success: true; data: OpenShiftRequest } | { success: false; error: string }
> {
  const parsed = PortalOpenShiftRequestSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Invalid shift request' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const employee = await getOwnPortalEmployee(supabase);
  if (!user || !employee) return { success: false, error: 'Unauthorized' };

  const admin = createAdminClient();
  const { data: shift, error: shiftError } = await admin
    .from('rota_published_shifts')
    .select('*')
    .eq('id', parsed.data.shiftId)
    .eq('is_open_shift', true)
    .eq('status', 'scheduled')
    .maybeSingle();

  if (shiftError) return { success: false, error: shiftError.message };
  if (!shift) return { success: false, error: 'Open shift not found' };

  const { data: request, error } = await admin
    .from('rota_open_shift_requests')
    .insert({
      shift_id: parsed.data.shiftId,
      employee_id: employee.employee_id,
      note: parsed.data.note?.trim() || null,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') return { success: false, error: 'You have already requested this shift' };
    return { success: false, error: error.message };
  }

  const staffName = employeeDisplayName(employee);
  const subject = `Open shift request: ${staffName} on ${shift.shift_date}`;
  let emailStatus: 'sent' | 'failed' = 'failed';
  let emailError: string | null = null;
  try {
    const emailResult = await sendEmail({
      to: MANAGER_SHIFT_EMAIL,
      subject,
      html: buildOpenShiftRequestManagerEmailHtml(
        shiftEmailSummary(shift, staffName),
        parsed.data.note?.trim() || null,
      ),
    });
    emailStatus = emailResult.success ? 'sent' : 'failed';
    emailError = emailResult.success ? null : emailResult.error ?? null;
  } catch (sendError) {
    emailStatus = 'failed';
    emailError = sendError instanceof Error ? sendError.message : String(sendError);
  }

  await admin.from('rota_email_log').insert({
    email_type: 'open_shift_requested',
    entity_type: 'rota_shift',
    entity_id: parsed.data.shiftId,
    to_addresses: [MANAGER_SHIFT_EMAIL],
    subject,
    status: emailStatus,
    error_message: emailError,
    sent_by: user.id,
  });

  revalidatePath('/portal/shifts');
  return { success: true, data: request as OpenShiftRequest };
}

// ---------------------------------------------------------------------------
// Move an existing shift to a new employee / date (within same week)
// ---------------------------------------------------------------------------

export async function moveShift(
  shiftId: string,
  newEmployeeId: string | null, // null = make it an open shift
  newShiftDate: string,
): Promise<{ success: true; data: RotaShift } | { success: false; error: string }> {
  const canEdit = await checkUserPermission('rota', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: currentShift, error: shiftError } = await supabase
    .from('rota_shifts')
    .select('week_id, employee_id, shift_date, status, start_time, is_open_shift')
    .eq('id', shiftId)
    .single();

  if (shiftError || !currentShift) return { success: false, error: 'Shift not found' };

  const { data: week, error: weekError } = await supabase
    .from('rota_weeks')
    .select('week_start')
    .eq('id', currentShift.week_id)
    .single();

  if (weekError || !week) return { success: false, error: 'Rota week not found' };

  const weekStart = week.week_start as string;
  const weekEnd = addDaysIso(weekStart, 6);
  if (newShiftDate < weekStart || newShiftDate > weekEnd) {
    return { success: false, error: `Shift date must stay within this rota week (${weekStart} to ${weekEnd})` };
  }

  const { data, error } = await supabase
    .from('rota_shifts')
    .update({
      employee_id: newEmployeeId,
      is_open_shift: newEmployeeId === null,
      shift_date: newShiftDate,
      ...initialAcceptanceForShift({
        employee_id: newEmployeeId,
        is_open_shift: newEmployeeId === null,
        status: currentShift.status,
        shift_date: newShiftDate,
        start_time: currentShift.start_time,
      }),
    })
    .eq('id', shiftId)
    .select('*')
    .single();

  if (error) return { success: false, error: error.message };

  await supabase
    .from('rota_weeks')
    .update({ has_unpublished_changes: true })
    .eq('id', (data as RotaShift).week_id)
    .eq('status', 'published');

  // Fire-and-forget: audit logging failure should not block the operation
  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'move',
    resource_type: 'rota_shift',
    resource_id: shiftId,
    operation_status: 'success',
    old_values: {
      employee_id: currentShift.employee_id,
      shift_date: currentShift.shift_date,
      is_open_shift: currentShift.is_open_shift,
    },
    new_values: { employee_id: newEmployeeId, shift_date: newShiftDate },
  });

  revalidatePath('/rota');
  return { success: true, data: data as RotaShift };
}

// ---------------------------------------------------------------------------
// Auto-populate a week from scheduled templates
// Creates open shifts (or assigned shifts) for each template that has a day_of_week,
// skipping dates that already have a shift from that template.
// ---------------------------------------------------------------------------

export async function autoPopulateWeekFromTemplates(
  weekId: string,
): Promise<{ success: true; created: number; shifts: RotaShift[] } | { success: false; error: string }> {
  const canEdit = await checkUserPermission('rota', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();

  // Parallelise: week, templates, existing shifts, and user auth all at once
  const [
    { data: week, error: weekError },
    { data: templates, error: tErr },
    { data: existing },
    { data: { user } },
  ] = await Promise.all([
    supabase.from('rota_weeks').select('week_start').eq('id', weekId).single(),
    supabase.from('rota_shift_templates').select('*').eq('is_active', true).not('day_of_week', 'is', null),
    supabase.from('rota_shifts').select('template_id, shift_date').eq('week_id', weekId),
    supabase.auth.getUser(),
  ]);

  if (weekError || !week) return { success: false, error: 'Rota week not found' };
  if (tErr) return { success: false, error: tErr.message };
  if (!templates?.length) return { success: true, created: 0, shifts: [] };

  const dayList = Array.from({ length: 7 }, (_, i) => addDaysIso(week.week_start as string, i));

  const existingSet = new Set(
    (existing ?? []).map((s: { template_id: string | null; shift_date: string }) =>
      `${s.template_id}:${s.shift_date}`,
    ),
  );

  // Build all inserts first, then batch insert in one round-trip (fixes N+1)
  const insertPayload: object[] = [];
  for (const t of templates) {
    if (t.day_of_week === null || t.day_of_week === undefined) continue;
    const dayIndex = t.day_of_week as number;
    if (dayIndex < 0 || dayIndex > 6) continue;
    const date = dayList[dayIndex];
    if (!date) continue;
    if (existingSet.has(`${t.id}:${date}`)) continue;

    insertPayload.push({
      week_id: weekId,
      employee_id: t.employee_id ?? null,
      is_open_shift: !t.employee_id,
      template_id: t.id,
      name: t.name as string,
      shift_date: date,
      start_time: (t.start_time as string).slice(0, 5),
      end_time: (t.end_time as string).slice(0, 5),
      unpaid_break_minutes: t.unpaid_break_minutes,
      department: t.department,
      is_overnight: false,
      ...initialAcceptanceForShift({
        employee_id: t.employee_id ?? null,
        is_open_shift: !t.employee_id,
        status: 'scheduled',
        shift_date: date,
        start_time: (t.start_time as string).slice(0, 5),
      }),
      created_by: user?.id,
    });
  }

  if (insertPayload.length === 0) {
    return { success: true, created: 0, shifts: [] };
  }

  const { data: inserted, error: insertError } = await supabase
    .from('rota_shifts')
    .insert(insertPayload)
    .select('*');

  if (insertError) return { success: false, error: insertError.message };

  const newShifts = (inserted ?? []) as RotaShift[];

  if (newShifts.length > 0) {
    await supabase
      .from('rota_weeks')
      .update({ has_unpublished_changes: true })
      .eq('id', weekId)
      .eq('status', 'published');
    revalidatePath('/rota');
  }

  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'create',
    resource_type: 'rota_week',
    resource_id: weekId,
    operation_status: 'success',
    additional_info: { action: 'auto_populate_from_templates', shifts_created: newShifts.length },
  });

  return { success: true, created: newShifts.length, shifts: newShifts };
}

// ---------------------------------------------------------------------------
// Add specific shifts from selected templates
// User picks template + date combinations from the AddShiftsModal.
// Server re-checks for duplicates (race condition safety) then batch-inserts.
// ---------------------------------------------------------------------------

export type ShiftSelection = { templateId: string; date: string }; // date = ISO "YYYY-MM-DD"

export async function addShiftsFromTemplates(
  weekId: string,
  selections: ShiftSelection[],
): Promise<
  { success: true; created: number; skipped: number; shifts: RotaShift[] } |
  { success: false; error: string }
> {
  const canEdit = await checkUserPermission('rota', 'edit');
  if (!canEdit) return { success: false, error: 'Permission denied' };
  if (!selections.length) return { success: false, error: 'No shifts selected' };

  const supabase = await createClient();

  const templateIds = [...new Set(selections.map(s => s.templateId))];

  const [
    { data: week, error: weekError },
    { data: templates, error: tErr },
    { data: existing },
    { data: { user } },
  ] = await Promise.all([
    supabase.from('rota_weeks').select('week_start').eq('id', weekId).single(),
    supabase.from('rota_shift_templates').select('*').in('id', templateIds),
    supabase.from('rota_shifts').select('template_id, shift_date').eq('week_id', weekId),
    supabase.auth.getUser(),
  ]);

  if (weekError || !week) return { success: false, error: 'Rota week not found' };
  if (tErr) return { success: false, error: tErr.message };

  type ShiftTemplate = { id: string; name: string; start_time: string; end_time: string; unpaid_break_minutes: number; department: string; employee_id: string | null };
  const templateMap = new Map((templates ?? []).map((t: ShiftTemplate) => [t.id, t]));

  // Server-side deduplication key: templateId:date
  const existingSet = new Set(
    (existing ?? []).map((s: { template_id: string | null; shift_date: string }) =>
      `${s.template_id}:${s.shift_date}`,
    ),
  );

  const insertPayload: object[] = [];
  for (const sel of selections) {
    if (existingSet.has(`${sel.templateId}:${sel.date}`)) continue;
    const t = templateMap.get(sel.templateId);
    if (!t) continue;

    insertPayload.push({
      week_id: weekId,
      employee_id: t.employee_id ?? null,
      is_open_shift: !t.employee_id,
      template_id: t.id,
      name: t.name as string,
      shift_date: sel.date,
      start_time: (t.start_time as string).slice(0, 5),
      end_time: (t.end_time as string).slice(0, 5),
      unpaid_break_minutes: t.unpaid_break_minutes,
      department: t.department,
      is_overnight: false,
      ...initialAcceptanceForShift({
        employee_id: t.employee_id ?? null,
        is_open_shift: !t.employee_id,
        status: 'scheduled',
        shift_date: sel.date,
        start_time: (t.start_time as string).slice(0, 5),
      }),
      created_by: user?.id,
    });
  }

  // skipped = selections not in insertPayload (already existed server-side)
  const skipped = selections.length - insertPayload.length;

  if (insertPayload.length === 0) {
    return { success: true, created: 0, skipped, shifts: [] };
  }

  const { data: inserted, error: insertError } = await supabase
    .from('rota_shifts')
    .insert(insertPayload)
    .select('*');

  if (insertError) {
    void logAuditEvent({
      user_id: user?.id,
      operation_type: 'create',
      resource_type: 'rota_week',
      resource_id: weekId,
      operation_status: 'failure',
      additional_info: { action: 'add_shifts_from_selection', error: insertError.message },
    });
    return { success: false, error: insertError.message };
  }

  const newShifts = (inserted ?? []) as RotaShift[];

  if (newShifts.length > 0) {
    await supabase
      .from('rota_weeks')
      .update({ has_unpublished_changes: true })
      .eq('id', weekId)
      .eq('status', 'published');
    revalidatePath('/rota');
  }

  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'create',
    resource_type: 'rota_week',
    resource_id: weekId,
    operation_status: 'success',
    additional_info: { action: 'add_shifts_from_selection', shifts_created: newShifts.length, shifts_skipped: skipped },
  });

  return { success: true, created: newShifts.length, skipped, shifts: newShifts };
}

// ---------------------------------------------------------------------------
// Active employees for the rota grid
// ---------------------------------------------------------------------------

export type RotaEmployee = {
  employee_id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  max_weekly_hours: number | null;
  is_active: boolean;
};

export async function getActiveEmployeesForRota(weekStart?: string): Promise<
  { success: true; data: RotaEmployee[] } | { success: false; error: string }
> {
  const canView = await checkUserPermission('rota', 'view');
  if (!canView) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();

  const { data: employees, error: empError } = await supabase
    .from('employees')
    .select('employee_id, first_name, last_name, job_title')
    .in('status', ['Active', 'Started Separation'])
    .order('first_name')
    .order('last_name');

  if (empError) return { success: false, error: empError.message };

  const activeList = employees ?? [];
  const activeIds = new Set(activeList.map((e: { employee_id: string }) => e.employee_id));

  // If a week is provided, also include any former employees who have shifts that week
  type EmpRow = { employee_id: string; first_name: string | null; last_name: string | null; job_title: string | null };
  let formerList: EmpRow[] = [];
  if (weekStart) {
    const weekEnd = new Date(weekStart + 'T00:00:00');
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    const { data: weekShifts } = await supabase
      .from('rota_shifts')
      .select('employee_id')
      .gte('shift_date', weekStart)
      .lte('shift_date', weekEndStr)
      .eq('is_open_shift', false)
      .not('employee_id', 'is', null);

    const formerIds = [...new Set(
      (weekShifts ?? [])
        .map((s: { employee_id: string | null }) => s.employee_id)
        .filter((id): id is string => id !== null && !activeIds.has(id))
    )];

    if (formerIds.length > 0) {
      const { data: formerEmployees } = await supabase
        .from('employees')
        .select('employee_id, first_name, last_name, job_title')
        .in('employee_id', formerIds)
        .order('first_name')
        .order('last_name');
      formerList = formerEmployees ?? [];
    }
  }

  const allIds = [...activeIds, ...formerList.map((e: EmpRow) => e.employee_id)];
  const settingsMap: Record<string, number | null> = {};
  if (allIds.length > 0) {
    const { data: settings } = await supabase
      .from('employee_pay_settings')
      .select('employee_id, max_weekly_hours')
      .in('employee_id', allIds);
    (settings ?? []).forEach((s: { employee_id: string; max_weekly_hours: number | null }) => {
      settingsMap[s.employee_id] = s.max_weekly_hours ?? null;
    });
  }

  const mapEmployee = (e: EmpRow, isActive: boolean): RotaEmployee => ({
    employee_id: e.employee_id,
    first_name: e.first_name,
    last_name: e.last_name,
    job_title: e.job_title,
    max_weekly_hours: settingsMap[e.employee_id] ?? null,
    is_active: isActive,
  });

  return {
    success: true,
    data: [
      ...activeList.map((e: EmpRow) => mapEmployee(e, true)),
      ...formerList.map((e: EmpRow) => mapEmployee(e, false)),
    ],
  };
}

// ---------------------------------------------------------------------------
// Leave days for a week (overlay on rota grid)
// ---------------------------------------------------------------------------

export type LeaveDayWithRequest = {
  employee_id: string;
  leave_date: string;
  request_id: string;
  status: 'pending' | 'approved' | 'declined';
};

export async function getLeaveDaysForWeek(weekStart: string): Promise<
  { success: true; data: LeaveDayWithRequest[] } | { success: false; error: string }
> {
  const canView = await checkUserPermission('rota', 'view');
  if (!canView) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('leave_days')
    .select('leave_date, request_id, leave_requests(employee_id, status)')
    .gte('leave_date', weekStart)
    .lte('leave_date', weekEndStr);

  if (error) return { success: false, error: error.message };

  // Supabase returns join as array when types are unresolved — normalise
  const rows = (data ?? []) as Array<{
    leave_date: string;
    request_id: string;
    leave_requests: { employee_id: string; status: string } | { employee_id: string; status: string }[] | null;
  }>;

  return {
    success: true,
    data: rows
      .map(d => {
        const lr = Array.isArray(d.leave_requests) ? d.leave_requests[0] : d.leave_requests;
        if (!lr) return null;
        return {
          employee_id: lr.employee_id,
          leave_date: d.leave_date,
          request_id: d.request_id,
          status: lr.status as LeaveDayWithRequest['status'],
        };
      })
      .filter((d): d is LeaveDayWithRequest => d !== null),
  };
}

// ---------------------------------------------------------------------------
// Publish a rota week
// ---------------------------------------------------------------------------

export async function publishRotaWeek(weekId: string): Promise<
  { success: true } | { success: false; error: string }
> {
  const canPublish = await checkUserPermission('rota', 'publish');
  if (!canPublish) return { success: false, error: 'Permission denied' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Fetch week metadata early — needed to determine first vs. re-publish
  const { data: weekRow } = await supabase
    .from('rota_weeks')
    .select('week_start, status')
    .eq('id', weekId)
    .single();

  const isRepublish = weekRow?.status === 'published';

  // Snapshot current shifts into rota_published_shifts so staff only see
  // what was published, not in-progress edits.
  const { data: currentShifts } = await supabase
    .from('rota_shifts')
    .select('id, week_id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name, acceptance_status, acceptance_decided_at, acceptance_decided_by, acceptance_note, auto_accept_reason, auto_accept_warning_sent_at')
    .eq('week_id', weekId)
    .neq('status', 'cancelled');

  // Replace the snapshot atomically: delete the previous published snapshot for
  // this week, then insert the current state fresh. Using delete-then-insert is
  // simpler and more reliable than upsert + selective-delete; the sub-millisecond
  // empty window is acceptable for an internal management tool.
  // Must use the admin client — rota_published_shifts has no write RLS policies
  // for regular users (intentional: only the system should write to this table).
  const admin = createAdminClient();
  const now = new Date().toISOString();

  // For a re-publish, capture the previous snapshot BEFORE we overwrite it so we
  // can compute the per-employee diff and only email staff whose shifts changed.
  let previousPublishedShifts: DiffShiftRow[] = [];
  let previousSnapshot: RotaShift[] = [];
  if (isRepublish) {
    const { data: prev } = await admin
      .from('rota_published_shifts')
      .select('id, week_id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name, acceptance_status, acceptance_decided_at, acceptance_decided_by, acceptance_note, auto_accept_reason, auto_accept_warning_sent_at')
      .eq('week_id', weekId);
    previousSnapshot = (prev ?? []) as RotaShift[];
    previousPublishedShifts = previousSnapshot.map(s => ({
      id: s.id,
      employee_id: s.employee_id,
      shift_date: s.shift_date,
      start_time: s.start_time,
      end_time: s.end_time,
      department: s.department,
      name: s.name,
      is_open_shift: s.is_open_shift,
      status: s.status,
    }));
  }

  const currentSnapshot = (currentShifts ?? []) as RotaShift[];
  const previousById = new Map(previousSnapshot.map(s => [s.id, s]));
  const currentById = new Map(currentSnapshot.map(s => [s.id, s]));

  const scheduleChanged = (prev: RotaShift, curr: RotaShift): boolean => (
    prev.employee_id !== curr.employee_id ||
    prev.shift_date !== curr.shift_date ||
    prev.start_time !== curr.start_time ||
    prev.end_time !== curr.end_time ||
    prev.unpaid_break_minutes !== curr.unpaid_break_minutes ||
    prev.department !== curr.department ||
    prev.is_overnight !== curr.is_overnight ||
    prev.is_open_shift !== curr.is_open_shift ||
    prev.status !== curr.status
  );

  await Promise.all(previousSnapshot.map(async prev => {
    if (!prev.employee_id || prev.is_open_shift || prev.status !== 'scheduled') return;
    const curr = currentById.get(prev.id);
    if (curr && curr.employee_id === prev.employee_id && !curr.is_open_shift && curr.status === 'scheduled') return;
    await recordCalendarCancellation(admin, prev, curr ? 'Shift reassigned or opened' : 'Shift removed');
  }));

  const rowsToPublish = currentSnapshot.map(shift => {
    const prev = previousById.get(shift.id);
    if (shift.is_open_shift) {
      const openAcceptance = shift.acceptance_status === 'rejected'
        ? {
            acceptance_status: 'rejected' as const,
            acceptance_decided_at: shift.acceptance_decided_at ?? prev?.acceptance_decided_at ?? null,
            acceptance_decided_by: shift.acceptance_decided_by ?? prev?.acceptance_decided_by ?? null,
            acceptance_note: shift.acceptance_note ?? prev?.acceptance_note ?? null,
            auto_accept_reason: null,
            auto_accept_warning_sent_at: null,
          }
        : {
            acceptance_status: null,
            acceptance_decided_at: null,
            acceptance_decided_by: null,
            acceptance_note: null,
            auto_accept_reason: null,
            auto_accept_warning_sent_at: null,
          };

      return {
        ...shift,
        ...openAcceptance,
        published_at: now,
      };
    }

    const shouldResetAcceptance = !prev || scheduleChanged(prev, shift);
    const acceptance = shouldResetAcceptance
      ? initialAcceptanceForShift({
          employee_id: shift.employee_id,
          is_open_shift: shift.is_open_shift,
          status: shift.status,
          shift_date: shift.shift_date,
          start_time: shift.start_time,
        })
      : {
          acceptance_status: shift.acceptance_status ?? prev.acceptance_status ?? null,
          acceptance_decided_at: shift.acceptance_decided_at ?? prev.acceptance_decided_at ?? null,
          acceptance_decided_by: shift.acceptance_decided_by ?? prev.acceptance_decided_by ?? null,
          acceptance_note: shift.acceptance_note ?? prev.acceptance_note ?? null,
          auto_accept_reason: shift.auto_accept_reason ?? prev.auto_accept_reason ?? null,
          auto_accept_warning_sent_at: shift.auto_accept_warning_sent_at ?? prev.auto_accept_warning_sent_at ?? null,
        };

    return {
      ...shift,
      ...acceptance,
      published_at: now,
    };
  });

  const { error: deleteError } = await admin
    .from('rota_published_shifts')
    .delete()
    .eq('week_id', weekId);
  if (deleteError) return { success: false, error: deleteError.message };

  if (rowsToPublish.length) {
    const { error: insertError } = await admin
      .from('rota_published_shifts')
      .insert(rowsToPublish);
    if (insertError) return { success: false, error: insertError.message };
  }

  // Only update status after snapshot succeeds
  const { error } = await supabase
    .from('rota_weeks')
    .update({
      status: 'published',
      published_at: new Date().toISOString(),
      published_by: user?.id,
      has_unpublished_changes: false,
    })
    .eq('id', weekId);

  if (error) return { success: false, error: error.message };

  // Fire-and-forget: audit logging failure should not block the operation
  void logAuditEvent({
    user_id: user?.id,
    operation_type: 'publish',
    resource_type: 'rota_week',
    resource_id: weekId,
    operation_status: 'success',
  });

  // Notify staff — fire-and-forget, errors must not block publish.
  // On first publish: everyone with shifts gets their full schedule.
  // On re-publish: only staff whose shifts changed get an update email.
  if (weekRow?.week_start) {
    if (isRepublish) {
      const newShiftsForDiff: DiffShiftRow[] = rowsToPublish.map(s => ({
        id: s.id,
        employee_id: s.employee_id,
        shift_date: s.shift_date,
        start_time: s.start_time,
        end_time: s.end_time,
        department: s.department,
        name: s.name,
        is_open_shift: s.is_open_shift,
        status: s.status,
      }));
      void sendRotaWeekChangeEmails(weekId, weekRow.week_start, previousPublishedShifts, newShiftsForDiff);
    } else {
      void sendRotaWeekEmails(weekId, weekRow.week_start);
    }
  }

  // Sync to management Google Calendar after the response is sent.
  // after() keeps the serverless function alive until the callback completes
  // (up to maxDuration = 300s). This never blocks publish or causes 504s.
  const weekStartDate = weekRow?.week_start as string | undefined
  after(async () => {
    try {
      const syncAdmin = createAdminClient()
      const { data: publishedShifts, error: readError } = await syncAdmin
        .from('rota_published_shifts')
        .select('id, week_id, employee_id, shift_date, start_time, end_time, department, status, notes, is_overnight, is_open_shift, name')
        .eq('week_id', weekId)

      // CRITICAL: Never sync an empty array on read failure — this would delete
      // all mapped events for the week. Abort on error or null data.
      if (readError || !publishedShifts) {
        console.error('[RotaCalendar] Failed to read published shifts for sync — aborting', weekId, readError?.message)
        return
      }

      // Guard against snapshot-in-progress: if the week is published but has
      // zero shifts, a delete/insert snapshot replacement may be in progress.
      if (publishedShifts.length === 0) {
        console.warn('[RotaCalendar] No published shifts found for week — skipping sync (snapshot may be in progress)', weekId)
        return
      }

      const { syncRotaWeekToCalendar } = await import('@/lib/google-calendar-rota');
      const syncResult = await syncRotaWeekToCalendar(weekId, publishedShifts, {
        weekStart: weekStartDate,
      })
      if (syncResult.failed > 0) {
        console.warn('[RotaCalendar] Sync completed with failures after publish for week', weekId, syncResult)
      }
    } catch (err: unknown) {
      console.error('[RotaCalendar] Sync failed after publish for week', weekId, err)
    }
  });

  revalidatePath('/rota');
  return { success: true };
}

/**
 * Re-sync all currently published rota weeks to the management Google Calendar.
 * Safe to call at any time — creates or updates events without sending staff emails.
 */
export async function resyncRotaCalendar(): Promise<
  { success: true; weeksSynced: number } | { success: false; error: string }
> {
  const canPublish = await checkUserPermission('rota', 'publish');
  if (!canPublish) return { success: false, error: 'Permission denied' };

  const admin = createAdminClient();

  const { data: weeks, error } = await admin
    .from('rota_weeks')
    .select('id, week_start')
    .eq('status', 'published');

  if (error) return { success: false, error: error.message };

  const { syncRotaWeekToCalendar } = await import('@/lib/google-calendar-rota');

  const weekIds = (weeks ?? []).map((w) => w.id);

  // Batch-fetch all shifts for every published week in a single query
  const { data: allShifts } = weekIds.length
    ? await admin
        .from('rota_published_shifts')
        .select('id, week_id, employee_id, shift_date, start_time, end_time, department, status, notes, is_overnight, is_open_shift, name')
        .in('week_id', weekIds)
    : { data: null };

  // Group shifts by week_id in memory
  const shiftsByWeek = new Map<string, typeof allShifts>();
  for (const shift of allShifts ?? []) {
    const existing = shiftsByWeek.get(shift.week_id);
    if (existing) {
      existing.push(shift);
    } else {
      shiftsByWeek.set(shift.week_id, [shift]);
    }
  }

  for (const week of weeks ?? []) {
    const shifts = shiftsByWeek.get(week.id) ?? [];
    try {
      await syncRotaWeekToCalendar(week.id, shifts, {
        weekStart: week.week_start as string,
      });
    } catch (err) {
      console.error('[RotaCalendar] resync failed for week', week.id, err);
    }
  }

  return { success: true, weeksSynced: (weeks ?? []).length };
}
