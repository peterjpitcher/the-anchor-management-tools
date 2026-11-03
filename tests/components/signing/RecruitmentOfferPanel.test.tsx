// The written job offer panel: what staff are told after sending the offer.
//
// Every failed link email showed 'Offer created, but the email failed. Use "Send new link"',
// even when the email may have reached the candidate: a new link cancels the one they may be
// holding. An email we did not hear back about is now a warning to check with them first.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PartyDelivery } from '@/lib/signing/service'

const mocks = vi.hoisted(() => ({
  getDocuments: vi.fn(),
  sendOffer: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/app/actions/signing', () => ({
  getSigningDocumentsForSubject: mocks.getDocuments,
  // The panel's shared actions (chase, withdraw, sign in person) are server actions too.
  sendSigningReminder: vi.fn(),
  startInPersonSigningAction: vi.fn(),
  voidSigningRequest: vi.fn(),
}))
vi.mock('@/app/actions/signing-recruitment', () => ({ sendJobOffer: mocks.sendOffer }))
vi.mock('@/ds/primitives/Toast', () => ({ toast: mocks.toast }))

import { RecruitmentOfferPanel } from '@/components/features/signing/RecruitmentOfferPanel'

const APPLICATION = '66666666-6666-4666-8666-666666666666'

function sentWith(delivery: Partial<PartyDelivery>): void {
  mocks.sendOffer.mockResolvedValue({
    success: true,
    data: {
      documentId: 'doc-offer',
      deliveries: [{ partyId: 'p1', name: 'Casey Candidate', email: 'casey@example.com', email_status: 'sent', ...delivery }],
    },
  })
}

async function sendOffer(): Promise<void> {
  const user = userEvent.setup()
  render(<RecruitmentOfferPanel applicationId={APPLICATION} candidateName="Casey Candidate" canSendNow canSend />)
  await user.click(await screen.findByRole('button', { name: 'Send Written Offer' }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'Send Offer' }))
  await waitFor(() => expect(mocks.sendOffer).toHaveBeenCalled())
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getDocuments.mockResolvedValue({ success: true, data: [] })
})

describe('after sending the written offer', () => {
  it('says it was sent when the email went', async () => {
    sentWith({})
    await sendOffer()

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Offer sent to Casey Candidate.'))
    expect(mocks.toast.warning).not.toHaveBeenCalled()
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('warns that an email we did not hear back about may have reached them', async () => {
    sentWith({ email_status: 'failed', error: 'Request timed out', uncertain: true })
    await sendOffer()

    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith(
      'Offer created, but we could not confirm the email to Casey Candidate went. It may have reached them, so check with them before sending a new link.',
    ))
    expect(mocks.toast.error).not.toHaveBeenCalled()
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it('calls it not sent only when the provider definitely refused it', async () => {
    sentWith({ email_status: 'failed', error: '550 mailbox unavailable', uncertain: false })
    await sendOffer()

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(
      'Offer created, but the email to Casey Candidate was not sent. Use "Send New Link" or "Sign in Person".',
    ))
    expect(mocks.toast.warning).not.toHaveBeenCalled()
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(JSON.stringify(mocks.toast.error.mock.calls)).not.toContain('550')
  })

  it('says to check the address when it has bounced before', async () => {
    sentWith({ email_status: 'failed', code: 'recipient_suppressed', uncertain: false })
    await sendOffer()

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(
      'Offer created, but the email to Casey Candidate was not sent because their address has bounced before. Check the address on their record, or use "Sign in Person".',
    ))
  })

  it('says email is switched off', async () => {
    sentWith({ email_status: 'failed', code: 'email_suspended', uncertain: false })
    await sendOffer()

    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith(
      'Offer created, but email is switched off, so no link was emailed to Casey Candidate. Use "Sign in Person".',
    ))
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })
})
