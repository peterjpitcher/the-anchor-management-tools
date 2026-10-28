import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * BK-028 (customer bookings review of 24 October 2026; owner decision D7): moving a booking to
 * another night created the replacement unpaid first, which emailed the guest a payment link,
 * lost ticket types and promised any overpayment in a text. The move is now one database
 * transaction; the action calls it, tells the guest once, and hands any overpayment to a manager.
 */

const mocks = vi.hoisted(() => ({
  checkUserPermission: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  createBooking: vi.fn(),
  sendSMS: vi.fn(),
  sendTransferredEmail: vi.fn(),
  alertEventRefundRequest: vi.fn(),
  logAuditEvent: vi.fn(),
  createEventManageToken: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.logAuditEvent }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.checkUserPermission }))
vi.mock('@/services/events', () => ({ EventService: {}, eventSchema: {} }))
vi.mock('@/services/event-bookings', () => ({ EventBookingService: { createBooking: mocks.createBooking, normalizeBookingMode: vi.fn() } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })) }))
vi.mock('@/lib/twilio', () => ({ sendSMS: mocks.sendSMS }))
vi.mock('@/lib/sms/support', () => ({ ensureReplyInstruction: vi.fn((body: string) => body) }))
vi.mock('@/lib/sms/bulk', () => ({ getSmartFirstName: vi.fn(() => 'Sam') }))
vi.mock('@/lib/email/event-ticket-emails', () => ({
  sendEventBookingCancelledEmail: vi.fn(),
  sendEventPaymentConfirmationEmail: vi.fn(),
  sendEventPaymentManualReviewEmail: vi.fn(),
  sendEventTicketTransferredEmail: mocks.sendTransferredEmail,
}))
vi.mock('@/lib/events/manage-booking', () => ({
  createEventManageToken: mocks.createEventManageToken,
  getEventRefundPolicy: vi.fn(),
  processEventRefund: vi.fn(),
  recordManualEventRefund: vi.fn(),
  updateEventBookingSeatsById: vi.fn(),
}))
vi.mock('@/lib/events/refund-requests', () => ({
  alertEventRefundRequest: mocks.alertEventRefundRequest,
  resolveEventRefundRequestRow: vi.fn(),
}))
vi.mock('@/lib/google-calendar-events', () => ({
  deletePubOpsEventCalendarEntryByEventId: vi.fn(),
  syncPubOpsEventCalendarByEventId: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))

const BOOKING_ID = '5e0e5be9-7f27-4c6b-8f36-0d0f2e2b6c01'
const TARGET_ID = '6f1f6cf0-8a38-4d7c-9a47-1e1a3f3c7d12'
const NEW_ID = '7a2a7d01-9b49-4e8d-8b58-2f2b4a4d8e23'
const GUEST_ID = '8b3b8e12-ac5a-4f9e-9c69-3a3c5b5e9f34'

function tableAnswer(table: string) {
  if (table === 'bookings') {
    return { data: { id: BOOKING_ID, event_id: 'event-from', customer_id: 'customer-1', event: { id: 'event-from', name: 'Quiz Night', start_datetime: '2036-11-05T19:00:00Z' } }, error: null }
  }
  if (table === 'events') return { data: { id: TARGET_ID, name: 'Quiz Night', start_datetime: '2036-12-03T19:00:00Z' }, error: null }
  if (table === 'customers') return { data: { id: 'customer-1', first_name: 'Sam', mobile_number: '+447700900001', sms_status: 'active' }, error: null }
  return { data: null, error: null }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'in', 'order', 'limit', 'update', 'insert']) chain[method] = () => chain
      chain.maybeSingle = () => Promise.resolve(tableAnswer(table))
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(tableAnswer(table)).then(resolve)
      return chain
    },
  }),
}))

import { transferEventBooking } from '@/app/actions/events'

