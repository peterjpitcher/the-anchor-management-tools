import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  // Every test injects its own client. If the service ever falls back to the real
  // cookie client the test fails loudly rather than reaching a database.
  createClient: vi.fn(async () => {
    throw new Error('createClient should not be called: inject a client instead')
  }),
}))

import {
  MaintenanceServiceError,
  addMaintenanceNote,
  createMaintenanceItem,
  getMaintenanceTimeline,
  listMaintenanceItems,
  resolveCompletedOn,
  summariseMaintenanceCosts,
  updateMaintenanceItem,
  type MaintenanceCostSummaryInput,
  type MaintenanceDbClient,
} from '@/services/maintenance'
import {
  isMaintenanceItemOverdue,
  type MaintenanceItemRow,
  type MaintenanceStatus,
} from '@/types/maintenance'

// ---------------------------------------------------------------------------
// A small chainable stand-in for the PostgREST builder
// ---------------------------------------------------------------------------

interface FakeResult {
  data: unknown
  error: unknown
}

interface RecordedCall {
  table: string
  ops: Array<{ op: string; args: unknown[] }>
}

const CHAINABLE = [
  'select',
  'insert',
  'update',
  'eq',
  'in',
  'not',
  'lt',
  'lte',
  'gt',
  'gte',
  'or',
  'order',
  'limit',
]

function makeBuilder(result: FakeResult, record: (op: string, args: unknown[]) => void): unknown {
  // Justifying the `any`: this is a test double for the PostgREST builder, whose
  // methods are attached in a loop and all return the builder itself.
  const builder: any = {}
  for (const op of CHAINABLE) {
    builder[op] = (...args: unknown[]) => {
      record(op, args)
      return builder
    }
  }
  builder.maybeSingle = async () => result
  builder.single = async () => result
  // Makes the builder awaitable, the way a PostgREST query is.
  builder.then = (onFulfilled: any, onRejected: any) =>
    Promise.resolve(result).then(onFulfilled, onRejected)
  return builder
}

function createFakeClient(results: Record<string, FakeResult[]>): {
  client: MaintenanceDbClient
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  const queues: Record<string, FakeResult[]> = {}
  for (const [table, list] of Object.entries(results)) queues[table] = [...list]

  const client = {
    from(table: string) {
      const queue = queues[table]
      if (!queue || queue.length === 0) throw new Error(`Unexpected table: ${table}`)
      const call: RecordedCall = { table, ops: [] }
      calls.push(call)
      // The last configured result repeats, so a test only lists what it cares about.
      const result = queue.length > 1 ? (queue.shift() as FakeResult) : queue[0]
      return makeBuilder(result, (op, args) => call.ops.push({ op, args })) as never
    },
  }

  return { client: client as unknown as MaintenanceDbClient, calls }
}

