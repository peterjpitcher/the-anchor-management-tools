import type { ComponentProps } from 'react'
import type { Badge } from '@/ds'
import { formatDateInLondon } from '@/lib/dateUtils'
import type {
  ManagerTrigger,
  PauseReason,
  StaffReminderStep,
  TrainingAssignmentReason,
  TrainingAssignmentStatus,
  TrainingAudienceAge,
  TrainingCancelReason,
  TrainingCourseKind,
  TrainingCourseStatus,
  TrainingDisplayState,
  TrainingEventType,
  TrainingGroup,
  TrainingPersonFlag,
  TrainingVersionState,
} from './types'

/**
 * Words and badge tones for every training state, status, reason, group and event, used by the
 * manager pages, the employee record, the staff portal and the emails, so a state reads and looks
 * the same everywhere. Never pick a tone at the call site.
 *
 * Tones follow the house meanings: success done, warning needs attention soon, danger stuck or
 * late, info under way, neutral nothing to do. The tone type is the design-system Badge's own,
 * so a tone Badge does not support fails the type check.
 */

type TrainingBadgeTone = NonNullable<ComponentProps<typeof Badge>['tone']>

export interface TrainingBadge {
  label: string
  tone: TrainingBadgeTone
}

/** Matrix cells, the employee record and My Training. */
export const TRAINING_DISPLAY_STATE_BADGE: Record<TrainingDisplayState, TrainingBadge> = {
  not_required: { label: 'Not required', tone: 'neutral' },
  paused: { label: 'Paused', tone: 'neutral' },
  locked: { label: 'Locked', tone: 'danger' },
  declined: { label: 'Declined', tone: 'danger' },
  awaiting_confirmation: { label: 'Awaiting confirmation', tone: 'warning' },
  waiting: { label: 'Waiting for prerequisite', tone: 'neutral' },
  overdue: { label: 'Overdue', tone: 'danger' },
  due_soon: { label: 'Due soon', tone: 'warning' },
  in_progress: { label: 'In progress', tone: 'info' },
  not_started: { label: 'Not started', tone: 'neutral' },
  waived: { label: 'Waived', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'danger' },
  refresher_due: { label: 'Refresher due', tone: 'warning' },
  done: { label: 'Done', tone: 'success' },
}

