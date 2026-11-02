import { createAdminClient } from '@/lib/supabase/admin';
import { fetchAllRows } from '@/lib/supabase/paged-read';
import { logAuditEvent } from '@/app/actions/audit';
import { displayName } from '@/lib/employees/display-name';
import { getTodayIsoDate, toLocalIsoDate } from '@/lib/dateUtils';
import { DEFAULT_LEAVE_TYPE, getLeaveTypes } from '@/lib/leave/leave-types';
import {
  calculateBusinessReliabilityScore,
  hasNoShiftSignals,
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
  /** leave_types.code. Missing means the column default, holiday. */
  leave_type?: string | null;
  /** leave_requests.leave_origin: 'agreed_at_hire' for time off a new starter listed at onboarding. */
  leave_origin?: string | null;
};

/** Leave events that can lower a score. holiday_requested and holiday_approved are information only. */
const SCORED_LEAVE_EVENT_TYPES = new Set<ReliabilityEventType>(['late_holiday', 'holiday_conflict']);

/**
 * Time off agreed when the person was hired. Migration 20260819050000 exempts it from late notice
 * and shift clash scoring: it was booked before they started, so it cannot be late.
 */
const AGREED_AT_HIRE_ORIGIN = 'agreed_at_hire';

/** Leave request ids per read, so the id list in the request URL stays short. */
const LEAVE_REQUEST_ID_CHUNK = 100;

