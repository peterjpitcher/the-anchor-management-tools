import type { ChecklistTaskView, TodayChecklistResult } from '@/app/actions/checklists'
import type { TodoView } from '@/app/actions/checklists-todos'
import type { Band } from '@/lib/checklists/types'
import type { CellState } from '@/types/checklists-review'

/**
 * The one set of status colours for Checklists: the staff screen, the manager tabs and the
 * weekly review all read their words and tones from here, so a state never changes colour
 * between screens. Pure module, safe to import from server and client components.
 */

export type ChecklistBadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

/** A task that can no longer be ticked on the staff screen: missed is the only red. */
export const CHECKLIST_CLOSED_TASK_STATUS: Record<
  Exclude<ChecklistTaskView['state'], 'done'>,
  { label: string; tone: ChecklistBadgeTone }
> = {
  missed: { label: 'Missed', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  not_applicable: { label: 'Not applicable', tone: 'neutral' },
  // A pending task that can no longer be ticked is locked.
  pending: { label: 'Locked', tone: 'neutral' },
}

/** Today's generation run, as the manager's Today tab shows it. */
export const CHECKLIST_GENERATION_STATUS: Record<
  TodayChecklistResult['generationStatus'],
  { label: string; tone: ChecklistBadgeTone }
> = {
  complete: { label: 'Complete', tone: 'success' },
  running: { label: 'Running', tone: 'info' },
  failed: { label: 'Failed', tone: 'danger' },
  skipped_closed: { label: 'Closed today', tone: 'neutral' },
  none: { label: 'Not generated', tone: 'warning' },
}

/** A closed todo. Open todos carry no badge. */
export const CHECKLIST_TODO_STATUS: Record<
  Exclude<TodoView['state'], 'open'>,
  { label: string; tone: ChecklistBadgeTone }
> = {
  done: { label: 'Done', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

/** A spot check: drawn and waiting, or its recorded result. */
export const CHECKLIST_SPOT_CHECK_STATUS: Record<
  'awaiting' | 'pass' | 'fail',
  { label: string; tone: ChecklistBadgeTone }
> = {
  awaiting: { label: 'Awaiting check', tone: 'warning' },
  pass: { label: 'Pass', tone: 'success' },
  fail: { label: 'Fail', tone: 'danger' },
}

/** Who is on shift, in the staff picker. */
export const CHECKLIST_PRESENCE_STATUS: Record<
  'clockedIn' | 'rostered',
  { label: string; tone: ChecklistBadgeTone }
> = {
  clockedIn: { label: 'Clocked in', tone: 'success' },
  rostered: { label: 'Rostered', tone: 'info' },
}

/** A person's timeliness band on the Insights tab. No band (too few ticks) is neutral. */
export const CHECKLIST_BAND_TONE: Record<Band, ChecklistBadgeTone> = {
  green: 'success',
  amber: 'warning',
  red: 'danger',
}

export function checklistBandTone(band: Band | null): ChecklistBadgeTone {
  return band ? CHECKLIST_BAND_TONE[band] : 'neutral'
}

/**
 * A weekly review cell, and its swatch in the legend. 'future' is a render-time state: a day
 * later than today has not happened yet, so an absent cell is upcoming, not a data gap.
 * Whole class strings only, so Tailwind sees every class.
 */
export type ChecklistReviewDisplayState = CellState | 'future'

export const CHECKLIST_REVIEW_CELL_CLASSES: Record<ChecklistReviewDisplayState, string> = {
  done: 'bg-success-soft text-success-fg',
  missed: 'bg-danger-soft text-danger-fg',
  skipped: 'bg-warning-soft text-warning-fg',
  not_applicable: 'bg-surface-2 text-text-muted',
  pending: 'bg-info-soft text-info-fg',
  not_due: 'bg-surface text-text-subtle',
  no_data: 'bg-warning-soft text-warning-fg',
  future: 'bg-surface text-text-subtle',
}
