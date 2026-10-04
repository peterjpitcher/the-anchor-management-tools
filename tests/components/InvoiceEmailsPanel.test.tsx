import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { InvoiceEmailHistory, InvoiceEmailHistoryEntry } from '@/lib/invoices/email-history'

const actions = vi.hoisted(() => ({
  getInvoiceEmailHistory: vi.fn(),
  holdInvoiceReminders: vi.fn(),
  resumeInvoiceReminders: vi.fn(),
}))

vi.mock('@/app/actions/invoice-reminders', () => actions)

import { InvoiceEmailsPanel } from '@/app/(authenticated)/invoices/[id]/_components/InvoiceEmailsPanel'

const INVOICE_ID = '7c1e4b2a-9d3f-4e6a-8b5c-1f2e3d4c5b6a'

function entry(overrides: Partial<InvoiceEmailHistoryEntry> = {}): InvoiceEmailHistoryEntry {
  return {
    id: 'email-1',
    sentAtLabel: '6 October 2026, 10:00',
    kind: 'invoice',
    kindLabel: 'Invoice',
    kindInferred: false,
    to: 'accounts@acme.example',
    copies: ['director@acme.example'],
    droppedCopies: [],
    outcome: 'Sent (delivery not tracked)',
    outcomeTone: 'neutral',
    subject: 'Invoice INV-0101 from Orange Jelly',
    body: 'Hi Jo,\n\n<b>Invoice INV-0101</b> is attached.\n\nMany thanks,\nPeter Pitcher',
    ...overrides,
  }
}

function history(overrides: Partial<InvoiceEmailHistory> = {}): InvoiceEmailHistory {
  return {
    nextReminder: {
      line: 'Next automatic reminder: Tuesday 13 October (forecast)',
      detail: 'The first reminder. Everything is checked again before it is sent.',
    },
    crossCheck: [
      { label: 'Invoice emailed', value: 'Tuesday 6 October 2026' },
      { label: 'First reminder', value: 'Not sent' },
      { label: 'Second reminder', value: 'Not sent' },
    ],
    earlierEmailsNotRecorded: false,
    emails: [entry()],
    truncated: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  actions.getInvoiceEmailHistory.mockResolvedValue({ history: history() })
})

