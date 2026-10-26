import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fakeSupabase'

/**
 * BK-217: a comp needs a reason, and Cash Paid or Card Paid records only the amount staff saw and
 * confirmed. Before this, one click recorded money with no amount shown and a comp with no reason.
 */

const state = vi.hoisted(() => ({ db: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => true) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'manager-1', email: 'boss@example.test' } }, error: null }) } }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.db }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(async () => undefined) }))
vi.mock('@/services/events', () => ({ EventService: {}, eventSchema: { safeParse: vi.fn(), partial: vi.fn() } }))
vi.mock('@/lib/sms/customers', () => ({ ensureCustomerForPhone: vi.fn() }))
vi.mock('@/lib/events/manage-booking', () => ({
  createEventManageToken: vi.fn(),
  getEventRefundPolicy: vi.fn(),
  processEventRefund: vi.fn(),
  updateEventBookingSeatsById: vi.fn(),
}))
vi.mock('@/lib/events/event-payments', () => ({
  sendEventBookingSeatUpdateSms: vi.fn(),
  sendEventPaymentConfirmationSms: vi.fn(async () => ({ success: true, code: null, logFailure: false })),
  sendEventPaymentManualReviewSms: vi.fn(async () => ({ success: true, code: null, logFailure: false })),
}))
vi.mock('@/lib/email/event-ticket-emails', () => ({
  sendEventBookingCancelledEmail: vi.fn(),
  sendEventPaymentConfirmationEmail: vi.fn(async () => ({ success: true })),
  sendEventPaymentManualReviewEmail: vi.fn(async () => ({ success: true })),
  sendEventTicketTransferredEmail: vi.fn(),
}))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/lib/google-calendar-events', () => ({
  syncPubOpsEventCalendarByEventId: vi.fn(async () => ({ state: 'updated' })),
  deletePubOpsEventCalendarEntryByEventId: vi.fn(),
}))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/sms/support', () => ({ ensureReplyInstruction: vi.fn() }))
vi.mock('@/lib/sms/bulk', () => ({ getSmartFirstName: vi.fn() }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { getEventBookingDoorCharge, markEventBookingPaidManually } from '@/app/actions/events'

const BOOKING = '2e0e5be9-7f27-4c6b-8f36-0d0f2e2b6c02'

function seed(): FakeSupabase & { rpc: ReturnType<typeof vi.fn> } {
  const db = createFakeSupabase({
    events: [{ id: 'event-1', name: 'Tinsel and Tipples', payment_mode: 'prepaid', price: 45, price_per_seat: null, is_free: false }],
    bookings: [{ id: BOOKING, event_id: 'event-1', customer_id: 'customer-1', seats: 2, status: 'pending_payment' }],
    booking_items: [],
  }) as FakeSupabase & { rpc: ReturnType<typeof vi.fn> }
  db.rpc = vi.fn(async () => ({ data: { state: 'confirmed', booking_id: BOOKING, payment_id: 'payment-1', seats: 2 }, error: null }))
  state.db = db
  return db
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('door payments and comps (BK-217)', () => {
  it('shows the amount Cash Paid would record: the full door price for the seats', async () => {
    seed()
    expect(await getEventBookingDoorCharge(BOOKING)).toEqual({ success: true, data: { amount: 90, seats: 2 } })
  })

  it('refuses a comp with no reason', async () => {
    const db = seed()
    const result = await markEventBookingPaidManually({ bookingId: BOOKING, method: 'comp' })
    expect(result).toEqual({ error: 'Say why this booking is free.' })
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('records a comp with its reason', async () => {
    const db = seed()
    const result = await markEventBookingPaidManually({ bookingId: BOOKING, method: 'comp', note: 'Performer guest' })
    expect(result).toMatchObject({ success: true, data: { state: 'confirmed' } })
    expect(db.rpc).toHaveBeenCalledWith('confirm_event_manual_payment_v01', expect.objectContaining({
      p_payment_method: 'comp', p_amount: 0, p_note: 'Performer guest',
    }))
  })

  it('refuses cash or card that nobody confirmed', async () => {
    const db = seed()
    const result = await markEventBookingPaidManually({ bookingId: BOOKING, method: 'cash' })
    expect(result).toEqual({ error: 'Confirm the amount taken before recording the payment.' })
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('refuses when the amount confirmed on screen is no longer the amount to record', async () => {
    const db = seed()
    const result = await markEventBookingPaidManually({ bookingId: BOOKING, method: 'card_terminal', confirmedAmount: 80 })
    expect(result).toEqual({ error: 'The amount to record is now £90.00. Check it and try again.' })
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('records the confirmed amount', async () => {
    const db = seed()
    const result = await markEventBookingPaidManually({ bookingId: BOOKING, method: 'cash', confirmedAmount: 90 })
    expect(result).toMatchObject({ success: true, data: { state: 'confirmed' } })
    expect(db.rpc).toHaveBeenCalledWith('confirm_event_manual_payment_v01', expect.objectContaining({
      p_payment_method: 'cash', p_amount: 90,
    }))
  })
})
