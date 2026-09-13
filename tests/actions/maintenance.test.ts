import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/services/maintenance', async importActual => {
  // The real error class is kept so the action's instanceof mapping is exercised.
  const actual = await importActual<typeof import('@/services/maintenance')>()
  return {
    MaintenanceServiceError: actual.MaintenanceServiceError,
    MAINTENANCE_STALE_WRITE_MESSAGE: actual.MAINTENANCE_STALE_WRITE_MESSAGE,
    listMaintenanceAreas: vi.fn(),
    listMaintenanceItems: vi.fn(),
    getMaintenanceItem: vi.fn(),
    getMaintenanceCostSummary: vi.fn(),
    getMaintenanceTimeline: vi.fn(),
    createMaintenanceItem: vi.fn(),
    updateMaintenanceItem: vi.fn(),
    addMaintenanceNote: vi.fn(),
  }
})

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/app/actions/audit'
import * as service from '@/services/maintenance'
import { MaintenanceServiceError } from '@/services/maintenance'
import {
  addMaintenanceNote,
  createMaintenanceItem,
  currentUserCanUseMaintenance,
  getMaintenanceAreas,
  getMaintenanceCosts,
  getMaintenanceItem,
  getMaintenanceItems,
  getMaintenanceTimeline,
  updateMaintenanceItem,
} from '@/app/actions/maintenance'

const mockedCreateClient = createClient as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock
const mockedRevalidatePath = revalidatePath as unknown as Mock

const USER_ID = '33333333-3333-3333-3333-333333333333'
const ITEM_ID = '11111111-1111-1111-1111-111111111111'
const AREA_ID = '22222222-2222-2222-2222-222222222222'
const NOTE_ID = '44444444-4444-4444-4444-444444444444'

const rpc = vi.fn()
const getUser = vi.fn()

function signInAs(options: { user: boolean; superAdmin?: boolean; rpcError?: unknown }): void {
  getUser.mockResolvedValue({
    data: { user: options.user ? { id: USER_ID, email: 'boss@the-anchor.pub' } : null },
    error: null,
  })
  rpc.mockResolvedValue({
    data: options.rpcError ? null : options.superAdmin === true,
    error: options.rpcError ?? null,
  })
  mockedCreateClient.mockResolvedValue({ auth: { getUser }, rpc })
}

const item = {
  id: ITEM_ID,
  reference: 'M-0001',
  kind: 'issue' as const,
  title: 'Cellar cooler dripping',
  description: null,
  areaId: AREA_ID,
  areaName: 'Cellar',
  status: 'reported' as const,
  priority: 'medium' as const,
  responsibility: 'us' as const,
  reportedOn: '2026-09-01',
  targetDate: null,
  completedOn: null,
  estimatedCost: 250,
  actualCost: null,
  contractorName: null,
  contractorContact: null,
  createdBy: USER_ID,
  createdByEmail: 'boss@the-anchor.pub',
  createdAt: '2026-09-01T09:00:00+00:00',
  updatedAt: '2026-09-01T09:00:00+00:00',
}

const note = {
  id: NOTE_ID,
  itemId: ITEM_ID,
  content: 'Quote chased.',
  createdBy: USER_ID,
  createdByEmail: 'boss@the-anchor.pub',
  createdAt: '2026-09-06T12:00:00+00:00',
}

/** Every exported action that performs work, with a valid payload for each. */
const GUARDED_ACTIONS: Array<{ name: string; invoke: () => Promise<{ error?: string; code?: string }> }> = [
  { name: 'getMaintenanceAreas', invoke: () => getMaintenanceAreas() },
  { name: 'getMaintenanceItems', invoke: () => getMaintenanceItems() },
  { name: 'getMaintenanceItem', invoke: () => getMaintenanceItem(ITEM_ID) },
  { name: 'getMaintenanceCosts', invoke: () => getMaintenanceCosts() },
  { name: 'getMaintenanceTimeline', invoke: () => getMaintenanceTimeline({ itemId: ITEM_ID }) },
  {
    name: 'createMaintenanceItem',
    invoke: () => createMaintenanceItem({ kind: 'issue', title: 'Broken tap', areaId: AREA_ID }),
  },
  {
    name: 'updateMaintenanceItem',
    invoke: () =>
      updateMaintenanceItem({
        id: ITEM_ID,
        expectedUpdatedAt: '2026-09-01T09:00:00+00:00',
        title: 'Renamed',
      }),
  },
  {
    name: 'addMaintenanceNote',
    invoke: () => addMaintenanceNote({ itemId: ITEM_ID, content: 'Quote chased.' }),
  },
]

