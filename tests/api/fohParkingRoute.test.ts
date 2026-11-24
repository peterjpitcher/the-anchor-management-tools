import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  tradingDay: vi.fn(),
}))

vi.mock('@/lib/foh/api-auth', () => ({ requireFohPermission: mocks.permission }))
vi.mock('@/lib/business-hours/trading-day', () => ({ resolveTradingDayNow: mocks.tradingDay }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { GET } from '@/app/api/foh/parking/route'
import { FOH_PARKING_COLUMNS } from '@/lib/foh/parking-view'

/**
 * Parking for the till (owner request, 23 November 2026). The shared FOH login may see what
 * parking is booked and must never see a price. These tests hold that line: the route reads a
 * fixed list of columns with no money in it, answers with a fixed list of fields, and leaves
 * cancelled bookings out.
 */

const MONEY = /price|amount|rate|total|fee|refund|discount|cost|paid_amount|gbp/i

// A row as the table really holds it, money and all, to prove none of it gets out.
function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    reference: 'PK-1001',
    customer_first_name: 'Asha',
    customer_last_name: 'Patel',
    customer_mobile: '+447700900111',
    customer_email: 'asha@example.com',
    vehicle_registration: 'AB12 CDE',
    vehicle_make: 'Ford',
    vehicle_model: 'Focus',
    vehicle_colour: 'Blue',
    start_at: '2026-07-10T13:00:00.000Z',
    end_at: '2026-07-14T09:00:00.000Z',
    status: 'confirmed',
    payment_status: 'paid',
    calculated_price: 84.5,
    override_price: 60,
    pricing_breakdown: { days: 4, rate: 21.125, total: 84.5 },
    ...overrides,
  }
}

/** A stand-in for the table that applies the status filter, so "cancelled is left out" is real. */
function buildDb(rows: Array<Record<string, unknown>>) {
  const seen: { table: string | null; select: string | null; filters: Array<[string, string, unknown]> } = {
    table: null,
    select: null,
    filters: [],
  }
  const from = (table: string) => {
    seen.table = table
    let result = rows
    const builder: Record<string, unknown> = {}
    builder.select = (columns: string) => { seen.select = columns; return builder }
    builder.in = (column: string, values: unknown[]) => {
      seen.filters.push(['in', column, values])
      result = result.filter((row) => values.includes(row[column]))
      return builder
    }
    builder.gte = (column: string, value: string) => {
      seen.filters.push(['gte', column, value])
      result = result.filter((row) => Date.parse(String(row[column])) >= Date.parse(value))
      return builder
    }
    builder.lt = (column: string, value: string) => {
      seen.filters.push(['lt', column, value])
      result = result.filter((row) => Date.parse(String(row[column])) < Date.parse(value))
      return builder
    }
    builder.order = () => builder
    builder.limit = () => builder
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: result, error: null }).then(resolve)
    return builder
  }
  return { supabase: { from }, seen }
}

function everyKey(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => everyKey(item, keys))
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) { keys.push(key); everyKey(inner, keys) }
  }
  return keys
}

async function call(rows: Array<Record<string, unknown>>) {
  const db = buildDb(rows)
  mocks.permission.mockResolvedValue({ ok: true, userId: 'user-1', supabase: db.supabase })
  const response = await GET()
  return { status: response.status, body: await response.json(), seen: db.seen }
}

// Friday 10 July 2026, 3pm in London (British Summer Time, so 14:00 UTC).
const NOW = '2026-07-10T14:00:00.000Z'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  mocks.tradingDay.mockResolvedValue({ date: '2026-07-10', until: new Date('2026-07-10T23:00:00.000Z') })
})
afterEach(() => vi.useRealTimers())

describe('who may read it', () => {
  it('asks for table_bookings view, the same gate as the floor screen, and nothing about parking', async () => {
    await call([])

    expect(mocks.permission).toHaveBeenCalledWith('view')
  })

  it('refuses a user without table_bookings view and reads nothing', async () => {
    const db = buildDb([dbRow()])
    const fromSpy = vi.spyOn(db.supabase, 'from')
    mocks.permission.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) })

    const response = await GET()

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
    expect(fromSpy).not.toHaveBeenCalled()
  })
})

