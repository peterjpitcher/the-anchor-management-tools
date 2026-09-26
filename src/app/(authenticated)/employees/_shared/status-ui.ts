import type { ReliabilityEventType } from '@/lib/employee-reliability-scoring'

/**
 * How employee statuses look on staff screens: the DS Badge tone for each one. Pure module, safe
 * to import from server and client components. Never pick a tone inline at the call site; add the
 * status here and use the map.
 *
 * Before 26 September 2026 the roster and the employee page each had their own copy of the
 * employment status tone, and they disagreed about a former employee (grey on the roster, red on
 * the employee page). Leaving is a finished state, not a fault, so it is quiet everywhere now, as
 * finished bookings are.
 */

export type EmployeeBadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

// Maps rather than object literals, so a status such as "constructor" can never resolve to an
// inherited Object property.
const EMPLOYMENT_STATUS_TONES = new Map<string, EmployeeBadgeTone>([
  ['Active', 'success'],
  ['Onboarding', 'info'],
  // On notice: still working, but leaving.
  ['Started Separation', 'warning'],
  ['Former', 'neutral'],
])

/** An employee's employment status (Active, Onboarding, Started Separation, Former). */
export function employmentStatusTone(status: string): EmployeeBadgeTone {
  return EMPLOYMENT_STATUS_TONES.get(status) ?? 'neutral'
}

/**
 * Holiday (leave request) status on the employee's Holidays tab. The rota, the staff portal and
 * this tab still carry their own copies; the cross-section leave map replaces all of them.
 */
const LEAVE_STATUS_TONES = new Map<string, EmployeeBadgeTone>([
  ['approved', 'success'],
  ['pending', 'warning'],
  ['declined', 'danger'],
])

export function leaveStatusTone(status: string): EmployeeBadgeTone {
  return LEAVE_STATUS_TONES.get(status) ?? 'danger'
}

/** Holiday allowance used this year: over (or at) the allowance is red, otherwise green. */
export function holidayAllowanceTone(overAllowance: boolean): 'danger' | 'success' {
  return overAllowance ? 'danger' : 'success'
}

export const HOLIDAY_ALLOWANCE_TEXT_CLASSES: Readonly<Record<'danger' | 'success', string>> = {
  danger: 'text-danger-fg',
  success: 'text-text',
}

/** An emergency contact's priority badge. "Other" shows no badge. */
const CONTACT_PRIORITY_TONES = new Map<string, EmployeeBadgeTone>([
  ['Primary', 'success'],
  ['Secondary', 'info'],
])

export function contactPriorityTone(priority: string): EmployeeBadgeTone {
  return CONTACT_PRIORITY_TONES.get(priority) ?? 'info'
}

/** A pay rate override: upcoming, the one in force now, or an older one. */
export type RateOverrideState = 'upcoming' | 'current' | 'historical'

export const RATE_OVERRIDE_TONES: Readonly<Record<RateOverrideState, EmployeeBadgeTone>> = {
  upcoming: 'warning',
  current: 'success',
  historical: 'neutral',
}

/** The countdown badge on the birthdays list: today, this week, this month, later. */
export function birthdayCountdownTone(daysUntil: number): EmployeeBadgeTone {
  if (daysUntil === 0) return 'danger'
  if (daysUntil <= 7) return 'warning'
  if (daysUntil <= 30) return 'info'
  return 'neutral'
}

/** A reliability score out of 100. Zero means no signal yet, so it stays quiet. */
export function reliabilityScoreTone(score: number): EmployeeBadgeTone {
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  if (score > 0) return 'danger'
  return 'neutral'
}

/**
 * The "Low sample" flag beside a reliability score: too few shift signals to rank the employee
 * yet, so treat the score with care. Used on the leaderboard and the employee's Reliability tab.
 */
export const RELIABILITY_LOW_SAMPLE_TONE: EmployeeBadgeTone = 'warning'

const RELIABILITY_EVENT_TONES = new Map<ReliabilityEventType, EmployeeBadgeTone>([
  ['shift_accepted', 'success'],
  ['shift_auto_accepted', 'info'],
  ['holiday_requested', 'info'],
  ['holiday_approved', 'info'],
  ['late_holiday', 'warning'],
  ['holiday_conflict', 'warning'],
  ['shift_rejected', 'danger'],
  ['late_shift_rejection_attempt', 'danger'],
  ['couldnt_work', 'danger'],
])

/** One event on an employee's reliability record. */
export function reliabilityEventTone(eventType: ReliabilityEventType): EmployeeBadgeTone {
  return RELIABILITY_EVENT_TONES.get(eventType) ?? 'neutral'
}

/** A rota week in the separation preview: published or still a draft. */
export function rotaWeekStatusTone(weekStatus: string): EmployeeBadgeTone {
  return weekStatus === 'published' ? 'success' : 'neutral'
}

/** What a separation does to a remaining shift: it stays assigned or becomes open. */
export const SEPARATION_SHIFT_DECISION_TONES: Readonly<Record<'retained' | 'released', EmployeeBadgeTone>> = {
  retained: 'success',
  released: 'warning',
}

/**
 * The icon disc beside each audit trail entry. Whole class strings, so Tailwind sees every class.
 * A note is a kind of entry, not a warning, so it takes a category colour.
 */
export function auditEntryIconClasses(entry: { kind: 'note' } | { kind: 'audit'; operationType: string }): string {
  if (entry.kind === 'note') return 'bg-cat-6-soft text-cat-6-fg'
  const operation = entry.operationType
  if (operation === 'create') return 'bg-success-soft text-success-fg'
  if (operation.includes('delete')) return 'bg-danger-soft text-danger-fg'
  if (operation.includes('update')) return 'bg-info-soft text-info-fg'
  return 'bg-surface-hover text-text'
}
