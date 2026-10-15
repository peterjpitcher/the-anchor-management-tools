import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The deductions panel on a private booking: sending a proposed deduction to the customer to
 * agree, and showing where that request has got to (owner decision, 13 October 2026).
 */

const mocks = vi.hoisted(() => ({
  listDeductions: vi.fn(),
  getAgreements: vi.fn(),
  send: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/app/actions/privateBookingWorkflow', () => ({
  listDeductions: mocks.listDeductions,
  proposeDeduction: vi.fn(),
  recordDeductionDiscussion: vi.fn(),
  decideDeduction: vi.fn(),
  listBookingSuppliers: vi.fn(),
  addBookingSupplier: vi.fn(),
  updateBookingSupplier: vi.fn(),
  setSupplierStatus: vi.fn(),
  setWaiverStatus: vi.fn(),
  uploadSignedWaiver: vi.fn(),
  setRiskStatus: vi.fn(),
  lockBookingRecord: vi.fn(),
  unlockBookingRecord: vi.fn(),
  logComplaint: vi.fn(),
  updateComplaint: vi.fn(),
  listComplaints: vi.fn(),
}))
vi.mock('@/app/actions/signing-deductions', () => ({
  getDeductionAgreements: mocks.getAgreements,
  sendDeductionForAgreement: mocks.send,
}))
vi.mock('@/ds', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/ds')>()
  return { ...original, toast: { ...original.toast, success: mocks.toastSuccess, error: mocks.toastError } }
})

import type { DeductionAgreementState } from '@/app/actions/signing-deductions'
import { DeductionsPanel } from '@/components/private-bookings/WorkflowPanels'

const BOOKING = '33333333-3333-4333-8333-333333333333'
const DEDUCTION = '77777777-7777-4777-8777-777777777777'
const OTHER_DEDUCTION = '88888888-8888-4888-8888-888888888888'
const SEND = 'Send to Customer for Agreement'

function deduction(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: DEDUCTION,
    booking_id: BOOKING,
    amount: 50,
    reason: 'Red wine on the function room carpet',
    evidence_document_id: null,
    customer_discussion_note: null,
    status: 'proposed',
    approved_by: null,
    approved_at: null,
    created_by: null,
    created_at: '2026-10-13T09:00:00.000Z',
    updated_at: '2026-10-13T09:00:00.000Z',
    ...extra,
  }
}

function agreement(extra: Partial<DeductionAgreementState> = {}): DeductionAgreementState {
  return {
    deductionId: DEDUCTION,
    documentId: 'doc-1',
    status: 'sent',
    version: 1,
    // British Summer Time: 11:15 in London.
    sentAt: '2026-10-13T10:15:00.000Z',
    completedAt: null,
    voidedAt: null,
    expiresAt: '2026-11-12T10:15:00.000Z',
    declineReason: null,
    withdrawnReason: null,
    ...extra,
  }
}

function show(options: { deductions?: Array<Record<string, unknown>>; agreements?: DeductionAgreementState[]; canSend?: boolean; canManage?: boolean } = {}): void {
  mocks.listDeductions.mockResolvedValue({ success: true, data: options.deductions ?? [deduction()] })
  mocks.getAgreements.mockResolvedValue({ success: true, data: { agreements: options.agreements ?? [], canSend: options.canSend ?? true } })
  render(<DeductionsPanel bookingId={BOOKING} canManage={options.canManage ?? true} refreshKey={0} />)
}

