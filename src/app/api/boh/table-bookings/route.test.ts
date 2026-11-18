import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Every query chain records its calls and resolves to an empty result, so the
// route runs end to end and the test can inspect how table_bookings was read.
const calls: Array<{ table: string; method: string; args: unknown[] }> = []

// Rows a table_bookings read answers with; empty unless a test sets them.
let tableBookingRows: unknown[] = []

function makeChain(table: string): unknown {
  const result = { data: table === 'table_bookings' ? tableBookingRows : [], error: null }
  const chain: Record<string, unknown> = {}
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve)
      }
      return (...args: unknown[]) => {
        calls.push({ table, method: String(prop), args })
        return proxy
      }
    },
  }
  const proxy = new Proxy(chain, handler)
  return proxy
}

vi.mock('@/lib/foh/api-auth', () => ({
  requireBohTableBookingPermission: vi.fn(),
  getLondonDateIso: vi.fn(() => '2026-09-25'),
}))

import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { GET } from './route'

describe('GET /api/boh/table-bookings', () => {
  beforeEach(() => {
    calls.length = 0
    tableBookingRows = []
    vi.mocked(requireBohTableBookingPermission).mockResolvedValue({
      ok: true,
      supabase: { from: (table: string) => makeChain(table) },
    } as never)
  })

  it('should leave out table bookings released by a communal seating conversion', async () => {
    const response = await GET(new NextRequest('http://localhost/api/boh/table-bookings?date=2026-09-25'))

    expect(response.status).toBe(200)
    const orFilters = calls.filter((call) => call.table === 'table_bookings' && call.method === 'or')
    expect(orFilters.length).toBeGreaterThan(0)
    expect(orFilters[0].args[0]).toBe(
      'cancellation_reason.is.null,cancellation_reason.neq.converted_to_communal_seating'
    )
  })

  describe('summary=1 (previous-period comparison)', () => {
    it('reads only table_bookings, with slim columns and the same filters', async () => {
      const response = await GET(
        new NextRequest('http://localhost/api/boh/table-bookings?date=2026-09-25&view=week&summary=1')
      )

      expect(response.status).toBe(200)
      // No tables, areas, assignments, events, deposit-review or customer reads.
      expect(new Set(calls.map((call) => call.table))).toEqual(new Set(['table_bookings']))
      const selects = calls.filter((call) => call.method === 'select')
      expect(selects).toHaveLength(1)
      const columns = String(selects[0].args[0])
      expect(columns).not.toContain('customer')
      expect(columns).toContain('party_size')
      expect(columns).toContain('status')

      // Same Monday-to-Sunday range and the same communal-seating exclusion as the full list.
      expect(calls.find((call) => call.method === 'gte')?.args).toEqual(['booking_date', '2026-09-21'])
      expect(calls.find((call) => call.method === 'lte')?.args).toEqual(['booking_date', '2026-09-27'])
      expect(calls.find((call) => call.method === 'or')?.args[0]).toBe(
        'cancellation_reason.is.null,cancellation_reason.neq.converted_to_communal_seating'
      )
    })

    it('returns the same visual statuses the full list gives', async () => {
      tableBookingRows = [
        { id: 'a', booking_date: '2026-09-25', booking_time: '18:00', party_size: 4, status: 'confirmed', payment_status: null, seated_at: '2026-09-25T17:05:00Z', left_at: null, no_show_at: null },
        { id: 'b', booking_date: '2026-09-25', booking_time: '19:00', party_size: 2, status: 'confirmed', payment_status: null, seated_at: null, left_at: null, no_show_at: '2026-09-25T18:30:00Z' },
        { id: 'c', booking_date: '2026-09-25', booking_time: '20:00', party_size: 6, status: 'cancelled', payment_status: null, seated_at: null, left_at: null, no_show_at: null },
        { id: 'd', booking_date: '2026-09-25', booking_time: '20:30', party_size: 20, status: 'confirmed', payment_status: 'pending', seated_at: null, left_at: null, no_show_at: null },
      ]

      const summary = await (await GET(
        new NextRequest('http://localhost/api/boh/table-bookings?date=2026-09-25&summary=1')
      )).json()
      const full = await (await GET(
        new NextRequest('http://localhost/api/boh/table-bookings?date=2026-09-25')
      )).json()

      expect(summary.success).toBe(true)
      expect(summary.data.summary).toBe(true)
      expect(summary.data.range_start_date).toBe(full.data.range_start_date)
      expect(summary.data.range_end_date).toBe(full.data.range_end_date)
      expect(summary.data.total).toBe(full.data.total)
      expect(summary.data.tables).toBeUndefined()

      const pick = (booking: Record<string, unknown>) => ({
        id: booking.id,
        status: booking.status,
        visual_status: booking.visual_status,
        party_size: booking.party_size,
        seated_at: booking.seated_at,
        left_at: booking.left_at,
      })
      const fullById = new Map(full.data.bookings.map((booking: Record<string, unknown>) => [booking.id, pick(booking)]))
      for (const booking of summary.data.bookings) {
        expect(pick(booking)).toEqual(fullById.get(booking.id))
      }
      expect(summary.data.bookings.map((booking: { visual_status: string }) => booking.visual_status)).toEqual([
        'seated',
        'no_show',
        'cancelled',
        'pending_payment',
      ])
    })

    it('still runs the back-of-house permission check and passes its refusal on', async () => {
      vi.mocked(requireBohTableBookingPermission).mockResolvedValue({
        ok: false,
        response: new Response('Forbidden', { status: 403 }),
      } as never)

      const response = await GET(
        new NextRequest('http://localhost/api/boh/table-bookings?date=2026-09-25&summary=1')
      )

      expect(response.status).toBe(403)
      expect(requireBohTableBookingPermission).toHaveBeenCalledWith('view')
      expect(calls).toHaveLength(0)
    })
  })
})
