/**
 * The Email Invoice dialog as staff see it before sending.
 *
 * Since 4 October 2026 its draft comes from the shared invoice wording. Three things are
 * pinned here that the pure draft tests cannot see:
 *
 *  - the greeting is the first name handed down from the server, never the company name
 *    (every email used to open "Hi Golden Barrels Limited");
 *  - staff are told when the server will add the pay online P.S., because the link itself
 *    is never in the draft (its token must not be made in the browser);
 *  - a send that worked but could not save its record shows the warning, rather than
 *    closing as if nothing had gone wrong.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EmailInvoiceModal } from '@/components/features/invoices/EmailInvoiceModal'
import { sendInvoiceViaEmail } from '@/app/actions/email'
import { toast } from '@/ds'
import { INVOICE_SIGN_OFF } from '@/lib/invoices/email-copy'
import type { InvoiceWithDetails } from '@/types/invoices'

vi.mock('@/components/providers/SupabaseProvider', () => {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => Promise.resolve({ data: [] }),
  }
  return { useSupabase: () => ({ from: () => query }) }
})

vi.mock('@/app/actions/email', () => ({
  sendInvoiceViaEmail: vi.fn(),
}))

function invoice(overrides: Partial<InvoiceWithDetails> = {}): InvoiceWithDetails {
  return {
    id: 'invoice-1',
    invoice_number: 'INV-003WD',
    vendor_id: 'vendor-1',
    invoice_date: '2026-09-25',
    due_date: '2026-10-09',
    status: 'sent',
    invoice_discount_percentage: 0,
    subtotal_amount: 600,
    discount_amount: 0,
    vat_amount: 120,
    total_amount: 720,
    paid_amount: 0,
    created_at: '2026-09-25T09:00:00.000Z',
    updated_at: '2026-09-25T09:00:00.000Z',
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
    line_items: [],
    payments: [],
    ...overrides,
  }
}

function message(): HTMLTextAreaElement {
  return screen.getByLabelText('Message') as HTMLTextAreaElement
}

const NOTE = 'A pay online link will be added as a P.S.'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EmailInvoiceModal draft', () => {
  it('greets the first name it is given, quotes the balance and signs off once', async () => {
    render(<EmailInvoiceModal invoice={invoice()} greetingName="Mihiir" isOpen onClose={vi.fn()} />)
    await screen.findByRole('dialog', { name: 'Email Invoice' })

    expect(screen.getByLabelText('Subject')).toHaveValue('Invoice INV-003WD from Orange Jelly')
    expect(message().value.startsWith('Hi Mihiir,\n\n')).toBe(true)
    expect(message().value).toContain('Invoice INV-003WD is attached: £720.00, due Friday 9 October.')
    expect(message().value.endsWith(INVOICE_SIGN_OFF)).toBe(true)
  })

  it('says "Hi there" with no name, and never the company or its contact_name', async () => {
    render(<EmailInvoiceModal invoice={invoice()} isOpen onClose={vi.fn()} />)
    await screen.findByRole('dialog', { name: 'Email Invoice' })

    expect(message().value.startsWith('Hi there,\n\n')).toBe(true)
    expect(message().value).not.toContain('Golden')
  })

  it('rebuilds the draft when a payment lands while the dialog is mounted but closed', async () => {
    const { rerender } = render(
      <EmailInvoiceModal invoice={invoice()} greetingName="Mihiir" isOpen={false} onClose={vi.fn()} />,
    )

    rerender(
      <EmailInvoiceModal
        invoice={invoice({ paid_amount: 250, status: 'partially_paid' })}
        greetingName="Mihiir"
        isOpen
        onClose={vi.fn()}
      />,
    )
    await screen.findByRole('dialog', { name: 'Email Invoice' })

    expect(message().value).toContain('is attached: £470.00, due Friday 9 October.')
    expect(message().value).not.toContain('is attached: £720.00')
  })

  it('keeps what staff typed while the dialog stays open', async () => {
    const { rerender } = render(<EmailInvoiceModal invoice={invoice()} greetingName="Mihiir" isOpen onClose={vi.fn()} />)
    await screen.findByRole('dialog', { name: 'Email Invoice' })

    fireEvent.change(message(), { target: { value: 'My own words.' } })
    rerender(<EmailInvoiceModal invoice={invoice()} greetingName="Mihiir" isOpen onClose={vi.fn()} />)

    expect(message()).toHaveValue('My own words.')
  })
})

describe('EmailInvoiceModal pay online note', () => {
  it('tells staff a pay online link will be added when the client can pay online', async () => {
    render(<EmailInvoiceModal invoice={invoice()} isOpen onClose={vi.fn()} />)
    await screen.findByRole('dialog', { name: 'Email Invoice' })

    expect(screen.getByText(NOTE)).toBeInTheDocument()
    // The link itself is added by the server at send time, never drafted in the browser.
    expect(message().value).not.toContain('P.S.')
    expect(message().value).not.toContain('invoice-portal')
  })

  it.each([
    ['the client is not set up to pay online', { vendor: { ...invoice().vendor!, paypal_payments_enabled: false } }],
    ['there is nothing left to pay', { paid_amount: 720, status: 'paid' as const }],
  ])('says nothing about it when %s', async (_case, overrides) => {
    render(<EmailInvoiceModal invoice={invoice(overrides)} isOpen onClose={vi.fn()} />)
    await screen.findByRole('dialog', { name: 'Email Invoice' })

    expect(screen.queryByText(NOTE)).not.toBeInTheDocument()
  })
})

describe('EmailInvoiceModal send result', () => {
  async function send(onClose: () => void): Promise<void> {
    render(<EmailInvoiceModal invoice={invoice()} greetingName="Mihiir" isOpen onClose={onClose} />)
    await waitFor(() =>
      expect(screen.getByPlaceholderText('primary.contact@example.com')).toHaveValue('accounts@example.com'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Send Email' }))
    await waitFor(() => expect(sendInvoiceViaEmail).toHaveBeenCalledTimes(1))
  }

  it('sends the draft the dialog showed', async () => {
    vi.mocked(sendInvoiceViaEmail).mockResolvedValue({ success: true, messageId: 'message-1' })

    await send(vi.fn())

    const formData = vi.mocked(sendInvoiceViaEmail).mock.calls[0][0]
    expect(formData.get('subject')).toBe('Invoice INV-003WD from Orange Jelly')
    expect(String(formData.get('body')).startsWith('Hi Mihiir,\n\n')).toBe(true)
  })

  it('shows the server\'s warnings instead of closing as a plain success', async () => {
    vi.mocked(sendInvoiceViaEmail).mockResolvedValue({
      success: true,
      messageId: 'message-1',
      warnings: ['Email sent but delivery log persistence failed', 'Email sent but invoice status update failed'],
    })
    const warning = vi.spyOn(toast, 'warning').mockImplementation(() => 'toast-id')
    const onClose = vi.fn()

    await send(onClose)

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(warning).toHaveBeenCalledTimes(1)
    const shown = String(warning.mock.calls[0][0])
    expect(shown).toContain('Email sent but delivery log persistence failed')
    expect(shown).toContain('Email sent but invoice status update failed')
    warning.mockRestore()
  })

  it('closes quietly when there is nothing to warn about', async () => {
    vi.mocked(sendInvoiceViaEmail).mockResolvedValue({ success: true, messageId: 'message-1' })
    const warning = vi.spyOn(toast, 'warning').mockImplementation(() => 'toast-id')
    const onClose = vi.fn()

    await send(onClose)

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(warning).not.toHaveBeenCalled()
    warning.mockRestore()
  })

  it('stays open and shows the error when the send is refused', async () => {
    vi.mocked(sendInvoiceViaEmail).mockResolvedValue({ error: 'Mailbox unavailable' })
    const onClose = vi.fn()

    await send(onClose)

    expect(await screen.findByText('Mailbox unavailable')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
