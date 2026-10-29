import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * BK-023 (customer bookings review of 24 October 2026; owner decisions D7 and D10): staff can take
 * guests off a paid booking, add guests and change a ticket type. Any member of staff who manages
 * events may do it; no refund is made here, only a request a manager decides. These pin what the
 * actions send to the database functions and what they tell staff, the manager and the guest.
 */

const mocks = vi.hoisted(() => ({
  checkUserPermission: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  processEventRefund: vi.fn(),
  sendChangedEmail: vi.fn(),
  alertEventRefundRequest: vi.fn(),
  resolveEventRefundRequestRow: vi.fn(),
  logAuditEvent: vi.fn(),
  getUserRoles: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.logAuditEvent }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.checkUserPermission }))
vi.mock('@/services/events', () => ({ EventService: {}, eventSchema: {} }))
vi.mock('@/services/event-bookings', () => ({ EventBookingService: { createBooking: vi.fn(), normalizeBookingMode: vi.fn() } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })) }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/email/event-ticket-emails', () => ({
  sendEventBookingCancelledEmail: vi.fn(),
  sendEventPaymentConfirmationEmail: vi.fn(),
  sendEventPaymentManualReviewEmail: vi.fn(),
  sendEventTicketTransferredEmail: vi.fn(),
  sendEventBookingTicketsChangedEmail: mocks.sendChangedEmail,
}))
vi.mock('@/lib/events/manage-booking', () => ({
  createEventManageToken: vi.fn(),
  getEventRefundPolicy: vi.fn(),
  processEventRefund: mocks.processEventRefund,
  recordManualEventRefund: vi.fn(),
  updateEventBookingSeatsById: vi.fn(),
}))
vi.mock('@/lib/events/refund-requests', () => ({
  alertEventRefundRequest: mocks.alertEventRefundRequest,
  resolveEventRefundRequestRow: mocks.resolveEventRefundRequestRow,
  describeEventRefundRequestKind: vi.fn(() => 'Guests taken off the booking'),
  loadOpenEventRefundRequests: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/google-calendar-events', () => ({
  deletePubOpsEventCalendarEntryByEventId: vi.fn(),
  syncPubOpsEventCalendarByEventId: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => (fn === 'get_user_roles' ? mocks.getUserRoles(args) : mocks.rpc(fn, args)),
    from: () => {
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'in', 'order', 'limit']) chain[method] = () => chain
      chain.maybeSingle = () => Promise.resolve({ data: { name: 'Child' }, error: null })
      return chain
    },
  }),
}))

import {
  addEventBookingGuests,
  changeEventBookingTicketType,
  decideNoEventRefund,
  removeEventBookingGuests,
} from '@/app/actions/events'

const BOOKING_ID = '5e0e5be9-7f27-4c6b-8f36-0d0f2e2b6c01'
const GUEST_ID = '8b3b8e12-ac5a-4f9e-9c69-3a3c5b5e9f34'
const TYPE_ID = '9c4c9f23-bd6b-4a0f-8d7a-4b4d6c6f0a45'
const CHILD_TYPE = 'ad5da034-ce7c-4b1a-9e8b-5c5e7d7a1b56'
const REQUEST_ID = 'be6eb145-df8d-4c2b-af9c-6d6f8e8b2c67'