const SERVICE_FUNCTIONS = [
  'listMaintenanceAreas',
  'listMaintenanceItems',
  'getMaintenanceItem',
  'getMaintenanceCostSummary',
  'getMaintenanceTimeline',
  'createMaintenanceItem',
  'updateMaintenanceItem',
  'addMaintenanceNote',
] as const

function expectNoServiceCalls(): void {
  for (const name of SERVICE_FUNCTIONS) {
    expect(service[name] as unknown as Mock, `${name} should not have been called`).not.toHaveBeenCalled()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('maintenance actions, access', () => {
  it('refuses every action when the caller is not a super-admin', async () => {
    for (const action of GUARDED_ACTIONS) {
      vi.clearAllMocks()
      signInAs({ user: true, superAdmin: false })

      const result = await action.invoke()

      expect(result.error, action.name).toBe('Insufficient permissions')
      expect(result.code, action.name).toBe('forbidden')
      expectNoServiceCalls()
    }
  })

  it('refuses every action when there is no session', async () => {
    for (const action of GUARDED_ACTIONS) {
      vi.clearAllMocks()
      signInAs({ user: false })

      const result = await action.invoke()

      expect(result.error, action.name).toBe('Unauthorized')
      expect(result.code, action.name).toBe('forbidden')
      expectNoServiceCalls()
    }
  })

  it('fails closed when the role cannot be verified', async () => {
    signInAs({ user: true, rpcError: { message: 'rpc unavailable' } })

    const result = await getMaintenanceItems()

    expect(result.error).toBe('Insufficient permissions')
    expect(result.code).toBe('forbidden')
    expectNoServiceCalls()
  })

  it('checks the role with the same predicate the RLS policies use', async () => {
    signInAs({ user: true, superAdmin: true })
    ;(service.listMaintenanceAreas as unknown as Mock).mockResolvedValue([])

    await getMaintenanceAreas()

    expect(rpc).toHaveBeenCalledWith('is_super_admin', { check_user_id: USER_ID })
  })

  it('reports whether the current caller may use the tracker at all', async () => {
    signInAs({ user: true, superAdmin: false })
    await expect(currentUserCanUseMaintenance()).resolves.toBe(false)

    signInAs({ user: true, superAdmin: true })
    await expect(currentUserCanUseMaintenance()).resolves.toBe(true)
  })
})

describe('maintenance actions, writes', () => {
  beforeEach(() => {
    signInAs({ user: true, superAdmin: true })
  })

  it('creates an item, records an audit event and refreshes the pages', async () => {
    ;(service.createMaintenanceItem as unknown as Mock).mockResolvedValue(item)

    const result = await createMaintenanceItem({
      kind: 'issue',
      title: '  Cellar cooler dripping  ',
      areaId: AREA_ID,
      estimatedCost: 250,
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual(item)

    const [input, actor] = (service.createMaintenanceItem as unknown as Mock).mock.calls[0]
    expect(input.title).toBe('Cellar cooler dripping')
    expect(actor).toEqual({ userId: USER_ID, userEmail: 'boss@the-anchor.pub' })

    expect(mockedLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: USER_ID,
        operation_type: 'create',
        resource_type: 'maintenance_item',
        resource_id: ITEM_ID,
        operation_status: 'success',
      })
    )
    expect(mockedRevalidatePath).toHaveBeenCalledWith('/maintenance')
    expect(mockedRevalidatePath).toHaveBeenCalledWith(`/maintenance/${ITEM_ID}`)
  })

  it('rejects a target date before the reported date without touching the database', async () => {
    const result = await createMaintenanceItem({
      kind: 'issue',
      title: 'Broken tap',
      areaId: AREA_ID,
      reportedOn: '2026-09-05',
      targetDate: '2026-09-01',
    })

    expect(result.error).toBe('The target date cannot be before the date this was reported')
    expect(service.createMaintenanceItem as unknown as Mock).not.toHaveBeenCalled()
  })

  it('rejects an empty title without touching the database', async () => {
    const result = await createMaintenanceItem({ kind: 'issue', title: '   ', areaId: AREA_ID })

    expect(result.error).toBe('Give this a short title')
    expect(service.createMaintenanceItem as unknown as Mock).not.toHaveBeenCalled()
  })

  it('passes the version the form was built from through to the update', async () => {
    ;(service.updateMaintenanceItem as unknown as Mock).mockResolvedValue(item)

    await updateMaintenanceItem({
      id: ITEM_ID,
      expectedUpdatedAt: '2026-09-01T09:00:00+00:00',
      status: 'quoting',
    })

    const [id, patch, expectedUpdatedAt] = (service.updateMaintenanceItem as unknown as Mock).mock
      .calls[0]
    expect(id).toBe(ITEM_ID)
    expect(patch.status).toBe('quoting')
    expect(patch).not.toHaveProperty('expectedUpdatedAt')
    expect(expectedUpdatedAt).toBe('2026-09-01T09:00:00+00:00')
  })

  it('surfaces a stale write with a code the page can render as reload and reapply', async () => {
    ;(service.updateMaintenanceItem as unknown as Mock).mockRejectedValue(
      new MaintenanceServiceError('stale_write', service.MAINTENANCE_STALE_WRITE_MESSAGE)
    )

    const result = await updateMaintenanceItem({
      id: ITEM_ID,
      expectedUpdatedAt: '2026-09-01T09:00:00+00:00',
      title: 'Renamed',
    })

    expect(result.success).toBe(false)
    expect(result.code).toBe('stale_write')
    expect(result.error).toContain('Reload the page')
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })

  it('surfaces the inactive-area sentence rather than a generic failure', async () => {
    ;(service.createMaintenanceItem as unknown as Mock).mockRejectedValue(
      new MaintenanceServiceError('area_inactive', 'That area is no longer available. Pick another one.')
    )

    const result = await createMaintenanceItem({ kind: 'issue', title: 'Broken tap', areaId: AREA_ID })

    expect(result.error).toBe('That area is no longer available. Pick another one.')
    expect(result.code).toBe('area_inactive')
  })

  it('saves a note and records an audit event', async () => {
    ;(service.addMaintenanceNote as unknown as Mock).mockResolvedValue(note)

    const result = await addMaintenanceNote({ itemId: ITEM_ID, content: '  Quote chased.  ' })

    expect(result.success).toBe(true)
    expect(service.addMaintenanceNote as unknown as Mock).toHaveBeenCalledWith(
      ITEM_ID,
      'Quote chased.',
      { userId: USER_ID, userEmail: 'boss@the-anchor.pub' }
    )
    expect(mockedLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ resource_type: 'maintenance_note', resource_id: NOTE_ID })
    )
  })

  it('rejects an empty note without touching the database', async () => {
    const result = await addMaintenanceNote({ itemId: ITEM_ID, content: '   ' })

    expect(result.error).toBe('Write something before saving the note')
    expect(service.addMaintenanceNote as unknown as Mock).not.toHaveBeenCalled()
  })
})

