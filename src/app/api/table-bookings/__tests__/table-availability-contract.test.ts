// =============================================================================
// Availability contract test (review F03 / plan T8).
//
// GET /api/table-bookings/load returns TWO slot collections, and the website
// merges them. This test pins the AMS side of that contract to the shared
// fixture (fixtures/table-availability-contract.json); the website carries a
// byte-identical copy and pins its parser to the same file. Tests only: no
// behaviour change.
//
// Collection 1: `data.slots` (kitchen pacing, built in TypeScript).
//   Consumers may rely on, per slot:
//     time                  "HH:MM" London-local, 15-minute grid
//     covers                number, food covers already booked in the window
//     remaining             number >= 0, covers left under the pacing ceiling
//     high_chairs_remaining number >= 0, advisory chairs left for the slot
//   Semantics: pacing only. It knows NOTHING about tables, so `remaining > 0`
//   must never be shown as "bookable" on its own; it is safe to ignore when
//   `data.capacity.enabled` is false.
//
// Collection 2: `data.table_availability` (authoritative, built by the
// check_table_availability_v06 RPC in SQL; the route passes the JSON through
// untouched, or substitutes the `unknown` fallback when the RPC fails).
//   Consumers may rely on, top level:
//     contract_version      1
//     calculation_state     "complete" | "unknown"; on "unknown" the caller
//                           must not treat ANY slot as bookable (never fail
//                           open; say "please ring" instead)
//     date                  "YYYY-MM-DD"
//     party_size            number (echo of the request)
//     slots                 array, empty when closed/too_large/unknown
//     public_reason         present on empty-slot responses: "closed" |
//                           "too_large" | "unknown"
//     message               customer-ready sentence for public_reason; may be
//                           absent on the route-level unknown fallback
//   And per slot (only when calculation_state is "complete"):
//     time                  "HH:MM" London-local
//     state                 "available" | "unavailable"
//     public_reason         null when available, else "tables_full" |
//                           "kitchen_full" | "outside_full" | "closed" |
//                           "too_late" | "too_large" | "unknown" (never an
//                           internal reason; a private block reads tables_full)
//     message               customer-ready sentence, null when available
//     high_chairs_remaining number >= 0, advisory only (the booking RPC's
//                           atomic grant is the real gate)
//   Fields NOT listed here (purpose, outside, requires_accessible_table,
//   max_party_size_online, duration_minutes) are informational echoes: the
//   website must tolerate their absence.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import contract from './fixtures/table-availability-contract.json'
import {
  buildKitchenAvailabilitySlots,
  enrichSlotsWithHighChairsRemaining,
  type HighChairHoldRow,
  type KitchenBookingRow,
  type KitchenPacingSettings,
} from '@/lib/table-bookings/kitchen-pacing'

// --- Route-level mocks (same seams as load/route.test.ts) --------------------

const emptyRowsResult = { data: [] as unknown[], error: null as unknown }
const rpcResult = { data: null as unknown, error: null as unknown }

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => {
        const chain: Record<string, unknown> = {
          eq: vi.fn(() => Promise.resolve(emptyRowsResult)),
          gt: vi.fn(() => chain),
          gte: vi.fn(() => chain),
          lt: vi.fn(() => Promise.resolve(emptyRowsResult)),
        }
        return chain
      }),
    })),
    rpc: vi.fn(() => Promise.resolve(rpcResult)),
  })),
}))

vi.mock('@/lib/api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/auth')>()
  return {
    ...actual,
    withApiAuth: vi.fn(
      (
        handler: (req: Request, apiKey: { id: string }) => Promise<Response>,
        _scopes: string[],
        req: Request
      ) => handler(req, { id: 'test-key' })
    ),
  }
})

// Partial mock: the real slot builders call shouldCountBooking from this module.
vi.mock('@/lib/table-bookings/load', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/table-bookings/load')>()
  return {
    ...actual,
    getBookingLoadForDate: vi.fn(() => Promise.resolve([])),
    getPacingSettings: vi.fn(() =>
      Promise.resolve({ busyThresholdCovers: 30, fillingThresholdCovers: 20, windowMinutes: 60 })
    ),
    toPublicPacingSettings: vi.fn(() => ({
      busy_threshold_covers: 30,
      filling_threshold_covers: 20,
      window_minutes: 60,
    })),
  }
})

vi.mock('@/services/business-hours', () => ({
  getKitchenWindowForDate: vi.fn(() => Promise.resolve(null)),
}))

