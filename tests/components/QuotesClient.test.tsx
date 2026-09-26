import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import QuotesClient from '@/app/(authenticated)/quotes/_components/QuotesClient'

/**
 * The quotes list. A failed load must say so and must never be drawn as "no quotes" or as an
 * empty table card.
 */

const quoteActions = vi.hoisted(() => ({
  getQuotes: vi.fn(),
  getQuoteSummary: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/quotes',
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({ hasPermission: () => true, loading: false }),
}))

vi.mock('@/app/actions/quotes', () => quoteActions)

const summary = { total_pending: 0, total_expired: 0, total_accepted: 0, draft_badge: 0 }
const permissions = { canCreate: true, canEdit: true, canDelete: true }

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
    expect(screen.queryByText('No quotes found')).not.toBeInTheDocument()
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

    expect(await screen.findByText('No quotes found')).toBeInTheDocument()
    const filterRow = screen.getByPlaceholderText('Search quotes...').closest('.flex-wrap') as HTMLElement
    expect(filterRow.nextElementSibling).toContainElement(screen.getByText('No quotes found'))
  })
})