describe('transferEventBooking (BK-028)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkUserPermission.mockResolvedValue(true)
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'staff-1', email: 'staff@example.test' } }, error: null })
    mocks.sendSMS.mockResolvedValue({ success: true })
    mocks.sendTransferredEmail.mockResolvedValue({ success: true })
    mocks.createEventManageToken.mockResolvedValue({ url: 'https://management.example.test/g/token/manage-booking' })
  })

  it('moves the booking in one database call, never through the unpaid booking path', async () => {
    mocks.rpc.mockResolvedValue({ data: { state: 'transferred', new_booking_id: NEW_ID, paid_total: 80, target_amount: 80, overpayment: 0, refund_request_id: null, answers_to_follow: 0 }, error: null })

    const result = await transferEventBooking({ bookingId: BOOKING_ID, targetEventId: TARGET_ID, answers: { [GUEST_ID]: { 'q-meal': 'yes' } } })

    expect(mocks.rpc).toHaveBeenCalledWith('transfer_event_booking_v01', {
      p_booking_id: BOOKING_ID, p_target_event_id: TARGET_ID, p_answers: { [GUEST_ID]: { 'q-meal': 'yes' } }, p_performed_by: 'staff-1',
    })
    expect(mocks.createBooking).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: true, data: { state: 'transferred', new_booking_id: NEW_ID, overpayment: 0 } })
    expect(mocks.alertEventRefundRequest).not.toHaveBeenCalled()
    expect(mocks.sendTransferredEmail).toHaveBeenCalledTimes(1)
    expect(String(mocks.sendSMS.mock.calls[0]?.[1])).not.toMatch(/pay|owe/i)
  })

  it('hands an overpayment to a manager and does not promise the guest an amount owed', async () => {
    mocks.rpc.mockResolvedValue({ data: { state: 'transferred', new_booking_id: NEW_ID, paid_total: 80, target_amount: 60, overpayment: 20, refund_request_id: 'request-1' }, error: null })

    const result = await transferEventBooking({ bookingId: BOOKING_ID, targetEventId: TARGET_ID })

    expect(mocks.alertEventRefundRequest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      requestId: 'request-1', bookingId: NEW_ID, kind: 'transfer_overpayment', amount: 20, pricePaid: 80,
    }))
    const sms = String(mocks.sendSMS.mock.calls[0]?.[1])
    expect(sms).toContain('The new night costs £20.00 less than you paid, and we will be in touch about the difference.')
    expect(sms).not.toContain('We owe you')
    expect(result).toMatchObject({ success: true, data: { overpayment: 20, refund_request_id: 'request-1' } })
  })

  it('passes a refusal back without telling the guest anything', async () => {
    mocks.rpc.mockResolvedValue({ data: { state: 'blocked', reason: 'target_event_costs_more' }, error: null })

    const result = await transferEventBooking({ bookingId: BOOKING_ID, targetEventId: TARGET_ID })

    expect(result).toEqual({ success: true, data: { state: 'blocked', reason: 'target_event_costs_more', original_booking_id: BOOKING_ID, new_booking_id: null, sms_sent: false } })
    expect(mocks.sendSMS).not.toHaveBeenCalled()
    expect(mocks.sendTransferredEmail).not.toHaveBeenCalled()
    expect(mocks.logAuditEvent).not.toHaveBeenCalled()
  })

  it('reports a database failure as nothing changed', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'deadlock detected', code: '40P01' } })

    const result = await transferEventBooking({ bookingId: BOOKING_ID, targetEventId: TARGET_ID })

    expect(result).toEqual({ error: 'The booking could not be moved. Nothing has changed; please try again.' })
    expect(mocks.sendTransferredEmail).not.toHaveBeenCalled()
  })

  it('refuses staff without event permission', async () => {
    mocks.checkUserPermission.mockResolvedValue(false)
    const result = await transferEventBooking({ bookingId: BOOKING_ID, targetEventId: TARGET_ID })
    expect(result).toEqual({ error: 'You do not have permission to transfer event bookings.' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
