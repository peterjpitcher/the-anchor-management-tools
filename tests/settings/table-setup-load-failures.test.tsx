import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TableSetupManager } from '@/app/(authenticated)/settings/table-bookings/TableSetupManager'
import { SeasonalPeriods } from '@/app/(authenticated)/settings/table-bookings/SeasonalPeriods'

vi.mock('@/ds/primitives/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

/**
 * A settings block that failed to load must say so. Showing the default values instead (30 covers,
 * kitchen pacing off, deposits on) invites a save that writes those defaults over the real settings,
 * and an empty list reads as "nothing is set up".
 */

type Reply = { status: number; body: unknown }

function stubFetch(replies: Record<string, Reply>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const reply = replies[url]
      if (!reply) throw new Error(`Unexpected fetch in test: ${url}`)
      return { ok: reply.status < 400, status: reply.status, json: async () => reply.body } as Response
    }),
  )
}

const OK_TABLES: Reply = {
  status: 200,
  body: {
    success: true,
    data: {
      tables: [{ id: 't1', name: 'Window', table_number: '1', capacity: 4, area_id: null, area: null, is_bookable: true }],
      join_links: [],
      areas: [],
    },
  },
}
const OK_SPACE_AREAS: Reply = { status: 200, body: { success: true, data: { venue_spaces: [], areas: [], space_area_links: [] } } }
const OK_KITCHEN: Reply = {
  status: 200,
  body: {
    success: true,
    data: {
      enabled: true,
      window_minutes: 30,
      pace_covers_regular: 25,
      pace_covers_sunday: 20,
      walk_in_reserve_regular: 6,
      walk_in_reserve_sunday: 6,
    },
  },
}
const FAILED: Reply = { status: 500, body: { success: false, error: 'Database unavailable' } }

describe('table setup blocks that fail to load', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the pacing and join group errors instead of default values and an empty list', async () => {
    stubFetch({
      '/api/settings/table-bookings/tables': OK_TABLES,
      '/api/settings/table-bookings/space-area-links': OK_SPACE_AREAS,
      '/api/settings/table-bookings/pacing': FAILED,
      '/api/settings/table-bookings/kitchen-pacing': OK_KITCHEN,
      '/api/settings/table-bookings/join-groups': FAILED,
    })

    render(<TableSetupManager />)

    expect(await screen.findByText('Could not load pacing settings')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save Pacing Settings' })).not.toBeInTheDocument()
    expect(await screen.findByText('Could not load join groups')).toBeInTheDocument()
    expect(screen.queryByText('No join groups yet')).not.toBeInTheDocument()
    // The blocks that did load still work.
    expect(await screen.findByRole('button', { name: 'Save Kitchen Pacing Settings' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Window')).toBeInTheDocument()
  })

  it('shows the tables error rather than "No tables yet", and will not save an empty mapping', async () => {
    stubFetch({
      '/api/settings/table-bookings/tables': FAILED,
      '/api/settings/table-bookings/space-area-links': OK_SPACE_AREAS,
      '/api/settings/table-bookings/pacing': {
        status: 200,
        body: { success: true, data: { busy_threshold_covers: 30, filling_threshold_covers: 20, window_minutes: 60 } },
      },
      '/api/settings/table-bookings/kitchen-pacing': OK_KITCHEN,
      '/api/settings/table-bookings/join-groups': { status: 200, body: { success: true, data: { groups: [] } } },
    })

    render(<TableSetupManager />)

    expect(await screen.findByText('Could not load tables')).toBeInTheDocument()
    expect(screen.getByText('Could not load private-booking mappings')).toBeInTheDocument()
    expect(screen.queryByText('No tables yet')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Private-Booking Area Mapping' })).toBeDisabled()
  })

  it('fails the seasonal periods block when the deposit settings cannot be read', async () => {
    stubFetch({
      '/api/settings/table-bookings/periods': { status: 200, body: { data: [] } },
      '/api/settings/table-bookings/allocation': FAILED,
    })

    render(<SeasonalPeriods />)

    expect(await screen.findByText('Could not load seasonal periods')).toBeInTheDocument()
    expect(screen.queryByLabelText('Collect seasonal deposits')).not.toBeInTheDocument()
  })
})