describe('event ticket changes (BK-023)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkUserPermission.mockResolvedValue(true)
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'staff-1', email: 'bar@example.test' } }, error: null })
    mocks.sendChangedEmail.mockResolvedValue({ success: true })
    mocks.getUserRoles.mockResolvedValue({ data: [{ role_name: 'staff' }], error: null })
  })

  it('takes a named guest off without refunding, and hands the price paid to a manager', async () => {
    mocks.rpc.mockResolvedValue({ data: { state: 'updated', event_id: 'event-1', event_name: 'Tinsel and Tipples', old_seats: 3, new_seats: 2, removed: 1, price_paid: 40, refund_owed: 40, refund_request_id: REQUEST_ID }, error: null })

    const result = await removeEventBookingGuests({ bookingId: BOOKING_ID, attendeeIds: [GUEST_ID] })

    expect(mocks.rpc).toHaveBeenCalledWith('remove_event_booking_guests_v01', {
      p_booking_id: BOOKING_ID, p_attendee_ids: [GUEST_ID], p_ticket_type_id: null, p_quantity: null, p_performed_by: 'staff-1',
    })
    expect(mocks.processEventRefund).not.toHaveBeenCalled()
    expect(mocks.alertEventRefundRequest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      requestId: REQUEST_ID, bookingId: BOOKING_ID, kind: 'guest_removed', amount: 40, pricePaid: 40,
    }))
    expect(mocks.sendChangedEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      bookingId: BOOKING_ID, change: { kind: 'guests_removed', count: 1, refundToDecide: true },
    }))
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ operation_type: 'remove_event_booking_guests', resource_id: BOOKING_ID }))
    expect(result).toEqual({ success: true, data: { state: 'updated', old_seats: 3, new_seats: 2, refund_owed: 40, refund_request_id: REQUEST_ID, amount_taken: 0 } })
  })

  it('lets any member of staff who manages events make the change, not only a manager (D7)', async () => {
    mocks.rpc.mockResolvedValue({ data: { state: 'updated', removed: 1, refund_owed: 0, refund_request_id: null }, error: null })
    const result = await removeEventBookingGuests({ bookingId: BOOKING_ID, ticketTypeId: TYPE_ID, quantity: 1 })
    expect(result).toMatchObject({ success: true })
    expect(mocks.getUserRoles).not.toHaveBeenCalled()
    expect(mocks.alertEventRefundRequest).not.toHaveBeenCalled()
  })

  it('refuses staff without event permission', async () => {
    mocks.checkUserPermission.mockResolvedValue(false)
    expect(await removeEventBookingGuests({ bookingId: BOOKING_ID, attendeeIds: [GUEST_ID] })).toEqual({ error: 'You do not have permission to change event bookings.' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('turns a refusal into plain words and tells nobody', async () => {
    mocks.rpc.mockResolvedValue({ data: { state: 'blocked', reason: 'would_remove_every_guest' }, error: null })
    expect(await removeEventBookingGuests({ bookingId: BOOKING_ID, attendeeIds: [GUEST_ID] })).toEqual({ error: 'That would take every guest off. Cancel the booking instead.' })
    expect(mocks.sendChangedEmail).not.toHaveBeenCalled()
    expect(mocks.logAuditEvent).not.toHaveBeenCalled()
  })

  it('adds a guest paid in cash at full price, with the phone in E.164', async () => {
    mocks.rpc.mockResolvedValue({ data: { state: 'updated', event_id: 'event-1', old_seats: 3, new_seats: 4, added: 1, amount: 45 }, error: null })

    const result = await addEventBookingGuests({
      bookingId: BOOKING_ID, ticketTypeId: TYPE_ID, quantity: 1, settlement: 'cash', expectedAmount: 45,
      attendees: [{ id: GUEST_ID, name: 'Jo', phone: '07700 900123', ticket_type_id: TYPE_ID, answers: {} }],
    })

    expect(mocks.rpc).toHaveBeenCalledWith('add_event_booking_guests_v01', expect.objectContaining({
      p_booking_id: BOOKING_ID, p_quantity: 1, p_settlement: 'cash', p_expected_amount: 45, p_performed_by: 'staff-1',
      p_attendees: [expect.objectContaining({ id: GUEST_ID, name: 'Jo', phone: '+447700900123' })],
    }))
    expect(mocks.sendChangedEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ change: { kind: 'guests_added', count: 1, amountTaken: 45 } }))
    expect(result).toMatchObject({ success: true, data: { amount_taken: 45, new_seats: 4 } })
  })

  it('says the new amount when the price shown has changed', async () => {
    mocks.rpc.mockResolvedValue({ data: { state: 'blocked', reason: 'amount_changed', amount: 45 }, error: null })
    expect(await addEventBookingGuests({ bookingId: BOOKING_ID, quantity: 1, settlement: 'cash', expectedAmount: 40 }))
      .toEqual({ error: 'The amount to take is now £45.00. Check it and try again.' })
  })

  it('refuses a guest phone that cannot be a phone before calling the database', async () => {
    const result = await addEventBookingGuests({
      bookingId: BOOKING_ID, quantity: 1, settlement: 'comp', note: 'Birthday',
      attendees: [{ id: GUEST_ID, name: 'Jo', phone: 'not a phone', ticket_type_id: null, answers: {} }],
    })
    expect(result).toEqual({ error: 'Please check the guest mobile numbers' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('changes a ticket to a cheaper type and leaves the difference for a manager', async () => {
    mocks.rpc.mockResolvedValue({ data: { state: 'updated', event_id: 'event-1', changed: 1, price_paid: 40, difference: -20, amount: 0, refund_owed: 20, refund_request_id: REQUEST_ID }, error: null })

    const result = await changeEventBookingTicketType({ bookingId: BOOKING_ID, attendeeIds: [GUEST_ID], toTicketTypeId: CHILD_TYPE, settlement: 'none' })

    expect(mocks.alertEventRefundRequest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'ticket_type_changed', amount: 20 }))
    expect(mocks.sendChangedEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      change: { kind: 'ticket_type_changed', count: 1, ticketTypeName: 'Child', amountTaken: 0, refundToDecide: true },
    }))
    expect(mocks.processEventRefund).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: true, data: { refund_owed: 20 } })
  })

  it('only a manager can record that no refund is due, with a reason', async () => {
    expect(await decideNoEventRefund({ bookingId: BOOKING_ID, requestId: REQUEST_ID, note: 'Guest swapped seats with a friend' }))
      .toEqual({ error: 'Only a manager can decide a refund.' })
    expect(mocks.resolveEventRefundRequestRow).not.toHaveBeenCalled()

    mocks.getUserRoles.mockResolvedValue({ data: [{ role_name: 'manager' }], error: null })
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'manager-1', email: 'peter@example.test' } }, error: null })
    mocks.resolveEventRefundRequestRow.mockResolvedValue(true)
    expect(await decideNoEventRefund({ bookingId: BOOKING_ID, requestId: REQUEST_ID, note: 'Guest swapped seats with a friend' })).toEqual({ success: true })
    expect(mocks.resolveEventRefundRequestRow).toHaveBeenCalledWith(expect.anything(), {
      requestId: REQUEST_ID, bookingId: BOOKING_ID, status: 'no_refund', amount: 0, resolvedBy: 'manager-1', note: 'Guest swapped seats with a friend',
    })
  })
})
