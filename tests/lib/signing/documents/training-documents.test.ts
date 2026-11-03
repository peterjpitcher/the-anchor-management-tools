import { describe, expect, it } from 'vitest'
import { STAFF } from '@/lib/brand/palette'
import {
  TRAINING_CERTIFICATE_SLOT,
  buildTrainingCertificateHtml,
  buildTrainingCertificateSource,
  trainingCertificateTitle,
  type TrainingCertificateInput,
} from '@/lib/signing/documents/training-certificate'
import { TRAINING_DISCLAIMER } from '@/lib/signing/documents/training-document'
import {
  SUPERVISED_ONLY_NOTICE,
  TRAINING_SIGNOFF_MANAGER_SLOT,
  TRAINING_SIGNOFF_WORKER_SLOT,
  buildTrainingSignoffHtml,
  buildTrainingSignoffSource,
  type TrainingSignoffInput,
} from '@/lib/signing/documents/training-signoff'
import { fillForSending } from '@/lib/signing/prepare'
import { findSignatureSlots } from '@/lib/signing/signature-slots'

/**
 * The two training documents, rendered with fixture data. Run under Europe/London (npm test) and
 * UTC (npm run test:utc): every date is a London calendar date, so both print the same day.
 */

const EM_DASH = String.fromCharCode(0x2014)

/** The page text without the inlined logo, whose base64 could hold any three letters. */
function visible(html: string): string {
  return html.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, 'LOGO')
}

function expectClean(html: string): void {
  const text = visible(html)
  expect(text).not.toMatch(/undefined|Invalid Date|NaN|\[object Object\]|>null</)
  expect(text.includes(EM_DASH)).toBe(false)
}

/** Owner decision, 3 November 2026: both directors sign jointly, under the issuer line. */
function expectJointSignatories(text: string): void {
  expect(text).toContain('Issued by <strong>Orange Jelly')
  expect(text).toContain('Signatories<br><strong>Peter Pitcher, Director</strong><br><strong>Billy Summers, Director</strong>')
  expect(text).not.toMatch(/Signatory<br>/)
  expect(text.indexOf('Issued by')).toBeLessThan(text.indexOf('Signatories'))
}

const CERTIFICATE: TrainingCertificateInput = {
  holderName: 'Sam Example',
  courseTitle: 'Essentials',
  versionLabel: '1.0',
  certificateNumber: 'AT-0123456789',
  // Both on the days the clocks change, where a date read as a UTC instant slips a day.
  completedOn: '2026-03-29',
  expiresOn: '2027-10-31',
  startedOn: '2026-03-27',
  contentSha256: 'a'.repeat(64),
  sections: [
    { title: 'Serving alcohol', checksTaken: 1, passedOn: '2026-03-27', passedFirstTime: true },
    { title: 'Food allergies', checksTaken: 3, passedOn: '2026-03-29', passedFirstTime: false },
  ],
}

const SIGNOFF: TrainingSignoffInput = {
  holderName: 'Sam Example',
  courseTitle: 'Cellar and lines',
  versionLabel: '1.2',
  managerName: 'Billy Manager',
  observedOn: '2026-10-25',
  tasks: [
    { key: 'change-keg', text: 'Change a keg safely' },
    { key: 'clean-lines', text: 'Clean the beer lines' },
  ],
  supervisedOnly: false,
  expiresOn: null,
  certificateNumber: 'AT-ABCDEFGHJK',
}

