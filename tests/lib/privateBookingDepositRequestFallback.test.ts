import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as any, flags: {} as Record<string, boolean> }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => state.db),
}))

vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn(async (key: string) => state.flags[key] === true),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: vi.fn(async () => undefined),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/sms/customers', () => ({
  resolveCustomerIdForSms: vi.fn(async () => ({ customerId: 'customer-1' })),
}))

vi.mock('@/services/audit', () => ({
  AuditService: { logAuditEvent: vi.fn(async () => undefined) },
}))

import { sendSMS } from '@/lib/twilio'
import { runDelayedFallbackJob } from '@/lib/notifications/delayed-fallback/run'
import { privateBookingMessageValidUntil, renderPrivateBookingMessage, type CatalogueBooking } from '@/lib/private-bookings/message-catalogue'

const mockedSendSMS = sendSMS as unknown as Mock

const NOW = new Date('2026-09-12T09:00:00.000Z')

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
    event_date: '2026-11-21',
    start_time: '19:00:00',
    end_time: '23:30:00',
    end_time_next_day: false,
    guest_count: 40,
    date_tbd: false,
    internal_notes: null,
    hold_expiry: '2026-09-25T09:00:00.000Z',
    deposit_amount: 300,
    deposit_paid_date: null,
    deposit_waived: false,
    balance_due_date: '2026-11-07',
    final_payment_date: null,
    setup_date: null,
    setup_time: null,
    ...overrides,
  }
}

/** The delivery the Confirm deposit email wrote, as the messenger writes it. */
function delivery(facts: Record<string, unknown> = { event_date: '2026-11-21', hold_expiry_date: '2026-09-25', deposit_amount: 300 }) {
  return {
    id: 'delivery-1',
    customer_id: 'customer-1',
    template_key: 'private_booking_deposit_request',
    category: 'transactional',
    policy: 'email_first',
    selected_channel: 'email',
    final_status: 'sent',
    delayed_fallback_allowed: true,
    delayed_fallback_sent_at: null,
    metadata: { private_booking_id: 'booking-1', trigger_type: 'deposit_request', booking_facts: facts },
  }
}

function seed(booking: Record<string, unknown> = bookingRow()) {
  state.db = createFakeSupabase({
    private_bookings: [booking],
    private_bookings_with_details: [],
    customers: [{ id: 'customer-1', email: 'alex@example.com', email_status: null, email_deactivated_at: null, mobile_number: '+447700900123' }],
    email_suppressions: [],
    notification_deliveries: [delivery()],
    notification_attempts: [],
    private_booking_audit: [],
  })
}

describe('bounce fallback for the deposit request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.flags = { bounce_sms_fallback: true, private_booking_email_first: true }
    mockedSendSMS.mockResolvedValue({ success: true, sid: 'SM-1' })
  })

  it('texts the same request, with a working link to the booking page, straight away', async () => {
    seed()

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => NOW })

    expect(outcome).toMatchObject({ outcome: 'sent' })
    const [to, body] = mockedSendSMS.mock.calls[0]
    expect(to).toBe('+447700900123')
    expect(body).toMatch(
      /^Hi Alex, the deposit for your booking at The Anchor on 21 November 2026 is £300, due by 25 September 2026\. Pay in cash at the bar or by PayPal: https:\/\/example\.com\/booking-portal\/\S+$/
    )
  })

  it('sends nothing once the deposit is paid', async () => {
    seed(bookingRow({ deposit_paid_date: '2026-09-12' }))
    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => NOW })
    expect(outcome).toMatchObject({ outcome: 'skipped', reason: 'no_longer_needed' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
  })

  it('sends nothing when the amount or deadline has changed since the email', async () => {
    seed(bookingRow({ deposit_amount: 350 }))
    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => NOW })
    expect(outcome).toMatchObject({ outcome: 'skipped', reason: 'booking_changed' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
  })

  it('sends nothing after the deadline it names', async () => {
    seed()
    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { now: () => new Date('2026-09-25T10:00:00.000Z') })
    expect(outcome).toMatchObject({ outcome: 'skipped', reason: 'too_late' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
  })

  it('is valid until the hold expiry, and has no deadline without one', () => {
    const context = (overrides: Record<string, unknown>) => ({ booking: bookingRow(overrides) as CatalogueBooking, now: NOW })
    expect(privateBookingMessageValidUntil('deposit_request', context({}))).toBe('2026-09-25T09:00:00.000Z')
    expect(privateBookingMessageValidUntil('deposit_request', context({ hold_expiry: null }))).toBeNull()
  })

  it('cannot be written without a link, so it is never sent without one', () => {
    expect(renderPrivateBookingMessage('deposit_request', { booking: bookingRow() as CatalogueBooking, now: NOW, paymentLink: null })).toBeNull()
  })
})