/** The stored status of one cycle, for history lists. */
export const TRAINING_ASSIGNMENT_STATUS_BADGE: Record<TrainingAssignmentStatus, TrainingBadge> = {
  waiting: { label: 'Waiting for prerequisite', tone: 'neutral' },
  assigned: { label: 'Not started', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'info' },
  locked: { label: 'Locked', tone: 'danger' },
  awaiting_confirmation: { label: 'Awaiting confirmation', tone: 'warning' },
  declined: { label: 'Declined', tone: 'danger' },
  completed: { label: 'Completed', tone: 'success' },
  waived: { label: 'Waived', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

export const TRAINING_REASON_BADGE: Record<TrainingAssignmentReason, TrainingBadge> = {
  new_starter: { label: 'New starter', tone: 'neutral' },
  existing_staff: { label: 'Existing staff', tone: 'neutral' },
  course_added: { label: 'New course', tone: 'neutral' },
  refresher: { label: 'Refresher', tone: 'neutral' },
  redo: { label: 'Redo after a change', tone: 'neutral' },
  manual: { label: 'Assigned by a manager', tone: 'neutral' },
  renewal: { label: 'Renewal', tone: 'neutral' },
}

export const TRAINING_CANCEL_REASON_BADGE: Record<TrainingCancelReason, TrainingBadge> = {
  left: { label: 'Left', tone: 'neutral' },
  group_removed: { label: 'No longer needed for their groups', tone: 'neutral' },
  course_retired: { label: 'Course retired', tone: 'neutral' },
  replaced: { label: 'Replaced', tone: 'neutral' },
  manual: { label: 'Cancelled by a manager', tone: 'neutral' },
}

export const TRAINING_GROUP_BADGE: Record<TrainingGroup, TrainingBadge> = {
  bar: { label: 'Bar', tone: 'neutral' },
  kitchen: { label: 'Kitchen', tone: 'neutral' },
  floor: { label: 'Floor', tone: 'neutral' },
  management: { label: 'Management', tone: 'neutral' },
}

/** The training log. */
export const TRAINING_EVENT_BADGE: Record<TrainingEventType, TrainingBadge> = {
  course_draft_uploaded: { label: 'Draft uploaded', tone: 'neutral' },
  course_published: { label: 'Course published', tone: 'success' },
  course_retired: { label: 'Course retired', tone: 'neutral' },
  assigned: { label: 'Assigned', tone: 'neutral' },
  started: { label: 'Started', tone: 'info' },
  section_passed: { label: 'Section passed', tone: 'success' },
  section_failed: { label: 'Section not passed', tone: 'warning' },
  locked: { label: 'Locked', tone: 'danger' },
  unlocked: { label: 'Unlocked', tone: 'info' },
  extended: { label: 'Due date moved', tone: 'info' },
  waived: { label: 'Waived', tone: 'neutral' },
  paused: { label: 'Paused', tone: 'neutral' },
  resumed: { label: 'Resumed', tone: 'info' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  declined: { label: 'Confirmation declined', tone: 'danger' },
  confirmation_prepared: { label: 'Confirmation ready', tone: 'info' },
  confirmation_failed: { label: 'Confirmation could not be prepared', tone: 'danger' },
  completed: { label: 'Completed', tone: 'success' },
  reminder_sent: { label: 'Reminder sent', tone: 'neutral' },
  escalated: { label: 'Manager told', tone: 'warning' },
  external_recorded: { label: 'External qualification recorded', tone: 'success' },
  signoff_recorded: { label: 'Practical sign-off recorded', tone: 'success' },
  groups_changed: { label: 'Training groups changed', tone: 'neutral' },
  redo_requested: { label: 'Redo requested', tone: 'warning' },
}

export const TRAINING_COURSE_STATUS_BADGE: Record<TrainingCourseStatus, TrainingBadge> = {
  draft: { label: 'Draft', tone: 'warning' },
  live: { label: 'Live', tone: 'success' },
  retired: { label: 'Retired', tone: 'neutral' },
}

export const TRAINING_COURSE_KIND_BADGE: Record<TrainingCourseKind, TrainingBadge> = {
  online: { label: 'Online course', tone: 'primary' },
  practical: { label: 'Practical sign-off', tone: 'primary' },
  external: { label: 'External qualification', tone: 'primary' },
}

export const TRAINING_VERSION_STATE_BADGE: Record<TrainingVersionState, TrainingBadge> = {
  draft: { label: 'Draft', tone: 'warning' },
  published: { label: 'Published', tone: 'success' },
}

export const TRAINING_PAUSE_REASON_BADGE: Record<PauseReason, TrainingBadge> = {
  leave_of_absence: { label: 'Leave of absence', tone: 'neutral' },
  parental_leave: { label: 'Parental leave', tone: 'neutral' },
  other: { label: 'Other', tone: 'neutral' },
}

export const TRAINING_PERSON_FLAG_BADGE: Record<TrainingPersonFlag, TrainingBadge> = {
  groups_not_confirmed: { label: 'Groups not confirmed', tone: 'warning' },
  no_login: { label: 'No login', tone: 'danger' },
  dob_missing: { label: 'Date of birth missing', tone: 'warning' },
}

export const TRAINING_AUDIENCE_AGE_BADGE: Record<TrainingAudienceAge, TrainingBadge> = {
  all: { label: 'Any age', tone: 'neutral' },
  under_18: { label: 'Under 18 only', tone: 'neutral' },
  adult: { label: '18 and over only', tone: 'neutral' },
}

/** The staff chasing ladder, for "next reminder" on the employee record. */
export const TRAINING_REMINDER_STEP_BADGE: Record<StaffReminderStep, TrainingBadge> = {
  assigned: { label: 'New training', tone: 'neutral' },
  nudge: { label: 'Reminder', tone: 'neutral' },
  due_soon: { label: 'Due soon', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'danger' },
  weekly: { label: 'Still outstanding', tone: 'danger' },
}

/** Lines in the manager's daily training email. */
export const TRAINING_MANAGER_TRIGGER_BADGE: Record<ManagerTrigger, TrainingBadge> = {
  essentials_overdue: { label: 'Essentials overdue', tone: 'danger' },
  overdue_7_days: { label: 'Overdue for 7 days', tone: 'danger' },
  locked: { label: 'Section locked', tone: 'danger' },
  declined: { label: 'Confirmation declined', tone: 'danger' },
  no_login: { label: 'No portal login', tone: 'danger' },
  undeliverable: { label: 'Training emails cannot be delivered', tone: 'danger' },
  certificate_failed: { label: 'Certificate could not be prepared', tone: 'danger' },
}

/** A check attempt on the employee record. */
export const TRAINING_ATTEMPT_RESULT_BADGE: Record<'passed' | 'failed' | 'open', TrainingBadge> = {
  passed: { label: 'Passed', tone: 'success' },
  failed: { label: 'Not passed', tone: 'warning' },
  open: { label: 'Not submitted', tone: 'neutral' },
}

/** Shown wherever an under-18 practical sign-off is recorded (MHSWR reg 19). */
export const TRAINING_SUPERVISED_ONLY_BADGE: TrainingBadge = { label: 'Supervised only', tone: 'warning' }

/** "2 Nov 2027" for a London date (YYYY-MM-DD) or an instant. */
export function formatTrainingDate(value: string): string {
  return formatDateInLondon(value, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** A published version's number: "1.0", "2.3". */
export function formatTrainingVersion(major: number, minor: number): string {
  return `${major}.${minor}`
}

/** "Version 1.2", or "Draft" for a version with no number yet. */
export function trainingVersionText(version: { major: number | null; minor: number | null }): string {
  if (version.major === null || version.minor === null) return 'Draft'
  return `Version ${formatTrainingVersion(version.major, version.minor)}`
}

/** "Bar, Kitchen" in the fixed order, or "Everyone" for a course with no groups. */
export function trainingGroupsText(groups: readonly TrainingGroup[]): string {
  if (groups.length === 0) return 'Everyone'
  const order: TrainingGroup[] = ['bar', 'kitchen', 'floor', 'management']
  return order
    .filter((group) => groups.includes(group))
    .map((group) => TRAINING_GROUP_BADGE[group].label)
    .join(', ')
}

function dayCount(days: number): string {
  return days === 1 ? '1 day' : `${days} days`
}

export interface DisplayStateDetail {
  dueOn?: string | null
  daysOverdue?: number | null
  expiresOn?: string | null
}

export interface DescribedDisplayState extends TrainingBadge {
  /** The extra words in brackets, or null when there are none. */
  detail: string | null
  /** The label with its detail: "Overdue (3 days)", "Done (refresher due by 2 Nov 2027)". */
  text: string
}

/** A display state with the dates that make it useful, worded the same on every screen. */
export function describeDisplayState(state: TrainingDisplayState, detail: DisplayStateDetail = {}): DescribedDisplayState {
  const badge = TRAINING_DISPLAY_STATE_BADGE[state]
  let extra: string | null = null
  switch (state) {
    case 'overdue':
      extra = typeof detail.daysOverdue === 'number' && detail.daysOverdue > 0 ? dayCount(detail.daysOverdue) : null
      break
    case 'due_soon':
    case 'in_progress':
    case 'not_started':
    case 'awaiting_confirmation':
      extra = detail.dueOn ? `due ${formatTrainingDate(detail.dueOn)}` : null
      break
    case 'expired':
      extra = detail.dueOn ? `due ${formatTrainingDate(detail.dueOn)}` : null
      break
    case 'refresher_due':
      extra = detail.expiresOn ? `due by ${formatTrainingDate(detail.expiresOn)}` : null
      break
    case 'done':
      extra = detail.expiresOn ? `refresher due by ${formatTrainingDate(detail.expiresOn)}` : null
      break
    default:
      extra = null
  }
  return { ...badge, detail: extra, text: extra ? `${badge.label} (${extra})` : badge.label }
}

/**
 * My Training's words for the display states whose manager word is not plain enough for staff
 * (plain words, a reading age of about 9). Every other state reads as `TRAINING_DISPLAY_STATE_BADGE`
 * does, with the same tone. The manager maps keep the spec's words ("Waiting for prerequisite").
 */
export const TRAINING_STAFF_DISPLAY_STATE_LABEL: Partial<Record<TrainingDisplayState, string>> = {
  waiting: 'Waiting for another course',
}

/** `describeDisplayState` in the staff portal's words, for My Training only. */
export function describeStaffDisplayState(state: TrainingDisplayState, detail: DisplayStateDetail = {}): DescribedDisplayState {
  const described = describeDisplayState(state, detail)
  const label = TRAINING_STAFF_DISPLAY_STATE_LABEL[state]
  if (!label) return described
  return { ...described, label, text: described.detail ? `${label} (${described.detail})` : label }
}
