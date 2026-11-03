import { formatDateInLondon } from '@/lib/dateUtils'

/**
 * What a training document says to the person confirming it, and what its completed email says.
 *
 * A training document carries what it is about in `signing_documents.context.training`, written
 * once when the document is made (src/lib/training/signing.ts). The words a signer agrees to are
 * rebuilt from that stored context every time they are shown or checked, so the screen, the
 * check on the server and the signing record always say the same thing.
 *
 * Pure: no server imports, so the kind registry that uses it stays safe in the browser.
 */

/** `signing_documents.context.training`. Snake case, like the rest of the stored context. */
export interface TrainingSigningContext {
  assignment_id: string
  course_id: string
  course_slug: string
  course_title: string
  /** "1.0". Null for a practical course with no published version. */
  version_label: string | null
  certificate_number: string | null
  cycle: number
  /** The learner, by the name on their record when the document was made. */
  learner_name: string
  /** Practical sign-off only: the manager who watched, and the London date they watched. */
  manager_name?: string | null
  observed_on?: string | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** The training context on a document, or null when it has none (or not enough of one). */
export function readTrainingSigningContext(context: Record<string, unknown> | null | undefined): TrainingSigningContext | null {
  const raw = context?.training
  if (!raw || typeof raw !== 'object') return null
  const training = raw as Record<string, unknown>
  const assignmentId = text(training.assignment_id)
  const courseTitle = text(training.course_title)
  const learnerName = text(training.learner_name)
  if (!assignmentId || !courseTitle || !learnerName) return null
  return {
    assignment_id: assignmentId,
    course_id: text(training.course_id) ?? '',
    course_slug: text(training.course_slug) ?? '',
    course_title: courseTitle,
    version_label: text(training.version_label),
    certificate_number: text(training.certificate_number),
    cycle: typeof training.cycle === 'number' && Number.isFinite(training.cycle) ? training.cycle : 1,
    learner_name: learnerName,
    manager_name: text(training.manager_name),
    observed_on: text(training.observed_on),
  }
}

/** "3 November 2026" for a London date (YYYY-MM-DD). */
export function trainingDateText(isoDate: string): string {
  return formatDateInLondon(isoDate, { day: 'numeric', month: 'long', year: 'numeric' })
}

/** "Essentials, version 1.0", or the course title alone when there is no version. */
function trainingCourseVersionText(training: Pick<TrainingSigningContext, 'course_title' | 'version_label'>): string {
  return training.version_label ? `${training.course_title}, version ${training.version_label}` : training.course_title
}

export interface SigningWordingInput {
  title: string
  context: Record<string, unknown>
}

/** A finished online course. Null without a training context: the standard words are used. */
export function trainingCompletionWording(input: SigningWordingInput): string | null {
  const training = readTrainingSigningContext(input.context)
  if (!training) return null
  return `I confirm that I have read and understood "${trainingCourseVersionText(training)}" and will follow it at work.`
}

/** The learner's words on a practical sign-off. */
export function trainingSignoffWording(input: SigningWordingInput): string | null {
  const training = readTrainingSigningContext(input.context)
  if (!training?.manager_name || !training.observed_on) return null
  return `I confirm that ${training.manager_name} watched me do these tasks on ${trainingDateText(training.observed_on)} and that I will do them the same way at work.`
}

/** The manager's words on a practical sign-off, recorded as they sign for the business. */
export function trainingSignoffCompanyWording(input: SigningWordingInput): string | null {
  const training = readTrainingSigningContext(input.context)
  if (!training?.observed_on) return null
  return `I watched ${training.learner_name} do the tasks listed in "${input.title}" on ${trainingDateText(training.observed_on)}, and they did them safely. Signed for the business.`
}

export interface SigningCompletedEmailWording {
  subject: (title: string) => string
  /** The line after the greeting. */
  done: (title: string) => string
  /** What is attached, and what to do with it. */
  attached: string
}

export const TRAINING_CERTIFICATE_EMAIL: SigningCompletedEmailWording = {
  subject: (title) => `Your training certificate: ${title}`,
  done: (title) => `Well done. You have finished and confirmed "${title}".`,
  attached:
    'Your certificate is attached. Its last page is the signing record, which shows when you confirmed it. Please keep it somewhere safe.',
}

export const TRAINING_SIGNOFF_EMAIL: SigningCompletedEmailWording = {
  subject: (title) => `Your signed copy: ${title}`,
  done: (title) => `Thank you. "${title}" is now signed by you and your manager.`,
  attached:
    'Your copy is attached. Its last page is the signing record, which shows who signed and when. Please keep it somewhere safe.',
}
