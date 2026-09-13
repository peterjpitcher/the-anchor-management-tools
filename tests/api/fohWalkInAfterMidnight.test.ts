// Walk-ins between midnight and a 1am close.
//
// New Year's Eve 2026 is 12:00 to 01:00 and 1 January is closed. Walk-ins were allowed only on
// the calendar date, so at 00:30 nothing could be added to 31 December's service; and the
// walk-in fallback built its start from the date glued to the time, so a 00:31 walk-in on 31
// December's service would have landed at 00:31 on 31 December. The booking functions refuse
// that time as already past, which is what sends a walk-in down the fallback in the first place.
//
// The real route, trading-day resolver and London date helpers run here; the database is a
// stub that answers the hours reads. Instants are in UTC so the file reads the same in both
// test zones (London is on GMT from 25 October 2026 to 28 March 2027, BST either side).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/foh/api-auth', async () => {
  const { toLocalIsoDate } = await vi.importActual<typeof import('@/lib/dateUtils')>('@/lib/dateUtils')
  return { requireFohPermission: vi.fn(), getLondonDateIso: (now: Date = new Date()) => toLocalIsoDate(now) }
})

vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone: vi.fn(),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  alignTablePaymentHoldToScheduledSend: vi.fn(),
  createTablePaymentToken: vi.fn(),
  mapTableBookingBlockedReason: vi.fn(() => 'no_table'),
  sendManagerTableBookingCreatedEmailIfAllowed: vi.fn(async () => ({ sent: true })),
  sendTableBookingCreatedSmsIfAllowed: vi.fn(async () => ({ sent: true })),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { POST } from '@/app/api/foh/bookings/route'
import { FOH_BOOKING_CLIENT_CONTRACT, FOH_BOOKING_CLIENT_HEADER } from '@/lib/foh/booking-client-contract'
import { WALK_IN_TODAY_ONLY_MESSAGE } from '@/lib/foh/walk-in'

function makeThenable(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'order', 'in', 'lt', 'gt', 'gte', 'lte', 'eq', 'neq', 'is', 'not', 'update', 'delete', 'insert']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.then = (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected)
  return builder
}

const WEEKLY = { opens: '12:00:00', closes: '22:00:00', is_closed: false }
const SPECIALS = [
  { date: '2026-12-31', opens: '12:00:00', closes: '01:00:00', is_closed: false },
  { date: '2027-01-01', opens: null, closes: null, is_closed: true },
]

// The staff booking function refuses the time (as it does 00:31 on 31 December, which it reads
// as already past), and that sends a walk-in down the fallback insert.
function buildSupabase(refusal: string) {
  const rpc = vi.fn((fn: string) => {
    if (fn === 'business_hours_for_date') return Promise.resolve({ data: [WEEKLY], error: null })
    if (fn === 'create_table_booking_staff_v06') return Promise.resolve({ data: { state: 'blocked', reason: refusal }, error: null })
    return Promise.resolve({ data: null, error: null })
  })
  const tableBookingInsert = vi.fn(() => makeThenable({ data: { id: 'tb-walk-in-1', booking_reference: 'TB-W1' }, error: null }))

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'special_hours') {
        return {
          select: () => ({
            in: (_column: string, dates: string[]) =>
              Promise.resolve({ data: SPECIALS.filter((row) => dates.includes(row.date)), error: null }),
          }),
        }
      }
      if (table === 'table_bookings') {
        return {
          insert: tableBookingInsert,
          select: vi.fn(() => makeThenable({ data: [], error: null })),
          update: vi.fn(() => makeThenable({ data: null, error: null })),
          delete: vi.fn(() => makeThenable({ data: null, error: null })),
        }
      }
      return makeThenable({ data: [], error: null })
    }),
    rpc,
  }
  return { supabase, rpc, tableBookingInsert }
}

