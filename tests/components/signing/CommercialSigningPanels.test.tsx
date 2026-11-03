// The commercial signing panels: what staff are told after sending a quote for acceptance, a
// client agreement or a supplier confirmation.
//
// Every failed link email showed 'Created, but the email failed. Use "Send new link"', even when
// the email may have reached the client: a new link cancels the one they may be holding. An
// email we did not hear back about is now a warning to check with them first.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PartyDelivery } from '@/lib/signing/service'

const mocks = vi.hoisted(() => ({
  getDocuments: vi.fn(),
  sendQuote: vi.fn(),
  sendAgreement: vi.fn(),
  getSupplierState: vi.fn(),
  sendSupplier: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/app/actions/signing', () => ({
  getSigningDocumentsForSubject: mocks.getDocuments,
  // The panel's shared actions (chase, withdraw, sign in person) are server actions too.
  sendSigningReminder: vi.fn(),
  startInPersonSigningAction: vi.fn(),
  voidSigningRequest: vi.fn(),
}))
vi.mock('@/app/actions/signing-commercial', () => ({
  getBookingSupplierState: mocks.getSupplierState,
  sendClientAgreement: mocks.sendAgreement,
  sendQuoteForAcceptance: mocks.sendQuote,
  sendSupplierConfirmation: mocks.sendSupplier,
}))
vi.mock('@/ds/primitives/Toast', () => ({ toast: mocks.toast }))

import { BookingSuppliersPanel, ClientAgreementPanel, QuoteSigningPanel } from '@/components/features/signing/CommercialSigningPanels'

const QUOTE = '44444444-4444-4444-8444-444444444444'
const VENDOR = '55555555-5555-4555-8555-555555555555'
const BOOKING = '66666666-6666-4666-8666-666666666666'

function sent(action: ReturnType<typeof vi.fn>, delivery: Partial<PartyDelivery>): void {
  action.mockResolvedValue({
    success: true,
    data: {
      documentId: 'doc-1',
      deliveries: [{ partyId: 'p1', name: 'Jo Client', email: 'jo@example.com', email_status: 'sent', ...delivery }],
    },
  })
}

async function sendQuote(): Promise<void> {
  const user = userEvent.setup()
  render(<QuoteSigningPanel quoteId={QUOTE} quoteNumber="Q-101" canSendNow canSend defaultSignerName="Jo Client" defaultSignerEmail="jo@example.com" />)
  await user.click(await screen.findByRole('button', { name: 'Send for Acceptance' }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'Send for Acceptance' }))
  await waitFor(() => expect(mocks.sendQuote).toHaveBeenCalledWith({ quoteId: QUOTE, signerName: 'Jo Client', signerEmail: 'jo@example.com' }))
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getDocuments.mockResolvedValue({ success: true, data: [] })
})

describe('after sending a quote for acceptance', () => {
  it('says it was sent when the email went', async () => {
    sent(mocks.sendQuote, {})
    await sendQuote()

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Quote Q-101 sent for acceptance.'))
    expect(mocks.toast.warning).not.toHaveBeenCalled()
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('warns that an email we did not hear back about may have reached them', async () => {
    sent(mocks.sendQuote, { email_status: 'failed', error: 'Request timed out', uncertain: true })
    await sendQuote()

    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith(
      'Acceptance request created, but we could not confirm the email to Jo Client went. It may have reached them, so check with them before sending a new link.',
    ))
    expect(mocks.toast.error).not.toHaveBeenCalled()
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it('calls it not sent only when the provider definitely refused it', async () => {
    sent(mocks.sendQuote, { email_status: 'failed', error: '550 mailbox unavailable', uncertain: false })
    await sendQuote()

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(
      'Acceptance request created, but the email to Jo Client was not sent. Use "Send New Link" or "Sign in Person".',
    ))
    expect(mocks.toast.warning).not.toHaveBeenCalled()
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(JSON.stringify(mocks.toast.error.mock.calls)).not.toContain('550')
  })

  it('says to check the address when it has bounced before', async () => {
    sent(mocks.sendQuote, { email_status: 'failed', code: 'recipient_suppressed', uncertain: false })
    await sendQuote()

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(
      'Acceptance request created, but the email to Jo Client was not sent because their address has bounced before. Check the address on their record, or use "Sign in Person".',
    ))
  })

  it('says email is switched off', async () => {
    sent(mocks.sendQuote, { email_status: 'failed', code: 'email_suspended', uncertain: false })
    await sendQuote()

    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith(
      'Acceptance request created, but email is switched off, so no link was emailed to Jo Client. Use "Sign in Person".',
    ))
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })
})

