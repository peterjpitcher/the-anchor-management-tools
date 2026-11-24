import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The day-before "offer expires" reminder for a customer with an email address.
 *
 * Quiet hours hold texts, not emails, so the email names the absolute deadline (weekday, date
 * and time), never "today" or "tomorrow" worked out for a held text. A late run whose text could
 * only land after the offer has gone still sends the email, with no text to fall back to.
 */

vi.mock('@/lib/notifications/notify', () => ({
  notifyCustomer: vi.fn().mockResolvedValue({
    selectedChannels: ['email'],
    attempts: [{ channel: 'email', success: true, messageId: 'email-1' }],
    finalStatus: 'sent',
    sentChannel: 'email',
    fallbackUsed: false,
  }),
}))

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(() => ({ authorized: true })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/cron-run-results', () => ({
  persistCronRunResult: vi.fn().mockResolvedValue(undefined),
  recoverCronRunLock: vi.fn().mockResolvedValue({ result: 'already_running', runId: 'run-1' }),
}))

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn().mockResolvedValue({ success: true, sid: 'SM1' }),
}))

vi.mock('@/lib/parking/repository', () => ({
  logParkingNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/parking/booking-updates', () => ({
  updateParkingBookingById: vi.fn().mockResolvedValue('updated'),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { notifyCustomer } from '@/lib/notifications/notify'
import { updateParkingBookingById } from '@/lib/parking/booking-updates'
import { GET } from '@/app/api/cron/parking-notifications/route'
import { called, createRecordingSupabase, firstArgsOf } from '../mocks/recordingSupabase'

const PAY_LINK = 'https://www.paypal.com/checkoutnow?token=TEST123'
const DAY_MS = 24 * 60 * 60 * 1000

/** A staff parking offer: seven days to pay, parking booked for April 2027. */
function offerDueAt(paymentDueAt: string) {
  return {
    id: 'parking-1',
    reference: 'PAR-20260909-0001',
    customer_id: 'customer-1',
    customer_first_name: 'Sam',
    customer_last_name: null,
    customer_mobile: '+447700900123',
    customer_email: 'sam@example.com',
    vehicle_registration: 'AB12CDE',
    start_at: '2027-04-03T08:00:00Z',
    end_at: '2027-04-10T16:00:00Z',
    calculated_price: 25,
    override_price: null,
    payment_due_at: paymentDueAt,
    expires_at: paymentDueAt,
    created_at: new Date(Date.parse(paymentDueAt) - 7 * DAY_MS).toISOString(),
    unpaid_day_before_sms_sent: false,
    unpaid_week_before_sms_sent: true,
  }
}

async function runCronAt(instant: string, booking: ReturnType<typeof offerDueAt>) {
  vi.setSystemTime(new Date(instant))

  const db = createRecordingSupabase({
    tables: {
      cron_job_runs: (query) =>
        called(query, 'insert') ? { data: { id: 'run-1' }, error: null } : { data: null, error: null },
      messages: () => ({ data: [], count: 0, error: null }),
      // The pending-payment query selects the lifecycle flags; the paid-session one does not.
      parking_bookings: (query) =>
        String(firstArgsOf(query, 'select')?.[0]).includes('unpaid_day_before_sms_sent')
          ? { data: [booking], error: null }
          : { data: [], error: null },
      parking_booking_notifications: () => ({ data: [], error: null }),
      parking_booking_payments: () => ({ data: { metadata: { approve_url: PAY_LINK } }, error: null }),
    },
    defaultAnswer: () => ({ data: [], count: 0, error: null }),
  })
  vi.mocked(createAdminClient).mockReturnValue(db.client as never)

  const response = await GET(new Request('http://localhost/api/cron/parking-notifications'))
  return response.json()
}

function expiryCalls() {
  return vi
    .mocked(notifyCustomer)
    .mock.calls.map(([input]) => input)
    .filter((input) => input.email?.commType === 'parking_payment_reminder_day_before_expiry')
}

describe('parking day-before payment reminder by email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('names the absolute deadline when the cron runs after 21:00, not the held-text "today"', async () => {
    // Monday 14 September 2026 at 22:15 BST, offer due Tuesday 15 September at 21:15 BST.
    await runCronAt('2026-09-14T21:15:00Z', offerDueAt('2026-09-15T20:15:00Z'))

    const [input] = expiryCalls()
    expect(input.email?.subject).toBe('Your parking offer expires Tuesday 15 September at 21:15, PAR-20260909-0001')
    expect(input.email?.text).not.toMatch(/today|tomorrow/)
    // The text fallback, if the email fails, keeps the wording for the day it lands.
    expect(input.sms?.body).toContain('expires today at 21:15')
  })

  it('still emails when a text could only land after the offer had gone, with no text fallback', async () => {
    const payload = await runCronAt('2026-09-16T01:00:00Z', offerDueAt('2026-09-16T07:00:00Z'))

    const [input] = expiryCalls()
    expect(input.email?.subject).toBe('Your parking offer expires Wednesday 16 September at 08:00, PAR-20260909-0001')
    expect(input.sms).toBeUndefined()
    expect(payload.pendingPaymentLifecycle).toEqual(expect.objectContaining({ sent: 1 }))
    expect(updateParkingBookingById).toHaveBeenCalledWith(
      expect.anything(),
      'parking-1',
      expect.objectContaining({ unpaid_day_before_sms_sent: true }),
      expect.any(String)
    )
  })
})
