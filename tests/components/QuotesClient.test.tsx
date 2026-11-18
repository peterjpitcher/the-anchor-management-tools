import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import QuotesClient from '@/app/(authenticated)/quotes/_components/QuotesClient'

/**
 * The quotes list. A failed load must say so and must never be drawn as "no quotes" or as an
 * empty table card.
 */

const routerPush = vi.hoisted(() => vi.fn())
const quoteActions = vi.hoisted(() => ({
  getQuotesPageData: vi.fn(),
}))
const permissionState = vi.hoisted(() => ({ loading: false }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
  usePathname: () => '/quotes',
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({ hasPermission: () => true, loading: permissionState.loading }),
}))

vi.mock('@/app/actions/quotes', () => quoteActions)

const summary = { total_pending: 0, total_expired: 0, total_accepted: 0, draft_badge: 0 }
const permissions = { canCreate: true, canEdit: true, canDelete: true, canExport: true }

describe('QuotesClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    permissionState.loading = false
  })

  it('shows a failed load as an error with no empty state and no empty table card', async () => {
    // The server load failed, so the client retries on mount, and that fails too.
    quoteActions.getQuotesPageData.mockResolvedValue({ error: 'Database unavailable' })

    const { container } = render(
      <QuotesClient
        initialQuotes={[]}
        initialSummary={summary}
        initialStatus="all"
        initialError="Failed to fetch quotes"
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
    quoteActions.getQuotesPageData.mockResolvedValue({ quotes: [], summary })

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
    quoteActions.getQuotesPageData.mockResolvedValue({ quotes: [quote], summary })

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
    quoteActions.getQuotesPageData.mockResolvedValue({ quotes: [], summary })

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
  it('does not fetch again on first mount when the server sent the page, even once permissions finish loading', async () => {
    permissionState.loading = true
    const { rerender } = render(
      <QuotesClient
        initialQuotes={[]}
        initialSummary={summary}
        initialStatus="all"
        initialError={null}
        permissions={permissions}
      />,
    )
    permissionState.loading = false
    rerender(
      <QuotesClient
        initialQuotes={[]}
        initialSummary={summary}
        initialStatus="all"
        initialError={null}
        permissions={permissions}
      />,
    )

    expect(await screen.findByText('No quotes yet')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(quoteActions.getQuotesPageData).not.toHaveBeenCalled()
  })

  it('loads again when the status filter changes, and again on going back to all', async () => {
    const drafts = { total_pending: 1, total_expired: 2, total_accepted: 3, draft_badge: 4 }
    quoteActions.getQuotesPageData.mockResolvedValue({ quotes: [], summary: drafts })
    render(
      <QuotesClient
        initialQuotes={[]}
        initialSummary={summary}
        initialStatus="all"
        initialError={null}
        permissions={permissions}
      />,
    )

    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'draft' } })
    await waitFor(() => expect(quoteActions.getQuotesPageData).toHaveBeenCalledWith('draft'))
    expect(await screen.findByText('4')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'all' } })
    await waitFor(() => expect(quoteActions.getQuotesPageData).toHaveBeenCalledTimes(2))
    expect(quoteActions.getQuotesPageData).toHaveBeenLastCalledWith(undefined)
  })

  it('shows a failed filter change as an error', async () => {
    quoteActions.getQuotesPageData.mockResolvedValue({ error: 'Database unavailable' })
    render(
      <QuotesClient
        initialQuotes={[]}
        initialSummary={summary}
        initialStatus="all"
        initialError={null}
        permissions={permissions}
      />,
    )

    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'sent' } })

    expect(await screen.findByText('Database unavailable')).toBeInTheDocument()
    expect(screen.queryByText('No quotes match these filters')).not.toBeInTheDocument()
  })
})
