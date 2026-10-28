import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * BK-145 and BK-146 (customer bookings review of 24 October 2026, owner decision D30).
 *
 * The super admin override and the late walk-in insert the booking themselves. They used their own
 * table picker (any non-cancelled booking counted as sitting at the table, no priority, no
 * maintenance or accessibility) and fixed 90 or 120 minute visits with no turnaround. They now take
 * tables from find_table_allocation_candidates, the booking function's picker, in its order, and the
 * visit length and gap from table_booking_turn_minutes, and keep the guest's accessible-table need.
 * The override also keeps to the one party limit, read from the setting.
 */

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(),
  getLondonDateIso: vi.fn(() => '2026-12-05'),
}))
vi.mock('@/lib/business-hours/trading-day', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/business-hours/trading-day')>()),
  resolveTradingDayNow: vi.fn(async () => ({ date: '2026-12-05', until: new Date('2026-12-05T23:00:00Z') })),
  loadTradingHours: vi.fn(async (_db: unknown, dates: string[]) =>
    new Map(dates.map((date) => [date, { opens: '12:00:00', closes: '23:00:00', is_closed: false }]))),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/table-bookings/bookings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/table-bookings/bookings')>()),
  sendTableBookingCreatedSmsIfAllowed: vi.fn().mockResolvedValue({ sms: null }),
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { POST } from '@/app/api/foh/bookings/route'
import { FOH_BOOKING_CLIENT_CONTRACT, FOH_BOOKING_CLIENT_HEADER } from '@/lib/foh/booking-client-contract'
import { argsOf, called, createRecordingSupabase } from '../mocks/recordingSupabase'

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001'

function buildDb(options: { partyLimit?: number; assignmentConflictOn?: string } = {}) {
  return createRecordingSupabase({
    tables: {
      user_roles: () => ({ data: [{ roles: { name: 'super_admin' } }], error: null }),
      system_settings: () => ({ data: { value: { value: options.partyLimit ?? 20 } }, error: null }),
      booking_table_assignments: (query) => {
        const rows = called(query, 'insert') ? (argsOf(query, 'insert')[0][0] as Array<{ table_id: string }>) : []
        return rows.some((row) => row.table_id === options.assignmentConflictOn)
          ? { data: null, error: { code: '23P01', message: 'table_assignment_overlap' } }
          : { data: null, error: null }
      },
      table_bookings: (query) =>
        called(query, 'insert')
          ? { data: { id: 'tb-override', booking_reference: 'TB-W1234567' }, error: null }
          : { data: null, error: null },
    },
    rpc: (fn) => {
      if (fn === 'table_booking_turn_minutes') {
        return { data: [{ duration_minutes: 105, turnaround_minutes: 15 }], error: null }
      }
      if (fn === 'find_table_allocation_candidates') {
        return {
          data: [
            // Out of order on purpose, with a rejected table (no rank) the picker reports.
            { rank: 2, table_ids: ['table-b'], table_names: ['Low 4b'], total_capacity: 4 },
            { rank: null, table_ids: ['table-x'], table_names: ['Snug'], total_capacity: 4, reason_code: 'table_blocked' },
            { rank: 1, table_ids: ['table-a'], table_names: ['Low 4a'], total_capacity: 4 },
          ],
          error: null,
        }
      }
      return { data: null, error: null }
    },
  })
}

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/foh/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [FOH_BOOKING_CLIENT_HEADER]: FOH_BOOKING_CLIENT_CONTRACT },
    body: JSON.stringify({ customer_mode: 'selected', customer_id: CUSTOMER_ID, date: '2026-12-05', time: '19:00', purpose: 'food', ...body }),
  }) as unknown as import('next/server').NextRequest
}

