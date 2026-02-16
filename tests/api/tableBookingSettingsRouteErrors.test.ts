import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/settings/api-auth', () => ({
  requireSettingsManagePermission: vi.fn(),
}))

import { requireSettingsManagePermission } from '@/lib/settings/api-auth'
import { GET as getSpaceAreaLinks } from '@/app/api/settings/table-bookings/space-area-links/route'
import { GET as getTableSetup, PUT as putTableSetup } from '@/app/api/settings/table-bookings/tables/route'

describe('table-booking settings route error payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a generic 500 payload when space-area mapping load fails', async () => {
    const venueSpacesOrder = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'sensitive venue-space diagnostics' },
    })
    const venueSpacesSelect = vi.fn().mockReturnValue({ order: venueSpacesOrder })

    const tableAreasOrder = vi.fn().mockResolvedValue({ data: [], error: null })
    const tableAreasSelect = vi.fn().mockReturnValue({ order: tableAreasOrder })

    const linksOrderSecond = vi.fn().mockResolvedValue({ data: [], error: null })
    const linksOrderFirst = vi.fn().mockReturnValue({ order: linksOrderSecond })
    const linksSelect = vi.fn().mockReturnValue({ order: linksOrderFirst })

    ;(requireSettingsManagePermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      supabase: {
        from: vi.fn((table: string) => {
          if (table === 'venue_spaces') {
            return { select: venueSpacesSelect }
          }
          if (table === 'table_areas') {
            return { select: tableAreasSelect }
          }
          if (table === 'venue_space_table_areas') {
            return { select: linksSelect }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
      },
    })

    const response = await getSpaceAreaLinks()
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Failed to load private-booking space mappings' })
  })

  it('returns a generic 500 payload when table setup load fails', async () => {
    const tablesOrderSecond = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'sensitive table setup diagnostics' },
    })
    const tablesOrderFirst = vi.fn().mockReturnValue({ order: tablesOrderSecond })
    const tablesSelect = vi.fn().mockReturnValue({ order: tablesOrderFirst })

    const linksOrderSecond = vi.fn().mockResolvedValue({ data: [], error: null })
    const linksOrderFirst = vi.fn().mockReturnValue({ order: linksOrderSecond })
    const linksSelect = vi.fn().mockReturnValue({ order: linksOrderFirst })

    const areasOrder = vi.fn().mockResolvedValue({ data: [], error: null })
    const areasSelect = vi.fn().mockReturnValue({ order: areasOrder })

    ;(requireSettingsManagePermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      supabase: {
        from: vi.fn((table: string) => {
          if (table === 'tables') {
            return { select: tablesSelect }
          }
          if (table === 'table_join_links') {
            return { select: linksSelect }
          }
          if (table === 'table_areas') {
            return { select: areasSelect }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
      },
    })

    const response = await getTableSetup()
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Failed to load table setup' })
  })

  it('returns a generic 500 payload when post-update table setup refresh fails', async () => {
    let tableJoinLinkSelectCallCount = 0
    const tableJoinLinksRefreshOrderSecond = vi.fn().mockResolvedValue({ data: [], error: null })
    const tableJoinLinksRefreshOrderFirst = vi.fn().mockReturnValue({ order: tableJoinLinksRefreshOrderSecond })
    const tableJoinLinksSelect = vi.fn().mockImplementation(() => {
      tableJoinLinkSelectCallCount += 1
      if (tableJoinLinkSelectCallCount === 1) {
        return Promise.resolve({ data: [], error: null })
      }
      return { order: tableJoinLinksRefreshOrderFirst }
    })

    const tablesOrderSecond = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'sensitive refresh diagnostics' },
    })
    const tablesOrderFirst = vi.fn().mockReturnValue({ order: tablesOrderSecond })
    const tablesSelect = vi.fn().mockReturnValue({ order: tablesOrderFirst })

    const areasOrder = vi.fn().mockResolvedValue({ data: [], error: null })
    const areasSelect = vi.fn().mockReturnValue({ order: areasOrder })

    ;(requireSettingsManagePermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase: {
        from: vi.fn((table: string) => {
          if (table === 'table_join_links') {
            return { select: tableJoinLinksSelect }
          }
          if (table === 'tables') {
            return { select: tablesSelect }
          }
          if (table === 'table_areas') {
            return { select: areasSelect }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
      },
    })

    const request = new Request('http://localhost/api/settings/table-bookings/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ join_links: [] }),
    })

    const response = await putTableSetup(request as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Failed to refresh table setup' })
  })
})
