import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getShortLinks = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/short-links',
}))

vi.mock('@/app/actions/short-links', () => ({
  getShortLinks: (...args: unknown[]) => getShortLinks(...args),
  deleteShortLink: vi.fn(),
}))

// The modals and the row menu are not under test and reach for server actions of their own.
vi.mock('@/app/(authenticated)/short-links/_components/ShortLinkFormModal', () => ({ ShortLinkFormModal: () => null }))
vi.mock('@/app/(authenticated)/short-links/_components/ShortLinkAnalyticsModal', () => ({ ShortLinkAnalyticsModal: () => null }))
vi.mock('@/app/(authenticated)/short-links/_components/ShortLinkActionsMenu', () => ({ ShortLinkActionsMenu: () => null }))

import { ShortLinksClient } from '@/app/(authenticated)/short-links/_components/ShortLinksClient'

function renderClient(initialError: string | null) {
  return render(
    <ShortLinksClient
      initialLinks={[]}
      initialTotal={0}
      initialLinkTotal={0}
      initialError={initialError}
      volume={[]}
      previousVolume={[]}
      canManage={false}
    />,
  )
}

describe('ShortLinksClient when the list cannot be read', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('says the read failed instead of claiming there are no links', () => {
    renderClient('Database unavailable')

    expect(screen.getByText('Could not load short links')).toBeInTheDocument()
    expect(screen.getByText('Database unavailable')).toBeInTheDocument()
    expect(screen.queryByText('No short links yet')).not.toBeInTheDocument()
  })

  it('shows the list again once a retry succeeds', async () => {
    getShortLinks.mockResolvedValue({ data: [], total: 0, linkTotal: 0, page: 1 })
    renderClient('Database unavailable')

    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))

    await waitFor(() => expect(screen.getByText('No short links yet')).toBeInTheDocument())
    expect(screen.queryByText('Could not load short links')).not.toBeInTheDocument()
    expect(getShortLinks).toHaveBeenCalledWith(1, 25, false, undefined)
  })

  it('shows the empty state when the read worked and there is nothing to list', () => {
    renderClient(null)
    expect(screen.getByText('No short links yet')).toBeInTheDocument()
  })
})
