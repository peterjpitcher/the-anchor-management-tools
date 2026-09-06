import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MaintenanceListClient } from '@/app/(authenticated)/maintenance/_components/MaintenanceListClient'
import {
  DEFAULT_MAINTENANCE_FILTERS,
  MAINTENANCE_FILTERS_STORAGE_KEY,
} from '@/app/(authenticated)/maintenance/_components/maintenanceFilters'
import type { MaintenanceArea, MaintenanceCostSummary, MaintenanceItem } from '@/types/maintenance'

const routerReplaceMock = vi.hoisted(() => vi.fn())
const getMaintenanceItemsMock = vi.hoisted(() => vi.fn())
const getMaintenanceCostsMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/maintenance',
}))

vi.mock('@/app/actions/maintenance', () => ({
  getMaintenanceItems: getMaintenanceItemsMock,
  getMaintenanceCosts: getMaintenanceCostsMock,
}))

const areas: MaintenanceArea[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Cellar',
    sortOrder: 1,
    active: true,
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
  },
]

function buildItem(overrides: Partial<MaintenanceItem> = {}): MaintenanceItem {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    reference: 'MNT-0001',
    kind: 'issue',
    title: 'Cellar cooler tripping out',
    description: null,
    areaId: areas[0].id,
    areaName: 'Cellar',
    status: 'reported',
    priority: 'high',
    responsibility: 'us',
    reportedOn: '2026-09-01',
    targetDate: '2026-09-10',
    completedOn: null,
    estimatedCost: null,
    actualCost: null,
    contractorName: null,
    contractorContact: null,
    createdBy: null,
    createdByEmail: 'peter@example.com',
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
    ...overrides,
  }
}

const costs: MaintenanceCostSummary = {
  ourOpenEstimate: 250.5,
  ourUncostedCount: 3,
  greeneKingOpenEstimate: 0,
  greeneKingUncostedCount: 2,
  toConfirmOpenEstimate: 40,
  toConfirmUncostedCount: 1,
  openCount: 7,
  overdueCount: 2,
}

function renderList(overrides: Partial<React.ComponentProps<typeof MaintenanceListClient>> = {}) {
  return render(
    <MaintenanceListClient
      areas={areas}
      initialFilters={DEFAULT_MAINTENANCE_FILTERS}
      initialItems={[buildItem()]}
      initialNextCursor={null}
      initialHasMore={false}
      initialCosts={costs}
      todayIsoDate="2026-09-06"
      {...overrides}
    />
  )
}

/** The Stat block a label belongs to, so a value can be read next to its own label. */
function statFor(label: string): HTMLElement {
  const labelNode = screen.getByText(label)
  const stat = labelNode.parentElement
  if (!stat) throw new Error(`No stat found for ${label}`)
  return stat
}

