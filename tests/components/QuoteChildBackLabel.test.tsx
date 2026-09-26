import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import EditQuotePage from '@/app/(authenticated)/quotes/[id]/edit/page'
import ConvertQuotePage from '@/app/(authenticated)/quotes/[id]/convert/page'
import type { QuoteWithDetails } from '@/types/invoices'

/**
 * The edit and convert pages go back to the quote page and name it as that page is titled
 * ("Quote Q-001"), with "Back to Quote" only until the quote has loaded. Cancel is a link to the
 * same place.
 */

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({ loading: false, hasPermission: () => true }),
}))

const mockGetQuote = vi.fn()

vi.mock('@/app/actions/quotes', () => ({
  getQuote: (...args: unknown[]) => mockGetQuote(...args),
  updateQuote: vi.fn(),
  convertQuoteToInvoice: vi.fn(),
}))

vi.mock('@/app/actions/vendors', () => ({
  getVendors: vi.fn().mockResolvedValue({ vendors: [] }),
}))

const quote: QuoteWithDetails = {
  id: 'quote-1',
  quote_number: 'Q-001',
  vendor_id: 'vendor-1',
  quote_date: '2026-09-01',
  valid_until: '2026-10-01',
  status: 'accepted',
  quote_discount_percentage: 0,
  subtotal_amount: 100,
  discount_amount: 0,
  vat_amount: 20,
  total_amount: 120,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  line_items: [],
}

describe('Quote child page back button', () => {
  it('names the quote page on the edit page, and Cancel goes to the same place', async () => {
    mockGetQuote.mockResolvedValue({ quote: { ...quote, status: 'draft' } })

    render(<EditQuotePage params={Promise.resolve({ id: 'quote-1' })} />)

    expect((await screen.findAllByRole('button', { name: 'Back to Quote Q-001' })).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/quotes/quote-1')
  })

  it('names the quote page on the convert page, and Cancel goes to the same place', async () => {
    mockGetQuote.mockResolvedValue({ quote })

    render(<ConvertQuotePage params={Promise.resolve({ id: 'quote-1' })} />)

    expect((await screen.findAllByRole('button', { name: 'Back to Quote Q-001' })).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/quotes/quote-1')
  })
})
