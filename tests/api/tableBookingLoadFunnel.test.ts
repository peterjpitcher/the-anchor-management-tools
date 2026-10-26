import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

/**
 * BK-101 and BK-097 (customer bookings review of 24 October 2026): every availability answer the
 * website gets from /api/table-bookings/load is counted, with its outcome and no personal data,
 * so "no tables" and "could not check" can be told apart from fewer visitors. An answer of
 * "unknown" from the database function is also logged as an error, because the function
 * swallows its own failures.
 */

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }))

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(async (handler: (request: Request, apiKey: { id: string }) => Promise<Response>, _scopes: string[], request: Request) =>
    handler(request, { id: '00000000-0000-4000-8000-0000000000a1' }),
  ),
  createApiResponse: (payload: unknown, status = 200) => Response.json(payload, { status }),
  createErrorResponse: (message: string, code: string, status = 400) => Response.json({ error: message, code }, { status }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: logError, warn: vi.fn(), info: vi.fn() } }))
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

function load(query: string): NextRequest {
  return new NextRequest(`https://management.example/api/table-bookings/load?${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-26T12:00:00.000Z'))
  db = createFakeDb()
  ;(createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db.client)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/table-bookings/load records each availability answer', () => {
  it('counts the times offered, with the date, party size and purpose only', async () => {
    db.onRpc(() => ({
      data: {
        contract_version: 1,
        calculation_state: 'complete',
        slots: [
          { time: '18:00', state: 'available' },
          { time: '18:15', state: 'unavailable', public_reason: 'slot_full' },
          { time: '18:30', state: 'available' },
        ],
      },
      error: null,
    }))

    const response = await GET(load('date=2026-11-07&party_size=4&purpose=drinks'))

    expect(response.status).toBe(200)
    expect(db.rows('booking_funnel_events')).toEqual([
      expect.objectContaining({
        source: 'ams',
        stage: 'availability',
        route: 'table-bookings/load',
        booking_date: '2026-11-07',
        days_ahead: 12,
        party_size: 4,
        purpose: 'drinks',
        calculation_state: 'complete',
        slots_offered: 2,
        public_reason: null,
        api_key_id: '00000000-0000-4000-8000-0000000000a1',
      }),
    ])
    expect(logError).not.toHaveBeenCalled()
  })

  it('counts a night with no tables', async () => {
    db.onRpc(() => ({ data: { calculation_state: 'complete', slots: [], public_reason: 'closed' }, error: null }))

    await GET(load('date=2026-10-27&party_size=2'))

    expect(db.rows('booking_funnel_events')[0]).toMatchObject({ purpose: 'food', slots_offered: 0, public_reason: 'closed', days_ahead: 1 })
  })

  it('counts and logs an answer the database could not work out', async () => {
    db.onRpc(() => ({ data: { calculation_state: 'unknown', slots: [], public_reason: 'unknown' }, error: null }))

    const response = await GET(load('date=2026-11-07&party_size=6'))

    expect(response.status).toBe(200)
    expect(db.rows('booking_funnel_events')[0]).toMatchObject({ calculation_state: 'unknown', slots_offered: 0 })
    expect(logError).toHaveBeenCalledWith('Table availability came back unknown', expect.anything())
  })

  it('still answers the website when the count cannot be written', async () => {
    db.onRpc(() => ({ data: { calculation_state: 'complete', slots: [{ time: '18:00', state: 'available' }] }, error: null }))
    db.failNext({ table: 'booking_funnel_events', operation: 'insert', message: 'database down' })

    const response = await GET(load('date=2026-11-07&party_size=4'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.table_availability.calculation_state).toBe('complete')
    expect(logError).toHaveBeenCalledWith('Could not record a booking funnel event', expect.anything())
  })

  it('records nothing without a party size, as nothing was checked', async () => {
    await GET(load('date=2026-11-07'))
    expect(db.rows('booking_funnel_events')).toHaveLength(0)
  })
})