describe('no money leaves the route', () => {
  it('reads an explicit list of columns with no money column in it', async () => {
    const { seen } = await call([dbRow()])

    expect(seen.table).toBe('parking_bookings')
    expect(seen.select).toBe(FOH_PARKING_COLUMNS)
    expect(seen.select).not.toContain('*')
    for (const column of String(seen.select).split(',').map((name) => name.trim())) {
      expect(column, column).not.toMatch(MONEY)
    }
    expect(seen.select).not.toContain('pricing_breakdown')
    expect(seen.select).not.toContain('payment_due_at')
  })

  it('answers with no key that looks like money, even when the rows carry prices', async () => {
    const { status, body } = await call([
      dbRow(),
      dbRow({ reference: 'PK-1002', start_at: '2026-07-12T10:00:00.000Z', end_at: '2026-07-13T10:00:00.000Z' }),
    ])

    expect(status).toBe(200)
    const keys = everyKey(body)
    expect(keys.length).toBeGreaterThan(10)
    for (const key of keys) expect(key, key).not.toMatch(MONEY)
    // And no figure from the rows anywhere in the answer.
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('84.5')
    expect(raw).not.toContain('21.125')
    expect(raw).not.toContain('asha@example.com')
  })

  it('returns exactly these fields for a booking', async () => {
    const { body } = await call([dbRow()])

    expect(body.data.arriving_today).toEqual([
      {
        reference: 'PK-1001',
        guest_name: 'Asha Patel',
        phone: '+447700900111',
        vehicle_registration: 'AB12 CDE',
        vehicle_make: 'Ford',
        vehicle_model: 'Focus',
        vehicle_colour: 'Blue',
        arrives_at: '2026-07-10T13:00:00.000Z',
        leaves_at: '2026-07-14T09:00:00.000Z',
        status: 'confirmed',
        paid: true,
        // D5 (24 November 2026): what is still to collect after a date change, or null.
        owes: null,
      },
    ])
    expect(Object.keys(body.data).sort()).toEqual(['arriving_today', 'coming_up', 'leaving_today', 'on_site_now', 'today'])
  })

  it('says only "not paid" for a booking that is unpaid, pending, failed or refunded', async () => {
    const { body } = await call([
      dbRow({ reference: 'PK-A', status: 'pending_payment', payment_status: 'pending' }),
      dbRow({ reference: 'PK-B', payment_status: 'failed' }),
      dbRow({ reference: 'PK-C', payment_status: 'refunded' }),
      dbRow({ reference: 'PK-D', payment_status: 'paid' }),
    ])

    const paid = Object.fromEntries(
      body.data.arriving_today.map((booking: { reference: string; paid: boolean }) => [booking.reference, booking.paid])
    )
    expect(paid).toEqual({ 'PK-A': false, 'PK-B': false, 'PK-C': false, 'PK-D': true })
  })
})

