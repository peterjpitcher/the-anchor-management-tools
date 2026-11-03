import { describe, expect, it } from 'vitest'
import type { SigningPartyContext } from '@/lib/signing/service'
import { buildSigningViewModel } from '@/lib/signing/view-model'

/**
 * A practical sign-off is signed only in person. Opened from the staff portal it shows why,
 * instead of a form the portal endpoints would refuse. On the manager's device (a /sign link,
 * which has an identity endpoint) it is the normal form, with the training words.
 */

const FUTURE = '2099-01-01T09:00:00.000Z'

function context(kind: string, mode: 'sign' | 'acknowledge', training: Record<string, unknown>): SigningPartyContext {
  // Cast: only the fields the view model reads are given.
  return {
    party: { id: 'party-1', name: 'Sam Example', status: 'pending', witnessed_by: null, document_viewed_at: null, token_expires_at: FUTURE },
    document: { id: 'doc-1', kind, mode, brand: 'staff', title: 'Cellar and lines sign-off', summary: 'Check the list, then sign.', expires_at: FUTURE, context: { training } },
  } as unknown as SigningPartyContext
}

const TRAINING = {
  assignment_id: 'assignment-1',
  course_title: 'Cellar and lines',
  learner_name: 'Sam Example',
  manager_name: 'Billy Manager',
  observed_on: '2026-10-25',
}

const PORTAL = { document: '/api/portal/signing/party-1/document', sign: '/api/portal/signing/party-1/sign', decline: '/api/portal/signing/party-1/decline' }
const LINK = { document: '/api/sign/t/document', identity: '/api/sign/t/identity', sign: '/api/sign/t/sign', decline: '/api/sign/t/decline' }

describe('the signing screen for training documents', () => {
  it('blocks a sign-off opened in the staff portal, with the reason', () => {
    const model = buildSigningViewModel({ context: context('training_signoff', 'sign', TRAINING), state: 'ready', otherParties: [], endpoints: PORTAL })
    expect(model.initialPhase).toBe('blocked')
    expect(model.blockedMessage).toBe('You sign this in person, on the phone or tablet your manager gives you.')
    expect(model.summary).toBeNull()
  })

  it('shows the form on the manager device, with the learner words', () => {
    const model = buildSigningViewModel({ context: context('training_signoff', 'sign', TRAINING), state: 'ready', otherParties: [], endpoints: LINK })
    expect(model.initialPhase).toBe('form')
    expect(model.blockedMessage).toBeNull()
    expect(model.agreedText).toBe('I confirm that Billy Manager watched me do these tasks on 25 October 2026 and that I will do them the same way at work.')
  })

  it('still shows a signed sign-off as signed in the portal', () => {
    const model = buildSigningViewModel({ context: context('training_signoff', 'sign', TRAINING), state: 'signed', otherParties: [], endpoints: PORTAL })
    expect(model.initialPhase).toBe('signed')
  })

  it('lets a training certificate be confirmed in the portal', () => {
    const model = buildSigningViewModel({
      context: context('training_completion', 'acknowledge', { ...TRAINING, course_title: 'Essentials', version_label: '1.0' }),
      state: 'ready',
      otherParties: [],
      endpoints: PORTAL,
    })
    expect(model.initialPhase).toBe('form')
    expect(model.agreedText).toBe('I confirm that I have read and understood "Essentials, version 1.0" and will follow it at work.')
  })
})
