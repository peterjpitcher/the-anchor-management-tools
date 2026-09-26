import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import QuoteDetailPage from '@/app/(authenticated)/quotes/[id]/page'
import type { QuoteWithDetails } from '@/types/invoices'

/**
 * The quote page loads the quote on the server, as the invoice page does, so it is titled with the
 * quote number ("Quote Q-001") from its first render and never shows a different title.
 */

const notFound = vi.hoisted(() => vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  notFound,
  redirect: vi.fn(),
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({ loading: false, hasPermission: () => true }),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn().mockResolvedValue(true),
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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is "Quote <number>" from the first render, with the reference in the first card', async () => {
    mockGetQuote.mockResolvedValue({ quote })

    render(await QuoteDetailPage({ params: Promise.resolve({ id: 'quote-1' }) }))

    expect(pageTitles().length).toBeGreaterThan(0)
    expect(pageTitles().every((title) => title === 'Quote Q-001')).toBe(true)
    expect(screen.getByText('PO-7')).toBeInTheDocument()
  })

  it('shows the not-found page when the quote fails to load', async () => {
    mockGetQuote.mockResolvedValue({ error: 'Failed to fetch quote' })

    await expect(QuoteDetailPage({ params: Promise.resolve({ id: 'quote-1' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalledTimes(1)
  })
})