describe('which bookings are listed', () => {
  it('leaves out cancelled, expired and completed bookings', async () => {
    const { body, seen } = await call([
      dbRow({ reference: 'PK-LIVE' }),
      dbRow({ reference: 'PK-CANCELLED', status: 'cancelled' }),
      dbRow({ reference: 'PK-EXPIRED', status: 'expired' }),
      dbRow({ reference: 'PK-COMPLETED', status: 'completed' }),
    ])

    expect(seen.filters).toContainEqual(['in', 'status', ['pending_payment', 'confirmed']])
    const raw = JSON.stringify(body)
    expect(raw).toContain('PK-LIVE')
    for (const gone of ['PK-CANCELLED', 'PK-EXPIRED', 'PK-COMPLETED']) expect(raw).not.toContain(gone)
  })

  it('sorts cars into arriving, on site and leaving for the day being worked', async () => {
    const { body } = await call([
      // Arrived yesterday, leaves this evening: on site and leaving, not arriving.
      dbRow({ reference: 'PK-LEAVING', start_at: '2026-07-09T09:00:00.000Z', end_at: '2026-07-10T18:00:00.000Z' }),
      // Arrives tonight: arriving, not yet on site.
      dbRow({ reference: 'PK-TONIGHT', start_at: '2026-07-10T19:00:00.000Z', end_at: '2026-07-12T09:00:00.000Z' }),
      // Arrived this morning: arriving today and on site.
      dbRow({ reference: 'PK-HERE', start_at: '2026-07-10T08:00:00.000Z', end_at: '2026-07-11T08:00:00.000Z' }),
    ])
    const refs = (list: Array<{ reference: string }>) => list.map((booking) => booking.reference)

    expect(refs(body.data.arriving_today)).toEqual(['PK-HERE', 'PK-TONIGHT'])
    expect(refs(body.data.on_site_now)).toEqual(['PK-LEAVING', 'PK-HERE'])
    expect(refs(body.data.leaving_today)).toEqual(['PK-LEAVING'])
    expect(body.data.coming_up).toEqual([])
  })

  it('puts a car on the London day it arrives, either side of midnight', async () => {
    const { body } = await call([
      // 00:30 London on the 10th is 23:30 UTC on the 9th: it arrives TODAY.
      dbRow({ reference: 'PK-JUST-AFTER-MIDNIGHT', start_at: '2026-07-09T23:30:00.000Z', end_at: '2026-07-12T09:00:00.000Z' }),
      // 00:30 London on the 11th is 23:30 UTC on the 10th: it arrives TOMORROW.
      dbRow({ reference: 'PK-TOMORROW-EARLY', start_at: '2026-07-10T23:30:00.000Z', end_at: '2026-07-12T09:00:00.000Z' }),
      // Leaves at 00:15 London on the 11th (23:15 UTC on the 10th): not leaving today.
      dbRow({ reference: 'PK-LEAVES-AFTER-MIDNIGHT', start_at: '2026-07-08T09:00:00.000Z', end_at: '2026-07-10T23:15:00.000Z' }),
    ])
    const refs = (list: Array<{ reference: string }>) => list.map((booking) => booking.reference)

    expect(refs(body.data.arriving_today)).toEqual(['PK-JUST-AFTER-MIDNIGHT'])
    expect(refs(body.data.leaving_today)).toEqual([])
    expect(body.data.coming_up).toEqual([
      { date: '2026-07-11', bookings: [expect.objectContaining({ reference: 'PK-TOMORROW-EARLY' })] },
    ])
  })

  it('groups the next 14 days by date and stops there', async () => {
    const { body, seen } = await call([
      dbRow({ reference: 'PK-DAY-3-B', start_at: '2026-07-13T15:00:00.000Z', end_at: '2026-07-15T09:00:00.000Z' }),
      dbRow({ reference: 'PK-DAY-3-A', start_at: '2026-07-13T08:00:00.000Z', end_at: '2026-07-15T09:00:00.000Z' }),
      dbRow({ reference: 'PK-DAY-14', start_at: '2026-07-24T10:00:00.000Z', end_at: '2026-07-25T10:00:00.000Z' }),
      dbRow({ reference: 'PK-DAY-15', start_at: '2026-07-25T10:00:00.000Z', end_at: '2026-07-26T10:00:00.000Z' }),
    ])

    expect(body.data.coming_up.map((day: { date: string; bookings: Array<{ reference: string }> }) => [
      day.date,
      day.bookings.map((booking) => booking.reference),
    ])).toEqual([
      ['2026-07-13', ['PK-DAY-3-A', 'PK-DAY-3-B']],
      ['2026-07-24', ['PK-DAY-14']],
    ])
    // The window is London midnight to London midnight: 23:00 UTC in summer.
    expect(seen.filters).toContainEqual(['gte', 'end_at', '2026-07-09T23:00:00.000Z'])
    expect(seen.filters).toContainEqual(['lt', 'start_at', '2026-07-24T23:00:00.000Z'])
  })
})
