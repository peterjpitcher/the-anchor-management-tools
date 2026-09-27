import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import QuotesClient from '@/app/(authenticated)/quotes/_components/QuotesClient'

/**
 * The quotes list. A failed load must say so and must never be drawn as "no quotes" or as an
 * empty table card.
 */

const routerPush = vi.hoisted(() => vi.fn())
const quoteActions = vi.hoisted(() => ({
  getQuotes: vi.fn(),
  getQuoteSummary: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
  usePathname: () => '/quotes',
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({ hasPermission: () => true, loading: false }),
}))

vi.mock('@/app/actions/quotes', () => quoteActions)

const summary = { total_pending: 0, total_expired: 0, total_accepted: 0, draft_badge: 0 }
const permissions = { canCreate: true, canEdit: true, canDelete: true, canExport: true }

describe('QuotesClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    quoteActions.getQuoteSummary.mockResolvedValue({ summary })
  })

  it('shows a failed load as an error with no empty state and no empty table card', async () => {
    quoteActions.getQuotes.mockResolvedValue({ error: 'Database unavailable' })

    const { container } = render(
      <QuotesClient
        initialQuotes={[]}
        initialSummary={summary}
        initialStatus="all"
        initialError={null}
        permissions={permissions}
      />,
    )

    expect(await screen.findByText('Database unavailable')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.queryByText('No quotes yet')).not.toBeInTheDocument()
    expect(container.querySelector('table')).toBeNull()
    // Nothing after the filter row: an empty framed card under the error reads as an empty list.
    const filterRow = screen.getByPlaceholderText('Search quotes...').closest('.flex-wrap') as HTMLElement
    expect(filterRow.nextElementSibling).toBeNull()
  })

  it('shows the empty state when the load worked and there are no quotes', async () => {
    quoteActions.getQuotes.mockResolvedValue({ quotes: [] })

    render(
      <QuotesClient
        initialQuotes={[]}
        initialSummary={summary}
        initialStatus="all"
        initialError={null}
        permissions={permissions}
      />,
    )

    expect(await screen.findByText('No quotes yet')).toBeInTheDocument()
    const filterRow = screen.getByPlaceholderText('Search quotes...').closest('.flex-wrap') as HTMLElement
    expect(filterRow.nextElementSibling).toContainElement(screen.getByText('No quotes yet'))
  })

  it('opens a quote from its phone row with the keyboard, but not from the Convert button inside it', async () => {
    const quote = {
      id: 'quote-1',
      quote_number: 'Q-001',
      vendor_id: 'vendor-1',
      quote_date: '2026-09-01',
      valid_until: '2026-10-01',
      status: 'accepted' as const,
      quote_discount_percentage: 0,
      subtotal_amount: 100,
      discount_amount: 0,
      vat_amount: 20,
      total_amount: 120,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    }
    quoteActions.getQuotes.mockResolvedValue({ quotes: [quote] })

    render(
      <QuotesClient
        initialQuotes={[quote]}
        initialSummary={summary}
        initialStatus="all"
        initialError={null}
        permissions={permissions}
      />,
    )

    const row = (await screen.findAllByRole('button', { name: /Q-001/ }))[0]
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(routerPush).toHaveBeenCalledWith('/quotes/quote-1')

    routerPush.mockClear()
    const convertInRow = Array.from(row.querySelectorAll('button')).find((button) => button.textContent === 'Convert to Invoice')
    expect(convertInRow).toBeDefined()
    fireEvent.keyDown(convertInRow as HTMLElement, { key: 'Enter' })
    expect(routerPush).not.toHaveBeenCalledWith('/quotes/quote-1')
  })

  it('names the search box for screen readers', () => {
    quoteActions.getQuotes.mockResolvedValue({ quotes: [] })

    render(
      <QuotesClient
        initialQuotes={[]}
        initialSummary={summary}
        initialStatus="all"
        initialError={null}
        permissions={permissions}
      />,
    )

    expect(screen.getByRole('textbox', { name: 'Search quotes by number, client or reference' })).toBeInTheDocument()
  })
})
