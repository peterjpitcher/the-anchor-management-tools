import { createAdminClient } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/app/actions/audit';
import {
  calculateBusinessReliabilityScore,
  RELIABILITY_WINDOW_DAYS,
  type EmployeeReliabilityEvent,
  type ReliabilityEventType,
  type ReliabilityScoreBreakdown,
} from '@/lib/employee-reliability-scoring';

type SupabaseLike = {
  from: (table: string) => any;
};

type JsonRecord = Record<string, unknown>;

export type ReliabilityShiftSnapshot = {
  id: string;
  week_id?: string | null;
  employee_id?: string | null;
  shift_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  department?: string | null;
  name?: string | null;
  published_at?: string | null;
};

export type ReliabilityLeaveSnapshot = {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  status?: string | null;
  created_at?: string | null;
  reviewed_at?: string | null;
  note?: string | null;
  manager_note?: string | null;
};

export type EmployeeReliabilityData = {
  employeeId: string;
  recent: ReliabilityScoreBreakdown;
  allTime: ReliabilityScoreBreakdown;
  events: EmployeeReliabilityEvent[];
};

export type TeamReliabilityRow = {
  employeeId: string;
  employeeName: string;
  email: string;
  jobTitle: string | null;
  status: string;
  rank: number | null;
  recent: ReliabilityScoreBreakdown;
};

export type TeamReliabilitySort =
  | 'score'
  | 'manual_accept_rate'
  | 'rejection_rate'
  | 'couldnt_work'
  | 'late_holidays';

function getReliabilityWindowStart(days = RELIABILITY_WINDOW_DAYS): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function toIsoDate(value: Date): string {
  return value.toISOString().split('T')[0]!;
}

function localDateFromIsoDateTime(value: string | null | undefined): string {
  if (!value) return toIsoDate(new Date());
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return toIsoDate(date);
}

