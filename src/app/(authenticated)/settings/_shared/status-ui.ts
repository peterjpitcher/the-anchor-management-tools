/**
 * How the statuses on the settings screens look: the DS Badge tone for each value. Pure module,
 * safe to import from server and client components. Call sites never pick a tone themselves; they
 * ask this file, so a status looks the same wherever it shows.
 */

export type SettingsBadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

// Maps rather than object literals, so a value such as "constructor" can never resolve to an
// inherited Object property.

/** Audit log entries: `operation_status` is success or failure. */
const AUDIT_LOG_STATUS_TONES = new Map<string, SettingsBadgeTone>([
  ['success', 'success'],
  ['failure', 'danger'],
])

export function auditLogStatusTone(status: string): SettingsBadgeTone {
  // Anything that is not a success is shown as a failure, as before.
  return AUDIT_LOG_STATUS_TONES.get(status) ?? 'danger'
}

/** The background job queue. */
const BACKGROUND_JOB_STATUS_TONES = new Map<string, SettingsBadgeTone>([
  ['pending', 'warning'],
  ['processing', 'info'],
  ['completed', 'success'],
  ['failed', 'danger'],
  ['cancelled', 'neutral'],
])

export function backgroundJobStatusTone(status: string): SettingsBadgeTone {
  return BACKGROUND_JOB_STATUS_TONES.get(status) ?? 'neutral'
}

/**
 * On/off states: an API key, a message template, a maintenance area. Active is green, anything
 * switched off is quiet.
 */
export function activeStateTone(isActive: boolean): SettingsBadgeTone {
  return isActive ? 'success' : 'neutral'
}

/**
 * A day on the special hours calendar. One state decides the tint, the border and the badge.
 * The old service status overrides are still shown and win over a special hours entry.
 */
export type SpecialHoursDayState =
  | 'overrideClosed'
  | 'overrideOpen'
  | 'closed'
  | 'kitchenClosed'
  | 'modified'
  | 'normal'

/** Whole class strings, so Tailwind sees every class. */
export const SPECIAL_HOURS_DAY_CLASSES: Record<SpecialHoursDayState, string> = {
  overrideClosed: 'border-danger-border bg-danger-soft text-danger-fg',
  overrideOpen: 'border-success-border bg-success-soft text-success-fg',
  closed: 'border-danger-border bg-danger-soft',
  kitchenClosed: 'border-warning-border bg-warning-soft',
  modified: 'border-info-border bg-info-soft',
  normal: 'border-border',
}

/** The same two states as words in the list of upcoming exceptions: a text colour, not a badge. */
export const SPECIAL_HOURS_TEXT_CLASSES: Record<'closed' | 'kitchenClosed', string> = {
  closed: 'text-danger-fg',
  kitchenClosed: 'text-warning-fg',
}

/** The badge on a special hours day, and the word it carries. */
export const SPECIAL_HOURS_BADGE: Record<'closed' | 'kitchenClosed' | 'modified', { tone: SettingsBadgeTone; label: string }> = {
  closed: { tone: 'danger', label: 'Closed' },
  kitchenClosed: { tone: 'warning', label: 'Kitchen Closed' },
  modified: { tone: 'info', label: 'Modified' },
}

/** The "Default" marker on a built-in message template. */
export const DEFAULT_TEMPLATE_TONE: SettingsBadgeTone = 'info'

/** A pay band rate: upcoming (not yet in force), current, or historical. */
export type PayRateStatus = 'upcoming' | 'current' | 'historical'

export const PAY_RATE_STATUS_BADGE: Record<PayRateStatus, { tone: SettingsBadgeTone; label: string }> = {
  upcoming: { tone: 'warning', label: 'Upcoming' },
  current: { tone: 'success', label: 'Current' },
  historical: { tone: 'neutral', label: 'Historical' },
}

/**
 * SMS failures and undelivered guest messages. A Twilio error code is a failure (red); a message
 * that never left our side ("not sent") is a warning. Message delivery status is shared with other
 * sections; this map is only the settings screen's view of it.
 */
export const SMS_FAILURE_TONES = {
  errorCode: 'danger',
  notSent: 'warning',
  undelivered: 'danger',
} as const satisfies Record<string, SettingsBadgeTone>

/** A seasonal booking period (Christmas, Mother's Day and the rest). */
export type SeasonalPeriodState = 'archived' | 'off' | 'liveMenuMissing' | 'live'

export const SEASONAL_PERIOD_STATUS_BADGE: Record<SeasonalPeriodState, { tone: SettingsBadgeTone; label: string }> = {
  archived: { tone: 'neutral', label: 'Archived' },
  off: { tone: 'neutral', label: 'Switched off' },
  // Live but unbookable: it needs a pre-order and has no menu yet.
  liveMenuMissing: { tone: 'warning', label: 'Live, menu missing' },
  live: { tone: 'success', label: 'Live' },
}
