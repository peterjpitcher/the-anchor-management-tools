import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import EditRecurringInvoicePage from '@/app/(authenticated)/invoices/recurring/[id]/edit/page'

/**
 * Cancel on the recurring invoice edit form goes where the back button goes: back to the
 * recurring invoice it edits, not to the list.
 */

const routerPush = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ id: 'recurring-1' }),
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({ loading: false, hasPermission: () => true }),
}))

vi.mock('@/app/actions/recurring-invoices', () => ({
  getRecurringInvoice: vi.fn().mockResolvedValue({
    recurringInvoice: {
      id: 'recurring-1',
      vendor_id: 'vendor-1',
      frequency: 'monthly',
      start_date: '2026-09-01',
      next_invoice_date: '2026-10-01',
      days_before_due: 30,
      invoice_discount_percentage: 0,
      is_active: true,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
      line_items: [
        { id: 'line-1', description: 'Retainer', quantity: 1, unit_price: 100, discount_percentage: 0, vat_rate: 20 },
      ],
    },
  }),
  updateRecurringInvoice: vi.fn(),
}))

vi.mock('@/app/actions/vendors', () => ({
  getVendors: vi.fn().mockResolvedValue({ vendors: [{ id: 'vendor-1', name: 'Acme Ltd' }] }),
}))

vi.mock('@/app/actions/invoices', () => ({
  getLineItemCatalog: vi.fn().mockResolvedValue({ items: [] }),
}))

describe('Edit recurring invoice', () => {
  it('sends Cancel and the back button to the recurring invoice', async () => {
    render(<EditRecurringInvoicePage />)

    const back = (await screen.findAllByRole('button', { name: 'Back to Recurring Invoice' }))[0]
    fireEvent.click(back)
    expect(routerPush).toHaveBeenLastCalledWith('/invoices/recurring/recurring-1')

    routerPush.mockClear()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(routerPush).toHaveBeenLastCalledWith('/invoices/recurring/recurring-1')
  })
})
