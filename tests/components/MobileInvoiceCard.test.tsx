import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MobileInvoiceCard } from '@/app/(authenticated)/invoices/MobileInvoiceCard'
import type { InvoiceWithDetails } from '@/types/invoices'

/**
 * One row of the phone invoice list. It sits inside the list's own Card, whose divide-y draws the
 * lines between rows, so the row must not carry a border of its own: any border utility on it is
 * emitted after divide-y and would hide the dividers.
 */

const invoice: InvoiceWithDetails = {
  id: 'invoice-1',
  invoice_number: 'INV-001',
  vendor_id: 'vendor-1',
  invoice_date: '2026-04-01',
  due_date: '2026-04-15',
  status: 'sent',
  invoice_discount_percentage: 0,
  subtotal_amount: 100,
  discount_amount: 0,
  vat_amount: 20,
  total_amount: 120,
  paid_amount: 0,
  created_at: '2026-04-01T00:00:00.000Z',
  updated_at: '2026-04-01T00:00:00.000Z',
  vendor: {
    id: 'vendor-1',
    name: 'Acme Supplies',
    is_active: true,
    paypal_payments_enabled: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
  line_items: [],
  payments: [],
}

describe('MobileInvoiceCard', () => {
  it('is a clickable row with no border of its own', () => {
    const onClick = vi.fn()
    const { container } = render(<MobileInvoiceCard invoice={invoice} onClick={onClick} onDownload={vi.fn()} />)

    const row = container.firstElementChild as HTMLElement
    expect(row).toHaveAttribute('role', 'button')
    expect(row).toHaveAttribute('tabindex', '0')
    expect(row.className.split(/\s+/).some((cls) => cls === 'border' || cls.startsWith('border-'))).toBe(false)

    fireEvent.click(row)
    expect(onClick).toHaveBeenCalledWith(invoice)
  })

  it('downloads without opening the invoice', () => {
    const onClick = vi.fn()
    const onDownload = vi.fn()
    render(<MobileInvoiceCard invoice={invoice} onClick={onClick} onDownload={onDownload} />)

    fireEvent.click(screen.getByRole('button', { name: 'Download invoice INV-001' }))

    expect(onDownload).toHaveBeenCalledWith(invoice)
    expect(onClick).not.toHaveBeenCalled()
  })
})
