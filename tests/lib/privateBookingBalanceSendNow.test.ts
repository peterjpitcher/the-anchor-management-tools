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

import { sendEmail } from '@/lib/email/emailService'
import { tryEmailForApprovedPrivateBookingText } from '@/lib/private-bookings/approved-message'
import { balanceReminder21DayMessage } from '@/lib/private-bookings/messages'

const mockedSendEmail = sendEmail as unknown as Mock

const NOW = new Date('2026-09-20T09:00:00.000Z')

const QUEUED = balanceReminder21DayMessage({
  customerFirstName: 'Alex',
  eventDate: '10 October 2026',
  balanceAmount: 900,
  balanceDueDate: '26 September 2026',
})

function seed(options: { payments?: Record<string, unknown>[]; balanceRemaining?: number } = {}) {
  state.db = createFakeSupabase({
    private_bookings: [
      {
        id: 'booking-1',
        status: 'confirmed',
        customer_id: 'customer-1',
        customer_first_name: 'Alex',
        customer_last_name: 'Smith',
        customer_name: 'Alex Smith',
        contact_phone: '+447700900123',
        contact_email: 'host@example.com',
        event_type: 'Birthday party',
        event_date: '2026-10-10',
        start_time: '19:00:00',
        end_time: '23:30:00',
        end_time_next_day: false,
        guest_count: 40,
        date_tbd: false,
        internal_notes: null,
        hold_expiry: null,
        deposit_amount: 250,
        deposit_paid_date: '2026-08-12T10:00:00.000Z',
        deposit_payment_method: 'card',
        deposit_waived: false,
        invoice_id: null,
        invoice_deposit_treatment: null,
        balance_due_date: '2026-09-26',
        final_payment_date: null,
        setup_date: null,
        setup_time: null,
      },
    ],
    private_bookings_with_details: [
      { id: 'booking-1', balance_remaining: options.balanceRemaining ?? 900, gross_total: 1200, calculated_total: 1000, total_amount: 0 },
    ],
    private_booking_payments: options.payments ?? [
      { id: 'pay-1', booking_id: 'booking-1', amount: 300, method: 'cash', created_at: '2026-09-01T18:00:00.000Z' },
    ],
    customers: [{ id: 'customer-1', email: null, email_status: null, email_deactivated_at: null }],
    email_suppressions: [],
    notification_deliveries: [],
    notification_attempts: [],
    private_booking_audit: [],
  })
}

const row = {
  id: 'sms-1',
  booking_id: 'booking-1',
  trigger_type: 'balance_reminder_21day',
  template_key: 'private_booking_balance_reminder_21day',
  message_body: QUEUED,
  metadata: { balance_due_date: '2026-09-26', balance_email_auto: true },
}

describe('Send Now for a balance reminder queued after the switch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.flags = { private_booking_email_first: true, private_booking_balance_email_auto: true }
    mockedSendEmail.mockResolvedValue({ success: true, messageId: 'resend-1', emailMessageId: 'email-row-1' })
  })

  it('emails it with the payments made, once the booking has a usable address', async () => {
    seed()

    const outcome = await tryEmailForApprovedPrivateBookingText({ row, performedBy: 'user-1', now: NOW })

    expect(outcome.status).toBe('sent')
    const email = mockedSendEmail.mock.calls[0][0]
    expect(email.text).toContain('Payments received\n12 August 2026: Deposit by card, £250 (held separately from your bill)\n1 September 2026: Payment by cash, £300')
    expect(email.text).toContain('Paid towards your bill so far: £300')
    expect(email.text).toContain('Balance due: £900')
  })

  it('sends the approved text instead when the payments cannot be stated correctly', async () => {
    seed({ balanceRemaining: 850 })

    const outcome = await tryEmailForApprovedPrivateBookingText({
      row: { ...row, message_body: balanceReminder21DayMessage({ customerFirstName: 'Alex', eventDate: '10 October 2026', balanceAmount: 850, balanceDueDate: '26 September 2026' }) },
      performedBy: 'user-1',
      now: NOW,
    })

    expect(outcome).toEqual({ status: 'not_attempted', reason: 'no_email_version' })
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })

  it('with the balance flag off, the email is as it has always been', async () => {
    state.flags = { private_booking_email_first: true }
    seed()

    const outcome = await tryEmailForApprovedPrivateBookingText({ row, performedBy: 'user-1', now: NOW })

    expect(outcome.status).toBe('sent')
    expect(mockedSendEmail.mock.calls[0][0].text).not.toContain('Payments received')
  })
})