async function loaded(): Promise<void> {
  await screen.findByText('Red wine on the function room carpet')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the button to send a deduction to the customer', () => {
  it.each(['proposed', 'discussed'])('is offered on a deduction that is %s', async (status) => {
    show({ deductions: [deduction({ status })] })
    await loaded()

    expect(screen.getByRole('button', { name: SEND })).toBeInTheDocument()
  })

  it.each(['approved', 'rejected', 'applied'])('is not offered on a deduction that is %s', async (status) => {
    show({ deductions: [deduction({ status })] })
    await loaded()

    expect(screen.queryByRole('button', { name: SEND })).not.toBeInTheDocument()
  })

  it('is not offered to someone who may not send, though they still see where it has got to', async () => {
    show({ canSend: false, canManage: false, agreements: [agreement()] })
    await loaded()

    expect(screen.queryByRole('button', { name: SEND })).not.toBeInTheDocument()
    expect(screen.getByText('Waiting to be signed')).toBeInTheDocument()
  })

  it('is offered once per open deduction, and only on those', async () => {
    show({ deductions: [deduction(), deduction({ id: OTHER_DEDUCTION, reason: 'Broken chair', status: 'approved' })] })
    await loaded()

    expect(screen.getAllByRole('button', { name: SEND })).toHaveLength(1)
  })

  it('is no longer offered once the customer has signed', async () => {
    show({ deductions: [deduction({ status: 'discussed' })], agreements: [agreement({ status: 'completed', completedAt: '2026-10-14T18:05:00.000Z' })] })
    await loaded()

    expect(screen.queryByRole('button', { name: SEND })).not.toBeInTheDocument()
  })

  it.each(['sent', 'declined', 'voided', 'expired'] as const)('is still offered, to send again, when the last request is %s', async (status) => {
    show({ agreements: [agreement({ status })] })
    await loaded()

    expect(screen.getByRole('button', { name: SEND })).toBeInTheDocument()
  })

  it('sends that deduction, says so, and reloads to show the new state', async () => {
    mocks.send.mockResolvedValue({ success: true, data: { documentId: 'doc-1', deliveries: [{ partyId: 'p1', name: 'Alex Host', email: 'alex@example.com', email_status: 'sent' }] } })
    show()
    await loaded()

    await userEvent.click(screen.getByRole('button', { name: SEND }))

    expect(mocks.send).toHaveBeenCalledWith({ deductionId: DEDUCTION })
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('Sent to the customer to agree'))
    await waitFor(() => expect(mocks.getAgreements).toHaveBeenCalledTimes(2))
    expect(mocks.listDeductions).toHaveBeenCalledTimes(2)
  })

  it('shows the reason when the send is refused, for example while the template is switched off', async () => {
    const reason = 'The "Deposit deduction agreement" template is switched off. Check its wording and switch it on in Settings, Signing templates.'
    mocks.send.mockResolvedValue({ error: reason })
    show()
    await loaded()

    await userEvent.click(screen.getByRole('button', { name: SEND }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(reason))
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('does not claim it was sent when the request was created and the email failed', async () => {
    mocks.send.mockResolvedValue({ success: true, data: { documentId: 'doc-1', deliveries: [{ partyId: 'p1', name: 'Alex Host', email: 'alex@example.com', email_status: 'failed' }] } })
    show()
    await loaded()

    await userEvent.click(screen.getByRole('button', { name: SEND }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'The request was created, but the email did not send. Use "Send New Link" or "Sign in Person" under Signatures.'
      )
    )
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })
})

describe('where the request for agreement has got to', () => {
  function row(): HTMLElement {
    return screen.getByText('Customer agreement:').parentElement as HTMLElement
  }

  it('shows nothing about agreement for a deduction that was never sent', async () => {
    show()
    await loaded()

    expect(screen.queryByText('Customer agreement:')).not.toBeInTheDocument()
  })

  it('shows a request that is out with the customer, and when it went', async () => {
    show({ agreements: [agreement()] })
    await loaded()

    expect(within(row()).getByText('Waiting to be signed')).toBeInTheDocument()
    expect(within(row()).getByText('Sent to the customer 13 Oct 2026 at 11:15am')).toBeInTheDocument()
  })

  it('shows a signed request, and when the customer agreed', async () => {
    show({ deductions: [deduction({ status: 'discussed' })], agreements: [agreement({ status: 'completed', completedAt: '2026-10-14T18:05:00.000Z' })] })
    await loaded()

    expect(within(row()).getByText('Signed')).toBeInTheDocument()
    expect(within(row()).getByText('The customer agreed 14 Oct 2026 at 7:05pm')).toBeInTheDocument()
  })

  it('shows a declined request with the reason the customer gave', async () => {
    show({ agreements: [agreement({ status: 'declined', declineReason: 'The stain was there before we arrived' })] })
    await loaded()

    expect(within(row()).getByText('Declined')).toBeInTheDocument()
    expect(within(row()).getByText('Their reason: The stain was there before we arrived')).toBeInTheDocument()
  })

  it('says so when the customer declined without a reason', async () => {
    show({ agreements: [agreement({ status: 'declined' })] })
    await loaded()

    expect(within(row()).getByText('The customer gave no reason')).toBeInTheDocument()
  })

  it('shows a withdrawn request, with why', async () => {
    show({ agreements: [agreement({ status: 'voided', voidedAt: '2026-10-13T12:00:00.000Z', withdrawnReason: 'The deduction was rejected' })] })
    await loaded()

    expect(within(row()).getByText('Withdrawn')).toBeInTheDocument()
    expect(within(row()).getByText('Reason: The deduction was rejected')).toBeInTheDocument()
  })

  it('shows an expired request, and when it ran out', async () => {
    show({ agreements: [agreement({ status: 'expired' })] })
    await loaded()

    expect(within(row()).getByText('Expired')).toBeInTheDocument()
    // Greenwich Mean Time by then: 10:15 in London.
    expect(within(row()).getByText('Not answered by 12 Nov 2026 at 10:15am')).toBeInTheDocument()
  })

  it('puts each request beside its own deduction', async () => {
    show({
      deductions: [deduction(), deduction({ id: OTHER_DEDUCTION, reason: 'Broken chair' })],
      agreements: [agreement({ deductionId: OTHER_DEDUCTION, status: 'declined', declineReason: 'It was already wobbly' })],
    })
    await loaded()

    const chair = screen.getByText('Broken chair').closest('li') as HTMLElement
    const wine = screen.getByText('Red wine on the function room carpet').closest('li') as HTMLElement
    expect(within(chair).getByText('Declined')).toBeInTheDocument()
    expect(within(wine).queryByText('Customer agreement:')).not.toBeInTheDocument()
  })

  it('says the agreement records could not be loaded, and offers no send, when that read fails', async () => {
    mocks.listDeductions.mockResolvedValue({ success: true, data: [deduction()] })
    mocks.getAgreements.mockResolvedValue({ error: 'Could not read signing documents: database down' })
    render(<DeductionsPanel bookingId={BOOKING} canManage refreshKey={0} />)
    await loaded()

    expect(screen.getByText('The customer agreement records could not be loaded: Could not read signing documents: database down')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: SEND })).not.toBeInTheDocument()
    // The deduction itself is still shown and can still be worked on.
    expect(screen.getByRole('button', { name: 'Record Discussion' })).toBeInTheDocument()
  })
})
