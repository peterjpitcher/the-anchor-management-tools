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
 * The certificate pack for a finished online course (kind `training_completion`): page 1 is the
 * certificate, page 2 the training record. The signing feature adds the signing record as the
 * last page, as it does for every document.
 *
 * This is the placeholder design, used until the owner's certificate design arrives: Orange Jelly
 * palette and wordmark, The Anchor named as the workplace. The confirmation box is a signature
 * slot: "To be confirmed electronically" on the copy the learner opens, and their name with the
 * date and time they confirmed on the signed copy.
 *
 * Everything printed is worked out before the pack is made (completion date, refresher date and
 * certificate number are stored on the training item first), so the certificate and the record
 * always agree.
 */

export const TRAINING_CERTIFICATE_SLOT = 'training-certificate:worker'

export interface TrainingRecordSection {
  title: string
  /** Checks submitted for this section in this cycle. */
  checksTaken: number
  /** London date the section's check was passed. */
  passedOn: string | null
  /** True when the first check taken was passed. */
  passedFirstTime: boolean
}

export interface TrainingCertificateInput {
  holderName: string
  courseTitle: string
  /** "1.0". */
  versionLabel: string | null
  certificateNumber: string
  /** London date the last section was passed. */
  completedOn: string
  /** London date the refresher is due by, or null when the course has no refresher. */
  expiresOn: string | null
  /** London date they started this cycle. */
  startedOn?: string | null
  /** SHA-256 of the published course content they took. */
  contentSha256?: string | null
  sections: TrainingRecordSection[]
}

export function trainingCertificateTitle(courseTitle: string, versionLabel: string | null): string {
  return versionLabel ? `${courseTitle} training, version ${versionLabel}` : `${courseTitle} training`
}

function count(value: number, what: string): string {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Training document: ${what} is not a count (${value})`)
  return String(value)
}

export function buildTrainingCertificateHtml(input: TrainingCertificateInput): string {
  const holder = required(input.holderName, 'the holder\'s name')
  const course = required(input.courseTitle, 'the course title')
  const number = required(input.certificateNumber, 'the certificate number')
  const passedOn = printDate(input.completedOn, 'the date every section was passed')
  const refresher = refresherText(input.expiresOn)
  const version = input.versionLabel ? `Version ${input.versionLabel}` : null
  if (input.sections.length === 0) throw new Error('Training document: the course has no sections')
  const title = trainingCertificateTitle(course, input.versionLabel)

  const certificate = `<div class="sheet page-break">
    ${brandMark()}
    <p class="kicker">Certificate of training</p>
    <p class="lead">This is to confirm that</p>
    <p class="holder">${esc(holder)}</p>
    <p class="lead">has completed</p>
    <p class="course">${esc(course)}</p>
    ${version ? `<p class="version">${esc(version)}</p>` : ''}
    <p class="how">An online course, taken in the staff portal, for work at ${esc(TRAINING_WORKPLACE)}.</p>
    <table class="facts">
      <tr><th>Result</th><td>All sections passed on ${esc(passedOn)}</td></tr>
      <tr><th>Refresher</th><td>${esc(refresher)}</td></tr>
      <tr><th>Certificate number</th><td>${esc(number)}</td></tr>
    </table>
    <div class="slots single">
      <div class="slot">
        <p class="slot-h">Confirmed by ${esc(holder)}</p>
        ${signatureSlot(TRAINING_CERTIFICATE_SLOT)}
      </div>
    </div>
    ${issuerBlock()}
    <p class="disclaimer">${esc(TRAINING_DISCLAIMER)}</p>
  </div>`

  const rows = input.sections
    .map((section, index) => {
      const checks = count(section.checksTaken, `checks taken for "${section.title}"`)
      const passed = section.passedOn ? printDate(section.passedOn, `the pass date for "${section.title}"`) : 'Not passed'
      const first = section.passedOn ? (section.passedFirstTime ? 'Yes' : 'No') : 'No'
      return `<tr><td>${index + 1}</td><td>${esc(required(section.title, 'a section title'))}</td><td>${checks}</td><td>${first}</td><td>${esc(passed)}</td></tr>`
    })
    .join('\n        ')

  const facts = [
    ['Name', holder],
    ['Course', course],
    ['Version', input.versionLabel ?? 'Not numbered'],
    ['Certificate number', number],
    ...(input.startedOn ? [['Started', printDate(input.startedOn, 'the start date')]] : []),
    ['All sections passed', passedOn],
    ['Refresher', refresher],
    ...(input.contentSha256 ? [['Course content fingerprint (SHA-256)', input.contentSha256]] : []),
  ]

  const record = `<div>
    <h1>Training record</h1>
    <p class="sub">${esc(title)}, for ${esc(holder)}</p>
    <table class="facts">
      ${facts.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join('\n      ')}
    </table>
    <h2>Sections</h2>
    <table class="record">
      <thead><tr><th>#</th><th>Section</th><th>Checks taken</th><th>Passed first time</th><th>Passed on</th></tr></thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    <p class="sub" style="margin-top:4mm">Each section ends with a short check. A section is passed when every key question is right and no more than one answer is wrong. A failed check sends the learner back through that section first.</p>
    ${companyFooter(number)}
  </div>`

  return wrapTrainingDocument(title, `${certificate}\n${record}`)
}

/** The certificate pack as createSigningRequest needs it: the learner confirms in its one slot. */
export function buildTrainingCertificateSource(input: TrainingCertificateInput): SigningDocumentSource {
  return {
    html: buildTrainingCertificateHtml(input),
    profile: 'a4_margins',
    slots: { [TRAINING_CERTIFICATE_SLOT]: 'worker' },
  }
}
