import { SIGNING_OPEN_STATUSES } from '@/lib/signing/types'
import type { EmployeeAssignmentItem, PracticalTask, TrainingAssignmentStatus } from '@/lib/training/types'

/** The manager actions one training item can offer on the employee record. */
export type ItemAction =
  | 'extend'
  | 'waive'
  | 'unlock'
  | 'prepare_again'
  | 'record_signoff'
  | 'sign_in_person'
  | 'record_external'

const OPEN: readonly TrainingAssignmentStatus[] = [
  'waiting',
  'assigned',
  'in_progress',
  'locked',
  'awaiting_confirmation',
  'declined',
]

/**
 * How an item waiting for confirmation stands with its signing document. `lapsed`: the document
 * ran out (the 30-day expiry) or was withdrawn on the Signing tab, so no hook will ever move the
 * item on and it needs a new document. `open`: the learner can still confirm it. Null when the
 * item is not waiting for confirmation, or has no document yet.
 */
export function confirmationStanding(item: EmployeeAssignmentItem): 'lapsed' | 'open' | null {
  if (item.assignment.status !== 'awaiting_confirmation' || !item.certificate) return null
  const { status } = item.certificate
  if (status === 'expired' || status === 'voided') return 'lapsed'
  return SIGNING_OPEN_STATUSES.includes(status) ? 'open' : null
}

/**
 * Which actions to show for an item, from its stored status, course kind and the state of its
 * signing document. The server checks each one again; this only decides which buttons appear.
 */
export function itemActions(item: EmployeeAssignmentItem): ItemAction[] {
  const { status, signingDocumentId } = item.assignment
  if (!OPEN.includes(status)) return []
  const actions: ItemAction[] = []
  const kind = item.course.kind
  const standing = confirmationStanding(item)

  if (kind === 'online') {
    if (status === 'locked') actions.push('unlock')
    if (status === 'declined' || (status === 'awaiting_confirmation' && (!signingDocumentId || standing === 'lapsed'))) {
      actions.push('prepare_again')
    }
  }
  if (kind === 'practical') {
    if (status === 'assigned' || status === 'in_progress' || status === 'declined' || standing === 'lapsed') {
      actions.push('record_signoff')
    }
    // The in-person link lasts 30 minutes; while the document is open, a new one can be made.
    if (standing === 'open') actions.push('sign_in_person')
  }
  if (kind === 'external' && status !== 'awaiting_confirmation') actions.push('record_external')

  // Moving the due date only means something while the person still has work to do.
  if (status !== 'waiting' && status !== 'awaiting_confirmation') actions.push('extend')
  actions.push('waive')
  return actions
}

/**
 * The tasks a practical sign-off covers, in course order. Empty when they could not be read (no
 * published version), and the sign-off dialog then says the task list could not be loaded.
 */
export function practicalTasksOf(item: EmployeeAssignmentItem): PracticalTask[] {
  return item.tasks ?? []
}
