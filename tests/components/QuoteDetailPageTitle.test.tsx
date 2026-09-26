import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import QuoteDetailPage from '@/app/(authenticated)/quotes/[id]/page'
import type { QuoteWithDetails } from '@/types/invoices'

/**
 * The quote number is only known once the quote has loaded, so the page title stays "Quote" in
 * every state and the number sits in the subtitle.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({ loading: false, hasPermission: () => true }),
}))

const mockGetQuote = vi.fn()

vi.mock('@/app/actions/quotes', () => ({
  getQuote: (...args: unknown[]) => mockGetQuote(...args),
  updateQuoteStatus: vi.fn(),
  convertQuoteToInvoice: vi.fn(),
  deleteQuote: vi.fn(),
}))

vi.mock('@/app/actions/email', () => ({
  getEmailConfigStatus: vi.fn().mockResolvedValue({ configured: false }),
}))

vi.mock('@/components/modals/EmailQuoteModal', () => ({
  EmailQuoteModal: () => null,
}))

const quote: QuoteWithDetails = {
  id: 'quote-1',
  quote_number: 'Q-001',
  vendor_id: 'vendor-1',
  quote_date: '2026-09-01',
  valid_until: '2026-10-01',
  reference: 'PO-7',
  status: 'draft',
  quote_discount_percentage: 0,
  subtotal_amount: 100,
  discount_amount: 0,
  vat_amount: 20,
  total_amount: 120,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  line_items: [],
}

function pageTitles(): string[] {
  return screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent ?? '')
}

describe('Quote detail page title', () => {
  it('is "Quote" while loading and once loaded, with the number in the subtitle', async () => {
    let resolveQuote: (value: { quote: QuoteWithDetails }) => void = () => {}
    mockGetQuote.mockReturnValue(new Promise((resolve) => { resolveQuote = resolve }))

    render(<QuoteDetailPage params={Promise.resolve({ id: 'quote-1' })} />)

    expect(pageTitles().every((title) => title === 'Quote')).toBe(true)

    resolveQuote({ quote })

    expect((await screen.findAllByText('Q-001 · Reference: PO-7')).length).toBeGreaterThan(0)
    expect(pageTitles().every((title) => title === 'Quote')).toBe(true)
  })

  it('keeps the same title when the quote fails to load', async () => {
    mockGetQuote.mockResolvedValue({ error: 'Quote not found' })

    render(<QuoteDetailPage params={Promise.resolve({ id: 'quote-1' })} />)

    await waitFor(() => expect(screen.getAllByText('Quote not found').length).toBeGreaterThan(0))
    expect(pageTitles().every((title) => title === 'Quote')).toBe(true)
  })
})
