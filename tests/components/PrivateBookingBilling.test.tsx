import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PrivateBookingBilling } from '@/components/private-bookings/PrivateBookingBilling'
import * as actions from '@/app/actions/privateBookingExtras'
import type { ExtraChargeBatch } from '@/lib/private-bookings/extra-charges'

vi.mock('@/app/actions/privateBookingExtras', () => ({
  getPrivateBookingBilling: vi.fn(), savePrivateBookingExtras: vi.fn(), previewPrivateBookingExtras: vi.fn(),
  issuePrivateBookingExtras: vi.fn(), resendPrivateBookingExtraInvoice: vi.fn(), cancelPrivateBookingExtraInvoice: vi.fn(),
  deletePrivateBookingExtras: vi.fn(), recordPrivateBookingInvoicePayment: vi.fn(),
}))
vi.mock('@/app/actions/invoices', () => ({ getLineItemCatalog: vi.fn(async () => ({ items: [] })) }))

const bookingId = '00000000-0000-4000-8000-000000000001'
const invoiceId = '00000000-0000-4000-8000-000000000002'
const draft: ExtraChargeBatch = {
  id: '00000000-0000-4000-8000-000000000003', booking_id: bookingId, invoice_id: null, status: 'draft', revision: 1,
  lines: [{ description: 'Fixture extra', quantity: 2, unit_price: 25, discount_percentage: 0, vat_rate: 20 }],
  due_date: '2026-10-01', reference: null, created_at: '2026-09-18T12:00:00Z', updated_at: '2026-09-18T12:00:00Z',
}
const billing = {
  batches: [], supplementaryTotal: 0, collectibleBalance: 120, creditsTotal: 0,
  invoices: [{ id: invoiceId, invoice_number: 'TEST-001', kind: 'original' as const, status: 'sent', invoice_date: '2026-09-18', due_date: '2026-10-01', total_amount: 120, paid_amount: 0, credit_amount: 0, balance: 120, sent_at: '2026-09-18T12:00:00Z', paypalEnabled: true, paymentUrl: '/invoice-portal/test', deliveryState: 'sent' as const }],
}
const onChanged = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(actions.getPrivateBookingBilling).mockResolvedValue({ data: billing })
  vi.mocked(actions.savePrivateBookingExtras).mockResolvedValue({ batch: draft })
  vi.mocked(actions.previewPrivateBookingExtras).mockResolvedValue({ preview: { batch: draft, recipientEmail: 'fixture@example.test', paypalEnabled: true, sourceHash: 'fixture-hash', totals: { subtotalBeforeInvoiceDiscount: 50, invoiceDiscountAmount: 0, vatAmount: 10, totalAmount: 60, lineBreakdown: [] } } })
  vi.mocked(actions.issuePrivateBookingExtras).mockResolvedValue({ invoiceId, invoiceNumber: 'TEST-002', sent: true })
  vi.mocked(actions.recordPrivateBookingInvoicePayment).mockResolvedValue({ success: true })
})

function show(canIssue = true): void {
  render(<PrivateBookingBilling bookingId={bookingId} canIssue={canIssue} canRecordPayments={true} canAddExtras={true} onChanged={onChanged} />)
}

describe('private booking supplementary billing', () => {
  it('saves and previews extras before explicit issue, preserving the original invoice', async () => {
    const user = userEvent.setup()
    show()
    await screen.findByRole('link', { name: 'TEST-001' })
    await user.click(screen.getByRole('button', { name: 'Add extra charges' }))
    await user.type(screen.getByLabelText('Description 1'), 'Fixture extra')
    await user.clear(screen.getByLabelText('Quantity 1'))
    await user.type(screen.getByLabelText('Quantity 1'), '2')
    await user.clear(screen.getByLabelText('Unit price excluding VAT 1'))
    await user.type(screen.getByLabelText('Unit price excluding VAT 1'), '25')
    await user.type(screen.getByLabelText('Payment due date'), '2026-10-01')
    await user.click(screen.getByRole('button', { name: 'Preview invoice' }))
    await screen.findByText(/Send to fixture@example.test/)
    expect(actions.issuePrivateBookingExtras).not.toHaveBeenCalled()
    expect(actions.savePrivateBookingExtras).toHaveBeenCalledWith(expect.objectContaining({ bookingId, lines: [expect.objectContaining({ description: 'Fixture extra', quantity: 2, unit_price: 25 })] }))
    await user.click(screen.getByRole('button', { name: 'Issue and send additional invoice' }))
    await screen.findByText('Invoice TEST-002 sent.')
    expect(actions.issuePrivateBookingExtras).toHaveBeenCalledWith(expect.objectContaining({ batchId: draft.id, sourceHash: 'fixture-hash', expectedRevision: 1 }))
    expect(screen.getByRole('link', { name: 'TEST-001' })).toBeInTheDocument()
  })

  it('requires explicit consent to issue without an online payment link', async () => {
    const user = userEvent.setup()
    vi.mocked(actions.previewPrivateBookingExtras).mockResolvedValue({ preview: { batch: draft, recipientEmail: 'fixture@example.test', paypalEnabled: false, sourceHash: 'fixture-hash', totals: { subtotalBeforeInvoiceDiscount: 50, invoiceDiscountAmount: 0, vatAmount: 10, totalAmount: 60, lineBreakdown: [] } } })
    show()
    await user.click(screen.getByRole('button', { name: 'Add extra charges' }))
    await user.click(screen.getByRole('button', { name: 'Preview invoice' }))
    const issue = await screen.findByRole('button', { name: 'Issue and send additional invoice' })
    expect(issue).toBeDisabled()
    await user.click(screen.getByLabelText('Issue without an online payment link'))
    expect(issue).toBeEnabled()
  })

  it('reports failed delivery without claiming the invoice was sent', async () => {
    const user = userEvent.setup()
    vi.mocked(actions.issuePrivateBookingExtras).mockResolvedValue({ invoiceId, invoiceNumber: 'TEST-002', sent: false, warning: 'Invoice created but email failed. Retry sending.' })
    show()
    await user.click(screen.getByRole('button', { name: 'Add extra charges' }))
    await user.click(screen.getByRole('button', { name: 'Preview invoice' }))
    await user.click(await screen.findByRole('button', { name: 'Issue and send additional invoice' }))
    await screen.findByText('Invoice created but email failed. Retry sending.')
    expect(screen.queryByText('Invoice TEST-002 sent.')).not.toBeInTheDocument()
  })

  it('requires the received amount to equal selected invoice allocations', async () => {
    const user = userEvent.setup()
    show()
    await user.click(await screen.findByRole('button', { name: 'Record invoice payment' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Total payment received'), '60')
    await user.type(within(dialog).getByLabelText('TEST-001: £120.00 outstanding'), '50')
    expect(within(dialog).getByRole('button', { name: 'Record payment' })).toBeDisabled()
    await user.clear(within(dialog).getByLabelText('TEST-001: £120.00 outstanding'))
    await user.type(within(dialog).getByLabelText('TEST-001: £120.00 outstanding'), '60')
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }))
    await waitFor(() => expect(actions.recordPrivateBookingInvoicePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 60, allocations: [{ invoiceId, amount: 60 }] })))
  })

  it('hides invoice issue controls from users without issue permission', async () => {
    show(false)
    await screen.findByRole('link', { name: 'TEST-001' })
    expect(screen.queryByRole('button', { name: 'Add extra charges' })).not.toBeInTheDocument()
  })
})