describe('InvoiceEmailsPanel', () => {
  it('says it is loading, then shows the forecast, the cross-check and the emails', async () => {
    render(<InvoiceEmailsPanel invoiceId={INVOICE_ID} />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading emails')

    expect(await screen.findByText('Next automatic reminder: Tuesday 13 October (forecast)')).toBeInTheDocument()
    expect(screen.getByText('The first reminder. Everything is checked again before it is sent.')).toBeInTheDocument()
    expect(actions.getInvoiceEmailHistory).toHaveBeenCalledWith(INVOICE_ID)

    expect(screen.getByText('Invoice emailed')).toBeInTheDocument()
    expect(screen.getByText('Tuesday 6 October 2026')).toBeInTheDocument()

    const email = screen.getByRole('listitem')
    expect(within(email).getByText('Invoice')).toBeInTheDocument()
    expect(within(email).getByText('Sent (delivery not tracked)')).toBeInTheDocument()
    expect(within(email).getByText('Invoice INV-0101 from Orange Jelly')).toBeInTheDocument()
    expect(within(email).getByText('6 October 2026, 10:00')).toBeInTheDocument()
    expect(within(email).getByText('To accounts@acme.example')).toBeInTheDocument()
    expect(within(email).getByText('Copied to director@acme.example')).toBeInTheDocument()
    expect(screen.queryByText('Emails sent before 25 June 2026 are not recorded here.')).not.toBeInTheDocument()
  })

  it('shows the wording on expand as text, never as HTML, and hides it again', async () => {
    const { container } = render(<InvoiceEmailsPanel invoiceId={INVOICE_ID} />)

    const toggle = await screen.findByRole('button', { name: 'Show wording' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/is attached/)).not.toBeInTheDocument()

    fireEvent.click(toggle)

    const open = screen.getByRole('button', { name: 'Hide wording' })
    expect(open).toHaveAttribute('aria-expanded', 'true')
    const wording = document.getElementById(open.getAttribute('aria-controls') ?? '')
    expect(wording).not.toBeNull()
    // The angle brackets are on the page as characters; no element was made from them.
    expect(wording?.textContent).toBe('Hi Jo,\n\n<b>Invoice INV-0101</b> is attached.\n\nMany thanks,\nPeter Pitcher')
    expect(container.querySelector('b')).toBeNull()
    expect(wording).toHaveClass('whitespace-pre-wrap')

    fireEvent.click(open)
    expect(screen.queryByText(/is attached/)).not.toBeInTheDocument()
  })

  it('says copies were not recorded, which is not the same as none', async () => {
    actions.getInvoiceEmailHistory.mockResolvedValue({
      history: history({
        emails: [
          entry({ id: 'old', copies: null, kindInferred: true, kindLabel: 'Reminder', body: null }),
          entry({ id: 'new', copies: [] }),
        ],
      }),
    })
    render(<InvoiceEmailsPanel invoiceId={INVOICE_ID} />)

    const [older, newer] = await screen.findAllByRole('listitem')
    expect(within(older).getByText('Copies not recorded')).toBeInTheDocument()
    expect(within(older).getByText('Kind worked out from the subject')).toBeInTheDocument()
    expect(within(newer).getByText('No copies')).toBeInTheDocument()
    expect(within(newer).queryByText('Kind worked out from the subject')).not.toBeInTheDocument()

    fireEvent.click(within(older).getByRole('button', { name: 'Show wording' }))
    expect(within(older).getByText('The wording of this email was not recorded.')).toBeInTheDocument()
  })

  it('notes that earlier emails are missing for an invoice sent before 25 June 2026', async () => {
    actions.getInvoiceEmailHistory.mockResolvedValue({ history: history({ earlierEmailsNotRecorded: true, emails: [] }) })
    render(<InvoiceEmailsPanel invoiceId={INVOICE_ID} />)

    expect(await screen.findByText('Emails sent before 25 June 2026 are not recorded here.')).toBeInTheDocument()
    expect(screen.getByText('No emails recorded')).toBeInTheDocument()
  })

  it('says when the list was cut short', async () => {
    actions.getInvoiceEmailHistory.mockResolvedValue({ history: history({ truncated: true }) })
    render(<InvoiceEmailsPanel invoiceId={INVOICE_ID} />)

    expect(await screen.findByText('Only the latest 100 emails are shown.')).toBeInTheDocument()
  })

  it('announces a refusal from the server', async () => {
    actions.getInvoiceEmailHistory.mockResolvedValue({ error: 'You do not have permission to view invoices' })
    render(<InvoiceEmailsPanel invoiceId={INVOICE_ID} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission to view invoices')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('announces a failed request and tries again on Refresh', async () => {
    actions.getInvoiceEmailHistory.mockRejectedValueOnce(new Error('network down'))
    render(<InvoiceEmailsPanel invoiceId={INVOICE_ID} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('The email history could not be loaded')

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByRole('listitem')).toBeInTheDocument()
    expect(actions.getInvoiceEmailHistory).toHaveBeenCalledTimes(2)
  })

  it('shows an empty state when there is no such invoice', async () => {
    actions.getInvoiceEmailHistory.mockResolvedValue({ history: null })
    render(<InvoiceEmailsPanel invoiceId={INVOICE_ID} />)

    expect(await screen.findByText('No email history')).toBeInTheDocument()
  })

  it('reads again when the invoice changes', async () => {
    const { rerender } = render(<InvoiceEmailsPanel invoiceId={INVOICE_ID} reloadKey="a" />)
    await screen.findByRole('listitem')

    rerender(<InvoiceEmailsPanel invoiceId={INVOICE_ID} reloadKey="b" />)

    await waitFor(() => expect(actions.getInvoiceEmailHistory).toHaveBeenCalledTimes(2))
  })
})
