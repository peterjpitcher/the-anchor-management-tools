import { describe, expect, it } from 'vitest'
import { buildAgreedText, buildCompanyAgreedText } from '@/lib/signing/agreement-text'
import { buildSigningCompletedEmail } from '@/lib/signing/emails'
import {
  SIGNING_KIND_DEFAULTS,
  SIGNING_KIND_DEFINITIONS,
  findSigningKind,
  getSigningKind,
  isInPersonOnlyKind,
  signingKindOptions,
} from '@/lib/signing/kinds'
import { readTrainingSigningContext } from '@/lib/signing/training-wording'
import { SIGNING_KINDS, type SigningKind } from '@/lib/signing/types'

/**
 * The two training kinds (build contract section 4) and the per-kind options they brought in.
 * Every option defaults to what every kind did before, so the thirteen older kinds behave
 * exactly as they did.
 */

const TRAINING_KINDS: SigningKind[] = ['training_completion', 'training_signoff']
const OLDER_KINDS = SIGNING_KINDS.filter((kind) => !TRAINING_KINDS.includes(kind))

const TRAINING_CONTEXT = {
  training: {
    assignment_id: 'assignment-1',
    course_id: 'course-1',
    course_slug: 'essentials',
    course_title: 'Essentials',
    version_label: '1.0',
    certificate_number: 'AT-0123456789',
    cycle: 1,
    learner_name: 'Sam Example',
  },
}

const SIGNOFF_CONTEXT = {
  training: {
    ...TRAINING_CONTEXT.training,
    course_slug: 'cellar',
    course_title: 'Cellar and lines',
    manager_name: 'Billy Manager',
    observed_on: '2026-03-29',
  },
}

describe('per-kind options', () => {
  it('leaves every older kind on the old behaviour', () => {
    expect(OLDER_KINDS).toHaveLength(13)
    for (const kind of OLDER_KINDS) {
      expect(signingKindOptions(kind), kind).toEqual(SIGNING_KIND_DEFAULTS)
      const definition = SIGNING_KIND_DEFINITIONS[kind]
      expect(definition.agreementWording, kind).toBeUndefined()
      expect(definition.companyAgreementWording, kind).toBeUndefined()
      expect(definition.completedEmail, kind).toBeUndefined()
    }
    expect(SIGNING_KIND_DEFAULTS).toEqual({
      signingReminders: true,
      allowSendNewLink: true,
      linkExpiryDays: 30,
      notifySenderOnCompletion: 'sender',
      inPersonOnly: false,
    })
  })

  it('switches off the signing reminders and new links for both training kinds: the training chaser is the only one', () => {
    for (const kind of TRAINING_KINDS) {
      expect(signingKindOptions(kind).signingReminders, kind).toBe(false)
      expect(signingKindOptions(kind).allowSendNewLink, kind).toBe(false)
      expect(getSigningKind(kind).subjectType).toBe('employee')
      expect(getSigningKind(kind).signerRoles).toEqual(['worker'])
      expect(getSigningKind(kind).source).toBe('generator')
      expect(getSigningKind(kind).brand).toBe('staff')
    }
  })

  it('makes the certificate a confirmation the app sends by itself, telling the manager mailbox', () => {
    const certificate = getSigningKind('training_completion')
    expect(certificate.mode).toBe('acknowledge')
    expect(certificate.companySigns).toBe(false)
    expect(signingKindOptions('training_completion')).toMatchObject({
      inPersonOnly: false,
      notifySenderOnCompletion: 'sender_or_manager_mailbox',
    })
  })

  it('makes the practical sign-off signed by the manager for the business, and by the learner in person only', () => {
    const signoff = getSigningKind('training_signoff')
    expect(signoff.mode).toBe('sign')
    expect(signoff.companySigns).toBe(true)
    expect(signingKindOptions('training_signoff').inPersonOnly).toBe(true)
    expect(isInPersonOnlyKind('training_signoff')).toBe(true)
    for (const kind of [...OLDER_KINDS, 'training_completion']) expect(isInPersonOnlyKind(kind), kind).toBe(false)
  })

  it('is safe with a missing or unknown kind (old rows, test fixtures)', () => {
    expect(findSigningKind(undefined)).toBeNull()
    expect(findSigningKind(null)).toBeNull()
    expect(findSigningKind('not_a_kind')).toBeNull()
    expect(findSigningKind('toString')).toBeNull()
    expect(signingKindOptions('not_a_kind')).toEqual(SIGNING_KIND_DEFAULTS)
    expect(isInPersonOnlyKind(undefined)).toBe(false)
  })
})