function walkIn(date: string, time: string) {
  const request = new Request('http://localhost/api/foh/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', [FOH_BOOKING_CLIENT_HEADER]: FOH_BOOKING_CLIENT_CONTRACT },
    body: JSON.stringify({
      customer_mode: 'phone',
      phone: '+447700900222',
      walk_in: true,
      date,
      time,
      party_size: 2,
      purpose: 'drinks',
      // Outside seating skips indoor table allocation, which is not what this file is about.
      outside_seating: true,
    }),
  })
  return Object.assign(request, { nextUrl: new URL(request.url) }) as never
}

async function postAt(isoInstant: string, date: string, time: string, refusal = 'in_past') {
  vi.setSystemTime(new Date(isoInstant))
  const { supabase, tableBookingInsert } = buildSupabase(refusal)
  vi.mocked(requireFohPermission).mockResolvedValue({ ok: true, userId: 'user-1', supabase } as never)
  const response = await POST(walkIn(date, time))
  const inserted = (tableBookingInsert.mock.calls[0] as unknown[] | undefined)?.[0] as Record<string, unknown> | undefined
  return { status: response.status, body: await response.json(), inserted }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.mocked(ensureCustomerForPhone).mockResolvedValue({ customerId: 'customer-1', resolutionError: undefined } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a walk-in at 00:30 on 1 January', () => {
  it('joins 31 December\'s service, seated, starting at 00:31 on 1 January', async () => {
    const { status, body, inserted } = await postAt('2027-01-01T00:30:00Z', '2026-12-31', '00:31')
    expect(status).toBe(201)
    expect(body.data).toMatchObject({ state: 'confirmed', table_booking_id: 'tb-walk-in-1' })
    expect(inserted).toMatchObject({
      booking_date: '2026-12-31',
      booking_time: '00:31:00',
      start_datetime: '2027-01-01T00:31:00.000Z',
      end_datetime: '2027-01-01T02:01:00.000Z',
      source: 'walk-in',
      seated_at: '2027-01-01T00:30:00.000Z',
    })
  })

  it('is refused for 1 January, which is closed and not the service in progress', async () => {
    const { status, body, inserted } = await postAt('2027-01-01T00:30:00Z', '2027-01-01', '00:31')
    expect(status).toBe(400)
    expect(body.error).toBe(WALK_IN_TODAY_ONLY_MESSAGE)
    expect(inserted).toBeUndefined()
  })
})

describe('around the 1am close', () => {
  it('takes a walk-in for 31 December at 23:30 on the evening itself', async () => {
    const { status, inserted } = await postAt('2026-12-31T23:30:00Z', '2026-12-31', '23:31', 'outside_hours')
    expect(status).toBe(201)
    expect(inserted).toMatchObject({ booking_date: '2026-12-31', start_datetime: '2026-12-31T23:31:00.000Z' })
  })

  it('dates walk-ins by 1 January once the night has closed', async () => {
    const refused = await postAt('2027-01-01T01:05:00Z', '2026-12-31', '01:06')
    expect(refused.status).toBe(400)
    const taken = await postAt('2027-01-01T01:05:00Z', '2027-01-01', '01:06', 'outside_hours')
    expect(taken.status).toBe(201)
    expect(taken.inserted).toMatchObject({ booking_date: '2027-01-01', start_datetime: '2027-01-01T01:06:00.000Z' })
  })
})

describe('an ordinary day is unchanged', () => {
  it('takes a walk-in on the calendar date at its own time', async () => {
    // 18:00 BST on Friday 11 September 2026.
    const { status, inserted } = await postAt('2026-09-11T17:00:00Z', '2026-09-11', '18:01', 'outside_hours')
    expect(status).toBe(201)
    expect(inserted).toMatchObject({ booking_date: '2026-09-11', booking_time: '18:01:00', start_datetime: '2026-09-11T17:01:00.000Z' })
  })

  it('refuses yesterday once the night has closed at 22:00', async () => {
    // 00:30 BST on Saturday 12 September.
    const { status } = await postAt('2026-09-11T23:30:00Z', '2026-09-11', '00:31')
    expect(status).toBe(400)
  })
})