function daysBetween(startDate: string, eventAt: string | null | undefined): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const eventDate = localDateFromIsoDateDateTime(eventAt);
  const event = new Date(`${eventDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(event)) return 0;
  return Math.floor((start - event) / (1000 * 60 * 60 * 24));
}

function localDateFromIsoDateDateTime(value: string | null | undefined): string {
  return localDateFromIsoDateTime(value);
}

function leaveDayCount(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

function eventAction(eventType: ReliabilityEventType): string {
  const actionByEvent: Record<ReliabilityEventType, string> = {
    shift_accepted: 'shift_accepted',
    shift_auto_accepted: 'shift_auto_accepted',
    shift_rejected: 'shift_rejected',
    late_shift_rejection_attempt: 'late_shift_rejection_attempt',
    couldnt_work: 'couldnt_work',
    holiday_requested: 'holiday_requested',
    holiday_approved: 'holiday_approved',
    late_holiday: 'late_holiday',
    holiday_conflict: 'holiday_conflict',
  };
  return actionByEvent[eventType];
}

function normalizeReliabilityEvent(row: any): EmployeeReliabilityEvent {
  return {
    id: String(row.id),
    employee_id: String(row.employee_id),
    event_type: row.event_type as ReliabilityEventType,
    event_at: String(row.event_at),
    source: String(row.source ?? 'system'),
    source_table: row.source_table ?? null,
    source_id: row.source_id ?? null,
    idempotency_key: String(row.idempotency_key),
    shift_id: row.shift_id ?? null,
    leave_request_id: row.leave_request_id ?? null,
    week_id: row.week_id ?? null,
    shift_date: row.shift_date ?? null,
    start_time: row.start_time ?? null,
    end_time: row.end_time ?? null,
    department: row.department ?? null,
    shift_name: row.shift_name ?? null,
    leave_start_date: row.leave_start_date ?? null,
    leave_end_date: row.leave_end_date ?? null,
    leave_day_count: typeof row.leave_day_count === 'number' ? row.leave_day_count : row.leave_day_count ? Number(row.leave_day_count) : null,
    published_at: row.published_at ?? null,
    notice_days: typeof row.notice_days === 'number' ? row.notice_days : row.notice_days ? Number(row.notice_days) : null,
    impacted_shift_count: typeof row.impacted_shift_count === 'number' ? row.impacted_shift_count : Number(row.impacted_shift_count ?? 0),
    score_eligible: row.score_eligible ?? true,
    note: row.note ?? null,
    metadata: row.metadata ?? null,
    created_at: String(row.created_at),
  };
}

export async function recordReliabilityEvent(input: {
  eventType: ReliabilityEventType;
  employeeId: string;
  eventAt?: string;
  source: string;
  sourceTable?: string | null;
  sourceId?: string | null;
  idempotencyKey: string;
  shift?: ReliabilityShiftSnapshot | null;
  leave?: ReliabilityLeaveSnapshot | null;
  leaveDayCount?: number | null;
  noticeDays?: number | null;
  impactedShiftCount?: number;
  scoreEligible?: boolean;
  note?: string | null;
  metadata?: JsonRecord | null;
  supabase?: SupabaseLike;
}): Promise<void> {
  const supabase = input.supabase ?? createAdminClient();
  const eventAt = input.eventAt ?? new Date().toISOString();
  const payload = {
    employee_id: input.employeeId,
    event_type: input.eventType,
    event_at: eventAt,
    source: input.source,
    source_table: input.sourceTable ?? null,
    source_id: input.sourceId ?? null,
    idempotency_key: input.idempotencyKey,
    shift_id: input.shift?.id ?? null,
    leave_request_id: input.leave?.id ?? null,
    week_id: input.shift?.week_id ?? null,
    shift_date: input.shift?.shift_date ?? null,
    start_time: input.shift?.start_time ?? null,
    end_time: input.shift?.end_time ?? null,
    department: input.shift?.department ?? null,
    shift_name: input.shift?.name ?? null,
    leave_start_date: input.leave?.start_date ?? null,
    leave_end_date: input.leave?.end_date ?? null,
    leave_day_count: input.leaveDayCount ?? (input.leave ? leaveDayCount(input.leave.start_date, input.leave.end_date) : null),
    published_at: input.shift?.published_at ?? null,
    notice_days: input.noticeDays ?? null,
    impacted_shift_count: input.impactedShiftCount ?? 0,
    score_eligible: input.scoreEligible ?? true,
    note: input.note ?? null,
    metadata: input.metadata ?? {},
  };

  try {
    const { error } = await supabase
      .from('employee_reliability_events')
      .upsert(payload, { onConflict: 'idempotency_key', ignoreDuplicates: true });

    if (error) {
      console.error('[employeeReliability] failed to record event', error);
    }
  } catch (error) {
    console.error('[employeeReliability] exception while recording event', error);
  }
}

export async function recordEmployeeReliabilityAudit(input: {
  eventType: ReliabilityEventType;
  employeeId: string;
  userId?: string | null;
  userEmail?: string | null;
  operationType?: string;
  oldValues?: JsonRecord | null;
  newValues?: JsonRecord | null;
  additionalInfo?: JsonRecord | null;
  supabase?: SupabaseLike;
}): Promise<void> {
  const additionalInfo = {
    action: eventAction(input.eventType),
    event_type: input.eventType,
    ...(input.additionalInfo ?? {}),
  };

  if (input.supabase) {
    try {
      const { error } = await input.supabase.from('audit_logs').insert({
        user_id: input.userId ?? null,
        user_email: input.userEmail ?? null,
        operation_type: input.operationType ?? 'reliability_event',
        resource_type: 'employee',
        resource_id: input.employeeId,
        operation_status: 'success',
        old_values: input.oldValues ?? null,
        new_values: input.newValues ?? null,
        additional_info: additionalInfo,
      });

      if (error) {
        console.error('[employeeReliability] failed to record audit log', error);
      }
    } catch (error) {
      console.error('[employeeReliability] exception while recording audit log', error);
    }
    return;
  }

  await logAuditEvent({
    user_id: input.userId ?? undefined,
    user_email: input.userEmail ?? undefined,
    operation_type: input.operationType ?? 'reliability_event',
    resource_type: 'employee',
    resource_id: input.employeeId,
    operation_status: 'success',
    old_values: input.oldValues ?? undefined,
    new_values: input.newValues ?? undefined,
    additional_info: additionalInfo,
  });
}

export async function recordShiftReliabilityEvent(input: {
  eventType: Extract<ReliabilityEventType, 'shift_accepted' | 'shift_auto_accepted' | 'shift_rejected' | 'late_shift_rejection_attempt'>;
  employeeId: string;
  shift: ReliabilityShiftSnapshot;
  eventAt?: string;
  source: string;
  userId?: string | null;
  userEmail?: string | null;
  note?: string | null;
  metadata?: JsonRecord | null;
  supabase?: SupabaseLike;
}): Promise<void> {
  const eventAt = input.eventAt ?? new Date().toISOString();
  await recordReliabilityEvent({
    eventType: input.eventType,
    employeeId: input.employeeId,
    eventAt,
    source: input.source,
    sourceTable: 'rota_published_shifts',
    sourceId: input.shift.id,
    idempotencyKey: `${input.eventType}:shift:${input.shift.id}:${input.employeeId}:${eventAt}`,
    shift: input.shift,
    note: input.note ?? null,
    metadata: input.metadata ?? null,
    supabase: input.supabase,
  });

  await recordEmployeeReliabilityAudit({
    eventType: input.eventType,
    employeeId: input.employeeId,
    userId: input.userId,
    userEmail: input.userEmail,
    operationType: 'shift_response',
    newValues: { event_type: input.eventType, shift_id: input.shift.id },
    additionalInfo: {
      shift_id: input.shift.id,
      shift_date: input.shift.shift_date,
      start_time: input.shift.start_time,
      end_time: input.shift.end_time,
      department: input.shift.department,
      shift_name: input.shift.name,
      source: input.source,
      note: input.note ?? null,
      ...(input.metadata ?? {}),
    },
    supabase: input.supabase,
  });
}

export async function recordCouldntWorkReliabilityEvent(input: {
  employeeId: string;
  markerShift: ReliabilityShiftSnapshot;
  reason: string;
  eventAt?: string;
  userId?: string | null;
  impactedShiftIds?: string[];
  supabase?: SupabaseLike;
}): Promise<void> {
  const eventAt = input.eventAt ?? new Date().toISOString();
  await recordReliabilityEvent({
    eventType: 'couldnt_work',
    employeeId: input.employeeId,
    eventAt,
    source: 'rota_couldnt_work',
    sourceTable: 'rota_shifts',
    sourceId: input.markerShift.id,
    idempotencyKey: `couldnt_work:shift:${input.markerShift.id}`,
    shift: input.markerShift,
    impactedShiftCount: input.impactedShiftIds?.length ?? 0,
    note: input.reason,
    metadata: { impacted_shift_ids: input.impactedShiftIds ?? [] },
    supabase: input.supabase,
  });
}

async function getHolidayConflictCount(
  supabase: SupabaseLike,
  employeeId: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('rota_published_shifts')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('status', 'scheduled')
      .eq('is_open_shift', false)
      .gte('shift_date', startDate)
      .lte('shift_date', endDate);

    if (error) {
      console.error('[employeeReliability] failed to detect holiday conflicts', error);
      return 0;
    }

    return (data ?? []).length;
  } catch (error) {
    console.error('[employeeReliability] exception while detecting holiday conflicts', error);
    return 0;
  }
}

export async function recordHolidayReliabilityEvents(input: {
  leave: ReliabilityLeaveSnapshot;
  eventAt?: string;
  source: string;
  userId?: string | null;
  userEmail?: string | null;
  includeRequested?: boolean;
  includeApproved?: boolean;
  includeLateAndConflict?: boolean;
  supabase?: SupabaseLike;
}): Promise<void> {
  const supabase = input.supabase ?? createAdminClient();
  const eventAt = input.eventAt ?? input.leave.reviewed_at ?? input.leave.created_at ?? new Date().toISOString();
  const noticeDays = daysBetween(input.leave.start_date, input.leave.created_at ?? eventAt);
  const days = leaveDayCount(input.leave.start_date, input.leave.end_date);

  const baseMetadata = {
    source: input.source,
    leave_status: input.leave.status ?? null,
    manager_note: input.leave.manager_note ?? null,
  };

  if (input.includeRequested) {
    await recordReliabilityEvent({
      eventType: 'holiday_requested',
      employeeId: input.leave.employee_id,
      eventAt: input.leave.created_at ?? eventAt,
      source: input.source,
      sourceTable: 'leave_requests',
      sourceId: input.leave.id,
      idempotencyKey: `holiday_requested:${input.leave.id}`,
      leave: input.leave,
      leaveDayCount: days,
      noticeDays,
      scoreEligible: false,
      note: input.leave.note ?? null,
      metadata: baseMetadata,
      supabase,
    });
  }

  if (input.includeApproved) {
    await recordReliabilityEvent({
      eventType: 'holiday_approved',
      employeeId: input.leave.employee_id,
      eventAt,
      source: input.source,
      sourceTable: 'leave_requests',
      sourceId: input.leave.id,
      idempotencyKey: `holiday_approved:${input.leave.id}:${eventAt}`,
      leave: input.leave,
      leaveDayCount: days,
      noticeDays,
      scoreEligible: false,
      note: input.leave.manager_note ?? input.leave.note ?? null,
      metadata: baseMetadata,
      supabase,
    });
  }

  if (input.includeLateAndConflict) {
    if (noticeDays <= 14) {
      await recordReliabilityEvent({
        eventType: 'late_holiday',
        employeeId: input.leave.employee_id,
        eventAt,
        source: input.source,
        sourceTable: 'leave_requests',
        sourceId: input.leave.id,
        idempotencyKey: `late_holiday:${input.leave.id}:${input.leave.start_date}:${input.leave.end_date}`,
        leave: input.leave,
        leaveDayCount: days,
        noticeDays,
        note: input.leave.manager_note ?? input.leave.note ?? null,
        metadata: baseMetadata,
        supabase,
      });
    }

    const conflictCount = await getHolidayConflictCount(
      supabase,
      input.leave.employee_id,
      input.leave.start_date,
      input.leave.end_date,
    );

    if (conflictCount > 0) {
      await recordReliabilityEvent({
        eventType: 'holiday_conflict',
        employeeId: input.leave.employee_id,
        eventAt,
        source: input.source,
        sourceTable: 'leave_requests',
        sourceId: input.leave.id,
        idempotencyKey: `holiday_conflict:${input.leave.id}:${input.leave.start_date}:${input.leave.end_date}`,
        leave: input.leave,
        leaveDayCount: days,
        noticeDays,
        impactedShiftCount: conflictCount,
        note: input.leave.manager_note ?? input.leave.note ?? null,
        metadata: baseMetadata,
        supabase,
      });
    }
  }

  if (input.includeRequested || input.includeApproved) {
    await recordEmployeeReliabilityAudit({
      eventType: input.includeApproved ? 'holiday_approved' : 'holiday_requested',
      employeeId: input.leave.employee_id,
      userId: input.userId,
      userEmail: input.userEmail,
      operationType: 'holiday_reliability',
      newValues: {
        leave_request_id: input.leave.id,
        start_date: input.leave.start_date,
        end_date: input.leave.end_date,
        status: input.leave.status,
      },
      additionalInfo: {
        leave_request_id: input.leave.id,
        start_date: input.leave.start_date,
        end_date: input.leave.end_date,
        leave_day_count: days,
        notice_days: noticeDays,
        source: input.source,
      },
      supabase,
    });
  }
}

export async function recordHolidayAuditOnly(input: {
  leave: ReliabilityLeaveSnapshot;
  action: string;
  eventAt?: string;
  userId?: string | null;
  userEmail?: string | null;
  additionalInfo?: JsonRecord | null;
  supabase?: SupabaseLike;
}): Promise<void> {
  await recordEmployeeReliabilityAudit({
    eventType: 'holiday_requested',
    employeeId: input.leave.employee_id,
    userId: input.userId,
    userEmail: input.userEmail,
    operationType: 'holiday_reliability',
    newValues: {
      leave_request_id: input.leave.id,
      start_date: input.leave.start_date,
      end_date: input.leave.end_date,
      status: input.leave.status,
    },
    additionalInfo: {
      action: input.action,
      leave_request_id: input.leave.id,
      start_date: input.leave.start_date,
      end_date: input.leave.end_date,
      source: input.action,
      ...(input.additionalInfo ?? {}),
    },
    supabase: input.supabase,
  });
}

async function fetchReliabilityEvents(params: {
  employeeIds?: string[];
  employeeId?: string;
  fromDate?: string;
  limit?: number;
}): Promise<EmployeeReliabilityEvent[]> {
  const supabase = createAdminClient();

  try {
    let query = supabase
      .from('employee_reliability_events')
      .select('*')
      .order('event_at', { ascending: false });

    if (params.employeeId) {
      query = query.eq('employee_id', params.employeeId);
    }
    if (params.employeeIds && params.employeeIds.length > 0) {
      query = query.in('employee_id', params.employeeIds);
    }
    if (params.fromDate) {
      query = query.gte('event_at', params.fromDate);
    }
    if (params.limit) {
      query = query.limit(params.limit);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[employeeReliability] failed to fetch events', error);
      return [];
    }

    return (data ?? []).map(normalizeReliabilityEvent);
  } catch (error) {
    console.error('[employeeReliability] exception while fetching events', error);
    return [];
  }
}

export async function getEmployeeReliabilityData(employeeId: string): Promise<EmployeeReliabilityData> {
  const events = await fetchReliabilityEvents({ employeeId, limit: 1000 });
  const windowStart = getReliabilityWindowStart();
  const recentEvents = events.filter(event => event.event_at >= windowStart);

  return {
    employeeId,
    recent: calculateBusinessReliabilityScore(recentEvents),
    allTime: calculateBusinessReliabilityScore(events),
    events: events.slice(0, 150),
  };
}

function employeeName(employee: { first_name: string | null; last_name: string | null; email_address: string | null }): string {
  const name = [employee.first_name, employee.last_name].filter(Boolean).join(' ');
  return name || employee.email_address || 'Unknown employee';
}

function sortLeaderboard(rows: TeamReliabilityRow[], sortBy: TeamReliabilitySort): TeamReliabilityRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const lowSampleDelta = Number(a.recent.isLowSample) - Number(b.recent.isLowSample);
    if (lowSampleDelta !== 0) return lowSampleDelta;

    if (sortBy === 'manual_accept_rate') {
      return (b.recent.rates.manualAcceptRate ?? -1) - (a.recent.rates.manualAcceptRate ?? -1);
    }
    if (sortBy === 'rejection_rate') {
      return (a.recent.rates.rejectionRate ?? 999) - (b.recent.rates.rejectionRate ?? 999);
    }
    if (sortBy === 'couldnt_work') {
      return a.recent.counts.couldntWork - b.recent.counts.couldntWork;
    }
    if (sortBy === 'late_holidays') {
      return a.recent.counts.lateHolidays - b.recent.counts.lateHolidays;
    }
    return b.recent.score - a.recent.score;
  });

  let rank = 1;
  return sorted.map(row => {
    if (row.recent.isLowSample) return { ...row, rank: null };
    const ranked = { ...row, rank };
    rank += 1;
    return ranked;
  });
}

export async function getTeamReliabilityLeaderboard(input: {
  includeFormer?: boolean;
  sortBy?: TeamReliabilitySort;
  fromDate?: string;
} = {}): Promise<TeamReliabilityRow[]> {
  const supabase = createAdminClient();
  const statuses = input.includeFormer
    ? ['Active', 'Started Separation', 'Former']
    : ['Active', 'Started Separation'];

  const { data: employees, error } = await supabase
    .from('employees')
    .select('employee_id, first_name, last_name, email_address, job_title, status')
    .in('status', statuses)
    .order('last_name')
    .order('first_name');

  if (error) {
    console.error('[employeeReliability] failed to fetch employees for leaderboard', error);
    return [];
  }

  const employeeRows = employees ?? [];
  const employeeIds = employeeRows.map((employee: any) => employee.employee_id as string);
  const events = employeeIds.length > 0
    ? await fetchReliabilityEvents({
        employeeIds,
        fromDate: input.fromDate ?? getReliabilityWindowStart(),
      })
    : [];

  const eventsByEmployee = new Map<string, EmployeeReliabilityEvent[]>();
  for (const event of events) {
    const existing = eventsByEmployee.get(event.employee_id) ?? [];
    existing.push(event);
    eventsByEmployee.set(event.employee_id, existing);
  }

  const rows = employeeRows.map((employee: any): TeamReliabilityRow => ({
    employeeId: employee.employee_id,
    employeeName: employeeName(employee),
    email: employee.email_address,
    jobTitle: employee.job_title ?? null,
    status: employee.status,
    rank: null,
    recent: calculateBusinessReliabilityScore(eventsByEmployee.get(employee.employee_id) ?? []),
  }));

  return sortLeaderboard(rows, input.sortBy ?? 'score');
}
