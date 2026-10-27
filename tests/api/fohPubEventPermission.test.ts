import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * BK-106 (owner decision D18): the FOH "Pub Event" tick took the deposit off any booking, Christmas
 * included, for anyone who could edit table bookings, with no audit row, while the separate waiver
 * was manager-only by role name (so the Deputy role, which holds table_bookings manage, was
 * refused). Now both need table_bookings manage, a pub event never removes a Christmas deposit,
 * and the booking records who took the deposit off and why.
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
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/table-bookings/bookings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/table-bookings/bookings')>()),
  sendTableBookingCreatedSmsIfAllowed: vi.fn().mockResolvedValue({ sms: null }),
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { logAuditEvent } from '@/app/actions/audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { logger } from '@/lib/logger'
import { POST } from '@/app/api/foh/bookings/route'
import { FOH_BOOKING_CLIENT_CONTRACT, FOH_BOOKING_CLIENT_HEADER } from '@/lib/foh/booking-client-contract'
import { called, createRecordingSupabase } from '../mocks/recordingSupabase'

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001'

function buildDb(options: { stampError?: unknown } = {}) {
  return createRecordingSupabase({
    tables: {
      user_roles: () => ({ data: [{ roles: { name: 'staff' } }], error: null }),
      customers: () => ({ data: { id: CUSTOMER_ID, mobile_e164: '+447700900123', mobile_number: '+447700900123', email: null }, error: null }),
      table_bookings: (query) =>
        called(query, 'update') ? { data: null, error: options.stampError ?? null } : { data: null, error: null },
    },
    rpc: (fn) =>
      fn === 'create_table_booking_staff_v06'
        ? { data: { state: 'confirmed', table_booking_id: 'tb-event', booking_reference: 'TB-EVENT01', party_size: 20 }, error: null }
        : { data: null, error: null },
  })
}

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/foh/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [FOH_BOOKING_CLIENT_HEADER]: FOH_BOOKING_CLIENT_CONTRACT },
    body: JSON.stringify({ customer_mode: 'selected', customer_id: CUSTOMER_ID, date: '2026-12-05', time: '19:00', purpose: 'food', party_size: 20, ...body }),
  }) as unknown as import('next/server').NextRequest
}

function signIn(db: ReturnType<typeof buildDb>, canManage: boolean) {
  vi.mocked(requireFohPermission).mockResolvedValue({ ok: true, userId: 'foh-user', supabase: db.client } as never)
  vi.mocked(checkUserPermission).mockResolvedValue(canManage)
}

function waiverAudits() {
  return vi.mocked(logAuditEvent).mock.calls.map(([event]) => event).filter((event) => event.operation_type === 'table_booking.deposit_waived')
}

describe('the Pub Event tick', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is refused for an account without table_bookings manage, before any booking is made', async () => {
    const db = buildDb()
    signIn(db, false)

    const response = await POST(request({ is_venue_event: true }))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'Insufficient permissions to mark a booking as a pub event' })
    expect(checkUserPermission).toHaveBeenCalledWith('table_bookings', 'manage', 'foh-user')
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('takes the deposit off for a manager, and records it as a pub event against the booking', async () => {
    const db = buildDb()
    signIn(db, true)

    const response = await POST(request({ is_venue_event: true }))

    expect(response.status).toBe(201)
    expect(db.rpc).toHaveBeenCalledWith('create_table_booking_staff_v06', expect.objectContaining({ p_deposit_waived: true }))
    expect(waiverAudits()).toEqual([
      expect.objectContaining({
        user_id: 'foh-user',
        resource_type: 'table_booking',
        resource_id: 'tb-event',
        additional_info: expect.objectContaining({ reason: 'pub_event', description: 'No deposit: pub event' }),
      }),
    ])
  })

  it('never removes a Christmas deposit, whoever asks', async () => {
    const db = buildDb()
    signIn(db, true)

    const response = await POST(request({ is_venue_event: true, purpose: 'christmas', party_size: 6, christmas_course_counts: [1, 1, 1, 1, 1, 1] }))

    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/Christmas booking always takes its deposit/)
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('says loudly when the pub event mark did not save', async () => {
    const db = buildDb({ stampError: { message: 'connection reset' } })
    signIn(db, true)

    await POST(request({ is_venue_event: true }))

    expect(logger.error).toHaveBeenCalledWith('Failed to stamp is_venue_event on table booking', expect.anything())
  })
})

describe('the deposit waiver', () => {
  beforeEach(() => vi.clearAllMocks())

  it('follows the permission, not a role name: an account holding table_bookings manage may waive', async () => {
    const db = buildDb()
    // The role rows say "staff"; the permission is what counts, as for the live Deputy role.
    signIn(db, true)

    const response = await POST(request({ waive_deposit: true }))

    expect(response.status).toBe(201)
    expect(waiverAudits()).toEqual([
      expect.objectContaining({ resource_id: 'tb-event', additional_info: expect.objectContaining({ reason: 'manager_waiver' }) }),
    ])
  })

  it('is refused without table_bookings manage', async () => {
    const db = buildDb()
    signIn(db, false)

    const response = await POST(request({ waive_deposit: true }))

    expect(response.status).toBe(403)
    expect(db.rpc).not.toHaveBeenCalled()
  })
})
