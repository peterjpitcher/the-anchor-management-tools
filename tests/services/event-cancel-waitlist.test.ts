import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('@/lib/email/event-ticket-emails', () => ({
  sendEventBookingCancelledEmail: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/lib/events/manage-booking', () => ({ processEventRefund: vi.fn() }))

import {
  EventService,
  OPEN_WAITLIST_ENTRY_STATUSES,
  OPEN_WAITLIST_OFFER_STATUSES,
} from '@/services/events'

/**
 * Cancelling an event must close its waitlist. The cascade used to filter waitlist_entries on
 * ('pending', 'offered') and waitlist_offers on ('pending', 'active'). Neither table can hold
 * 'pending' or 'active' (their status checks, confirmed against production on 14 October 2026),
 * so queued entries and sent offers outlived the cancelled event.
 */

function allowedStatuses(table: 'waitlist_entries' | 'waitlist_offers'): string[] {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260420000003_bookings_v05_foundations.sql'),
    'utf8',
  )
  const block = sql.slice(sql.indexOf(`CREATE TABLE IF NOT EXISTS public.${table}`))
  const check = block.match(/status text NOT NULL DEFAULT '\w+' CHECK \(status IN \(([^)]*)\)\)/)
  if (!check) throw new Error(`No status check found for ${table}`)
  return [...check[1].matchAll(/'(\w+)'/g)].map((match) => match[1])
}

type Call = { table: string; method: string; args: unknown[] }

/** A Supabase stand-in that records every chained call and resolves each chain to its table's rows. */
function recordingDb(rowsByTable: Record<string, unknown[]>) {
  const calls: Call[] = []
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'update', 'insert', 'eq', 'in', 'order', 'limit', 'maybeSingle', 'single']) {
      chain[method] = (...args: unknown[]) => {
        calls.push({ table, method, args })
        return chain
      }
    }
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: rowsByTable[table] ?? [], error: null }).then(resolve)
    return chain
  })
  return { db: { from } as never, calls }
}

function statusFilter(calls: Call[], table: string): unknown[][] {
  return calls
    .filter((call) => call.table === table && call.method === 'in' && call.args[0] === 'status')
    .map((call) => call.args[1] as unknown[])
}

const params = {
  eventId: 'event-1',
  eventName: 'Quiz Night',
  eventDate: '2026-10-20',
  eventTime: '19:00',
  cancelledBy: 'user-1',
}

describe('event cancellation closes the waitlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('filters only on statuses the waitlist tables can hold, covering every open one', () => {
    const entryStatuses = allowedStatuses('waitlist_entries')
    const offerStatuses = allowedStatuses('waitlist_offers')

    expect(entryStatuses).toEqual(['queued', 'offered', 'accepted', 'expired', 'cancelled'])
    expect(offerStatuses).toEqual(['sent', 'accepted', 'expired', 'cancelled'])
    for (const status of OPEN_WAITLIST_ENTRY_STATUSES) expect(entryStatuses).toContain(status)
    for (const status of OPEN_WAITLIST_OFFER_STATUSES) expect(offerStatuses).toContain(status)
    expect([...OPEN_WAITLIST_ENTRY_STATUSES]).toEqual(['queued', 'offered'])
    expect([...OPEN_WAITLIST_OFFER_STATUSES]).toEqual(['sent'])
  })

  it('cancels queued and offered entries and sent offers when the event has no bookings', async () => {
    const { db, calls } = recordingDb({ bookings: [] })

    await EventService.cancelEventBookings({ ...params, supabase: db })

    expect(statusFilter(calls, 'waitlist_entries')).toEqual([['queued', 'offered']])
    expect(statusFilter(calls, 'waitlist_offers')).toEqual([['sent']])
  })

  it('cancels them after cancelling the bookings too', async () => {
    const { db, calls } = recordingDb({
      bookings: [
        {
          id: 'booking-1',
          customer_id: 'customer-1',
          seats: 2,
          status: 'confirmed',
          customers: { id: 'customer-1', first_name: 'Sam', mobile_number: null, sms_status: 'opted_out' },
        },
      ],
      payments: [],
    })

    await EventService.cancelEventBookings({ ...params, supabase: db })

    expect(statusFilter(calls, 'waitlist_entries')).toEqual([['queued', 'offered']])
    expect(statusFilter(calls, 'waitlist_offers')).toEqual([['sent']])
  })
})