export type EmployeeReliabilityData = {
  employeeId: string;
  recent: ReliabilityScoreBreakdown;
  allTime: ReliabilityScoreBreakdown;
  events: EmployeeReliabilityEvent[];
  /**
   * Set when the events could not be read. The Reliability tab shows it instead of the scores,
   * which would otherwise be worked out from no events and look like a real record.
   */
  loadError?: string | null;
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

/** Shown by /employees/reliability when the leaderboard cannot be read. */
export const RELIABILITY_LEADERBOARD_LOAD_ERROR = 'Could not load the reliability leaderboard. Try again in a moment.';
const RELIABILITY_EVENTS_LOAD_ERROR = 'Could not load the reliability events.';

function getReliabilityWindowStart(days = RELIABILITY_WINDOW_DAYS): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

// The London date of an instant. This used to take the UTC date, so a holiday asked for between
// 00:00 and 00:59 BST was dated the day before, and its notice ran a day long: 15 days instead
// of 14, just enough to miss the late holiday flag.
function localDateFromIsoDateTime(value: string | null | undefined): string {
  if (!value) return getTodayIsoDate();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return toLocalIsoDate(date);
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

async function recordReliabilityEvent(input: {
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

async function recordEmployeeReliabilityAudit(input: {
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

/**
 * Whether late notice on this leave counts against the person. It does not for a leave type with
 * counts_in_reliability false (days someone cannot work, which are not holiday), nor for time off
 * agreed at hire. The type is read through the cached leave type list, which falls back to the
 * seeded types on a database error. If even that throws, the event is recorded as scored: the
 * score read (applyLeaveScoringRules) checks every leave event against leave_types again and can
 * take a penalty away, but never add one.
 */
async function lateNoticeCounts(leave: ReliabilityLeaveSnapshot, supabase: SupabaseLike): Promise<boolean> {
  if (leave.leave_origin === AGREED_AT_HIRE_ORIGIN) return false;
  const code = leave.leave_type ?? DEFAULT_LEAVE_TYPE;
  try {
    const type = (await getLeaveTypes(supabase)).find(row => row.code === code);
    return type ? type.counts_in_reliability : true;
  } catch (error) {
    console.error('[employeeReliability] failed to read leave types for a late holiday', error);
    return true;
  }
}

// No 'holiday_conflict' event is emitted any more (spec F2, developer review C10).
//
// It docked the EMPLOYEE's reliability score for a clash the MANAGER created by
// rostering over approved leave. Approval is now blocked outright while a clashing
// shift exists (decision D1), so the event can no longer fire legitimately.
//
// The 'holiday_conflict' member of ReliabilityEventType and its case in
// calculateBusinessReliabilityScore are deliberately kept: the event_type CHECK
// constraint is closed and the scoring switch is exhaustive with no default, so
// historical rows must still read and score. Those rows are cleaned up under the
// runbook, not by this code.
export async function recordHolidayReliabilityEvents(input: {
  leave: ReliabilityLeaveSnapshot;
  eventAt?: string;
  source: string;
  userId?: string | null;
  userEmail?: string | null;
  includeRequested?: boolean;
  includeApproved?: boolean;
  includeLate?: boolean;
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
    leave_type: input.leave.leave_type ?? null,
    leave_origin: input.leave.leave_origin ?? null,
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

  if (input.includeLate && noticeDays <= 14) {
    // Still recorded when it does not count, as information, like the requested and approved
    // events: the record then shows the short notice without it lowering the score.
    const scoreEligible = await lateNoticeCounts(input.leave, supabase);
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
      scoreEligible,
      note: input.leave.manager_note ?? input.leave.note ?? null,
      metadata: baseMetadata,
      supabase,
    });
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

type ReliabilityEventQuery = {
  employeeId?: string;
  fromDate?: string;
};

/**
 * Reads reliability events and throws when the read fails, so a caller can tell a failure from no
 * events. Newest first.
 *
 * Read in pages: Supabase returns at most 1,000 rows per request and cuts the answer short with no
 * error. The leaderboard's 90-day window was one unpaged read (417 rows on 2 November 2026, and
 * growing), and an employee's all-time record stopped at 1,000, so scores would have drifted
 * quietly once either passed the limit. The id breaks ties between events at the same instant, so
 * no page repeats or skips a row.
 */
async function queryReliabilityEvents(params: ReliabilityEventQuery): Promise<EmployeeReliabilityEvent[]> {
  const supabase = createAdminClient();

  let rows: unknown[];
  try {
    rows = await fetchAllRows<unknown>(
      (from, to) => {
        let query = supabase.from('employee_reliability_events').select('*');
        if (params.employeeId) {
          query = query.eq('employee_id', params.employeeId);
        }
        if (params.fromDate) {
          query = query.gte('event_at', params.fromDate);
        }
        return query
          .order('event_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to);
      },
      { label: 'reliability events' }
    );
  } catch (error) {
    console.error('[employeeReliability] failed to fetch events', error);
    throw new Error(RELIABILITY_EVENTS_LOAD_ERROR);
  }

  return rows.map(normalizeReliabilityEvent);
}

function isScoredLeaveEvent(event: EmployeeReliabilityEvent): boolean {
  return event.score_eligible && SCORED_LEAVE_EVENT_TYPES.has(event.event_type) && Boolean(event.leave_request_id);
}

/**
 * Applies the leave rules to events already recorded, in memory, before they are scored. A late
 * holiday or a rota clash on leave whose type has counts_in_reliability false (days someone cannot
 * work, which are not holiday), or on time off agreed at hire, is marked not score-eligible. Until
 * 2 November 2026 the recorder checked neither, and one 'unavailable' request in production
 * carried a scored late_holiday and a scored holiday_conflict. This corrects that row without a
 * data change, and any like it.
 *
 * The types come from leave_types, not a hard-coded list. Throws when leave_types or the leave
 * requests cannot be read, because a score with those penalties left in would look real; callers
 * show their own read error instead. An event whose request has since been deleted keeps the
 * eligibility it was recorded with, as there is nothing left to check it against.
 */
async function applyLeaveScoringRules(events: EmployeeReliabilityEvent[]): Promise<EmployeeReliabilityEvent[]> {
  const requestIds = [...new Set(events.filter(isScoredLeaveEvent).map(event => event.leave_request_id as string))];
  if (requestIds.length === 0) return events;

  const supabase = createAdminClient();

  // Read directly rather than through getLeaveTypes, which falls back to the seeded types on an
  // error: a score must not rest on a guess.
  const { data: typeRows, error: typeError } = await supabase
    .from('leave_types')
    .select('code, counts_in_reliability');
  if (typeError || !Array.isArray(typeRows) || typeRows.length === 0) {
    console.error('[employeeReliability] failed to read leave types for scoring', typeError ?? new Error('leave_types returned no rows'));
    throw new Error(RELIABILITY_EVENTS_LOAD_ERROR);
  }
  const notCounted = new Set(
    (typeRows as Array<{ code: string; counts_in_reliability: boolean }>)
      .filter(row => row.counts_in_reliability === false)
      .map(row => row.code)
  );

  const requests = new Map<string, { leave_type: string | null; leave_origin: string | null }>();
  for (let start = 0; start < requestIds.length; start += LEAVE_REQUEST_ID_CHUNK) {
    const { data, error } = await supabase
      .from('leave_requests')
      .select('id, leave_type, leave_origin')
      .in('id', requestIds.slice(start, start + LEAVE_REQUEST_ID_CHUNK));
    if (error) {
      console.error('[employeeReliability] failed to read leave requests for scoring', error);
      throw new Error(RELIABILITY_EVENTS_LOAD_ERROR);
    }
    for (const row of (data ?? []) as Array<{ id: string; leave_type: string | null; leave_origin: string | null }>) {
      requests.set(row.id, row);
    }
  }

  return events.map(event => {
    if (!isScoredLeaveEvent(event)) return event;
    const request = requests.get(event.leave_request_id as string);
    if (!request) return event;
    const exempt = notCounted.has(request.leave_type ?? DEFAULT_LEAVE_TYPE)
      || request.leave_origin === AGREED_AT_HIRE_ORIGIN;
    return exempt ? { ...event, score_eligible: false } : event;
  });
}

/**
 * One employee's record, for the Reliability tab on their page. A failed read comes back as
 * loadError rather than as no events: before 2 November 2026 it was shown as an empty record with
 * a score worked out from nothing.
 */
export async function getEmployeeReliabilityData(employeeId: string): Promise<EmployeeReliabilityData> {
  let events: EmployeeReliabilityEvent[];
  let loadError: string | null = null;
  try {
    events = await applyLeaveScoringRules(await queryReliabilityEvents({ employeeId }));
  } catch (error) {
    // A database error was logged where it happened; anything else is logged here.
    if (!(error instanceof Error && error.message === RELIABILITY_EVENTS_LOAD_ERROR)) {
      console.error('[employeeReliability] exception while fetching events', error);
    }
    events = [];
    loadError = RELIABILITY_EVENTS_LOAD_ERROR;
  }
  const windowStart = getReliabilityWindowStart();
  const recentEvents = events.filter(event => event.event_at >= windowStart);

  return {
    employeeId,
    recent: calculateBusinessReliabilityScore(recentEvents),
    allTime: calculateBusinessReliabilityScore(events),
    events: events.slice(0, 150),
    loadError,
  };
}

function employeeName(employee: {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email_address: string | null;
}): string {
  // Same fallback chain as before: name, then email address, then a placeholder.
  return displayName(employee, employee.email_address || 'Unknown employee');
}

function sortLeaderboard(rows: TeamReliabilityRow[], sortBy: TeamReliabilitySort): TeamReliabilityRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const lowSampleDelta = Number(a.recent.isLowSample) - Number(b.recent.isLowSample);
    if (lowSampleDelta !== 0) return lowSampleDelta;
    // Someone with no shifts at all has nothing to score, so they go last rather than above a
    // low-sample score that is real.
    const noShiftsDelta = Number(hasNoShiftSignals(a.recent)) - Number(hasNoShiftSignals(b.recent));
    if (noShiftsDelta !== 0) return noShiftsDelta;

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

/**
 * The team leaderboard. Throws (with RELIABILITY_LEADERBOARD_LOAD_ERROR as the message) when
 * either the employees or their reliability events cannot be read, as the maintenance and P&L
 * services do for their reads. Before 26 September 2026 a failed read returned an empty list, so
 * the page said "No employees found" (or scored everyone zero) when the database was down.
 */
export async function getTeamReliabilityLeaderboard(input: {
  includeFormer?: boolean;
  sortBy?: TeamReliabilitySort;
  fromDate?: string;
} = {}): Promise<TeamReliabilityRow[]> {
  const supabase = createAdminClient();
  const statuses = input.includeFormer
    ? ['Active', 'Started Separation', 'Former']
    : ['Active', 'Started Separation'];

  type LeaderboardEmployee = {
    employee_id: string;
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    email_address: string;
    job_title: string | null;
    status: string;
  };

  let employeeRows: LeaderboardEmployee[];
  try {
    // Paged like the events, with the id as the last sort key so two people with the same name
    // can never swap places between pages.
    employeeRows = await fetchAllRows<LeaderboardEmployee>(
      (from, to) =>
        supabase
          .from('employees')
          .select('employee_id, first_name, last_name, preferred_name, email_address, job_title, status')
          .in('status', statuses)
          .order('last_name')
          .order('first_name')
          .order('employee_id')
          .range(from, to),
      { label: 'employees for leaderboard' }
    );
  } catch (error) {
    console.error('[employeeReliability] failed to fetch employees for leaderboard', error);
    throw new Error(RELIABILITY_LEADERBOARD_LOAD_ERROR);
  }

  // Everyone's events in the window, matched to the people above in memory. Filtering by a list
  // of every employee id put the whole list in the request URL, which only grows.
  const employeeIds = new Set(employeeRows.map(employee => employee.employee_id));
  let events: EmployeeReliabilityEvent[] = [];
  if (employeeIds.size > 0) {
    try {
      const windowEvents = await queryReliabilityEvents({
        fromDate: input.fromDate ?? getReliabilityWindowStart(),
      });
      events = await applyLeaveScoringRules(windowEvents.filter(event => employeeIds.has(event.employee_id)));
    } catch (error) {
      // Scoring everyone from no events would show a zero for every employee, a failed load
      // dressed up as data, and scoring them without the leave rules would show penalties that
      // do not count. Both reads log their own database error; anything else is logged here.
      if (!(error instanceof Error && error.message === RELIABILITY_EVENTS_LOAD_ERROR)) {
        console.error('[employeeReliability] exception while reading leaderboard events', error);
      }
      throw new Error(RELIABILITY_LEADERBOARD_LOAD_ERROR);
    }
  }

  const eventsByEmployee = new Map<string, EmployeeReliabilityEvent[]>();
  for (const event of events) {
    if (!employeeIds.has(event.employee_id)) continue;
    const existing = eventsByEmployee.get(event.employee_id) ?? [];
    existing.push(event);
    eventsByEmployee.set(event.employee_id, existing);
  }

  const rows = employeeRows.map((employee): TeamReliabilityRow => ({
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
