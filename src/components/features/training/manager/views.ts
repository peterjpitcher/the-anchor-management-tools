/**
 * The views of Employees, Training. They are a switch on one page (a page shows at most one tab
 * row), kept in the address as `?view=` so each view can be linked to and is loaded on the server.
 */
const TRAINING_VIEWS = ['matrix', 'courses', 'activity', 'pay'] as const
export type TrainingView = (typeof TRAINING_VIEWS)[number]

export const TRAINING_VIEW_OPTIONS: Array<{ id: TrainingView; label: string }> = [
  { id: 'matrix', label: 'Matrix' },
  { id: 'courses', label: 'Courses' },
  { id: 'activity', label: 'Activity' },
  { id: 'pay', label: 'Pay Report' },
]

const TRAINING_PAGE_PATH = '/employees/training'

/** The training log as CSV with an "as at" line (route handler, training view). */
export const TRAINING_EXPORT_HREF = '/api/training/export'

/** The view named in the address, or the matrix when it names none or one that does not exist. */
export function parseTrainingView(value: string | string[] | undefined): TrainingView {
  const raw = Array.isArray(value) ? value[0] : value
  return (TRAINING_VIEWS as readonly string[]).includes(raw ?? '') ? (raw as TrainingView) : 'matrix'
}

/** The address of a view, with any extra query values (empty values are left out). */
export function trainingViewHref(view: TrainingView, extra: Record<string, string | number | null | undefined> = {}): string {
  const params = new URLSearchParams()
  if (view !== 'matrix') params.set('view', view)
  for (const [key, value] of Object.entries(extra)) {
    if (value !== null && value !== undefined && value !== '') params.set(key, String(value))
  }
  const query = params.toString()
  return query ? `${TRAINING_PAGE_PATH}?${query}` : TRAINING_PAGE_PATH
}

/** The record page of one course. */
export function trainingCourseHref(slug: string): string {
  return `${TRAINING_PAGE_PATH}/courses/${encodeURIComponent(slug)}`
}

/** The preview player for one version of a course. */
export function trainingPreviewHref(slug: string, versionId: string): string {
  return `${trainingCourseHref(slug)}/preview?version=${encodeURIComponent(versionId)}`
}

/** The back button on a course's page and its preview's parent: the Courses view. */
export const COURSE_BACK_BUTTON = { label: 'Back to Training', href: `${TRAINING_PAGE_PATH}?view=courses` }

/** An employee's record, opened on its Training tab. */
export function employeeTrainingHref(employeeId: string): string {
  return `/employees/${encodeURIComponent(employeeId)}?tab=training`
}