describe('MaintenanceListClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
    getMaintenanceItemsMock.mockResolvedValue({
      success: true,
      data: { items: [buildItem()], nextCursor: null, hasMore: false },
    })
    getMaintenanceCostsMock.mockResolvedValue({ success: true, data: costs })
  })

  it('shows the uncosted count as its own figure, never folded into the money total', () => {
    renderList()

    const estimate = statFor('Our open estimate')
    const uncosted = statFor('Uncosted')

    // Two separate blocks, so a null estimate can never be read as a nil amount.
    expect(estimate).not.toBe(uncosted)
    expect(estimate.textContent).toContain('£250.50')
    expect(uncosted.textContent).toContain('3')
    expect(uncosted.textContent).toContain('Open items of ours with no estimate')
    // The money figure carries no count, and the count carries no money.
    expect(estimate.textContent).not.toContain('3 uncosted')
    expect(uncosted.textContent).not.toContain('£')
  })

  it('keeps an uncosted count visible when the estimate itself is nil', () => {
    renderList({
      initialCosts: { ...costs, ourOpenEstimate: 0, ourUncostedCount: 4 },
    })

    expect(statFor('Our open estimate').textContent).toContain('£0.00')
    expect(statFor('Uncosted').textContent).toContain('4')
  })

  it('shows an item without an estimate as not costed rather than as nil', () => {
    renderList({ initialItems: [buildItem({ estimatedCost: null })] })

    expect(screen.getAllByText('Not costed').length).toBeGreaterThan(0)
  })

  it('remembers the filters and restores them on a return visit', async () => {
    const first = renderList()

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'done' } })

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith('/maintenance?status=done', { scroll: false })
    })
    expect(window.sessionStorage.getItem(MAINTENANCE_FILTERS_STORAGE_KEY)).toBe('status=done')
    await waitFor(() => {
      expect(getMaintenanceItemsMock).toHaveBeenCalledWith({
        filters: { statuses: ['done'] },
      })
    })

    // Leave the page, then come back to a bare /maintenance URL.
    first.unmount()
    cleanup()
    vi.clearAllMocks()

    renderList()

    await waitFor(() => {
      expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('done')
    })
    expect(getMaintenanceItemsMock).toHaveBeenCalledWith({ filters: { statuses: ['done'] } })
  })

  it('sends the overdue toggle as a real boolean, never as a string', async () => {
    renderList()

    const toggle = screen.getByLabelText('Overdue only')
    expect(toggle).toBeInTheDocument()
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(getMaintenanceItemsMock).toHaveBeenCalledWith({
        filters: { statuses: expect.any(Array), overdueOnly: true },
      })
    })

    // Turning it back off drops the filter rather than sending 'false'.
    fireEvent.click(screen.getByLabelText('Overdue only'))
    await waitFor(() => {
      expect(getMaintenanceItemsMock).toHaveBeenLastCalledWith({
        filters: { statuses: expect.any(Array) },
      })
    })
  })

  it('reports a load failure rather than drawing an empty list', async () => {
    getMaintenanceItemsMock.mockResolvedValue({
      success: false,
      error: 'Could not load the maintenance list.',
    })

    renderList()
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'critical' } })

    await waitFor(() => {
      expect(screen.getByText('Could not load the maintenance list.')).toBeInTheDocument()
    })
    expect(screen.queryByText('Nothing logged yet')).not.toBeInTheDocument()
  })

  it('reports a list request that never came back, rather than spinning for ever', async () => {
    getMaintenanceItemsMock.mockRejectedValue(new Error('Failed to fetch'))

    renderList()
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'critical' } })

    await waitFor(() => {
      expect(
        screen.getByText('Could not load the maintenance list. Check your connection and try again.')
      ).toBeInTheDocument()
    })
    expect(screen.queryByText('Loading the list')).not.toBeInTheDocument()
  })

  it('keeps a switched-off area in the filter, so the control never lies about the list', async () => {
    const signage: MaintenanceArea = {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Signage',
      sortOrder: 2,
      active: false,
      createdAt: '2026-09-01T09:00:00.000Z',
      updatedAt: '2026-09-01T09:00:00.000Z',
    }

    renderList({
      areas: [areas[0], signage],
      initialFilters: { ...DEFAULT_MAINTENANCE_FILTERS, areaId: signage.id },
    })

    const areaFilter = screen.getByLabelText('Area') as HTMLSelectElement
    // The filter still reads as Signage, not as "All areas" over a filtered list.
    expect(areaFilter.value).toBe(signage.id)
    expect(screen.getByRole('option', { name: 'Signage (off)' })).toBeInTheDocument()

    // And it is still selectable, so the filter can be moved off it and back.
    fireEvent.change(areaFilter, { target: { value: areas[0].id } })
    await waitFor(() => {
      expect(getMaintenanceItemsMock).toHaveBeenCalledWith({
        filters: { statuses: expect.any(Array), areaId: areas[0].id },
      })
    })
    fireEvent.change(areaFilter, { target: { value: signage.id } })
    await waitFor(() => {
      expect(getMaintenanceItemsMock).toHaveBeenLastCalledWith({
        filters: { statuses: expect.any(Array), areaId: signage.id },
      })
    })
  })
})