// Keep the pure slot builders REAL (the pacing test below pins their output);
// only the DB-touching getters are stubbed.
vi.mock('@/lib/table-bookings/kitchen-pacing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/table-bookings/kitchen-pacing')>()
  return {
    ...actual,
    getKitchenPacingSettings: vi.fn(() =>
      Promise.resolve({
        enabled: true,
        windowMinutes: 30,
        paceCoversRegular: 25,
        paceCoversSunday: 20,
        walkInReserveRegular: 6,
        walkInReserveSunday: 6,
      })
    ),
    getKitchenPacingOverrideForDate: vi.fn(() => Promise.resolve(null)),
    getHighChairInventory: vi.fn(() => Promise.resolve(2)),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { GET } from '../load/route'

const scenario = contract.scenario

function makeRequest(query: string) {
  return new NextRequest(`http://localhost/api/table-bookings/load?${query}`, {
    method: 'GET',
    headers: { 'X-API-Key': 'test-key' },
  })
}

beforeEach(() => {
  // The fixture is a capture of one moment and records it as `scenario.now`.
  // Pin the clock to it, so nothing here depends on when the suite runs.
  //
  // The website mirror of this file needs the pin to survive at all: its route
  // applies a same-day cutoff, so on the fixture's own date (2026-08-07) the
  // asserted slots vanished from about 17:00 London. This side is less exposed,
  // but the two files are meant to stay in step, and an unpinned clock around a
  // dated fixture is a bomb waiting for the right afternoon.
  vi.useFakeTimers()
  vi.setSystemTime(new Date(scenario.now))

  rpcResult.data = null
  rpcResult.error = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe('availability contract: pacing slots (data.slots)', () => {
  it('serialises exactly the fixture slots for the fixture scenario', () => {
    // The route returns this array as `data.slots` untouched, so pinning the
    // pure builders pins the wire shape.
    const base = buildKitchenAvailabilitySlots(
      scenario.kitchen_rows as KitchenBookingRow[],
      scenario.kitchen_settings as KitchenPacingSettings,
      scenario.date,
      scenario.grid_start_minutes,
      scenario.grid_end_minutes,
      scenario.step_minutes,
      null,
      new Date(scenario.now)
    )
    const enriched = enrichSlotsWithHighChairsRemaining(
      base,
      scenario.high_chair_holds as HighChairHoldRow[],
      scenario.high_chair_inventory,
      scenario.date,
      scenario.step_minutes,
      new Date(scenario.now)
    )

    expect(enriched).toEqual(contract.slots)
  })
})

describe('availability contract: table_availability', () => {
  it('passes the RPC JSON through to data.table_availability untouched', async () => {
    rpcResult.data = contract.table_availability

    const res = await GET(makeRequest(`date=${scenario.date}&party_size=4`))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.table_availability).toEqual(contract.table_availability)
  })

  it('substitutes exactly the fixture unknown fallback when the RPC fails', async () => {
    rpcResult.error = { message: 'boom' }

    const res = await GET(makeRequest(`date=${scenario.date}&party_size=4`))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.table_availability).toEqual(contract.table_availability_unknown)
  })

  it('returns null table_availability when no party size is supplied (old-website path)', async () => {
    const res = await GET(makeRequest(`date=${scenario.date}`))
    const json = await res.json()

    expect(json.data.table_availability).toBeNull()
  })

  it('keeps the fixture itself inside the documented shape', () => {
    const availability = contract.table_availability

    expect(availability.contract_version).toBe(1)
    expect(availability.calculation_state).toBe('complete')
    expect(availability.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(typeof availability.party_size).toBe('number')
    expect(availability.slots.length).toBeGreaterThan(0)

    for (const slot of availability.slots) {
      // Exactly the keys the SQL builds per slot: additions must be a
      // deliberate contract change in both repos, not drift.
      expect(Object.keys(slot).sort()).toEqual([
        'high_chairs_remaining',
        'message',
        'public_reason',
        'state',
        'time',
      ])
      expect(slot.time).toMatch(/^\d{2}:\d{2}$/)
      expect(['available', 'unavailable']).toContain(slot.state)
      expect(typeof slot.high_chairs_remaining).toBe('number')
      if (slot.state === 'available') {
        expect(slot.public_reason).toBeNull()
        expect(slot.message).toBeNull()
      } else {
        expect(['tables_full', 'kitchen_full', 'outside_full', 'closed', 'too_late', 'too_large', 'unknown'])
          .toContain(slot.public_reason)
        expect(typeof slot.message).toBe('string')
      }
    }

    const unknown = contract.table_availability_unknown
    expect(unknown.calculation_state).toBe('unknown')
    expect(unknown.slots).toEqual([])
    expect(unknown.public_reason).toBe('unknown')
  })
})
