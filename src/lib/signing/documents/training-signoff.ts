import type { SigningDocumentSource } from '../prepare'
import { signatureSlot } from '../signature-slots'
import {
  TRAINING_DISCLAIMER,
  TRAINING_WORKPLACE,
  brandMark,
  companyFooter,
  esc,
  issuerBlock,
  printDate,
  refresherText,
  required,
  wrapTrainingDocument,
} from './training-document'

/**
 * The practical sign-off (kind `training_signoff`): a manager watched someone do a list of tasks
 * and signs for the business as they record it; the person then confirms on the manager's phone
 * or tablet. One page, flowing on to a second when the task list is long. The signing feature
 * adds the signing record as the last page.
 *
 * The manager's box is filled with their name as the document is sent (they sign as they record
 * it); the learner's box reads "To be signed electronically" until they sign in person.
 */

export const TRAINING_SIGNOFF_MANAGER_SLOT = 'training-signoff:manager'
export const TRAINING_SIGNOFF_WORKER_SLOT = 'training-signoff:worker'

/** Printed when someone under 18 is signed off on a course that limits them to supervised work. */
export const SUPERVISED_ONLY_NOTICE =
  'Supervised only: they were under 18 on this date, so they do these tasks only while supervised.'

export interface TrainingSignoffInput {
  holderName: string
  courseTitle: string
  /** "1.0". */
  versionLabel: string | null
  /** The manager who watched and signs for the business. */
  managerName: string
  managerPosition?: string | null
  /** London date the tasks were watched. */
  observedOn: string
  /** Each task watched, with its wording from the course at the time. */
  tasks: Array<{ key: string; text: string }>
  supervisedOnly: boolean
  /** London date the refresher is due by, or null when the course has no refresher. */
  expiresOn: string | null
  certificateNumber: string
}

export function trainingSignoffTitle(courseTitle: string): string {
  return `${courseTitle} sign-off`
}

export function buildTrainingSignoffHtml(input: TrainingSignoffInput): string {
  const holder = required(input.holderName, 'the holder\'s name')
  const course = required(input.courseTitle, 'the course title')
  const manager = required(input.managerName, 'the manager\'s name')
  const number = required(input.certificateNumber, 'the certificate number')
  const observedOn = printDate(input.observedOn, 'the date the tasks were watched')
  const refresher = refresherText(input.expiresOn)
  if (input.tasks.length === 0) throw new Error('Training document: there are no tasks to sign off')
  const tasks = input.tasks.map((task) => `<li>${esc(required(task.text, `the wording of task "${task.key}"`))}</li>`)
  const title = trainingSignoffTitle(course)
  const managerLine = input.managerPosition?.trim() ? `${manager}, ${input.managerPosition.trim()}` : manager

  const body = `<div class="sheet">
    ${brandMark()}
    <p class="kicker">Practical sign-off</p>
    <p class="holder">${esc(holder)}</p>
    <p class="course">${esc(course)}</p>
    ${input.versionLabel ? `<p class="version">${esc(`Version ${input.versionLabel}`)}</p>` : ''}
    <p class="how">Watched in person by ${esc(managerLine)} on ${esc(observedOn)}, at ${esc(TRAINING_WORKPLACE)}.</p>
    ${input.supervisedOnly ? `<p class="notice">${esc(SUPERVISED_ONLY_NOTICE)}</p>` : ''}
    <h2>Tasks they did</h2>
    <ol class="tasks">
      ${tasks.join('\n      ')}
    </ol>
    <table class="facts">
      <tr><th>Refresher</th><td>${esc(refresher)}</td></tr>
      <tr><th>Certificate number</th><td>${esc(number)}</td></tr>
    </table>
    <div class="slots">
      <div class="slot">
        <p class="slot-h">Signed for the business</p>
        ${signatureSlot(TRAINING_SIGNOFF_MANAGER_SLOT)}
      </div>
      <div class="slot">
        <p class="slot-h">Confirmed by ${esc(holder)}</p>
        ${signatureSlot(TRAINING_SIGNOFF_WORKER_SLOT)}
      </div>
    </div>
    ${issuerBlock()}
    <p class="disclaimer">${esc(TRAINING_DISCLAIMER)}</p>
    ${companyFooter(number, 'Signed')}
  </div>`

  return wrapTrainingDocument(title, body)
}

/** The sign-off as createSigningRequest needs it: the manager's slot and the learner's. */
export function buildTrainingSignoffSource(input: TrainingSignoffInput): SigningDocumentSource {
  return {
    html: buildTrainingSignoffHtml(input),
    profile: 'a4_margins',
    slots: { [TRAINING_SIGNOFF_MANAGER_SLOT]: 'company', [TRAINING_SIGNOFF_WORKER_SLOT]: 'worker' },
  }
}
