import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
 * BK-021 and BK-022, customer bookings review of 24 October 2026; owner decision D7.
 *
 * A guest could cut paid seats from their link and PayPal refunded them straight away at the
 * event's list price, with no audit row and no manager. Now a paid booking's link asks a manager,
 * nothing is refunded by the link, and a booking with named guests is never offered a change
 * that the database refuses.
 */

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  update: vi.fn(),
  request: vi.fn(),
  audit: vi.fn(),
  sms: vi.fn(),
  refund: vi.fn(),
  items: [] as unknown[],
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const builder = {
        select: () => builder, eq: () => builder, order: () => builder, limit: () => builder,
        maybeSingle: async () => ({ data: { id: 'default-type' }, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: mocks.items, error: null }),
      }
      return builder
    },
    rpc: vi.fn(),
  }),
}))
vi.mock('@/lib/guest/token-throttle', () => ({ checkGuestTokenThrottle: vi.fn(async () => ({ allowed: true })) }))
vi.mock('@/lib/events/manage-booking', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/manage-booking')>()
  return {
    ...actual,
    getEventManagePreviewByRawToken: mocks.preview,
    updateEventBookingSeatsByRawToken: mocks.update,
    processEventRefund: mocks.refund,
  }
})
vi.mock('@/lib/events/guest-change-request', () => ({ raiseGuestChangeRequest: mocks.request }))
vi.mock('@/lib/paypal', () => ({ refundPayPalPayment: mocks.refund }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.audit }))
vi.mock('@/lib/events/event-payments', () => ({ sendEventBookingSeatUpdateSms: mocks.sms }))
vi.mock('@/lib/google-calendar-events', () => ({ syncPubOpsEventCalendarByBookingId: vi.fn(), syncPubOpsEventCalendarByEventId: vi.fn() }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example' }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { POST } from '@/app/g/[token]/manage-booking/action/route'

const base = {
  state: 'ready', booking_id: 'booking-1', customer_id: 'customer-1', event_id: 'event-1', event_name: 'Tinsel & Tipples',
  event_start_datetime: '2099-11-20T19:00:00Z', status: 'confirmed', seats: 4, payment_mode: 'prepaid', price_per_seat: 45,
  can_change_seats: true, has_named_guests: false, seat_change_blocked_reason: null,
}

function post(fields: Record<string, string>) {
  return POST(new NextRequest('http://localhost/g/raw-token/manage-booking/action', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  }), { params: Promise.resolve({ token: 'raw-token' }) })
}

function stateOf(response: Response): Record<string, string> {
  return Object.fromEntries(new URL(response.headers.get('location') ?? '').searchParams)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.items = []
  mocks.preview.mockResolvedValue(base)
  mocks.update.mockResolvedValue({ state: 'updated', booking_id: 'booking-1', event_id: 'event-1', old_seats: 4, new_seats: 2, delta: -2, payment_mode: 'cash_only' })
  mocks.request.mockResolvedValue({ sent: true, duplicate: false, facts: { paid: 160 } })
})

describe('guest manage link on a booking paid online', () => {
  it('never cuts seats or refunds from the link: a reduction is sent to the request form', async () => {
    const response = await post({ intent: 'update_seats', seats: '2' })
    expect(stateOf(response)).toEqual({ state: 'blocked', reason: 'change_by_request' })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.refund).not.toHaveBeenCalled()
  })

  it('passes a change request to a manager, records it, and tells the guest nothing has changed yet', async () => {
    const response = await post({ intent: 'request_change', seats: '2' })
    expect(stateOf(response)).toEqual({ state: 'change_requested', seats: '2' })
    expect(mocks.request).toHaveBeenCalledWith(expect.anything(), {
      bookingId: 'booking-1', eventId: 'event-1', eventName: 'Tinsel & Tipples', eventStart: '2099-11-20T19:00:00Z',
      currentSeats: 4, requestedSeats: 2,
    })
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      resource_type: 'event_booking', resource_id: 'booking-1',
      additional_info: expect.objectContaining({ action: 'guest_change_request', old_seats: 4, requested_seats: 2, manager_alerted: true }),
    }))
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.refund).not.toHaveBeenCalled()
  })

  it('tells the guest to call when the request reached nobody', async () => {
    mocks.request.mockResolvedValue({ sent: false, duplicate: false, facts: { paid: 160 } })
    const response = await post({ intent: 'request_change', seats: '2' })
    expect(stateOf(response)).toEqual({ state: 'blocked', reason: 'request_not_sent' })
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('treats asking again for the same change as passed on', async () => {
    mocks.request.mockResolvedValue({ sent: false, duplicate: true, facts: { paid: 160 } })
    const response = await post({ intent: 'request_change', seats: '2' })
    expect(stateOf(response)).toEqual({ state: 'change_requested', seats: '2' })
  })

  it('refuses a request for the same number of places', async () => {
    const response = await post({ intent: 'request_change', seats: '4' })
    expect(stateOf(response)).toEqual({ state: 'blocked', reason: 'invalid_seats' })
    expect(mocks.request).not.toHaveBeenCalled()
  })
})

describe('guest manage link on other bookings', () => {
  it('never offers a change on named tickets, so the database is not asked', async () => {
    mocks.preview.mockResolvedValue({ ...base, payment_mode: 'cash_only', can_change_seats: false, has_named_guests: true, seat_change_blocked_reason: 'guest_details_locked' })
    const response = await post({ intent: 'update_seats', seats: '2' })
    expect(stateOf(response)).toEqual({ state: 'blocked', reason: 'guest_details_locked' })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('refuses a multi-type booking, as staff are refused', async () => {
    mocks.preview.mockResolvedValue({ ...base, payment_mode: 'cash_only' })
    mocks.items = [
      { id: 'a', booking_id: 'booking-1', ticket_type_id: 'adult', quantity: 2, unit_price: 10, attendee_names: [] },
      { id: 'c', booking_id: 'booking-1', ticket_type_id: 'child', quantity: 2, unit_price: 5, attendee_names: [] },
    ]
    const response = await post({ intent: 'update_seats', seats: '2' })
    expect(stateOf(response)).toEqual({ state: 'blocked', reason: 'multi_ticket_type_booking' })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('changes a pay-on-the-night booking, records it, and moves no money', async () => {
    mocks.preview.mockResolvedValue({ ...base, payment_mode: 'cash_only' })
    const response = await post({ intent: 'update_seats', seats: '2' })
    expect(stateOf(response)).toEqual({ state: 'updated', delta: '-2' })
    expect(mocks.update).toHaveBeenCalledWith(expect.anything(), { rawToken: 'raw-token', newSeats: 2, actor: 'guest' })
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      additional_info: expect.objectContaining({ action: 'guest_seat_change', old_seats: 4, new_seats: 2 }),
    }))
    expect(mocks.refund).not.toHaveBeenCalled()
  })

  it('shows the database refusal for named guests rather than an internal error', async () => {
    mocks.preview.mockResolvedValue({ ...base, payment_mode: 'cash_only' })
    mocks.update.mockResolvedValue({ state: 'blocked', reason: 'guest_details_locked' })
    const response = await post({ intent: 'update_seats', seats: '2' })
    expect(stateOf(response)).toEqual({ state: 'blocked', reason: 'guest_details_locked' })
  })
})
