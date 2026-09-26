/**
 * How cash-up states look on staff screens. Pure module, safe to import from server and client
 * components.
 *
 * The daily entry page and the weekly table each had their own copy of the session status map;
 * both now read this one, so a session looks the same on every Cashing Up screen.
 */

type CashupBadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

/** Session status to Badge tone: approved is done, submitted waits for approval, locked is closed. */
export const CASHUP_SESSION_STATUS_TONE: Record<string, CashupBadgeTone> = {
  approved: 'success',
  submitted: 'info',
  locked: 'warning',
  draft: 'neutral',
}

export function cashupSessionStatusTone(status: string): CashupBadgeTone {
  return CASHUP_SESSION_STATUS_TONE[status] ?? 'neutral'
}

/**
 * Takings against the target for the week so far: at or over target is good, within 10% is a
 * warning, further short is a problem. No target set is neutral.
 */
export function targetPerformanceTone(percent: number | null): CashupBadgeTone {
  if (percent === null) return 'neutral'
  if (percent >= 100) return 'success'
  if (percent >= 90) return 'warning'
  return 'danger'
}

/** The dashboard's row tint for the same bands as targetPerformanceTone. */
export function targetPerformanceRowClass(percent: number | null): string | undefined {
  if (percent === null) return undefined
  if (percent >= 100) return 'bg-success-soft hover:bg-success-soft'
  if (percent >= 90) return 'bg-warning-soft hover:bg-warning-soft'
  return 'bg-danger-soft hover:bg-danger-soft'
}

/** A till count against the Z-read: short, over, or balanced to the penny. */
export type CashVarianceKind = 'shortfall' | 'overage' | 'balanced'

/**
 * The one map for cash variance, on every Cashing Up screen (the daily entry, the weekly table
 * and its totals, the dashboard's rows and its Total Variance figure). Any difference to the
 * penny needs review: short is danger, over is warning (money that should not be there is still
 * a discrepancy, never good news), balanced is neutral. `text` colours a figure written in a
 * table or line, `stat` is the Stat tone, and `alert` the daily entry's balance banner, where a
 * balanced till is confirmed in the success colour because an Alert has no neutral tone.
 */
export const CASH_VARIANCE_UI: Record<
  CashVarianceKind,
  { text: string; stat: 'danger' | 'warning' | 'default'; alert: 'danger' | 'warning' | 'success' }
> = {
  shortfall: { text: 'text-danger-fg', stat: 'danger', alert: 'danger' },
  overage: { text: 'text-warning-fg', stat: 'warning', alert: 'warning' },
  balanced: { text: 'text-text-muted', stat: 'default', alert: 'success' },
}

/** Which way a cash variance goes, rounded to the penny. */
export function cashVarianceKind(variance: number): CashVarianceKind {
  const rounded = Number(variance.toFixed(2))
  if (rounded === 0) return 'balanced'
  return rounded < 0 ? 'shortfall' : 'overage'
}

/** Text colour for a cash variance figure (CASH_VARIANCE_UI). */
export function cashVarianceTextClass(variance: number): string {
  return CASH_VARIANCE_UI[cashVarianceKind(variance)].text
}

/** Stat tone for a cash variance figure (CASH_VARIANCE_UI). */
export function cashVarianceTone(variance: number): 'danger' | 'warning' | 'default' {
  return CASH_VARIANCE_UI[cashVarianceKind(variance)].stat
}

/**
 * Text colour for a signed amount where more is better (weekly takings against target). Not for
 * cash variance, where over is not good news: that is CASH_VARIANCE_UI.
 */
export function signedAmountTextClass(amount: number): string {
  if (amount < 0) return 'text-danger-fg'
  if (amount > 0) return 'text-success-fg'
  return ''
}

/** The same rule as a Stat tone, for the weekly takings against target. */
export function signedAmountTone(amount: number): 'danger' | 'success' | 'default' {
  if (amount < 0) return 'danger'
  if (amount > 0) return 'success'
  return 'default'
}

/** The import result banner: every row in is a success, any failed row needs a look. */
export function cashupImportResultTone(failedRows: number): 'success' | 'warning' {
  return failedRows === 0 ? 'success' : 'warning'
}

/** The dashboard's weekly progress bar: green once the week's target is met. */
export function weeklyProgressTone(percentOfTarget: number): 'success' | 'primary' {
  return percentOfTarget >= 100 ? 'success' : 'primary'
}

/** The balance banner on the daily entry (CASH_VARIANCE_UI): any difference is flagged for review. */
export function cashVarianceAlertTone(variance: number): 'danger' | 'warning' | 'success' {
  return CASH_VARIANCE_UI[cashVarianceKind(variance)].alert
}
