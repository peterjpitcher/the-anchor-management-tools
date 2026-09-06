import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

// The tracker's own gate and its area read are reused rather than re-implemented,
// so both are mocked here and the reuse itself is asserted below.
vi.mock('@/app/actions/maintenance', () => ({
  currentUserCanUseMaintenance: vi.fn(),
  getMaintenanceAreas: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/app/actions/audit'
import { currentUserCanUseMaintenance, getMaintenanceAreas } from '@/app/actions/maintenance'
import {
  createMaintenanceArea,
  listMaintenanceAreasForAdmin,
  renameMaintenanceArea,
  reorderMaintenanceAreas,
  setMaintenanceAreaActive,
} from '@/app/actions/maintenance-areas'
import * as areaActions from '@/app/actions/maintenance-areas'
import { AREA_DUPLICATE_NAME_MESSAGE, AREA_ORDER_STALE_MESSAGE } from '@/lib/maintenance/areas'

const mockedCreateClient = createClient as unknown as Mock
const mockedCanUse = currentUserCanUseMaintenance as unknown as Mock
const mockedGetAreas = getMaintenanceAreas as unknown as Mock
const mockedAudit = logAuditEvent as unknown as Mock

const USER_ID = '33333333-3333-3333-3333-333333333333'
const BAR_ID = '11111111-1111-1111-1111-111111111111'
const CELLAR_ID = '22222222-2222-2222-2222-222222222222'
const KITCHEN_ID = '44444444-4444-4444-4444-444444444444'

interface AreaRow {
  id: string
  name: string
  sort_order: number
  active: boolean
  created_at: string
  updated_at: string
}

function row(id: string, name: string, sortOrder: number, active = true): AreaRow {
  return {
    id,
    name,
    sort_order: sortOrder,
    active,
    created_at: '2026-09-01T09:00:00Z',
    updated_at: '2026-09-01T09:00:00Z',
  }
}

interface RecordedOp {
  table: string
  method: 'select' | 'insert' | 'update' | 'delete'
  payload: Record<string, unknown> | null
  filters: Array<[string, unknown]>
}

let areasInDb: AreaRow[]
let recorded: RecordedOp[]
let signedIn: boolean
let writeError: { code?: string; message?: string } | null

function buildClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: signedIn ? { id: USER_ID, email: 'owner@example.com' } : null },
      }),
    },
    from: vi.fn((table: string) => {
      const state: RecordedOp = { table, method: 'select', payload: null, filters: [] }

      function resultFor() {
        if (state.method === 'select') return { data: areasInDb, error: null }
        if (writeError) return { data: null, error: writeError }
        if (state.method === 'insert') {
          const payload = state.payload as { name: string; sort_order: number }
          return {
            data: row('55555555-5555-5555-5555-555555555555', payload.name, payload.sort_order),
            error: null,
          }
        }
        const id = state.filters.find(([column]) => column === 'id')?.[1]
        const target = areasInDb.find((area) => area.id === id)
        return { data: target ? { ...target, ...state.payload } : null, error: null }
      }

      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        eq: (column: string, value: unknown) => {
          state.filters.push([column, value])
          return chain
        },
        insert: (payload: Record<string, unknown>) => {
          state.method = 'insert'
          state.payload = payload
          recorded.push(state)
          return chain
        },
        update: (payload: Record<string, unknown>) => {
          state.method = 'update'
          state.payload = payload
          recorded.push(state)
          return chain
        },
        delete: () => {
          state.method = 'delete'
          recorded.push(state)
          return chain
        },
        single: () => Promise.resolve(resultFor()),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(resultFor()).then(resolve, reject),
      }

      return chain
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  areasInDb = [row(BAR_ID, 'Main Bar', 10), row(CELLAR_ID, 'Cellar', 20), row(KITCHEN_ID, 'Kitchen', 30)]
  recorded = []
  signedIn = true
  writeError = null
  mockedCanUse.mockResolvedValue(true)
  mockedCreateClient.mockResolvedValue(buildClient())
})

/** Every write in the module, so a new one cannot skip the access tests. */
const WRITES: Array<[string, () => Promise<{ error?: string; code?: string }>]> = [
  ['createMaintenanceArea', () => createMaintenanceArea({ name: 'Snug' })],
  ['renameMaintenanceArea', () => renameMaintenanceArea({ id: BAR_ID, name: 'Front Bar' })],
  ['setMaintenanceAreaActive', () => setMaintenanceAreaActive({ id: BAR_ID, active: false })],
  [
    'reorderMaintenanceAreas',
    () => reorderMaintenanceAreas({ orderedIds: [CELLAR_ID, BAR_ID, KITCHEN_ID] }),
  ],
]

describe('access', () => {
  it.each(WRITES)('refuses %s when the caller is not a super-admin', async (_name, run) => {
    mockedCanUse.mockResolvedValue(false)

    const result = await run()

    expect(result.error).toBe('Insufficient permissions')
    expect(result.code).toBe('forbidden')
    // Nothing reached the database.
    expect(recorded).toEqual([])
  })

  it.each(WRITES)('refuses %s when nobody is signed in', async (_name, run) => {
    signedIn = false
    mockedCreateClient.mockResolvedValue(buildClient())

    const result = await run()

    expect(result.error).toBe('Unauthorized')
    expect(recorded).toEqual([])
  })

  it('reuses the tracker gate rather than a second super-admin check', async () => {
    await createMaintenanceArea({ name: 'Snug' })

    expect(mockedCanUse).toHaveBeenCalled()
  })

  it('reuses the existing areas read, which gates itself', async () => {
    mockedGetAreas.mockResolvedValue({ success: true, data: [] })

    await listMaintenanceAreasForAdmin()

    // Inactive areas must come back: they still label existing items and this is
    // the only screen that can bring one back.
    expect(mockedGetAreas).toHaveBeenCalledWith(true)
  })
})