describe('the words a signer agrees to', () => {
  it('names the course and its version on a training confirmation', () => {
    expect(
      buildAgreedText({ mode: 'acknowledge', title: 'Essentials training, version 1.0', kind: 'training_completion', context: TRAINING_CONTEXT })
    ).toBe('I confirm that I have read and understood "Essentials, version 1.0" and will follow it at work.')
  })

  it('names the manager and the London date on a practical sign-off, for both sides', () => {
    expect(buildAgreedText({ mode: 'sign', title: 'Cellar and lines sign-off', kind: 'training_signoff', context: SIGNOFF_CONTEXT })).toBe(
      'I confirm that Billy Manager watched me do these tasks on 29 March 2026 and that I will do them the same way at work.'
    )
    expect(buildCompanyAgreedText({ title: 'Cellar and lines sign-off', kind: 'training_signoff', context: SIGNOFF_CONTEXT })).toBe(
      'I watched Sam Example do the tasks listed in "Cellar and lines sign-off" on 29 March 2026, and they did them safely. Signed for the business.'
    )
  })

  it('falls back to the standard words when a training document has no training context', () => {
    expect(buildAgreedText({ mode: 'acknowledge', title: 'T', kind: 'training_completion', context: {} })).toBe(
      'I confirm that I have read and understood "T".'
    )
    expect(buildCompanyAgreedText({ title: 'T', kind: 'training_signoff', context: null })).toBe('Issued and signed for the business: "T".')
  })

  it('keeps the older kinds on the standard words, whatever context they carry', () => {
    for (const kind of OLDER_KINDS) {
      const { mode } = SIGNING_KIND_DEFINITIONS[kind]
      expect(buildAgreedText({ mode, title: 'Doc', kind, context: TRAINING_CONTEXT }), kind).toBe(buildAgreedText({ mode, title: 'Doc' }))
      expect(buildCompanyAgreedText({ title: 'Doc', kind, context: TRAINING_CONTEXT }), kind).toBe(buildCompanyAgreedText({ title: 'Doc' }))
    }
  })

  it('never prints undefined, Invalid Date or NaN', () => {
    const words = [
      buildAgreedText({ mode: 'acknowledge', title: 'Essentials training', kind: 'training_completion', context: TRAINING_CONTEXT }),
      buildAgreedText({ mode: 'sign', title: 'Cellar and lines sign-off', kind: 'training_signoff', context: SIGNOFF_CONTEXT }),
      buildCompanyAgreedText({ title: 'Cellar and lines sign-off', kind: 'training_signoff', context: SIGNOFF_CONTEXT }),
      buildAgreedText({
        mode: 'acknowledge',
        title: 'Essentials training',
        kind: 'training_completion',
        context: { training: { ...TRAINING_CONTEXT.training, version_label: null } },
      }),
    ]
    for (const text of words) expect(text).not.toMatch(/undefined|Invalid Date|NaN|null/)
  })

  it('reads the stored context strictly', () => {
    expect(readTrainingSigningContext(TRAINING_CONTEXT)?.assignment_id).toBe('assignment-1')
    expect(readTrainingSigningContext({ training: { ...TRAINING_CONTEXT.training, learner_name: ' ' } })).toBeNull()
    expect(readTrainingSigningContext({ training: 'nope' })).toBeNull()
    expect(readTrainingSigningContext(null)).toBeNull()
  })
})

describe('the email with the signed copy', () => {
  it('sends a certificate email for a training confirmation', () => {
    const email = buildSigningCompletedEmail({
      brand: 'staff',
      mode: 'acknowledge',
      recipientName: 'Sam Example',
      title: 'Essentials training, version 1.0',
      kind: 'training_completion',
    })
    expect(email.subject).toBe('Your training certificate: Essentials training, version 1.0')
    expect(email.text).toContain('Well done. You have finished and confirmed "Essentials training, version 1.0".')
    expect(email.text).toContain('Your certificate is attached.')
    expect(email.text).toContain('Hi Sam,')
    expect(`${email.subject}${email.text}${email.html}`).not.toMatch(/undefined|Invalid Date|NaN/)
  })

  it('sends a signed-copy email for a practical sign-off', () => {
    const email = buildSigningCompletedEmail({
      brand: 'staff',
      mode: 'sign',
      recipientName: 'Sam Example',
      title: 'Cellar and lines sign-off',
      kind: 'training_signoff',
    })
    expect(email.subject).toBe('Your signed copy: Cellar and lines sign-off')
    expect(email.text).toContain('is now signed by you and your manager')
    expect(email.html).toContain('Cellar and lines sign-off')
    expect(`${email.subject}${email.text}${email.html}`).not.toMatch(/undefined|Invalid Date|NaN/)
  })

  it('leaves the older kinds on the standard email', () => {
    for (const kind of OLDER_KINDS) {
      const { brand, mode } = SIGNING_KIND_DEFINITIONS[kind]
      const input = { brand, mode, recipientName: 'Sam Example', title: 'Doc' }
      expect(buildSigningCompletedEmail({ ...input, kind }), kind).toEqual(buildSigningCompletedEmail(input))
    }
  })
})
