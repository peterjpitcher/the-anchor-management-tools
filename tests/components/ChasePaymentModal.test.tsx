import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChasePaymentModal } from '@/components/modals/ChasePaymentModal'
import { sendChasePaymentEmail } from '@/app/actions/email'
import { toast } from '@/ds'
import { INVOICE_SIGN_OFF } from '@/lib/invoices/email-copy'
import type { InvoiceWithDetails } from '@/types/invoices'

/**
 * How overdue the invoice is used to be a hand-made header row inside the dialog body. It is now
 * the dialog's description, which a screen reader reads with the title.
 */

vi.mock('@/components/providers/SupabaseProvider', () => {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => Promise.resolve({ data: [] }),
  }
  return { useSupabase: () => ({ from: () => query }) }
})

vi.mock('@/app/actions/email', () => ({
  getInvoiceEmailLogs: vi.fn().mockResolvedValue({ logs: [] }),
  sendChasePaymentEmail: vi.fn(),
}))

const invoice: InvoiceWithDetails = {
  id: 'invoice-1',
  invoice_number: 'INV-001',
  vendor_id: 'vendor-1',
  invoice_date: '2026-09-01',
  due_date: '2026-09-10',
  status: 'overdue',
  invoice_discount_percentage: 0,
  subtotal_amount: 100,
  discount_amount: 0,
  vat_amount: 20,
  total_amount: 120,
  paid_amount: 0,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  line_items: [],
  payments: [],
}

describe('ChasePaymentModal', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('describes how overdue the invoice is', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-15T12:00:00.000Z'))

    render(<ChasePaymentModal invoice={invoice} isOpen onClose={vi.fn()} />)

    const dialog = await screen.findByRole('dialog', { name: 'Chase Payment' })
    expect(dialog).toHaveAccessibleDescription('Invoice INV-001 is 5 days overdue')
  })

  it('says the invoice PDF goes with the reminder', async () => {
    render(<ChasePaymentModal invoice={invoice} isOpen onClose={vi.fn()} />)

    expect(
      await screen.findByText('Invoice INV-001 (PDF format) will be attached as a reminder.'),
    ).toBeInTheDocument()
  })
})

/**
 * The draft the owner sees before a chase goes. Since 4 October 2026 it comes from the
 * shared wording: greeted by a first name the server resolved (never the company), one
 * sign-off, and for a private hire invoice it names the booking at The Anchor.
 */
describe('ChasePaymentModal draft', () => {
  const payable: InvoiceWithDetails = {
    ...invoice,
    vendor: {
      id: 'vendor-1',
      name: 'Golden Barrels Limited',
      contact_name: 'Golden Barrels Accounts',
      email: 'accounts@example.com',
      paypal_payments_enabled: true,
      is_active: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  }

  function message(): HTMLTextAreaElement {
    return screen.getByLabelText('Message') as HTMLTextAreaElement
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('greets the first name it is given and signs off once', async () => {
    render(<ChasePaymentModal invoice={payable} greetingName="Mihiir" isOpen onClose={vi.fn()} />)
    await screen.findByRole('dialog', { name: 'Chase Payment' })

    expect(message().value.startsWith('Hi Mihiir,\n\n')).toBe(true)
    expect(message().value).toContain('was due on Thursday 10 September and is now 5 days overdue')
    expect(message().value).toContain('Amount outstanding: £120.00')
    expect(message().value.endsWith(INVOICE_SIGN_OFF)).toBe(true)
    expect(screen.getByLabelText('Subject')).toHaveValue('Gentle reminder: Invoice INV-001 - 5 days overdue')
  })

  it('says "Hi there" with no name, and never the company or its contact_name', async () => {
    render(<ChasePaymentModal invoice={payable} isOpen onClose={vi.fn()} />)
    await screen.findByRole('dialog', { name: 'Chase Payment' })

    expect(message().value.startsWith('Hi there,\n\n')).toBe(true)
    expect(message().value).not.toContain('Golden')
  })

  it('names the booking at The Anchor for a private hire invoice', async () => {
    render(
      <ChasePaymentModal invoice={payable} greetingName="Priya" bookingEventDate="2026-11-14" isOpen onClose={vi.fn()} />,
    )
    await screen.findByRole('dialog', { name: 'Chase Payment' })

    expect(message().value).toContain('invoice INV-001 for your booking at The Anchor on Saturday 14 November 2026 was due')
  })

  it('counts the days on the London calendar, the same as the server does', async () => {
    // 23:30 UTC on 15 September is already 16 September in London, so the invoice due on
    // the 10th is six days overdue there, whatever the laptop's own clock says.
    vi.setSystemTime(new Date('2026-09-15T23:30:00.000Z'))

    render(<ChasePaymentModal invoice={payable} isOpen onClose={vi.fn()} />)

    const dialog = await screen.findByRole('dialog', { name: 'Chase Payment' })
    expect(dialog).toHaveAccessibleDescription('Invoice INV-001 is 6 days overdue')
    expect(message().value).toContain('is now 6 days overdue')
  })

  it('says a pay online link will be added when the client can pay online', async () => {
    render(<ChasePaymentModal invoice={payable} isOpen onClose={vi.fn()} />)
    await screen.findByRole('dialog', { name: 'Chase Payment' })

    expect(screen.getByText('A pay online link will be added as a P.S.')).toBeInTheDocument()
    // The link itself is never in the draft: the server adds it when the email is sent.
    expect(message().value).not.toContain('P.S.')
  })

  it('says nothing about a pay online link for a client who cannot pay online', async () => {
    render(<ChasePaymentModal invoice={invoice} isOpen onClose={vi.fn()} />)
    await screen.findByRole('dialog', { name: 'Chase Payment' })

    expect(screen.queryByText('A pay online link will be added as a P.S.')).not.toBeInTheDocument()
  })

  it('shows the server\'s warnings instead of closing as a plain success', async () => {
    vi.mocked(sendChasePaymentEmail).mockResolvedValue({
      success: true,
      messageId: 'message-1',
      daysOverdue: 5,
      warnings: ['Chase email sent but delivery log persistence failed'],
    })
    const warning = vi.spyOn(toast, 'warning').mockImplementation(() => 'toast-id')
    const onClose = vi.fn()

    render(<ChasePaymentModal invoice={payable} isOpen onClose={onClose} />)
    await waitFor(() => expect(screen.getByPlaceholderText('primary.contact@example.com')).toHaveValue('accounts@example.com'))
    fireEvent.click(screen.getByRole('button', { name: 'Send Reminder' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(warning).toHaveBeenCalledTimes(1)
    expect(String(warning.mock.calls[0][0])).toContain('Chase email sent but delivery log persistence failed')
    warning.mockRestore()
  })

  it('closes quietly when the send has nothing to warn about', async () => {
    vi.mocked(sendChasePaymentEmail).mockResolvedValue({ success: true, messageId: 'message-1', daysOverdue: 5 })
    const warning = vi.spyOn(toast, 'warning').mockImplementation(() => 'toast-id')
    const onClose = vi.fn()

    render(<ChasePaymentModal invoice={payable} isOpen onClose={onClose} />)
    await waitFor(() => expect(screen.getByPlaceholderText('primary.contact@example.com')).toHaveValue('accounts@example.com'))
    fireEvent.click(screen.getByRole('button', { name: 'Send Reminder' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(warning).not.toHaveBeenCalled()
    warning.mockRestore()
  })
})