describe('maintenance actions, reads', () => {
  beforeEach(() => {
    signInAs({ user: true, superAdmin: true })
  })

  it('refuses a malformed paging cursor', async () => {
    const result = await getMaintenanceItems({
      cursor: { createdAt: '2026-09-01T09:00:00+00:00', id: 'not-a-uuid' },
    })

    expect(result.error).toBe('Could not load the next page. Reload and try again.')
    expect(service.listMaintenanceItems as unknown as Mock).not.toHaveBeenCalled()
  })

  it('reads the cost totals under the same filters as the list', async () => {
    const summary = {
      ourOpenEstimate: 250,
      ourUncostedCount: 1,
      greeneKingOpenEstimate: 0,
      greeneKingUncostedCount: 0,
      toConfirmOpenEstimate: 0,
      toConfirmUncostedCount: 0,
      openCount: 2,
      overdueCount: 0,
    }
    ;(service.getMaintenanceCostSummary as unknown as Mock).mockResolvedValue(summary)

    const result = await getMaintenanceCosts({ responsibility: 'us', overdueOnly: 'false' })

    expect(result.data).toEqual(summary)
    const [filters] = (service.getMaintenanceCostSummary as unknown as Mock).mock.calls[0]
    // A FormData 'false' must arrive as false. Boolean('false') is true, which is
    // exactly why z.coerce.boolean() is never used for this.
    expect(filters.overdueOnly).toBe(false)
    expect(filters.responsibility).toBe('us')
  })
})
