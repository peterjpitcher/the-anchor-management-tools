import type { Badge } from '@/ds'

type BadgeTone = NonNullable<React.ComponentProps<typeof Badge>['tone']>

/**
 * A holiday request's status on the staff portal. The same colours as the manager's leave
 * screens: pending waits on a manager, approved is done, declined is the one to notice.
 * Wave 3 folds this into the shared leave tone map beside ROTA_HOLIDAY_CLASSES.
 */
export const PORTAL_LEAVE_STATUS_TONE: Record<string, BadgeTone> = {
  pending: 'warning',
  approved: 'success',
  declined: 'danger',
}

export function portalLeaveStatusTone(status: string): BadgeTone {
  return PORTAL_LEAVE_STATUS_TONE[status] ?? 'neutral'
}

/** An open shift this person has already asked for, waiting on a manager. */
export const OPEN_SHIFT_REQUESTED_TONE: BadgeTone = 'warning'

/**
 * The inline panel a shift row opens to confirm a decision before it is sent: asking for an open
 * shift is the same warning tone as its Requested badge; turning down your own shift is danger.
 */
export const SHIFT_CONFIRM_PANEL_CLASSES = {
  request: 'rounded-lg border border-warning-border bg-warning-soft p-3',
  reject: 'rounded-lg border border-danger-border bg-danger-soft p-3',
} as const

/**
 * A pay premium on a shift. Warning draws the eye to your own extra pay; another person's shift
 * (shown to portal shift managers) stays neutral so it reads as background.
 */
export function shiftPremiumTone(isOtherStaffShift: boolean): BadgeTone {
  return isOtherStaffShift ? 'neutral' : 'warning'
}
