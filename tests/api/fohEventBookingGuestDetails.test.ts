import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * FOH event bookings (BK-141 and BK-011, customer bookings review of 24 October 2026): the bar can
 * pick a ticket type, take each ticket's guest details (any of which may follow), and every
 * booking made there writes an audit row naming the staff member.
 */
vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(),
  getLondonDateIso: vi.fn(() => '2026-01-01'),
}))
vi.mock('@/lib/business-hours/trading-day', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/business-hours/trading-day')>()),
  resolveTradingDayNow: vi.fn(async () => ({ date: '2026-01-01', until: new Date('2026-01-02T00:00:00Z') })),
}))
vi.mock('@/lib/events/sunday-lunch-only-policy', () => ({
  isSundayLunchOnlyEvent: vi.fn().mockReturnValue(false),
  SUNDAY_LUNCH_ONLY_EVENT_MESSAGE: 'Sunday lunch only',
}))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/lib/consent/staff-capture', () => ({ recordStaffReadOutConsent: vi.fn() }))
vi.mock('@/lib/sms/customers', () => ({ ensureCustomerForPhone: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
const { createBooking } = vi.hoisted(() => ({ createBooking: vi.fn() }))
vi.mock('@/services/event-bookings', () => ({
  EventBookingService: { createBooking, normalizeBookingMode: () => 'general' },
}))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { logAuditEvent } from '@/app/actions/audit'
import { POST } from '@/app/api/foh/event-bookings/route'
import { FOH_BOOKING_CLIENT_CONTRACT, FOH_BOOKING_CLIENT_HEADER } from '@/lib/foh/booking-client-contract'

const EVENT_ID = '11111111-1111-4111-8111-111111111111'
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222'
const QUESTION_ID = '33333333-3333-4333-8333-333333333333'
const GUEST_ID = '44444444-4444-4444-8444-444444444444'

function supabaseFor(eventRow: Record<string, unknown>) {
  const chain = (data: unknown) => {
    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.eq = () => builder
    builder.maybeSingle = async () => ({ data, error: null })
    return builder
  }
  return { from: vi.fn((table: string) => {
    if (table === 'events') return chain(eventRow)
    throw new Error(`Unexpected table: ${table}`)
  }) }
}

const request = (body: Record<string, unknown>) => new NextRequest('http://localhost/api/foh/event-bookings', {
  method: 'POST',
  headers: { 'content-type': 'application/json', [FOH_BOOKING_CLIENT_HEADER]: FOH_BOOKING_CLIENT_CONTRACT },
  body: JSON.stringify({ customer_mode: 'phone', phone: '07700900123', first_name: 'Pat', event_id: EVENT_ID, seats: 2, ...body }),
})

const confirmed = {
  resolvedState: 'confirmed', resolvedReason: null, bookingId: 'booking-1', seatsRemaining: 8, nextStepUrl: null,
  manageUrl: 'https://example.test/manage', smsMeta: null, tableBookingId: null, tableName: null, eventSeatingType: null,
  rpcResult: { state: 'confirmed', booking_id: 'booking-1', event_name: 'Tasting' }, notificationChannel: 'email',
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(ensureCustomerForPhone as unknown as Mock).mockResolvedValue({ customerId: CUSTOMER_ID, bookingContactEmail: null })
  createBooking.mockResolvedValue(confirmed)
})

describe('FOH event bookings carry guest details and an audit row', () => {
  it('passes each ticket\'s guest details, with a name and answer to follow, and says details are to follow', async () => {
    ;(requireFohPermission as unknown as Mock).mockResolvedValue({ ok: true, userId: 'staff-1', supabase: supabaseFor({
      id: EVENT_ID, booking_mode: 'general', name: 'Tasting', date: '2026-01-01', start_datetime: '2026-01-01T19:00:00Z',
      payment_mode: 'prepaid', collect_guest_details: null,
      booking_questions: [{ id: QUESTION_ID, label: 'Any allergies?', type: 'text', required: true }],
    }) })
    const response = await POST(request({ attendees: [
      { id: GUEST_ID, name: 'Sam', phone: '07700 900456', answers: { [QUESTION_ID]: 'Peanuts' } },
      { id: '55555555-5555-4555-8555-555555555555', name: '', answers: {} },
    ] }) as never)
    const payload = await response.json()
    expect(response.status).toBe(201)
    expect(createBooking).toHaveBeenCalledWith(expect.objectContaining({
      attendees: [
        { id: GUEST_ID, name: 'Sam', phone: '+447700900456', answers: { [QUESTION_ID]: 'Peanuts' } },
        { id: '55555555-5555-4555-8555-555555555555', name: '', answers: {} },
      ],
    }))
    expect(payload.data.details_to_follow).toBe(true)
  })

  it('writes one create audit row naming the staff member, with counts and no guest details', async () => {
    ;(requireFohPermission as unknown as Mock).mockResolvedValue({ ok: true, userId: 'staff-1', supabase: supabaseFor({
      id: EVENT_ID, booking_mode: 'general', name: 'Quiz', date: '2026-01-01', start_datetime: '2026-01-01T19:00:00Z',
      payment_mode: 'cash_only', booking_questions: [],
    }) })
    await POST(request({ attendees: [{ id: GUEST_ID, name: 'Sam', phone: '07700900456', answers: {} }, { id: '55555555-5555-4555-8555-555555555555', name: 'Jo', answers: {} }] }) as never)
    expect(logAuditEvent).toHaveBeenCalledTimes(1)
    const row = (logAuditEvent as unknown as Mock).mock.calls[0][0]
    expect(row).toMatchObject({ user_id: 'staff-1', operation_type: 'create', resource_type: 'event_booking', resource_id: 'booking-1',
      additional_info: expect.objectContaining({ seats: 2, source: 'admin', channel: 'foh', guest_details_given: 2, guest_details_to_follow: false }) })
    expect(JSON.stringify(row)).not.toContain('Sam')
    expect(JSON.stringify(row)).not.toContain('900456')
  })

  it('writes no audit row when the event is full', async () => {
    ;(requireFohPermission as unknown as Mock).mockResolvedValue({ ok: true, userId: 'staff-1', supabase: supabaseFor({
      id: EVENT_ID, booking_mode: 'general', name: 'Quiz', date: '2026-01-01', start_datetime: '2026-01-01T19:00:00Z', payment_mode: 'cash_only',
    }) })
    createBooking.mockResolvedValue({ ...confirmed, resolvedState: 'full_with_waitlist_option', bookingId: null, rpcResult: { state: 'full_with_waitlist_option' } })
    const response = await POST(request({}) as never)
    const payload = await response.json()
    expect(payload.data.state).toBe('full_with_waitlist_option')
    expect(payload.data.details_to_follow).toBe(false)
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it('refuses a guest mobile that cannot be a number before booking', async () => {
    ;(requireFohPermission as unknown as Mock).mockResolvedValue({ ok: true, userId: 'staff-1', supabase: supabaseFor({
      id: EVENT_ID, booking_mode: 'general', name: 'Quiz', date: '2026-01-01', start_datetime: '2026-01-01T19:00:00Z', payment_mode: 'cash_only',
    }) })
    const response = await POST(request({ seats: 1, attendees: [{ id: GUEST_ID, name: 'Sam', phone: '12', answers: {} }] }) as never)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('Please check the guest mobile numbers')
    expect(createBooking).not.toHaveBeenCalled()
  })
})
