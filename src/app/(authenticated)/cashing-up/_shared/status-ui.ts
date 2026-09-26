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

/**
 * Text colour for a till count against the Z-read. Any difference to the penny needs review:
 * short is red, over is amber, balanced is muted.
 */
export function cashVarianceTextClass(variance: number): string {
  const rounded = Number(variance.toFixed(2))
  if (rounded === 0) return 'text-text-muted'
  return rounded < 0 ? 'text-danger-fg' : 'text-warning-fg'
}

/** Text colour for a signed amount where more is better (weekly takings against target). */
export function signedAmountTextClass(amount: number): string {
  if (amount < 0) return 'text-danger-fg'
  if (amount > 0) return 'text-success-fg'
  return ''
}

/** The import result banner: every row in is a success, any failed row needs a look. */
export function cashupImportResultTone(failedRows: number): 'success' | 'warning' {
  return failedRows === 0 ? 'success' : 'warning'
}

/** The dashboard's weekly progress bar: green once the week's target is met. */
export function weeklyProgressTone(percentOfTarget: number): 'success' | 'primary' {
  return percentOfTarget >= 100 ? 'success' : 'primary'
}

/** The balance banner on the daily entry: any difference to the penny is flagged for review. */
export function cashVarianceAlertTone(variance: number): 'success' | 'warning' {
  return Number(variance.toFixed(2)) === 0 ? 'success' : 'warning'
}
