import { beforeEach, describe, expect, it, vi } from 'vitest'

/** BK-034: flagged event text replies are listed until someone reads them, without the text. */
const state = vi.hoisted(() => ({ allowed: true, filters: [] as Array<[string, string, unknown]>, rows: [] as unknown[] }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => state.allowed) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => {
  const builder: Record<string, unknown> = {}
  builder.select = () => builder
  for (const method of ['eq', 'is', 'gte']) builder[method] = (column: string, value: unknown) => { state.filters.push([method, column, value]); return builder }
  builder.order = () => builder
  builder.limit = () => builder
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: state.rows, error: null })
  return builder
} }) }))

import { listUnbookedEventReplies } from '@/app/actions/unbooked-event-replies'

const EVENT_ID = '11111111-1111-4111-8111-111111111111'
beforeEach(() => {
  state.allowed = true
  state.filters = []
  state.rows = [{ id: 'm1', customer_id: 'c1', created_at: '2026-11-19T10:00:00Z', body: 'can we bring 2 kids', metadata: { reply_to_book_unbooked: true, reply_to_book_event_id: EVENT_ID }, customer: { first_name: 'Pat' } }]
})

describe('listUnbookedEventReplies', () => {
  it('lists unread flagged inbound replies for the event, with no message text', async () => {
    const result = await listUnbookedEventReplies({ eventId: EVENT_ID })
    expect(result.data).toEqual([{ messageId: 'm1', customerId: 'c1', firstName: 'Pat', receivedAt: '2026-11-19T10:00:00Z', eventId: EVENT_ID }])
    expect(JSON.stringify(result)).not.toContain('kids')
    expect(state.filters).toEqual(expect.arrayContaining([
      ['eq', 'direction', 'inbound'],
      ['is', 'read_at', null],
      ['eq', 'metadata->>reply_to_book_unbooked', 'true'],
      ['eq', 'metadata->>reply_to_book_event_id', EVENT_ID],
    ]))
  })
  it('needs permission to view events', async () => {
    state.allowed = false
    expect(await listUnbookedEventReplies()).toEqual({ error: 'You do not have permission to view events.' })
  })
})
