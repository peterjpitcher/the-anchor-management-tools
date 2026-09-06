import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Access is checked on the server on every one of the three pages. Hiding a nav
 * item or a button is never the boundary, so these tests drive the page functions
 * themselves rather than anything rendered.
 */

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    // next/navigation's redirect throws so nothing after it runs. The stub has to
    // do the same, or a page would carry on and load data it must never load.
    const error = new Error(`NEXT_REDIRECT:${path}`)
    throw error
  })
)

const currentUserCanUseMaintenanceMock = vi.hoisted(() => vi.fn())
const getMaintenanceAreasMock = vi.hoisted(() => vi.fn())
const getMaintenanceItemsMock = vi.hoisted(() => vi.fn())
const getMaintenanceItemMock = vi.hoisted(() => vi.fn())
const getMaintenanceCostsMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/maintenance',
}))

vi.mock('@/app/actions/maintenance', () => ({
  currentUserCanUseMaintenance: currentUserCanUseMaintenanceMock,
  getMaintenanceAreas: getMaintenanceAreasMock,
  getMaintenanceItems: getMaintenanceItemsMock,
  getMaintenanceItem: getMaintenanceItemMock,
  getMaintenanceCosts: getMaintenanceCostsMock,
  createMaintenanceItem: vi.fn(),
  updateMaintenanceItem: vi.fn(),
  addMaintenanceNote: vi.fn(),
  getMaintenanceTimeline: vi.fn(),
}))

vi.mock('@/app/actions/maintenance-photos', () => ({
  listMaintenancePhotos: vi.fn(),
  requestMaintenancePhotoUpload: vi.fn(),
  confirmMaintenancePhotoUpload: vi.fn(),
}))

import MaintenancePage from '@/app/(authenticated)/maintenance/page'
import NewMaintenanceItemPage from '@/app/(authenticated)/maintenance/new/page'
import MaintenanceItemPage from '@/app/(authenticated)/maintenance/[id]/page'

const ITEM_ID = '22222222-2222-4222-8222-222222222222'

describe('maintenance pages, server-side access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getMaintenanceAreasMock.mockResolvedValue({ success: true, data: [] })
    getMaintenanceItemsMock.mockResolvedValue({
      success: true,
      data: { items: [], nextCursor: null, hasMore: false },
    })
    getMaintenanceCostsMock.mockResolvedValue({ success: true, data: null })
    getMaintenanceItemMock.mockResolvedValue({ success: true, data: null })
  })

  it('sends a caller without access away from the list', async () => {
    currentUserCanUseMaintenanceMock.mockResolvedValue(false)

    await expect(MaintenancePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_REDIRECT:/unauthorized'
    )
    expect(redirectMock).toHaveBeenCalledWith('/unauthorized')
    // The check happens before anything is read, so no data is fetched at all.
    expect(getMaintenanceItemsMock).not.toHaveBeenCalled()
    expect(getMaintenanceCostsMock).not.toHaveBeenCalled()
  })

  it('sends a caller without access away from the new-item page', async () => {
    currentUserCanUseMaintenanceMock.mockResolvedValue(false)

    await expect(NewMaintenanceItemPage()).rejects.toThrow('NEXT_REDIRECT:/unauthorized')
    expect(redirectMock).toHaveBeenCalledWith('/unauthorized')
    expect(getMaintenanceAreasMock).not.toHaveBeenCalled()
  })

  it('sends a caller without access away from an item page', async () => {
    currentUserCanUseMaintenanceMock.mockResolvedValue(false)

    await expect(
      MaintenanceItemPage({ params: Promise.resolve({ id: ITEM_ID }) })
    ).rejects.toThrow('NEXT_REDIRECT:/unauthorized')
    expect(redirectMock).toHaveBeenCalledWith('/unauthorized')
    expect(getMaintenanceItemMock).not.toHaveBeenCalled()
  })

  it('lets a super-admin through to the list', async () => {
    currentUserCanUseMaintenanceMock.mockResolvedValue(true)

    await MaintenancePage({ searchParams: Promise.resolve({}) })

    expect(redirectMock).not.toHaveBeenCalled()
    expect(getMaintenanceItemsMock).toHaveBeenCalledTimes(1)
  })

  it('redirects when an item read comes back denied', async () => {
    currentUserCanUseMaintenanceMock.mockResolvedValue(true)
    getMaintenanceItemMock.mockResolvedValue({
      success: false,
      code: 'forbidden',
      error: 'Insufficient permissions',
    })

    await expect(
      MaintenanceItemPage({ params: Promise.resolve({ id: ITEM_ID }) })
    ).rejects.toThrow('NEXT_REDIRECT:/unauthorized')
  })

  it('tells a missing item apart from a failed read', async () => {
    currentUserCanUseMaintenanceMock.mockResolvedValue(true)

    getMaintenanceItemMock.mockResolvedValue({ success: true, data: null })
    const missing = await MaintenanceItemPage({ params: Promise.resolve({ id: ITEM_ID }) })
    expect(JSON.stringify(missing)).toContain('That item is not here')

    getMaintenanceItemMock.mockResolvedValue({
      success: false,
      code: 'db_error',
      error: 'Could not load that item.',
    })
    const broken = await MaintenanceItemPage({ params: Promise.resolve({ id: ITEM_ID }) })
    expect(JSON.stringify(broken)).toContain('Could not load this item')
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('loads switched-off areas on the list and the item, but not on the new-item form', async () => {
    currentUserCanUseMaintenanceMock.mockResolvedValue(true)
    getMaintenanceItemMock.mockResolvedValue({
      success: true,
      data: {
        id: ITEM_ID,
        reference: 'MNT-0001',
        kind: 'issue',
        title: 'Signage light out',
        description: null,
        areaId: '11111111-1111-4111-8111-111111111111',
        areaName: 'Signage',
        status: 'reported',
        priority: 'medium',
        responsibility: 'us',
        reportedOn: '2026-09-01',
        targetDate: null,
        completedOn: null,
        estimatedCost: null,
        actualCost: null,
        contractorName: null,
        contractorContact: null,
        createdBy: null,
        createdByEmail: 'peter@example.com',
        createdAt: '2026-09-01T09:00:00.000Z',
        updatedAt: '2026-09-01T09:00:00.000Z',
      },
    })
    getMaintenanceAreasMock.mockResolvedValue({
      success: true,
      data: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Signage',
          sortOrder: 1,
          active: false,
          createdAt: '2026-09-01T09:00:00.000Z',
          updatedAt: '2026-09-01T09:00:00.000Z',
        },
      ],
    })

    // The list keeps an inactive area so the filter can still name it.
    await MaintenancePage({ searchParams: Promise.resolve({}) })
    expect(getMaintenanceAreasMock).toHaveBeenLastCalledWith(true)

    // The item keeps it so the area it sits in is shown rather than blank.
    await MaintenanceItemPage({ params: Promise.resolve({ id: ITEM_ID }) })
    expect(getMaintenanceAreasMock).toHaveBeenLastCalledWith(true)

    // Nothing new may be logged against one, so the form asks for active areas only.
    await NewMaintenanceItemPage()
    expect(getMaintenanceAreasMock).toHaveBeenLastCalledWith()
  })
})
