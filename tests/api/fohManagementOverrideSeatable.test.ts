import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * BK-050: the FOH walk-in fallback and the super admin override insert the booking themselves and
 * never named a payment status, so the column default of 'pending' made every one read as owing a
 * deposit. A 20-person override then could not be seated or confirmed (hasUnpaidRequiredDeposit).
 * The insert now names payment_status null, and an override of a deposit-sized party records the
 * deposit as waived.
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
import { hasUnpaidRequiredDeposit } from '@/lib/foh/bookings'
import { FOH_BOOKING_CLIENT_CONTRACT, FOH_BOOKING_CLIENT_HEADER } from '@/lib/foh/booking-client-contract'
import { argsOf, called, createRecordingSupabase } from '../mocks/recordingSupabase'
import { walkInOverridePickerRpc } from '../mocks/walkInOverridePicker'

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001'

function buildDb() {
  return createRecordingSupabase({
    tables: {
      user_roles: () => ({ data: [{ roles: { name: 'super_admin' } }], error: null }),
      tables: () => ({ data: [{ id: 'table-1', table_number: '1', name: 'Long table', capacity: 24, is_bookable: true }], error: null }),
      table_join_links: () => ({ data: [], error: null }),
      booking_table_assignments: () => ({ data: [], error: null }),
      table_bookings: (query) =>
        called(query, 'insert')
          ? { data: { id: 'tb-override', booking_reference: 'TB-W1234567' }, error: null }
          : { data: null, error: null },
    },
    rpc: (fn) => walkInOverridePickerRpc(fn, [{ id: 'table-1', name: 'Long table', capacity: 24 }]) ?? { data: null, error: null },
  })
}

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/foh/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [FOH_BOOKING_CLIENT_HEADER]: FOH_BOOKING_CLIENT_CONTRACT },
    body: JSON.stringify({ customer_mode: 'selected', customer_id: CUSTOMER_ID, date: '2026-12-05', time: '19:00', purpose: 'food', ...body }),
  }) as unknown as import('next/server').NextRequest
}

describe('a super admin override of a large party', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is saved with no deposit pending and the waiver recorded, so it can be seated', async () => {
    const db = buildDb()
    vi.mocked(requireFohPermission).mockResolvedValue({ ok: true, userId: 'user-admin', supabase: db.client } as never)

    const response = await POST(request({ party_size: 20, management_override: true }))

    expect(response.status).toBe(200)
    const insert = db.queries.find((query) => query.table === 'table_bookings' && called(query, 'insert'))!
    const row = argsOf(insert, 'insert')[0][0] as Record<string, unknown>
    expect(row).toMatchObject({ status: 'confirmed', payment_status: null, deposit_waived: true, party_size: 20, source: 'management' })
    expect(hasUnpaidRequiredDeposit({ ...row, committed_party_size: 20 } as never)).toBe(false)
  })

  it('records no waiver for a party that would owe nothing', async () => {
    const db = buildDb()
    vi.mocked(requireFohPermission).mockResolvedValue({ ok: true, userId: 'user-admin', supabase: db.client } as never)

    await POST(request({ party_size: 6, management_override: true }))

    const insert = db.queries.find((query) => query.table === 'table_bookings' && called(query, 'insert'))!
    expect(argsOf(insert, 'insert')[0][0]).toMatchObject({ payment_status: null, deposit_waived: false })
  })
})
