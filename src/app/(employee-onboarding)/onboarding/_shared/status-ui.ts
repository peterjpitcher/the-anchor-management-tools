import type { Badge, IconName } from '@/ds'

type BadgeTone = NonNullable<React.ComponentProps<typeof Badge>['tone']>

/** A section on the onboarding review screen: saved, or still to do before submitting. */
export type OnboardingSectionState = 'complete' | 'incomplete'

export const ONBOARDING_SECTION_TONE: Record<OnboardingSectionState, BadgeTone> = {
  complete: 'success',
  incomplete: 'warning',
}

export const ONBOARDING_SECTION_LABEL: Record<OnboardingSectionState, string> = {
  complete: 'Complete',
  incomplete: 'Incomplete',
}

/** The icon beside each section on the review screen. */
export const ONBOARDING_SECTION_ICON: Record<OnboardingSectionState, { name: IconName; className: string }> = {
  complete: { name: 'checkCircle', className: 'text-success' },
  incomplete: { name: 'alertCircle', className: 'text-warning' },
}

/** A set of dates on the time-off step. The set the server turned down is edged in danger. */
export type TimeOffRowState = 'ok' | 'rejected'

export const TIME_OFF_ROW_BORDER_CLASSES: Record<TimeOffRowState, string> = {
  ok: 'border-border',
  rejected: 'border-danger',
}
