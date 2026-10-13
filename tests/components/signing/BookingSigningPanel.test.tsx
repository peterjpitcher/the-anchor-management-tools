import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  sendWaiver: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/app/actions/signing-bookings', () => ({
  getBookingSigningState: mocks.getState,
  sendBookingWaiver: mocks.sendWaiver,
}))
// The panel's shared actions (chase, withdraw, sign in person) are server actions too.
vi.mock('@/app/actions/signing', () => ({
  sendSigningReminder: vi.fn(),
  startInPersonSigningAction: vi.fn(),
  voidSigningRequest: vi.fn(),
}))
vi.mock('@/ds/primitives/Toast', () => ({ toast: mocks.toast }))

import type { BookingSigningState } from '@/app/actions/signing-bookings'
import { BookingSigningPanel } from '@/components/features/signing/BookingSigningPanel'
import type { SigningDocumentSummary } from '@/lib/signing/service'
import type { SigningDocumentStatus, SigningKind } from '@/lib/signing/types'

const BOOKING = '33333333-3333-4333-8333-333333333333'
const SEND = 'Send Food Agreement to Sign'

function signingDocument(kind: SigningKind, status: SigningDocumentStatus): SigningDocumentSummary {
  return {
    id: `doc-${kind}-${status}`,
    kind,
    title: kind === 'private_booking_waiver' ? 'Self-catering and outside food agreement' : 'Private booking contract',
    version: 1,
    status,
    sent_at: '2026-10-13T10:00:00.000Z',
    void_reason: null,
    parties: [],
  } as unknown as SigningDocumentSummary
}

function signingState(overrides: Partial<BookingSigningState> = {}): BookingSigningState {
  return {
    documents: [],
    waiverRequired: true,
    waiverOutstanding: true,
    waiverStatus: 'required',
    hasEmail: true,
    canSend: true,
    contractIssued: true,
    contractAcceptedAt: null,
    contractAcceptanceMethod: null,
    // Off here so the tests in this file see the food agreement on its own; the tests for
    // recording an acceptance are in BookingSigningPanel.acceptance.test.tsx.
    canRecordAcceptance: false,
    ...overrides,
  }
}

function load(state: BookingSigningState): void {
  mocks.getState.mockResolvedValue({ success: true, data: state })
}

async function renderLoaded(state: BookingSigningState): Promise<void> {
  load(state)
  render(<BookingSigningPanel bookingId={BOOKING} />)
  await screen.findByText('Signatures')
}

function sendButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: SEND })
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('offering the food agreement to sign on a booking', () => {
  it('offers it when one is outstanding and nothing has been sent', async () => {
    await renderLoaded(signingState())

    expect(mocks.getState).toHaveBeenCalledWith(BOOKING)
    expect(sendButton()).toBeInTheDocument()
  })

  it('offers it while only the contract is out for signature', async () => {
    await renderLoaded(signingState({ documents: [signingDocument('private_booking_contract', 'part_signed')] }))
    expect(sendButton()).toBeInTheDocument()
  })

  it.each(['voided', 'expired', 'declined'] as const)(
    'offers it again when the earlier food agreement request was %s',
    async (status) => {
      await renderLoaded(signingState({ waiverStatus: 'sent', documents: [signingDocument('private_booking_waiver', status)] }))
      expect(sendButton()).toBeInTheDocument()
    }
  )

  it.each(['sent', 'part_signed'] as const)(
    'does not offer it while a food agreement request is already open (%s)',
    async (status) => {
      await renderLoaded(signingState({ waiverStatus: 'sent', documents: [signingDocument('private_booking_waiver', status)] }))
      expect(sendButton()).not.toBeInTheDocument()
    }
  )

  it('does not offer it when no food agreement is outstanding', async () => {
    await renderLoaded(signingState({ waiverRequired: false, waiverOutstanding: false, waiverStatus: 'not_required' }))
    expect(sendButton()).not.toBeInTheDocument()
  })

  it('does not offer it once the food agreement is signed', async () => {
    await renderLoaded(
      signingState({ waiverOutstanding: false, waiverStatus: 'signed', documents: [signingDocument('private_booking_waiver', 'completed')] })
    )
    expect(sendButton()).not.toBeInTheDocument()
  })

  it('does not offer it to someone who may not send', async () => {
    await renderLoaded(signingState({ canSend: false }))
    expect(sendButton()).not.toBeInTheDocument()
  })

  it('says Email Contract sends both, each with its own link, when a food agreement applies', async () => {
    await renderLoaded(signingState())
    expect(screen.getByText(/Email Contract sends the contract and the food agreement, each with its own link to sign/)).toBeInTheDocument()
  })

  it('does not mention a food agreement on a booking with no outside food', async () => {
    await renderLoaded(signingState({ waiverRequired: false, waiverOutstanding: false, waiverStatus: 'not_required' }))

    expect(screen.getByText(/Email Contract sends the contract with a link to sign it online/)).toBeInTheDocument()
    expect(screen.queryByText(/food agreement/i)).not.toBeInTheDocument()
  })
})

