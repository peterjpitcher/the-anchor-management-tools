import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Page load performance, spec section 5.4: the dashboard's "paid, needs action" figure used to run
 * the full exceptions list plus two payments reads to get a count and one event id. It now has a
 * light read of its own. It must give exactly what the list gives (row count, and the event id
 * when every row is on one event), from the same filter, order and cap.
 */

type Call = { table: string; method: string; args: unknown[] }

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  calls: [] as Call[],
  failTable: null as string | null,
  canView: true,
}))

function builder(table: string) {
  let limit: number | null = null
  const api: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order', 'is']) {
    api[method] = (...args: unknown[]) => {
      state.calls.push({ table, method, args })
      return api
    }
  }
  api.limit = (count: number) => {
    state.calls.push({ table, method: 'limit', args: [count] })
    limit = count
    return api
  }
  api.then = (resolve: (value: unknown) => unknown) => {
    if (state.failTable === table) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve)
    const data = table === 'event_payment_exceptions'
      ? state.rows.slice(0, limit ?? state.rows.length)
      : [] // payments: the amounts do not affect the count
    return Promise.resolve({ data, error: null }).then(resolve)
  }
  return api
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (table: string) => builder(table) }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => state.canView) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/events/manage-booking', () => ({ processEventRefund: vi.fn() }))
vi.mock('@/lib/events/event-payment-notify', () => ({ notifyEventPaymentOutcome: vi.fn() }))
vi.mock('@/lib/email/event-ticket-emails', () => ({ sendEventBookingCancelledEmail: vi.fn() }))
vi.mock('@/lib/events/payment-alerts', () => ({ alertEventPaymentNeedsAPerson: vi.fn() }))

import { checkUserPermission } from '@/app/actions/rbac'
import { countOpenEventPaymentExceptions, listEventPaymentExceptions } from '@/app/actions/event-payment-exceptions'

function exception(i: number, eventId: string) {
  return {
    id: `exception-${i}`,
    event_booking_id: `booking-${i}`,
    reason: 'capacity_unavailable_after_capture',
    created_at: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00Z`,
    staff_notified_at: null,
    bookings: { id: `booking-${i}`, event_id: eventId, seats: 2, status: 'pending_payment', events: { name: 'Quiz' }, customers: { first_name: 'A', last_name: 'B' } },
  }
}

/** What the dashboard got before: derived from the full list. */
async function fromList() {
  const result = await listEventPaymentExceptions()
  const rows = result.data ?? []
  const eventIds = [...new Set(rows.map((row) => row.eventId))]
  return { count: rows.length, eventId: eventIds.length === 1 ? eventIds[0] : null }
}

function filtersFor(table: string) {
  return state.calls.filter((call) => call.table === table && call.method !== 'select')
}

beforeEach(() => {
  state.rows = []
  state.calls = []
  state.failTable = null
  state.canView = true
  vi.mocked(checkUserPermission).mockClear()
})

describe('countOpenEventPaymentExceptions', () => {
  it.each([
    ['no exceptions', []],
    ['one exception', [exception(1, 'event-a')]],
    ['three on one event', [1, 2, 3].map((i) => exception(i, 'event-a'))],
    ['spread over two events', [exception(1, 'event-a'), exception(2, 'event-b'), exception(3, 'event-a')]],
    ['more than the 100-row cap, one event', Array.from({ length: 130 }, (_, i) => exception(i, 'event-a'))],
    ['more than the cap, a second event past it', [...Array.from({ length: 100 }, (_, i) => exception(i, 'event-a')), exception(200, 'event-b')]],
  ])('gives the same count and event id as the full list: %s', async (_label, rows) => {
    state.rows = rows
    const expected = await fromList()
    const listFilters = filtersFor('event_payment_exceptions')
    state.calls = []

    expect(await countOpenEventPaymentExceptions()).toEqual(expected)
    // Same filter, order and cap as the list, so the two cannot drift apart.
    expect(filtersFor('event_payment_exceptions')).toEqual(listFilters)
  })

  it('does not read payments', async () => {
    state.rows = [exception(1, 'event-a')]
    await countOpenEventPaymentExceptions()
    expect(state.calls.some((call) => call.table === 'payments')).toBe(false)
  })

  it('still checks the events view permission, and shows nothing without it', async () => {
    state.rows = [exception(1, 'event-a')]
    state.canView = false
    expect(await countOpenEventPaymentExceptions()).toEqual({ count: 0, eventId: null })
    expect(checkUserPermission).toHaveBeenCalledWith('events', 'view')
    expect(state.calls).toEqual([])
  })

  it('shows nothing when the read fails', async () => {
    state.rows = [exception(1, 'event-a')]
    state.failTable = 'event_payment_exceptions'
    expect(await countOpenEventPaymentExceptions()).toEqual({ count: 0, eventId: null })
  })
})
