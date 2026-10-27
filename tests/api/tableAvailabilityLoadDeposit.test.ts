import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

/**
 * BK-186 (customer bookings review of 24 October 2026): the website quotes the deposit AMS will
 * charge, so /api/table-bookings/load answers with it, asked of resolve_table_booking_deposit, the
 * function the booking itself charges with. The website no longer keeps its own copy of the rule.
 */

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(async (handler: (request: Request, apiKey: { id: string }) => Promise<Response>, _scopes: string[], request: Request) =>
    handler(request, { id: '00000000-0000-4000-8000-0000000000a1' }),
  ),
  createApiResponse: (payload: unknown, status = 200) => Response.json(payload, { status }),
  createErrorResponse: (message: string, code: string, status = 400) => Response.json({ error: message, code }, { status }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/table-bookings/load', () => ({
  getBookingLoadForDate: vi.fn(async () => []),
  getPacingSettings: vi.fn(async () => ({})),
  toPublicPacingSettings: vi.fn(() => ({ window_minutes: 30, busy_threshold_covers: 40, filling_threshold_covers: 30 })),
}))
vi.mock('@/lib/table-bookings/kitchen-pacing', () => ({
  buildKitchenAvailabilitySlots: vi.fn(() => []),
  enrichSlotsWithHighChairsRemaining: vi.fn(() => []),
  getHighChairInventory: vi.fn(async () => 2),
  getKitchenPacingOverrideForDate: vi.fn(async () => null),
  getKitchenPacingSettings: vi.fn(async () => ({ enabled: false, windowMinutes: 30, walkInReserveSunday: 0, walkInReserveRegular: 0 })),
  isSundayDate: vi.fn(() => false),
  resolveKitchenCeiling: vi.fn(() => 0),
}))
vi.mock('@/services/business-hours', () => ({ getKitchenWindowForDate: vi.fn(async () => null) }))

import { createAdminClient } from '@/lib/supabase/admin'
import { GET } from '@/app/api/table-bookings/load/route'

let db: FakeDb
const PERIOD_ID = '11111111-1111-4111-8111-111111111111'

function load(query: string): NextRequest {
  return new NextRequest(`https://management.example/api/table-bookings/load?${query}`)
}

function availability() {
  return { data: { contract_version: 1, calculation_state: 'complete', slots: [] }, error: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  db = createFakeDb()
  ;(createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db.client)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/table-bookings/load quotes the deposit AMS charges', () => {
  it('returns the figure resolve_table_booking_deposit gives for the party and date', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    db.onRpc((name, args) => {
      calls.push({ name, args })
      if (name === 'resolve_table_booking_deposit') {
        return { data: { ok: true, required: true, amount: 160, rule: 'group', reason: 'Parties of 15 or more pay GBP 10.00 per guest.' }, error: null }
      }
      return availability()
    })

    const response = await GET(load('date=2026-11-07&party_size=16&purpose=food'))
    const body = await response.json()

    expect(body.deposit).toEqual({
      party_size: 16,
      required: true,
      amount: 160,
      rule: 'group',
      reason: 'Parties of 15 or more pay GBP 10.00 per guest.',
    })
    expect(calls.find((call) => call.name === 'resolve_table_booking_deposit')?.args).toEqual({
      p_party_size: 16,
      p_booking_date: '2026-11-07',
      p_period_id: undefined,
      p_period_answer: undefined,
    })
  })

  it("passes the guest's seasonal answer, so a Christmas quote is the Christmas charge", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    db.onRpc((name, args) => {
      calls.push({ name, args })
      if (name === 'resolve_table_booking_deposit') {
        return { data: { ok: true, required: true, amount: 60, rule: 'period', reason: 'Christmas deposit, GBP 10.00 per guest.' }, error: null }
      }
      return availability()
    })

    const response = await GET(load(`date=2026-12-12&party_size=6&purpose=food&period_id=${PERIOD_ID}&period_answer=true`))
    const body = await response.json()

    expect(body.deposit).toMatchObject({ required: true, amount: 60, rule: 'period' })
    expect(calls.find((call) => call.name === 'resolve_table_booking_deposit')?.args).toMatchObject({
      p_period_id: PERIOD_ID,
      p_period_answer: true,
    })
  })

  it('says nothing owed for a small party', async () => {
    db.onRpc((name) =>
      name === 'resolve_table_booking_deposit'
        ? { data: { ok: true, required: false, amount: 0, rule: 'none', reason: 'No deposit is needed.' }, error: null }
        : availability(),
    )

    const body = await (await GET(load('date=2026-11-07&party_size=4'))).json()

    expect(body.deposit).toMatchObject({ required: false, amount: 0 })
  })

  it('quotes nothing when the figure cannot be worked out, rather than a guess', async () => {
    db.onRpc((name) =>
      name === 'resolve_table_booking_deposit' ? { data: null, error: { message: 'boom' } } : availability(),
    )

    const body = await (await GET(load('date=2026-11-07&party_size=16'))).json()

    expect(body.deposit).toBeNull()
  })

  it('quotes nothing without a party size', async () => {
    db.onRpc(() => availability())

    const body = await (await GET(load('date=2026-11-07'))).json()

    expect(body.deposit).toBeNull()
  })

  it('ignores a period id that is not one', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    db.onRpc((name, args) => {
      calls.push({ name, args })
      return name === 'resolve_table_booking_deposit'
        ? { data: { ok: true, required: false, amount: 0, rule: 'none' }, error: null }
        : availability()
    })

    await GET(load("date=2026-11-07&party_size=4&period_id=x'or'1&period_answer=true"))

    expect(calls.find((call) => call.name === 'resolve_table_booking_deposit')?.args).toMatchObject({
      p_period_id: undefined,
      p_period_answer: undefined,
    })
  })
})