describe('the training certificate pack', () => {
  it('prints the certificate and the training record from the stored result', () => {
    const html = buildTrainingCertificateHtml(CERTIFICATE)
    const text = visible(html)
    expect(text).toContain('Certificate of training')
    expect(text).toContain('Sam Example')
    expect(text).toContain('Essentials')
    expect(text).toContain('Version 1.0')
    expect(text).toContain('All sections passed on 29 March 2026')
    expect(text).toContain('<th>Refresher</th><td>Due by 31 October 2027</td>')
    expect(text).toContain('Confirmed electronically: the signing record is the last page.')
    expect(text).toContain('AT-0123456789')
    expect(text).toContain('Training record')
    expect(text).toContain('Started')
    expect(text).toContain('27 March 2026')
    expect(text).toContain('Food allergies')
    expect(text).toContain('a'.repeat(64))
    expect(text).toContain(TRAINING_DISCLAIMER)
    expect(text).toContain('Orange Jelly')
    expect(text).toContain('The Anchor, Stanwell Moor')
    // Orange Jelly palette and wordmark: staff documents are Orange Jelly documents.
    expect(html).toContain(STAFF.primary)
    expect(html).toContain('data:image/png;base64,')
    expectJointSignatories(text)
    expectClean(html)
  })

  it('has one confirmation box, for the learner, and the page break after the certificate', () => {
    const source = buildTrainingCertificateSource(CERTIFICATE)
    expect(source.profile).toBe('a4_margins')
    expect(source.slots).toEqual({ [TRAINING_CERTIFICATE_SLOT]: 'worker' })
    expect(findSignatureSlots(source.html)).toEqual([TRAINING_CERTIFICATE_SLOT])
    expect(source.html).toContain('page-break')

    const sent = fillForSending({ source, mode: 'acknowledge', parties: [{ role: 'worker', name: 'Sam Example' }] })
    expect(findSignatureSlots(sent)).toEqual([])
    expect(sent).toContain('To be confirmed electronically')
    expectClean(sent)
  })

  it('says so when there is no refresher, no version and nothing optional', () => {
    const html = buildTrainingCertificateHtml({
      ...CERTIFICATE,
      versionLabel: null,
      expiresOn: null,
      startedOn: null,
      contentSha256: null,
    })
    const text = visible(html)
    expect(text).toContain('No refresher')
    expect(text).toContain('Not numbered')
    expect(text).not.toContain('Version ')
    expect(text).not.toContain('Started')
    expectClean(html)
  })

  it('prints a section not yet passed plainly, never a blank or a bad date', () => {
    const html = buildTrainingCertificateHtml({
      ...CERTIFICATE,
      sections: [{ title: 'Serving alcohol', checksTaken: 0, passedOn: null, passedFirstTime: false }],
    })
    expect(visible(html)).toContain('Not passed')
    expectClean(html)
  })

  it('escapes what people typed', () => {
    const html = buildTrainingCertificateHtml({ ...CERTIFICATE, holderName: 'Sam <b>Example</b> & Co' })
    expect(html).toContain('Sam &lt;b&gt;Example&lt;/b&gt; &amp; Co')
    expect(html).not.toContain('<b>Example</b>')
  })

  it('refuses to make a certificate with a blank or a bad date in it', () => {
    expect(() => buildTrainingCertificateHtml({ ...CERTIFICATE, holderName: '  ' })).toThrow(/name is missing/)
    expect(() => buildTrainingCertificateHtml({ ...CERTIFICATE, certificateNumber: '' })).toThrow(/certificate number is missing/)
    expect(() => buildTrainingCertificateHtml({ ...CERTIFICATE, completedOn: '2026-02-30' })).toThrow(/not a date/)
    expect(() => buildTrainingCertificateHtml({ ...CERTIFICATE, expiresOn: 'soon' })).toThrow(/not a date/)
    expect(() => buildTrainingCertificateHtml({ ...CERTIFICATE, sections: [] })).toThrow(/no sections/)
    expect(() =>
      buildTrainingCertificateHtml({
        ...CERTIFICATE,
        sections: [{ title: 'X', checksTaken: Number.NaN, passedOn: null, passedFirstTime: false }],
      })
    ).toThrow(/not a count/)
  })

  it('titles the document by course and version', () => {
    expect(trainingCertificateTitle('Essentials', '1.0')).toBe('Essentials training, version 1.0')
    expect(trainingCertificateTitle('Essentials', null)).toBe('Essentials training')
  })
})

describe('the practical sign-off', () => {
  it('prints who watched, when, and the tasks in order', () => {
    const html = buildTrainingSignoffHtml(SIGNOFF)
    const text = visible(html)
    expect(text).toContain('Practical sign-off')
    expect(text).toContain('Watched in person by Billy Manager on 25 October 2026')
    expect(text.indexOf('Change a keg safely')).toBeLessThan(text.indexOf('Clean the beer lines'))
    expect(text).toContain('No refresher')
    expect(text).toContain('AT-ABCDEFGHJK')
    expect(text).toContain('Version 1.2')
    expect(text).toContain(TRAINING_DISCLAIMER)
    expect(text).not.toContain(SUPERVISED_ONLY_NOTICE)
    expectJointSignatories(text)
    expectClean(html)
  })

  it('marks an under 18 signed off on a supervised-only course', () => {
    const html = buildTrainingSignoffHtml({ ...SIGNOFF, supervisedOnly: true, expiresOn: '2027-10-25' })
    expect(visible(html)).toContain(SUPERVISED_ONLY_NOTICE)
    expect(visible(html)).toContain('<th>Refresher</th><td>Due by 25 October 2027</td>')
    expect(visible(html)).toContain('Signed electronically: the signing record is the last page.')
    expectClean(html)
  })

  it('has the manager box filled as it is sent and the learner box waiting', () => {
    const source = buildTrainingSignoffSource(SIGNOFF)
    expect(source.profile).toBe('a4_margins')
    expect(source.slots).toEqual({ [TRAINING_SIGNOFF_MANAGER_SLOT]: 'company', [TRAINING_SIGNOFF_WORKER_SLOT]: 'worker' })
    expect(findSignatureSlots(source.html).sort()).toEqual([TRAINING_SIGNOFF_MANAGER_SLOT, TRAINING_SIGNOFF_WORKER_SLOT].sort())

    const sent = fillForSending({
      source,
      mode: 'sign',
      parties: [{ role: 'worker', name: 'Sam Example' }],
      sender: { name: 'Billy Manager' },
    })
    expect(findSignatureSlots(sent)).toEqual([])
    expect(sent).toContain('Signed electronically')
    expect(sent).toContain('To be signed electronically')
    expectClean(sent)
  })

  it('refuses a sign-off with no tasks, a blank task or a bad date', () => {
    expect(() => buildTrainingSignoffHtml({ ...SIGNOFF, tasks: [] })).toThrow(/no tasks/)
    expect(() => buildTrainingSignoffHtml({ ...SIGNOFF, tasks: [{ key: 'x', text: ' ' }] })).toThrow(/wording of task "x"/)
    expect(() => buildTrainingSignoffHtml({ ...SIGNOFF, observedOn: '25/10/2026' })).toThrow(/not a date/)
    expect(() => buildTrainingSignoffHtml({ ...SIGNOFF, managerName: '' })).toThrow(/manager's name is missing/)
  })
})