describe('sending the food agreement from the booking', () => {
  it('sends it, says so, and reloads so the open request replaces the button', async () => {
    const user = userEvent.setup()
    await renderLoaded(signingState())
    mocks.sendWaiver.mockResolvedValue({
      success: true,
      data: { documentId: 'doc-waiver', deliveries: [{ partyId: 'p1', name: 'Sam Example', email: 'sam@example.com', email_status: 'sent' }] },
    })
    load(signingState({ waiverStatus: 'sent', documents: [signingDocument('private_booking_waiver', 'sent')] }))

    await user.click(screen.getByRole('button', { name: SEND }))

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Food agreement sent to the customer to sign.'))
    expect(mocks.sendWaiver).toHaveBeenCalledWith(BOOKING)
    expect(mocks.toast.error).not.toHaveBeenCalled()
    await waitFor(() => expect(sendButton()).not.toBeInTheDocument())
    expect(screen.getByText('Self-catering and outside food agreement')).toBeInTheDocument()
    expect(mocks.getState).toHaveBeenCalledTimes(2)
  })

  it('tells the user when the request was created but the email failed', async () => {
    const user = userEvent.setup()
    await renderLoaded(signingState())
    mocks.sendWaiver.mockResolvedValue({
      success: true,
      data: { documentId: 'doc-waiver', deliveries: [{ partyId: 'p1', name: 'Sam Example', email: 'sam@example.com', email_status: 'failed', error: 'Mailbox unavailable' }] },
    })

    await user.click(screen.getByRole('button', { name: SEND }))

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith('Food agreement created, but the email failed. Use "Send New Link" or "Sign in Person".')
    )
    // Never a plain "sent" when the customer has no link.
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it('tells the user to sign in person when there is no email address', async () => {
    const user = userEvent.setup()
    await renderLoaded(signingState({ hasEmail: false }))
    mocks.sendWaiver.mockResolvedValue({
      success: true,
      data: { documentId: 'doc-waiver', deliveries: [{ partyId: 'p1', name: 'Sam Example', email: null, email_status: 'none' }] },
    })

    await user.click(screen.getByRole('button', { name: SEND }))

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith('Food agreement created. There is no email address, so use "Sign in Person".')
    )
    expect(mocks.toast.success).not.toHaveBeenCalledWith('Food agreement sent to the customer to sign.')
  })

  it('shows the reason when the food agreement could not be sent, and keeps the button', async () => {
    const user = userEvent.setup()
    await renderLoaded(signingState())
    mocks.sendWaiver.mockResolvedValue({ error: 'This booking has no outside food, so there is no food agreement to sign.' })

    await user.click(screen.getByRole('button', { name: SEND }))

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith('This booking has no outside food, so there is no food agreement to sign.')
    )
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(sendButton()).toBeInTheDocument()
  })

  it('never claims success when the action returns neither data nor a reason', async () => {
    const user = userEvent.setup()
    await renderLoaded(signingState())
    mocks.sendWaiver.mockResolvedValue({})

    await user.click(screen.getByRole('button', { name: SEND }))

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Could not send the food agreement.'))
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })
})

describe('loading the signing records of a booking', () => {
  it('shows the reason, and no button, when they cannot be loaded', async () => {
    mocks.getState.mockResolvedValue({ error: 'Insufficient permissions' })
    render(<BookingSigningPanel bookingId={BOOKING} />)

    expect(await screen.findByText('The signing records could not be loaded')).toBeInTheDocument()
    expect(screen.getByText('Insufficient permissions')).toBeInTheDocument()
    expect(sendButton()).not.toBeInTheDocument()
  })

  it('loads again when the booking is refreshed, as after Email Contract', async () => {
    load(signingState())
    const { rerender } = render(<BookingSigningPanel bookingId={BOOKING} refreshKey="v1" />)
    await screen.findByText('Signatures')
    expect(sendButton()).toBeInTheDocument()

    // Email Contract has sent the food agreement with the contract.
    load(signingState({ waiverStatus: 'sent', documents: [signingDocument('private_booking_waiver', 'sent')] }))
    rerender(<BookingSigningPanel bookingId={BOOKING} refreshKey="v2" />)

    await waitFor(() => expect(sendButton()).not.toBeInTheDocument())
    expect(mocks.getState).toHaveBeenCalledTimes(2)
  })
})
