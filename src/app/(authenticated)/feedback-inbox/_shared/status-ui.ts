import type { ReviewFeedbackItem } from '@/app/actions/feedback'

/**
 * Guest review feedback status: one label and one Badge tone per status, used wherever it shows
 * (UI_UX.md, Status). New is info, in progress is warning, resolved is success, dismissed is
 * neutral.
 */
export type FeedbackStatus = ReviewFeedbackItem['status']

export const FEEDBACK_STATUS_TONE: Record<FeedbackStatus, 'info' | 'warning' | 'success' | 'neutral'> = {
  new: 'info',
  in_progress: 'warning',
  resolved: 'success',
  dismissed: 'neutral',
}

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
}

export const FEEDBACK_STATUS_OPTIONS: { value: FeedbackStatus; label: string }[] = (
  ['new', 'in_progress', 'resolved', 'dismissed'] as const
).map((value) => ({ value, label: FEEDBACK_STATUS_LABEL[value] }))
