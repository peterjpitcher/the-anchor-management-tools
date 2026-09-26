import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/mgd',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/app/actions/mgd', () => ({
  getCollections: vi.fn(),
  getReturns: vi.fn(),
  getCurrentReturn: vi.fn(),
  deleteCollection: vi.fn(),
  updateReturnStatus: vi.fn(),
  updateReturnMachineCount: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
}))

import { MgdClient } from '@/app/(authenticated)/mgd/_components/MgdClient'
import type { MgdReturn } from '@/app/actions/mgd'

const openReturn: MgdReturn = {
  id: 'return-1',
  period_start: '2026-08-01',
  period_end: '2026-10-31',
  total_net_take: 1200,
  total_mgd: 240,
  total_vat_on_supplier: 40,
  status: 'open',
  submitted_at: null,
  submitted_by: null,
  date_paid: null,
  machine_count: 1,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  collection_count: 3,
}

describe('MgdClient collections', () => {
  it('shows collections that failed to load as a failure, not as a period with none', () => {
    render(
      <MgdClient
        initialReturn={openReturn}
        initialCollections={[]}
        initialCollectionsError="Database unavailable"
        initialReturns={[openReturn]}
      />,
    )

    const failure = screen.getByText('Database unavailable').closest('[role="alert"]')
    expect(failure).not.toBeNull()
    expect(within(failure as HTMLElement).getByText("Couldn't load collections")).toBeInTheDocument()
    expect(screen.queryByText('No collections for this period')).not.toBeInTheDocument()
    // Exporting would download a stale or empty list, so it is off until the collections load.
    const collectionsCard = screen.getByRole('heading', { name: 'Collections' }).closest('div.bg-surface') as HTMLElement
    expect(within(collectionsCard).getByRole('button', { name: 'Export CSV' })).toBeDisabled()
  })

  it('shows an empty period as empty when the collections loaded', () => {
    render(
      <MgdClient
        initialReturn={openReturn}
        initialCollections={[]}
        initialReturns={[openReturn]}
      />,
    )

    expect(screen.getByText('No collections for this period')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load collections")).not.toBeInTheDocument()
  })
})