describe('no hard delete', () => {
  it('exports nothing that deletes an area', () => {
    const exported = Object.keys(areaActions)
    expect(exported.some((name) => /delete|remove|destroy/i.test(name))).toBe(false)
  })

  it('turns an area off with an update, never a delete', async () => {
    const result = await setMaintenanceAreaActive({ id: BAR_ID, active: false })

    expect(result.success).toBe(true)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      table: 'maintenance_areas',
      method: 'update',
      payload: { active: false },
    })
    expect(recorded.some((op) => op.method === 'delete')).toBe(false)
  })

  it('leaves items alone when an in-use area is turned off', async () => {
    await setMaintenanceAreaActive({ id: BAR_ID, active: false })

    // The area row is the only thing touched: existing items keep their area, so
    // they stay readable and filterable by it. Nothing reassigns them.
    expect(recorded.every((op) => op.table === 'maintenance_areas')).toBe(true)
  })

  it('can turn an area back on', async () => {
    areasInDb = [row(BAR_ID, 'Main Bar', 10, false)]

    const result = await setMaintenanceAreaActive({ id: BAR_ID, active: true })

    expect(result.success).toBe(true)
    expect(result.data?.active).toBe(true)
  })
})

describe('duplicate names', () => {
  it('rejects a name that differs only by capitals', async () => {
    const result = await createMaintenanceArea({ name: 'main bar' })

    expect(result.error).toBe(AREA_DUPLICATE_NAME_MESSAGE)
    expect(recorded).toEqual([])
  })

  it('rejects a name that differs only by surrounding or repeated whitespace', async () => {
    const result = await createMaintenanceArea({ name: '  Main    Bar ' })

    expect(result.error).toBe(AREA_DUPLICATE_NAME_MESSAGE)
    expect(recorded).toEqual([])
  })

  it('rejects a rename that collides with another area', async () => {
    const result = await renameMaintenanceArea({ id: BAR_ID, name: 'CELLAR' })

    expect(result.error).toBe(AREA_DUPLICATE_NAME_MESSAGE)
  })

  it('rejects reusing the name of an area that is turned off', async () => {
    // The unique index does not care about `active`, so this would otherwise fail
    // at the database with a constraint name nobody can read.
    areasInDb = [row(BAR_ID, 'Old Snug', 10, false)]

    const result = await createMaintenanceArea({ name: 'old snug' })

    expect(result.error).toBe(AREA_DUPLICATE_NAME_MESSAGE)
  })

  it('allows an area to keep its own name unchanged', async () => {
    const result = await renameMaintenanceArea({ id: BAR_ID, name: 'Main Bar' })

    expect(result.success).toBe(true)
  })

  it('turns the database unique violation into the same plain sentence', async () => {
    // The pre-check above is for a readable message. The unique index is still the
    // enforcer, and this is what a caller sees if it loses the race.
    writeError = { code: '23505', message: 'maintenance_areas_name_normalised_key' }

    const result = await createMaintenanceArea({ name: 'Snug' })

    expect(result.error).toBe(AREA_DUPLICATE_NAME_MESSAGE)
  })

  it('stores the tidied form of a new name', async () => {
    const result = await createMaintenanceArea({ name: '  Function   Room  ' })

    expect(result.success).toBe(true)
    expect(recorded[0].payload).toMatchObject({ name: 'Function Room' })
    // Placed after the last area rather than at the front.
    expect(recorded[0].payload).toMatchObject({ sort_order: 40 })
  })
})

describe('renaming', () => {
  it('records the old and new name, because items are not snapshotted', async () => {
    const result = await renameMaintenanceArea({ id: BAR_ID, name: 'Front Bar' })

    expect(result.success).toBe(true)
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        resource_type: 'maintenance_area',
        old_values: { name: 'Main Bar' },
        new_values: { name: 'Front Bar' },
      }),
    )
  })

  it('reports an area that has gone rather than creating one', async () => {
    const result = await renameMaintenanceArea({
      id: '99999999-9999-9999-9999-999999999999',
      name: 'Ghost',
    })

    expect(result.code).toBe('not_found')
    expect(recorded).toEqual([])
  })

  it('refuses an empty name', async () => {
    const result = await renameMaintenanceArea({ id: BAR_ID, name: '   ' })

    expect(result.error).toBe('Give the area a name')
    expect(recorded).toEqual([])
  })
})

describe('reordering', () => {
  it('writes only the areas that actually moved', async () => {
    const result = await reorderMaintenanceAreas({
      orderedIds: [CELLAR_ID, BAR_ID, KITCHEN_ID],
    })

    expect(result.success).toBe(true)
    const updates = recorded.filter((op) => op.method === 'update')
    // Kitchen keeps position three, so it is left alone.
    expect(updates).toHaveLength(2)
    expect(updates.map((op) => op.filters[0][1]).sort()).toEqual([BAR_ID, CELLAR_ID].sort())
  })

  it('refuses an order that does not match the areas that exist', async () => {
    const result = await reorderMaintenanceAreas({ orderedIds: [BAR_ID, CELLAR_ID] })

    expect(result.error).toBe(AREA_ORDER_STALE_MESSAGE)
    expect(recorded).toEqual([])
  })

  it('refuses an order containing an area twice', async () => {
    const result = await reorderMaintenanceAreas({
      orderedIds: [BAR_ID, BAR_ID, CELLAR_ID],
    })

    expect(result.error).toBe(AREA_ORDER_STALE_MESSAGE)
    expect(recorded).toEqual([])
  })
})
