import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authorizeCronRequestMock = vi.fn()
const createAdminClientMock = vi.fn()
const processQueueItemMock = vi.fn()

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: (...args: unknown[]) => authorizeCronRequestMock(...args),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

vi.mock('@/lib/google-calendar-notes', () => ({
  processPubOpsCalendarNoteQueueItem: (...args: unknown[]) => processQueueItemMock(...args),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}))

import { GET } from '@/app/api/cron/pub-ops-calendar-note-sync/route'

function makeQueueQuery(result: { data: unknown[] | null; error: unknown }) {
  const limit = vi.fn().mockResolvedValue(result)
  const secondOrder = vi.fn().mockReturnValue({ limit })
  const firstOrder = vi.fn().mockReturnValue({ order: secondOrder })
  const lte = vi.fn().mockReturnValue({ order: firstOrder })
  const eq = vi.fn().mockReturnValue({ lte })

  return {
    builder: { select: vi.fn().mockReturnValue({ eq }) },
    eq,
    lte,
    limit,
  }
}

describe('/api/cron/pub-ops-calendar-note-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T12:00:00.000Z'))
    authorizeCronRequestMock.mockReturnValue({ authorized: true })
    processQueueItemMock.mockResolvedValue({
      state: 'updated',
      noteId: 'note-1',
      googleEventId: 'google-note-1',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects unauthorized requests before opening an admin client', async () => {
    authorizeCronRequestMock.mockReturnValue({ authorized: false, reason: 'Unauthorized' })

    const response = await GET(new Request('http://localhost/api/cron/pub-ops-calendar-note-sync') as any)

    expect(response.status).toBe(401)
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })

  it('processes durable queue rows and reports their outcomes', async () => {
    const item = {
      note_id: 'note-1',
      operation: 'upsert',
      generation: 3,
      attempts: 1,
    }
    const query = makeQueueQuery({ data: [item], error: null })
    const admin = {
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      from: vi.fn((table: string) => {
        if (table !== 'calendar_note_google_sync_queue') {
          throw new Error(`Unexpected table: ${table}`)
        }
        return query.builder
      }),
    }
    createAdminClientMock.mockReturnValue(admin)

    const response = await GET(new Request('http://localhost/api/cron/pub-ops-calendar-note-sync') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(processQueueItemMock).toHaveBeenCalledWith(admin, 'note-1', {
      expectedGeneration: 3,
      context: { context: 'pub_ops_calendar_note_queue' },
    })
    expect(payload).toMatchObject({
      success: true,
      processed: 1,
      queued: 1,
      reconciled: 0,
      counts: { updated: 1, failed: 0 },
    })
  })

  it('uses spare capacity to recheck old synced future notes', async () => {
    const reconciledItem = {
      note_id: 'note-reconciled',
      operation: 'upsert',
      generation: 9,
      attempts: 0,
    }
    const query = makeQueueQuery({ data: [], error: null })
    const admin = {
      from: vi.fn().mockReturnValue(query.builder),
      rpc: vi.fn().mockResolvedValue({ data: [reconciledItem], error: null }),
    }
    createAdminClientMock.mockReturnValue(admin)

    const response = await GET(
      new Request('http://localhost/api/cron/pub-ops-calendar-note-sync') as any
    )
    const payload = await response.json()

    expect(admin.rpc).toHaveBeenCalledWith(
      'requeue_stale_calendar_note_google_sync',
      {
        p_today: '2026-07-10',
        p_synced_before: '2026-07-09T12:00:00.000Z',
        p_limit: 25,
      }
    )
    expect(processQueueItemMock).toHaveBeenCalledWith(
      admin,
      'note-reconciled',
      {
        expectedGeneration: 9,
        context: { context: 'pub_ops_calendar_note_reconciliation' },
      }
    )
    expect(payload).toMatchObject({
      success: true,
      processed: 1,
      queued: 0,
      reconciled: 1,
    })
  })

  it('does not reconcile when pending work fills the requested limit', async () => {
    const item = {
      note_id: 'note-1',
      operation: 'upsert',
      generation: 3,
      attempts: 1,
    }
    const query = makeQueueQuery({ data: [item], error: null })
    const admin = {
      from: vi.fn().mockReturnValue(query.builder),
      rpc: vi.fn(),
    }
    createAdminClientMock.mockReturnValue(admin)

    const response = await GET(
      new Request('http://localhost/api/cron/pub-ops-calendar-note-sync?limit=1') as any
    )

    expect(response.status).toBe(200)
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('supports an immediate targeted retry without loading the batch', async () => {
    const admin = { from: vi.fn() }
    createAdminClientMock.mockReturnValue(admin)

    const response = await GET(
      new Request('http://localhost/api/cron/pub-ops-calendar-note-sync?noteId=note-42') as any
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(admin.from).not.toHaveBeenCalled()
    expect(processQueueItemMock).toHaveBeenCalledWith(admin, 'note-42', {
      force: true,
      context: { context: 'pub_ops_calendar_note_single_sync' },
    })
    expect(payload.processed).toBe(1)
  })

  it('returns a generic failure when the queue cannot be loaded', async () => {
    const query = makeQueueQuery({ data: null, error: new Error('database details') })
    createAdminClientMock.mockReturnValue({ from: vi.fn().mockReturnValue(query.builder) })

    const response = await GET(new Request('http://localhost/api/cron/pub-ops-calendar-note-sync') as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({
      success: false,
      error: 'Failed to sync Pub Ops calendar notes',
    })
  })
})