function opArgs(call: RecordedCall, op: string): unknown[][] {
  return call.ops.filter(entry => entry.op === op).map(entry => entry.args)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ITEM_ID = '11111111-1111-1111-1111-111111111111'
const AREA_ID = '22222222-2222-2222-2222-222222222222'
const USER_ID = '33333333-3333-3333-3333-333333333333'

function itemRow(overrides: Partial<MaintenanceItemRow> = {}): Record<string, unknown> {
  const base: MaintenanceItemRow = {
    id: ITEM_ID,
    reference: 'M-0001',
    kind: 'issue',
    title: 'Cellar cooler dripping',
    description: null,
    area_id: AREA_ID,
    status: 'reported',
    priority: 'medium',
    responsibility: 'us',
    reported_on: '2026-09-01',
    target_date: null,
    completed_on: null,
    estimated_cost: 250,
    actual_cost: null,
    contractor_name: null,
    contractor_contact: null,
    created_by: USER_ID,
    created_by_email: 'boss@the-anchor.pub',
    created_at: '2026-09-01T09:00:00+00:00',
    updated_at: '2026-09-01T09:00:00+00:00',
    ...overrides,
  }
  return { ...base, maintenance_areas: { name: 'Cellar' } }
}

function costItem(
  overrides: Partial<MaintenanceCostSummaryInput> = {}
): MaintenanceCostSummaryInput {
  return {
    status: 'reported',
    responsibility: 'us',
    estimatedCost: null,
    targetDate: null,
    ...overrides,
  }
}

const ACTOR = { userId: USER_ID, userEmail: 'boss@the-anchor.pub' }

// ---------------------------------------------------------------------------
// Cost summary
// ---------------------------------------------------------------------------

describe('summariseMaintenanceCosts', () => {
  const TODAY = '2026-09-06'

  it('never sums a null estimate as zero, and counts it separately', () => {
    const summary = summariseMaintenanceCosts(
      [
        costItem({ responsibility: 'us', estimatedCost: 120.5 }),
        costItem({ responsibility: 'us', estimatedCost: null }),
        costItem({ responsibility: 'us', estimatedCost: null }),
      ],
      TODAY
    )

    expect(summary.ourOpenEstimate).toBe(120.5)
    expect(summary.ourUncostedCount).toBe(2)
    expect(summary.openCount).toBe(3)
  })

  it('treats zero as a real estimate, not as uncosted', () => {
    const summary = summariseMaintenanceCosts(
      [costItem({ responsibility: 'us', estimatedCost: 0 })],
      TODAY
    )

    expect(summary.ourOpenEstimate).toBe(0)
    expect(summary.ourUncostedCount).toBe(0)
  })

  it('includes on hold in our total, because on hold is open', () => {
    const summary = summariseMaintenanceCosts(
      [costItem({ status: 'on_hold', responsibility: 'us', estimatedCost: 400 })],
      TODAY
    )

    expect(summary.ourOpenEstimate).toBe(400)
    expect(summary.openCount).toBe(1)
  })

  it('keeps Greene King and to-confirm out of our total and reports them separately', () => {
    const summary = summariseMaintenanceCosts(
      [
        costItem({ responsibility: 'us', estimatedCost: 100 }),
        costItem({ responsibility: 'greene_king', estimatedCost: 5000 }),
        costItem({ responsibility: 'greene_king', estimatedCost: null }),
        costItem({ responsibility: 'to_confirm', estimatedCost: 75.25 }),
        costItem({ responsibility: 'to_confirm', estimatedCost: null }),
      ],
      TODAY
    )

    expect(summary.ourOpenEstimate).toBe(100)
    expect(summary.ourUncostedCount).toBe(0)
    expect(summary.greeneKingOpenEstimate).toBe(5000)
    expect(summary.greeneKingUncostedCount).toBe(1)
    expect(summary.toConfirmOpenEstimate).toBe(75.25)
    expect(summary.toConfirmUncostedCount).toBe(1)
  })

  it('excludes done and cancelled items entirely', () => {
    const summary = summariseMaintenanceCosts(
      [
        costItem({ status: 'done', responsibility: 'us', estimatedCost: 900 }),
        costItem({ status: 'cancelled', responsibility: 'us', estimatedCost: 900 }),
        costItem({ status: 'done', responsibility: 'us', estimatedCost: null }),
      ],
      TODAY
    )

    expect(summary.ourOpenEstimate).toBe(0)
    expect(summary.ourUncostedCount).toBe(0)
    expect(summary.openCount).toBe(0)
  })

  it('counts overdue open items only, and not one due today', () => {
    const summary = summariseMaintenanceCosts(
      [
        costItem({ targetDate: '2026-09-05' }),
        costItem({ targetDate: TODAY }),
        costItem({ targetDate: '2026-09-07' }),
        costItem({ status: 'done', targetDate: '2026-01-01' }),
      ],
      TODAY
    )

    expect(summary.overdueCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Overdue predicate
// ---------------------------------------------------------------------------

describe('isMaintenanceItemOverdue', () => {
  const TODAY = '2026-09-06'

  it('is not overdue when the target date is today', () => {
    expect(isMaintenanceItemOverdue({ status: 'reported', targetDate: TODAY }, TODAY)).toBe(false)
  })

  it('is overdue when the target date has passed', () => {
    expect(isMaintenanceItemOverdue({ status: 'in_progress', targetDate: '2026-09-05' }, TODAY)).toBe(
      true
    )
  })

  it('is never overdue without a target date', () => {
    expect(isMaintenanceItemOverdue({ status: 'reported', targetDate: null }, TODAY)).toBe(false)
  })

  it('is never overdue once the item is closed', () => {
    for (const status of ['done', 'cancelled'] as MaintenanceStatus[]) {
      expect(isMaintenanceItemOverdue({ status, targetDate: '2020-01-01' }, TODAY)).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

describe('resolveCompletedOn', () => {
  const TODAY = '2026-09-06'

  it('defaults to today in London when an item is marked done', () => {
    expect(
      resolveCompletedOn({
        previousStatus: 'in_progress',
        nextStatus: 'done',
        previousCompletedOn: null,
        todayIsoDate: TODAY,
      })
    ).toBe(TODAY)
  })

  it('keeps a supplied date, so a job can be recorded late', () => {
    expect(
      resolveCompletedOn({
        previousStatus: 'in_progress',
        nextStatus: 'done',
        previousCompletedOn: null,
        suppliedCompletedOn: '2026-08-30',
        todayIsoDate: TODAY,
      })
    ).toBe('2026-08-30')
  })

  it('keeps the existing completion date when the item stays done', () => {
    expect(
      resolveCompletedOn({
        previousStatus: 'done',
        nextStatus: 'done',
        previousCompletedOn: '2026-08-30',
        todayIsoDate: TODAY,
      })
    ).toBe('2026-08-30')
  })

  it('clears the completion date when an item is reopened', () => {
    expect(
      resolveCompletedOn({
        previousStatus: 'done',
        nextStatus: 'reported',
        previousCompletedOn: '2026-08-30',
        todayIsoDate: TODAY,
      })
    ).toBeNull()
  })

  it('leaves a cancelled item without a completion date, and reversing it keeps none', () => {
    expect(
      resolveCompletedOn({
        previousStatus: 'reported',
        nextStatus: 'cancelled',
        previousCompletedOn: null,
        todayIsoDate: TODAY,
      })
    ).toBeNull()

    expect(
      resolveCompletedOn({
        previousStatus: 'cancelled',
        nextStatus: 'reported',
        previousCompletedOn: null,
        todayIsoDate: TODAY,
      })
    ).toBeNull()
  })
})

describe('updateMaintenanceItem status transitions', () => {
  const TODAY = '2026-09-06'

  it('stamps today when moving to done', async () => {
    const current = itemRow({ status: 'in_progress' })
    const saved = itemRow({ status: 'done', completed_on: TODAY, updated_at: '2026-09-06T10:00:00+00:00' })
    const { client, calls } = createFakeClient({
      maintenance_items: [
        { data: current, error: null },
        { data: saved, error: null },
      ],
    })

    const result = await updateMaintenanceItem(
      ITEM_ID,
      { status: 'done' },
      '2026-09-01T09:00:00+00:00',
      { client, todayIsoDate: TODAY }
    )

    expect(result.completedOn).toBe(TODAY)
    const [payload] = opArgs(calls[1], 'update')[0] as [Record<string, unknown>]
    expect(payload.status).toBe('done')
    expect(payload.completed_on).toBe(TODAY)
  })

  it('clears the completion date when reopened from done', async () => {
    const current = itemRow({ status: 'done', completed_on: '2026-08-30' })
    const saved = itemRow({ status: 'reported', completed_on: null })
    const { client, calls } = createFakeClient({
      maintenance_items: [
        { data: current, error: null },
        { data: saved, error: null },
      ],
    })

    const result = await updateMaintenanceItem(
      ITEM_ID,
      { status: 'reported' },
      '2026-09-01T09:00:00+00:00',
      { client, todayIsoDate: TODAY }
    )

    expect(result.completedOn).toBeNull()
    const [payload] = opArgs(calls[1], 'update')[0] as [Record<string, unknown>]
    expect(payload.completed_on).toBeNull()
  })

  it('reverses a cancelled item back to reported', async () => {
    const current = itemRow({ status: 'cancelled' })
    const saved = itemRow({ status: 'reported' })
    const { client, calls } = createFakeClient({
      maintenance_items: [
        { data: current, error: null },
        { data: saved, error: null },
      ],
    })

    const result = await updateMaintenanceItem(
      ITEM_ID,
      { status: 'reported' },
      '2026-09-01T09:00:00+00:00',
      { client, todayIsoDate: TODAY }
    )

    expect(result.status).toBe('reported')
    const [payload] = opArgs(calls[1], 'update')[0] as [Record<string, unknown>]
    expect(payload.completed_on).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Optimistic concurrency
// ---------------------------------------------------------------------------

describe('updateMaintenanceItem concurrency', () => {
  const TODAY = '2026-09-06'
  const SEEN_AT = '2026-09-01T09:00:00+00:00'

  it('makes the write conditional on the updated_at the client last saw', async () => {
    const { client, calls } = createFakeClient({
      maintenance_items: [
        { data: itemRow(), error: null },
        { data: itemRow({ title: 'Renamed' }), error: null },
      ],
    })

    await updateMaintenanceItem(ITEM_ID, { title: 'Renamed' }, SEEN_AT, {
      client,
      todayIsoDate: TODAY,
    })

    const eqCalls = opArgs(calls[1], 'eq')
    expect(eqCalls).toContainEqual(['id', ITEM_ID])
    expect(eqCalls).toContainEqual(['updated_at', SEEN_AT])
  })

  it('refuses a stale write instead of overwriting someone else', async () => {
    const { client } = createFakeClient({
      maintenance_items: [
        { data: itemRow(), error: null },
        // The conditional update matches nothing: someone else has written since.
        { data: null, error: null },
        // The re-read proves the item still exists, so this is staleness not a deletion.
        { data: itemRow({ updated_at: '2026-09-06T11:00:00+00:00' }), error: null },
      ],
    })

    await expect(
      updateMaintenanceItem(ITEM_ID, { title: 'Renamed' }, SEEN_AT, {
        client,
        todayIsoDate: TODAY,
      })
    ).rejects.toMatchObject({
      code: 'stale_write',
      message: expect.stringContaining('Reload the page'),
    })
  })

  it('reports a vanished item as not found rather than as staleness', async () => {
    const { client } = createFakeClient({
      maintenance_items: [
        { data: itemRow(), error: null },
        { data: null, error: null },
        { data: null, error: null },
      ],
    })

    await expect(
      updateMaintenanceItem(ITEM_ID, { title: 'Renamed' }, SEEN_AT, {
        client,
        todayIsoDate: TODAY,
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('refuses to load an item that is not there', async () => {
    const { client } = createFakeClient({
      maintenance_items: [{ data: null, error: null }],
    })

    await expect(
      updateMaintenanceItem(ITEM_ID, { title: 'Renamed' }, SEEN_AT, {
        client,
        todayIsoDate: TODAY,
      })
    ).rejects.toBeInstanceOf(MaintenanceServiceError)
  })
})

// ---------------------------------------------------------------------------
// Inactive area
// ---------------------------------------------------------------------------

describe('inactive areas', () => {
  it('surfaces the database sentence rather than a generic failure', async () => {
    const { client } = createFakeClient({
      maintenance_items: [
        {
          data: null,
          error: {
            code: '23514',
            message: 'That area is no longer available. Pick another one.',
          },
        },
      ],
    })

    await expect(
      createMaintenanceItem(
        { kind: 'issue', title: 'Broken tap', areaId: AREA_ID },
        ACTOR,
        { client, todayIsoDate: '2026-09-06' }
      )
    ).rejects.toMatchObject({
      code: 'area_inactive',
      message: 'That area is no longer available. Pick another one.',
    })
  })
})

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

describe('addMaintenanceNote', () => {
  it('accepts a note on a closed item, because evidence arrives late', async () => {
    const { client, calls } = createFakeClient({
      maintenance_notes: [
        {
          data: {
            id: '44444444-4444-4444-4444-444444444444',
            item_id: ITEM_ID,
            content: 'Invoice received.',
            created_by: USER_ID,
            created_by_email: 'boss@the-anchor.pub',
            created_at: '2026-09-06T12:00:00+00:00',
          },
          error: null,
        },
      ],
    })

    const note = await addMaintenanceNote(ITEM_ID, '  Invoice received.  ', ACTOR, { client })

    expect(note.content).toBe('Invoice received.')
    const [payload] = opArgs(calls[0], 'insert')[0] as [Record<string, unknown>]
    expect(payload.content).toBe('Invoice received.')
    expect(payload.created_by).toBe(USER_ID)
  })
})

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

describe('listMaintenanceItems', () => {
  const TODAY = '2026-09-06'

  it('reports another page without a count query and hands back a keyset cursor', async () => {
    const rows = Array.from({ length: 3 }, (_, index) =>
      itemRow({
        id: `0000000${index}-0000-0000-0000-00000000000${index}`,
        created_at: `2026-09-0${index + 1}T09:00:00+00:00`,
      })
    )
    const { client, calls } = createFakeClient({
      maintenance_items: [{ data: rows, error: null }],
    })

    const page = await listMaintenanceItems({}, { client, limit: 2, todayIsoDate: TODAY })

    expect(page.items).toHaveLength(2)
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toEqual({
      createdAt: '2026-09-02T09:00:00+00:00',
      id: '00000001-0000-0000-0000-000000000001',
    })
    // limit is page size plus one, which is how hasMore is known.
    expect(opArgs(calls[0], 'limit')[0]).toEqual([3])
  })

  it('filters overdue with a strict less-than, so an item due today is excluded', async () => {
    const { client, calls } = createFakeClient({
      maintenance_items: [{ data: [], error: null }],
    })

    await listMaintenanceItems({ overdueOnly: true }, { client, todayIsoDate: TODAY })

    expect(opArgs(calls[0], 'lt')).toContainEqual(['target_date', TODAY])
    expect(opArgs(calls[0], 'lte')).toHaveLength(0)
  })

  it('quotes a free-text term so a comma cannot break out of the filter', async () => {
    const { client, calls } = createFakeClient({
      maintenance_items: [{ data: [], error: null }],
    })

    await listMaintenanceItems({ search: 'tap, cellar' }, { client, todayIsoDate: TODAY })

    const [filter] = opArgs(calls[0], 'or')[0] as [string]
    expect(filter).toBe('title.ilike."%tap, cellar%",reference.ilike."%tap, cellar%"')
  })

  it('refuses a malformed cursor rather than interpolating it into a filter', async () => {
    const { client } = createFakeClient({
      maintenance_items: [{ data: [], error: null }],
    })

    await expect(
      listMaintenanceItems(
        {},
        {
          client,
          todayIsoDate: TODAY,
          cursor: { createdAt: '2026-09-01T09:00:00+00:00', id: 'not-a-uuid' },
        }
      )
    ).rejects.toMatchObject({ code: 'invalid_cursor' })
  })
})

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

describe('getMaintenanceTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function noteRow(id: string, createdAt: string) {
    return {
      id,
      item_id: ITEM_ID,
      content: 'A note',
      created_by: USER_ID,
      created_by_email: 'boss@the-anchor.pub',
      created_at: createdAt,
    }
  }

  function historyRow(id: string, changedAt: string, field: string) {
    return {
      id,
      item_id: ITEM_ID,
      changed_at: changedAt,
      changed_by: USER_ID,
      changed_by_email: 'boss@the-anchor.pub',
      field,
      old_value: 'reported',
      new_value: 'quoting',
    }
  }

  function photoRow(id: string, uploadedAt: string) {
    return {
      id,
      item_id: ITEM_ID,
      storage_path: `${ITEM_ID}/a.jpg`,
      file_name: 'a.jpg',
      mime_type: 'image/jpeg',
      file_size_bytes: 1024,
      width: 800,
      height: 600,
      caption: null,
      taken_on: null,
      state: 'ready',
      uploaded_by: USER_ID,
      uploaded_by_email: 'boss@the-anchor.pub',
      uploaded_at: uploadedAt,
      redacted_at: null,
      redacted_by: null,
      redacted_by_email: null,
      redaction_reason: null,
    }
  }

  it('merges notes, history and photos newest first, breaking ties on id', async () => {
    const shared = '2026-09-05T10:00:00+00:00'
    const { client } = createFakeClient({
      maintenance_notes: [{ data: [noteRow('bbbbbbbb-0000-0000-0000-000000000001', shared)], error: null }],
      maintenance_item_history: [
        {
          data: [
            historyRow('cccccccc-0000-0000-0000-000000000001', shared, 'status'),
            historyRow('aaaaaaaa-0000-0000-0000-000000000001', shared, 'priority'),
          ],
          error: null,
        },
      ],
      maintenance_photos: [
        { data: [photoRow('dddddddd-0000-0000-0000-000000000001', '2026-09-06T08:00:00+00:00')], error: null },
      ],
    })

    const page = await getMaintenanceTimeline(ITEM_ID, { client, limit: 10 })

    expect(page.entries.map(entry => entry.kind)).toEqual(['photo', 'history', 'note', 'history'])
    expect(page.entries.map(entry => entry.id)).toEqual([
      'dddddddd-0000-0000-0000-000000000001',
      'cccccccc-0000-0000-0000-000000000001',
      'bbbbbbbb-0000-0000-0000-000000000001',
      'aaaaaaaa-0000-0000-0000-000000000001',
    ])
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeNull()
  })

  it('only asks for ready photos', async () => {
    const { client, calls } = createFakeClient({
      maintenance_notes: [{ data: [], error: null }],
      maintenance_item_history: [{ data: [], error: null }],
      maintenance_photos: [{ data: [], error: null }],
    })

    await getMaintenanceTimeline(ITEM_ID, { client })

    const photoCall = calls.find(call => call.table === 'maintenance_photos') as RecordedCall
    expect(opArgs(photoCall, 'eq')).toContainEqual(['state', 'ready'])
  })

  it('throws when the history read fails, never showing an empty trail', async () => {
    const { client } = createFakeClient({
      maintenance_notes: [{ data: [], error: null }],
      maintenance_item_history: [{ data: null, error: { message: 'permission denied' } }],
      maintenance_photos: [{ data: [], error: null }],
    })

    await expect(getMaintenanceTimeline(ITEM_ID, { client })).rejects.toMatchObject({
      code: 'db_error',
      message: 'Could not load the change history for this item.',
    })
  })

  it('pages with a keyset cursor built from the last entry', async () => {
    const { client } = createFakeClient({
      maintenance_notes: [
        {
          data: [
            noteRow('bbbbbbbb-0000-0000-0000-000000000002', '2026-09-05T10:00:00+00:00'),
            noteRow('bbbbbbbb-0000-0000-0000-000000000001', '2026-09-04T10:00:00+00:00'),
          ],
          error: null,
        },
      ],
      maintenance_item_history: [{ data: [], error: null }],
      maintenance_photos: [{ data: [], error: null }],
    })

    const page = await getMaintenanceTimeline(ITEM_ID, { client, limit: 1 })

    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toEqual({
      occurredAt: '2026-09-05T10:00:00+00:00',
      id: 'bbbbbbbb-0000-0000-0000-000000000002',
    })
  })
})
