import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The shared panel offers "Send New Link" only for kinds that are ever sent a link by email.
 * Training certificates are confirmed in the staff portal and practical sign-offs are signed in
 * person, so the server refuses a new link for both (signingKindOptions(kind).allowSendNewLink
 * is false). The panel must not offer a button that can only fail, nor tell staff a link was sent.
 */

vi.mock('@/app/actions/signing', () => ({
  sendSigningReminder: vi.fn(),
  startInPersonSigningAction: vi.fn(),
  voidSigningRequest: vi.fn(),
}))
vi.mock('@/ds/primitives/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { SignaturePanel } from '@/components/features/signing/SignaturePanel'
import { signingKindOptions } from '@/lib/signing/kinds'
import type { SigningDocumentSummary } from '@/lib/signing/service'
import type { SigningKind } from '@/lib/signing/types'

type Party = SigningDocumentSummary['parties'][number]

const NAME = 'Sam Smith'

function party(overrides: Partial<Party> = {}): Party {
  return {
    id: 'party-1',
    document_id: 'doc-1',
    role: 'worker',
    name: NAME,
    email: 'sam@example.test',
    status: 'pending',
    signed_at: null,
    method: null,
    decline_reason: null,
    first_opened_at: null,
    document_viewed_at: null,
    identity_check: 'none',
    identity_checked_at: null,
    identity_check_failures: 0,
    witnessed_by: null,
    ...overrides,
  } as unknown as Party
}

function signingDocument(kind: SigningKind, parties: Party[] = [party()]): SigningDocumentSummary {
  return {
    id: `doc-${kind}`,
    kind,
    title: `A ${kind.replace(/_/g, ' ')}`,
    version: 1,
    status: 'sent',
    sent_at: '2026-11-02T10:00:00.000Z',
    void_reason: null,
    parties,
  } as unknown as SigningDocumentSummary
}

function renderPanel(document: SigningDocumentSummary, canSend = true): HTMLElement {
  render(<SignaturePanel documents={[document]} canSend={canSend} />)
  return screen.getByText(document.title).closest('li') as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Send New Link on the signature panel', () => {
  it('is offered for a kind that is sent a link by email, such as the worker agreement', () => {
    expect(signingKindOptions('employment_agreement').allowSendNewLink).toBe(true)
    const row = renderPanel(signingDocument('employment_agreement'))

    expect(within(row).getByRole('button', { name: `Send New Link to ${NAME}` })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: `Sign in Person: ${NAME}` })).toBeInTheDocument()
    expect(within(row).getByText('Link sent, not yet opened')).toBeInTheDocument()
  })

  it.each(['training_completion', 'training_signoff'] as const)(
    'is not offered for %s, whose new links the server refuses, while Sign in Person still is',
    (kind) => {
      expect(signingKindOptions(kind).allowSendNewLink).toBe(false)
      const row = renderPanel(signingDocument(kind))

      expect(within(row).queryByRole('button', { name: /Send New Link/ })).toBeNull()
      expect(within(row).queryByText('Send New Link')).toBeNull()
      expect(within(row).getByRole('button', { name: `Sign in Person: ${NAME}` })).toBeInTheDocument()
      // No link was emailed for these, so the panel does not say one was.
      expect(within(row).queryByText('Link sent, not yet opened')).toBeNull()
    }
  )

  it('says where a training certificate is confirmed, and that a sign-off is signed in person', () => {
    const certificate = renderPanel(signingDocument('training_completion'))
    expect(within(certificate).getByText('Not yet confirmed: they confirm it in the staff portal, or sign in person')).toBeInTheDocument()
  })

  it('says a practical sign-off is signed in person', () => {
    const signoff = renderPanel(signingDocument('training_signoff'))
    expect(within(signoff).getByText('Not yet signed: sign in person')).toBeInTheDocument()
  })

  it('points a locked training confirmation at Sign in Person, not at a new link', () => {
    const locked = party({ identity_check: 'date_of_birth', identity_check_failures: 5 })
    const row = renderPanel(signingDocument('training_completion', [locked]))

    expect(within(row).getByText(/Locked after wrong dates of birth: sign in person/)).toBeInTheDocument()
    expect(within(row).queryByText(/send a new link/)).toBeNull()
  })

  it('still points a locked emailed document at a new link', () => {
    const locked = party({ identity_check: 'date_of_birth', identity_check_failures: 5 })
    const row = renderPanel(signingDocument('employment_agreement', [locked]))

    expect(within(row).getByText(/Locked after wrong dates of birth: send a new link/)).toBeInTheDocument()
  })

  it('offers nothing to someone who may not send', () => {
    const row = renderPanel(signingDocument('employment_agreement'), false)

    expect(within(row).queryByRole('button', { name: /Send New Link/ })).toBeNull()
    expect(within(row).queryByRole('button', { name: /Sign in Person/ })).toBeNull()
  })
})