describe('after sending a client agreement', () => {
  async function sendAgreement(): Promise<void> {
    const user = userEvent.setup()
    render(<ClientAgreementPanel vendorId={VENDOR} clientName="Acme Ltd" canSend defaultSignerName="Jo Client" defaultSignerEmail="jo@example.com" />)
    await user.click(await screen.findByRole('button', { name: 'Send Agreement' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Send Agreement' }))
    await waitFor(() => expect(mocks.sendAgreement).toHaveBeenCalled())
  }

  it('says it was sent when the email went', async () => {
    sent(mocks.sendAgreement, {})
    await sendAgreement()

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Agreement sent to Acme Ltd.'))
  })

  it('warns, never says to send again, when the email may have gone', async () => {
    sent(mocks.sendAgreement, { email_status: 'failed', uncertain: true })
    await sendAgreement()

    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith(
      'Agreement created, but we could not confirm the email to Jo Client went. It may have reached them, so check with them before sending a new link.',
    ))
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('calls it not sent when the provider definitely refused it', async () => {
    sent(mocks.sendAgreement, { email_status: 'failed', uncertain: false })
    await sendAgreement()

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(
      'Agreement created, but the email to Jo Client was not sent. Use "Send New Link" or "Sign in Person".',
    ))
  })
})

describe('after asking a supplier to confirm a booking', () => {
  beforeEach(() => {
    mocks.getSupplierState.mockResolvedValue({
      success: true,
      data: {
        suppliers: [{ vendorId: VENDOR, name: 'Acme Sounds', contactName: 'Jo Supplier', contactEmail: 'jo@example.com', services: ['DJ for the evening'] }],
        documents: [],
        eventDate: 'Saturday, 5 December 2026',
        canSend: true,
      },
    })
  })

  async function sendConfirmation(): Promise<void> {
    const user = userEvent.setup()
    render(<BookingSuppliersPanel bookingId={BOOKING} />)
    await user.click(await screen.findByRole('button', { name: 'Ask Acme Sounds to Confirm' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Send Confirmation' }))
    await waitFor(() => expect(mocks.sendSupplier).toHaveBeenCalledWith({
      bookingId: BOOKING,
      vendorId: VENDOR,
      signerName: 'Jo Supplier',
      signerEmail: 'jo@example.com',
      serviceSummary: 'DJ for the evening',
      eventDate: 'Saturday, 5 December 2026',
      feeSummary: '',
    }))
  }

  function sentToSupplier(delivery: Partial<PartyDelivery>): void {
    mocks.sendSupplier.mockResolvedValue({
      success: true,
      data: {
        documentId: 'doc-1',
        deliveries: [{ partyId: 'p1', name: 'Jo Supplier', email: 'jo@example.com', email_status: 'sent', ...delivery }],
      },
    })
  }

  it('says it was sent when the email went', async () => {
    sentToSupplier({})
    await sendConfirmation()

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Confirmation sent to Acme Sounds.'))
    expect(mocks.toast.warning).not.toHaveBeenCalled()
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('warns, never says to send again, when the email may have gone', async () => {
    sentToSupplier({ email_status: 'failed', error: 'Request timed out', uncertain: true })
    await sendConfirmation()

    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith(
      'Confirmation request created, but we could not confirm the email to Jo Supplier went. It may have reached them, so check with them before sending a new link.',
    ))
    expect(mocks.toast.error).not.toHaveBeenCalled()
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(JSON.stringify(mocks.toast.warning.mock.calls)).not.toContain('Send New Link')
  })

  it('calls it not sent only when the provider definitely refused it', async () => {
    sentToSupplier({ email_status: 'failed', error: '550 mailbox unavailable', uncertain: false })
    await sendConfirmation()

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(
      'Confirmation request created, but the email to Jo Supplier was not sent. Use "Send New Link" or "Sign in Person".',
    ))
    expect(mocks.toast.warning).not.toHaveBeenCalled()
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(JSON.stringify(mocks.toast.error.mock.calls)).not.toContain('550')
  })
})