describe('the super admin override uses the booking function picker and visit length', () => {
  beforeEach(() => vi.clearAllMocks())

  it('asks the shared picker on the walk-in channel, for the visit plus the turnaround gap', async () => {
    const db = buildDb()
    vi.mocked(requireFohPermission).mockResolvedValue({ ok: true, userId: 'user-admin', supabase: db.client } as never)

    const response = await POST(request({ party_size: 4, management_override: true, requires_accessible_table: true, high_chair_count: 1 }))

    expect(response.status).toBe(200)
    expect(db.rpc).toHaveBeenCalledWith('table_booking_turn_minutes', {
      p_booking_date: '2026-12-05',
      p_party_size: 4,
      p_purpose: 'food',
    })
    // 19:00 London on 5 December is 19:00 UTC; 105 minutes plus a 15 minute gap.
    expect(db.rpc).toHaveBeenCalledWith('find_table_allocation_candidates', {
      p_start_at: '2026-12-05T19:00:00.000Z',
      p_end_at: '2026-12-05T21:00:00.000Z',
      p_party_size: 4,
      p_purpose: 'food',
      p_high_chair_count: 1,
      p_requires_accessible_table: true,
      p_channel: 'walkin',
    })
    expect(db.queries.some((query) => query.table === 'tables' || query.table === 'table_join_links')).toBe(false)
  })

  it("takes the picker's first choice, keeps the accessible-table need, and holds the table through the gap", async () => {
    const db = buildDb()
    vi.mocked(requireFohPermission).mockResolvedValue({ ok: true, userId: 'user-admin', supabase: db.client } as never)

    const body = await (await POST(request({ party_size: 4, management_override: true, requires_accessible_table: true }))).json()

    const booking = db.queries.find((query) => query.table === 'table_bookings' && called(query, 'insert'))!
    expect(argsOf(booking, 'insert')[0][0]).toMatchObject({
      requires_accessible_table: true,
      duration_minutes: 105,
      start_datetime: '2026-12-05T19:00:00.000Z',
      end_datetime: '2026-12-05T20:45:00.000Z',
    })
    const assignment = db.queries.find((query) => query.table === 'booking_table_assignments' && called(query, 'insert'))!
    expect(argsOf(assignment, 'insert')[0][0]).toEqual([
      expect.objectContaining({ table_id: 'table-a', start_datetime: '2026-12-05T19:00:00.000Z', end_datetime: '2026-12-05T21:00:00.000Z' }),
    ])
    expect(body.data).toMatchObject({ table_name: 'Low 4a' })
  })

  it('falls through to the next choice when the first is taken in a race, never to a rejected table', async () => {
    const db = buildDb({ assignmentConflictOn: 'table-a' })
    vi.mocked(requireFohPermission).mockResolvedValue({ ok: true, userId: 'user-admin', supabase: db.client } as never)

    const body = await (await POST(request({ party_size: 4, management_override: true }))).json()

    const tried = db.queries
      .filter((query) => query.table === 'booking_table_assignments' && called(query, 'insert'))
      .map((query) => (argsOf(query, 'insert')[0][0] as Array<{ table_id: string }>)[0].table_id)
    expect(tried).toEqual(['table-a', 'table-b'])
    expect(body.data).toMatchObject({ table_name: 'Low 4b' })
  })

  it('keeps to the one party limit from the setting (D30)', async () => {
    const db = buildDb({ partyLimit: 20 })
    vi.mocked(requireFohPermission).mockResolvedValue({ ok: true, userId: 'user-admin', supabase: db.client } as never)

    const response = await POST(request({ party_size: 21, management_override: true }))

    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('Table bookings are for up to 20 guests. A bigger group is a private booking.')
    expect(db.queries.some((query) => query.table === 'table_bookings' && called(query, 'insert'))).toBe(false)
  })

  it('follows the setting when a manager lowers it', async () => {
    const db = buildDb({ partyLimit: 12 })
    vi.mocked(requireFohPermission).mockResolvedValue({ ok: true, userId: 'user-admin', supabase: db.client } as never)

    expect((await POST(request({ party_size: 13, management_override: true }))).status).toBe(400)
  })
})
