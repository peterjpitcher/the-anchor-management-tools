import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

/**
 * The deposit receipt when the SOP gate has held the booking back (review PB-2).
 *
 * `finalizeDepositPayment` always records the money, because it has already been taken, but keeps
 * the booking a draft when a space conflict, the capacity check or an outstanding risk review or
 * GM approval blocks confirmation. The email went out regardless, saying "your booking at The
 * Anchor is confirmed" and "your date is yours". `deriveRiskStatus` marks every booking under 30
 * guests as needing GM approval, so any small party paying before the GM got to it was told its
 * date was secured; it happened to both blocked bookings in the 90 days to 11 September 2026.
 */

const state = vi.hoisted(() => ({ db: null as any }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => state.db) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => state.db) }))

vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn(async (key: string) => key === 'private_booking_email_first'),
}))

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn(async () => undefined) }))

vi.mock('@/lib/google-calendar', () => ({
  syncCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  isCalendarConfigured: vi.fn(() => false),
}))

vi.mock('@/services/private-bookings/conflicts', () => ({
  getBookingConflictSummary: vi.fn(async () => []),
  getBookingSpaceIds: vi.fn(async () => []),
  findBookingConflicts: vi.fn(async () => []),
  checkCapacity: vi.fn(() => ({ ok: true })),
}))

vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))

vi.mock('@/services/sms-queue', async () => {
  const actual = await vi.importActual<typeof import('@/services/sms-queue')>('@/services/sms-queue')
  return {
    shouldAutoSendPrivateBookingSms: actual.shouldAutoSendPrivateBookingSms,
    SmsQueueService: { queueAndSend: vi.fn() },
  }
})

import { sendEmail } from '@/lib/email/emailService'
import { SmsQueueService } from '@/services/sms-queue'
import { finalizeDepositPayment } from '@/services/private-bookings/payments'

const mockedSendEmail = sendEmail as unknown as Mock
const mockedQueueAndSend = SmsQueueService.queueAndSend as unknown as Mock

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    status: 'draft',
    customer_id: 'customer-1',
    customer_first_name: 'Alex',
    customer_last_name: 'Smith',
    customer_name: 'Alex Smith',
    contact_phone: '+447700900123',
    contact_email: 'host@example.com',
    event_type: 'Birthday party',
    event_date: '2026-10-03',
    start_time: '19:00:00',
    end_time: '23:30:00',
    end_time_next_day: false,
    guest_count: 20,
    date_tbd: false,
    internal_notes: null,
    hold_expiry: '2026-09-25T22:59:59.000Z',
    deposit_amount: 250,
    deposit_paid_date: null,
    deposit_waived: false,
    balance_due_date: '2026-09-19',
    total_amount: 1200,
    calendar_event_id: null,
    contract_sent_at: null,
    layout: null,
    risk_status: 'normal',
    ...overrides,
  }
}

function seed(booking: Record<string, unknown>, viewRow: Record<string, unknown> = { id: 'booking-1', gross_total: 1440, calculated_total: 1200 }) {
  state.db = createFakeSupabase({
    private_bookings: [booking],
    private_bookings_with_details: [viewRow],
    customers: [{ id: 'customer-1', email: 'alex@example.com', email_status: null, email_deactivated_at: null }],
    email_suppressions: [],
    private_booking_sms_queue: [],
    notification_deliveries: [],
    notification_attempts: [],
    private_booking_audit: [],
  })
}

describe('deposit received when the confirmation is blocked', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'resend-1', emailMessageId: 'email-row-1' })
    mockedQueueAndSend.mockResolvedValue({ success: true, sent: true, queueId: 'queue-1' })
  })

  it('does not tell the guest the booking is confirmed when the GM has not approved it', async () => {
    seed(bookingRow({ risk_status: 'gm_approval_required' }))

    await finalizeDepositPayment({ bookingId: 'booking-1', amount: 250, method: 'card', performedByUserId: 'user-1' }, state.db)

    // The money is recorded and the booking is still a draft: that is the gate working.
    expect(state.db.tables.private_bookings[0].deposit_paid_date).toBeTruthy()
    expect(state.db.tables.private_bookings[0].status).toBe('draft')
    expect(state.db.tables.private_booking_audit.some((row: any) => row.action === 'confirmation_blocked')).toBe(true)

    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    const email = mockedSendEmail.mock.calls[0][0]
    expect(email.commType).toBe('private_booking_deposit_received')
    // What is true: the deposit is in.
    expect(email.subject).toBe('Deposit received: we will confirm your booking shortly')
    expect(email.text).toContain('We have received your deposit.')
    expect(email.text).toContain('Deposit paid: £250')
    expect(email.text).toContain("we'll confirm it shortly")
    // What is not true yet.
    expect(email.subject).not.toMatch(/is confirmed/)
    expect(email.html).not.toMatch(/is confirmed/)
    expect(email.text).not.toMatch(/is confirmed/)
    expect(email.text).not.toMatch(/is yours/)
  })

  it('says confirmed when nothing is blocking it', async () => {
    seed(bookingRow({ risk_status: 'normal', guest_count: 40 }))

    await finalizeDepositPayment({ bookingId: 'booking-1', amount: 250, method: 'card', performedByUserId: 'user-1' }, state.db)

    expect(state.db.tables.private_bookings[0].status).toBe('confirmed')
    const email = mockedSendEmail.mock.calls[0][0]
    expect(email.subject).toBe('Deposit received: your booking at The Anchor is confirmed')
    expect(email.text).toContain('Saturday, 3 October 2026 is yours')
  })

  it('leaves the total out of the receipt when nothing has been priced yet', async () => {
    seed(bookingRow({ risk_status: 'normal', guest_count: 40, total_amount: 0 }), {
      id: 'booking-1',
      gross_total: 0,
      calculated_total: 0,
    })

    await finalizeDepositPayment({ bookingId: 'booking-1', amount: 250, method: 'card', performedByUserId: 'user-1' }, state.db)

    const email = mockedSendEmail.mock.calls[0][0]
    // "Total event cost £0.00, Event balance due £0.00" is not a price (review PB-7).
    expect(email.text).not.toContain('Total event cost')
    expect(email.html).not.toContain('£0.00')
    expect(email.text).toContain('Deposit paid: £250')
  })
})
