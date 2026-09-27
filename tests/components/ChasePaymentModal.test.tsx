import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChasePaymentModal } from '@/components/modals/ChasePaymentModal'
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
