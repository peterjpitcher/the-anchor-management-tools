import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * BK-038: bookings made by staff wrote no "created" audit row, while website bookings did, so a
 * disputed booking, waiver or table had nobody behind it, and a deposit waiver was logged with no
 * booking id. Every FOH create path (the staff booking function, the walk-in fallback and the super
 * admin override) must audit the booking it made, and a waiver must name the booking.
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
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/table-bookings/bookings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/table-bookings/bookings')>()),
  sendTableBookingCreatedSmsIfAllowed: vi.fn().mockResolvedValue({ sms: null }),
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { logAuditEvent } from '@/app/actions/audit'
import { POST } from '@/app/api/foh/bookings/route'
import { FOH_BOOKING_CLIENT_CONTRACT, FOH_BOOKING_CLIENT_HEADER } from '@/lib/foh/booking-client-contract'
import { called, createRecordingSupabase } from '../mocks/recordingSupabase'

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001'

function buildDb(options: { role?: string; rpcResult?: unknown }) {
  return createRecordingSupabase({
    tables: {
      user_roles: () => ({ data: [{ roles: { name: options.role ?? 'staff' } }], error: null }),
      customers: () => ({ data: { id: CUSTOMER_ID, mobile_e164: '+447700900123', mobile_number: '+447700900123', email: null }, error: null }),
      tables: () => ({ data: [{ id: 'table-1', table_number: '1', name: 'Window', capacity: 24, is_bookable: true }], error: null }),
      table_join_links: () => ({ data: [], error: null }),
      booking_table_assignments: () => ({ data: [], error: null }),
      table_bookings: (query) =>
        called(query, 'insert')
          ? { data: { id: 'tb-direct', booking_reference: 'TB-W7654321' }, error: null }
          : { data: null, error: null },
    },
    rpc: (fn) =>
      fn === 'create_table_booking_staff_v06'
        ? options.rpcResult ?? { data: { state: 'confirmed', table_booking_id: 'tb-rpc', booking_reference: 'TB-ABCD1234', party_size: 4, table_ids: ['table-1'] }, error: null }
        : { data: 0, error: null },
  })
}

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/foh/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [FOH_BOOKING_CLIENT_HEADER]: FOH_BOOKING_CLIENT_CONTRACT },
    body: JSON.stringify({ customer_mode: 'selected', customer_id: CUSTOMER_ID, date: '2026-12-05', time: '19:00', purpose: 'food', party_size: 4, ...body }),
  }) as unknown as import('next/server').NextRequest
}

function createAudits() {
  return vi.mocked(logAuditEvent).mock.calls.map(([event]) => event).filter((event) => event.operation_type === 'create')
}

describe('every FOH create path audits the booking it made', () => {
  beforeEach(() => vi.clearAllMocks())

  it('a booking made through the staff booking function', async () => {
    vi.mocked(requireFohPermission).mockResolvedValue({ ok: true, userId: 'foh-user', supabase: buildDb({}).client } as never)

    const response = await POST(request({}))

    expect(response.status).toBe(201)
    expect(createAudits()).toEqual([
      expect.objectContaining({
        user_id: 'foh-user',
        resource_type: 'table_booking',
        resource_id: 'tb-rpc',
        operation_status: 'success',
        additional_info: expect.objectContaining({ path: 'staff_booking', source: 'admin', channel: 'staff', table_ids: ['table-1'], management_override: false }),
      }),
    ])
  })

  it('a walk-in that falls back to the direct insert', async () => {
    const db = buildDb({ rpcResult: { data: { state: 'blocked', reason: 'outside_hours' }, error: null } })
    vi.mocked(requireFohPermission).mockResolvedValue({ ok: true, userId: 'foh-user', supabase: db.client } as never)

    const response = await POST(request({ walk_in: true }))

    expect(response.status).toBe(201)
    expect(createAudits()).toEqual([
      expect.objectContaining({
        resource_id: 'tb-direct',
        additional_info: expect.objectContaining({ path: 'walk_in_fallback', source: 'walk-in', channel: 'walkin' }),
      }),
    ])
  })

  it('a super admin override', async () => {
    vi.mocked(requireFohPermission).mockResolvedValue({ ok: true, userId: 'admin-user', supabase: buildDb({ role: 'super_admin' }).client } as never)

    const response = await POST(request({ management_override: true }))

    expect(response.status).toBe(200)
    expect(createAudits()).toEqual([
      expect.objectContaining({
        user_id: 'admin-user',
        resource_id: 'tb-direct',
        additional_info: expect.objectContaining({ path: 'management_override', management_override: true }),
      }),
    ])
  })

  it('a booking that was refused writes no create row', async () => {
    const db = buildDb({ rpcResult: { data: { state: 'blocked', reason: 'no_table' }, error: null } })
    vi.mocked(requireFohPermission).mockResolvedValue({ ok: true, userId: 'foh-user', supabase: db.client } as never)

    await POST(request({}))

    expect(createAudits()).toEqual([])
  })

  it('a manager waiver is audited against the booking it waived', async () => {
    vi.mocked(requireFohPermission).mockResolvedValue({ ok: true, userId: 'manager-user', supabase: buildDb({ role: 'manager' }).client } as never)

    const response = await POST(request({ party_size: 16, waive_deposit: true }))

    expect(response.status).toBe(201)
    const waivers = vi.mocked(logAuditEvent).mock.calls.map(([event]) => event).filter((event) => /waive/.test(event.operation_type + event.resource_type))
    expect(waivers).toEqual([
      expect.objectContaining({ operation_type: 'table_booking.deposit_waived', resource_type: 'table_booking', resource_id: 'tb-rpc' }),
    ])
  })
})
