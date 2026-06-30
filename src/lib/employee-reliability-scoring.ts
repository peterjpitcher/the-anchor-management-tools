export const RELIABILITY_WINDOW_DAYS = 90;
const RELIABILITY_MINIMUM_ELIGIBLE_SHIFT_SIGNALS = 5;

const RELIABILITY_EVENT_TYPES = [
  'shift_accepted',
  'shift_auto_accepted',
  'shift_rejected',
  'late_shift_rejection_attempt',
  'couldnt_work',
  'holiday_requested',
  'holiday_approved',
  'late_holiday',
  'holiday_conflict',
] as const;

export type ReliabilityEventType = typeof RELIABILITY_EVENT_TYPES[number];

export interface EmployeeReliabilityEvent {
  id: string;
  employee_id: string;
  event_type: ReliabilityEventType;
  event_at: string;
  source: string;
  source_table: string | null;
  source_id: string | null;
  idempotency_key: string;
  shift_id: string | null;
  leave_request_id: string | null;
  week_id: string | null;
  shift_date: string | null;
  start_time: string | null;
  end_time: string | null;
  department: string | null;
  shift_name: string | null;
  leave_start_date: string | null;
  leave_end_date: string | null;
  leave_day_count: number | null;
  published_at: string | null;
  notice_days: number | null;
  impacted_shift_count: number;
  score_eligible: boolean;
  note: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface ReliabilityCounts {
  manualAccepts: number;
  autoAccepts: number;
  rejections: number;
  lateRejectionAttempts: number;
  couldntWork: number;
  holidayRequests: number;
  holidayApproved: number;
  lateHolidays: number;
  holidayConflicts: number;
  eligibleShiftSignals: number;
  manualResponseSignals: number;
}

export interface ReliabilityScoreBreakdown {
  score: number;
  isLowSample: boolean;
  counts: ReliabilityCounts;
  components: {
    acceptance: number;
    responseSpeed: number;
    disruptionDiscipline: number;
    holidayNoticeImpact: number;
  };
  rates: {
    manualAcceptRate: number | null;
    rejectionRate: number | null;
    responseRate: number | null;
  };
  averageResponseHours: number | null;
}

const SHIFT_DECISION_EVENTS = new Set<ReliabilityEventType>([
  'shift_accepted',
  'shift_auto_accepted',
  'shift_rejected',
  'late_shift_rejection_attempt',
]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function hoursBetween(startIso: string, endIso: string): number | null {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, (end - start) / (1000 * 60 * 60));
}

function responseSpeedCredit(hours: number): number {
  if (hours <= 48) return 1;
  if (hours <= 168) return 0.5;
  return 0.25;
}

export function calculateBusinessReliabilityScore(
  events: EmployeeReliabilityEvent[],
): ReliabilityScoreBreakdown {
  const counts: ReliabilityCounts = {
    manualAccepts: 0,
    autoAccepts: 0,
    rejections: 0,
    lateRejectionAttempts: 0,
    couldntWork: 0,
    holidayRequests: 0,
    holidayApproved: 0,
    lateHolidays: 0,
    holidayConflicts: 0,
    eligibleShiftSignals: 0,
    manualResponseSignals: 0,
  };

  let acceptanceCredit = 0;
  const responseHours: number[] = [];

  for (const event of events) {
    switch (event.event_type) {
      case 'shift_accepted': {
        counts.manualAccepts += 1;
        counts.eligibleShiftSignals += 1;
        counts.manualResponseSignals += 1;
        acceptanceCredit += 1;
        if (event.published_at) {
          const hours = hoursBetween(event.published_at, event.event_at);
          if (hours !== null) responseHours.push(hours);
        }
        break;
      }
      case 'shift_auto_accepted':
        counts.autoAccepts += 1;
        counts.eligibleShiftSignals += 1;
        acceptanceCredit += 0.25;
        break;
      case 'shift_rejected': {
        counts.rejections += 1;
        counts.eligibleShiftSignals += 1;
        counts.manualResponseSignals += 1;
        if (event.published_at) {
          const hours = hoursBetween(event.published_at, event.event_at);
          if (hours !== null) responseHours.push(hours);
        }
        break;
      }
      case 'late_shift_rejection_attempt':
        counts.lateRejectionAttempts += 1;
        counts.eligibleShiftSignals += 1;
        counts.manualResponseSignals += 1;
        break;
      case 'couldnt_work':
        counts.couldntWork += 1;
        counts.eligibleShiftSignals += 1;
        break;
      case 'holiday_requested':
        counts.holidayRequests += 1;
        break;
      case 'holiday_approved':
        counts.holidayApproved += 1;
        break;
      case 'late_holiday':
        counts.lateHolidays += 1;
        break;
      case 'holiday_conflict':
        counts.holidayConflicts += 1;
        break;
    }
  }

  const shiftDecisionCount = events.filter(event => SHIFT_DECISION_EVENTS.has(event.event_type)).length;
  const acceptance = shiftDecisionCount > 0 ? 45 * (acceptanceCredit / shiftDecisionCount) : 0;

  const responseSpeed = responseHours.length > 0
    ? 10 * (responseHours.map(responseSpeedCredit).reduce((sum, credit) => sum + credit, 0) / responseHours.length)
    : 0;

  const disruptionPenalty = Math.min(
    35,
    (counts.couldntWork * 15) +
      (counts.lateRejectionAttempts * 10) +
      (counts.rejections * 6),
  );
  const disruptionDiscipline = 35 - disruptionPenalty;

  const holidayPenalty = Math.min(
    10,
    (counts.lateHolidays * 4) +
      (counts.holidayConflicts * 8),
  );
  const holidayNoticeImpact = 10 - holidayPenalty;

  const score = clamp(acceptance + responseSpeed + disruptionDiscipline + holidayNoticeImpact, 0, 100);

  const acceptedSignals = counts.manualAccepts + counts.autoAccepts;
  const rejectionSignals = counts.rejections + counts.lateRejectionAttempts;
  const averageResponseHours = responseHours.length > 0
    ? responseHours.reduce((sum, hours) => sum + hours, 0) / responseHours.length
    : null;

  return {
    score: roundOne(score),
    isLowSample: counts.eligibleShiftSignals < RELIABILITY_MINIMUM_ELIGIBLE_SHIFT_SIGNALS,
    counts,
    components: {
      acceptance: roundOne(acceptance),
      responseSpeed: roundOne(responseSpeed),
      disruptionDiscipline: roundOne(disruptionDiscipline),
      holidayNoticeImpact: roundOne(holidayNoticeImpact),
    },
    rates: {
      manualAcceptRate: shiftDecisionCount > 0 ? roundOne((counts.manualAccepts / shiftDecisionCount) * 100) : null,
      rejectionRate: shiftDecisionCount > 0 ? roundOne((rejectionSignals / shiftDecisionCount) * 100) : null,
      responseRate: shiftDecisionCount > 0 ? roundOne((counts.manualResponseSignals / shiftDecisionCount) * 100) : null,
    },
    averageResponseHours: averageResponseHours === null ? null : roundOne(averageResponseHours),
  };
}

export function eventTypeLabel(eventType: ReliabilityEventType): string {
  const labels: Record<ReliabilityEventType, string> = {
    shift_accepted: 'Accepted shift',
    shift_auto_accepted: 'Auto-accepted shift',
    shift_rejected: 'Rejected shift',
    late_shift_rejection_attempt: 'Tried to reject inside cutoff',
    couldnt_work: "Couldn't Work",
    holiday_requested: 'Requested holiday',
    holiday_approved: 'Holiday approved',
    late_holiday: 'Late holiday',
    holiday_conflict: 'Holiday conflicted with rota',
  };

  return labels[eventType];
}
