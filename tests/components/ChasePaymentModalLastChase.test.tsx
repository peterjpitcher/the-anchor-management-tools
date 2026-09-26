// The "reminder already sent" warning in the chase payment dialog, on the London clock.
//
// The dialog reads when the last reminder went out from the invoice email log (a timestamp) and
// shows the day and time. The dialog only renders in the browser, and formatting without a zone
// used the device's clock, so on a device not set to UK time (a laptop on UTC, say) the time read
// an hour early during British Summer Time and, late in the evening, the day before. The UTC test
// run stands in for such a device.
//
// 23:30 UTC on 1 October 2026 is 00:30 BST on 2 October in London.
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChasePaymentModal } from '@/components/modals/ChasePaymentModal'
import type { InvoiceWithDetails } from '@/types/invoices'

const getInvoiceEmailLogs = vi.hoisted(() => vi.fn())

vi.mock('@/app/actions/email', () => ({
  sendChasePaymentEmail: vi.fn(),
  getInvoiceEmailLogs: (...args: unknown[]) => getInvoiceEmailLogs(...args),
}))

vi.mock('@/components/providers/SupabaseProvider', () => ({
  useSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: [], error: null }),
        }),
      }),
    }),
  }),
}))

const LAST_CHASE_SENT_AT = '2026-10-01T23:30:00Z'
// Ten hours later, well inside the 48-hour window that raises the warning.
const NOW = '2026-10-02T09:30:00Z'

const invoice: InvoiceWithDetails = {
  id: 'invoice-1',
  invoice_number: 'INV-001',
  vendor_id: 'vendor-1',
  invoice_date: '2026-10-01',
  due_date: '2026-10-01',
  status: 'overdue',
  invoice_discount_percentage: 0,
  subtotal_amount: 100,
  discount_amount: 0,
  vat_amount: 20,
  total_amount: 120,
  paid_amount: 0,
  created_at: '2026-10-01T09:00:00.000Z',
  updated_at: '2026-10-01T09:00:00.000Z',
  vendor: {
    id: 'vendor-1',
    name: 'Acme Ltd',
    paypal_payments_enabled: false,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
  line_items: [],
  payments: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  getInvoiceEmailLogs.mockResolvedValue({ logs: [{ created_at: LAST_CHASE_SENT_AT }] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ChasePaymentModal recent reminder warning', () => {
  it('shows when the last reminder was sent on the London clock', async () => {
    render(<ChasePaymentModal invoice={invoice} isOpen onClose={vi.fn()} />)

    expect(
      await screen.findByText(/A payment reminder was already sent on/),
    ).toHaveTextContent('A payment reminder was already sent on 02/10/2026 at 00:30.')
    expect(getInvoiceEmailLogs).toHaveBeenCalledWith('invoice-1')
  })
})
