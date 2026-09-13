import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The parking "offer expires" text, and the day it names.
 *
 * The cron runs every 15 minutes and sends the day-before payment reminder once fewer than 24
 * hours remain before the payment deadline. sendSMS holds anything sent from 21:00 to 09:00
 * London until 09:00, so for an offer due after about 20:45 the text arrived on the day it
 * expired, still saying "expires tomorrow". It now names the day the customer reads it on and
 * the time it expires, and is not sent if it could only arrive once the offer has gone.
 */

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
import { sendSMS } from '@/lib/twilio'
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
    customer_email: null,
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

function expiryTexts(): string[] {
  return vi
    .mocked(sendSMS)
    .mock.calls.filter(([, , options]) => options?.metadata?.template_key === 'parking_payment_reminder_day_before_expiry')
    .map(([, body]) => body)
}

/** The day as the customer reads it, and the deadline's London time. */
const text = (day: 'today' | 'tomorrow', time: string) =>
  `The Anchor: Sam! Your parking offer expires ${day} at ${time}, £25.00 for 3 Apr 2027, 09:00 to 10 Apr 2027, 17:00. Last chance: Sort it here: ${PAY_LINK}`

describe('parking day-before payment reminder: the day it names', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the wording for an offer due at 10:00, sent at 10:00 the day before', async () => {
    // Due 10:00 BST on Wednesday 16 September; the 10:00 run on the Tuesday is the first
    // inside 24 hours, outside quiet hours.
    await runCronAt('2026-09-15T09:00:00Z', offerDueAt('2026-09-16T09:00:00Z'))

    expect(expiryTexts()).toEqual([text('tomorrow', '10:00')])
  })

  it('says today for an offer due at 22:00, held from 22:00 the night before until 09:00', async () => {
    await runCronAt('2026-09-15T21:00:00Z', offerDueAt('2026-09-16T21:00:00Z'))

    expect(expiryTexts()).toEqual([text('today', '22:00')])
  })

  it('an offer due at 20:45 is still sent at 20:45 the day before and says tomorrow', async () => {
    await runCronAt('2026-09-15T19:45:00Z', offerDueAt('2026-09-16T19:45:00Z'))

    expect(expiryTexts()).toEqual([text('tomorrow', '20:45')])
  })

  it('an offer due at 20:50 is first due at the 21:00 run, held until 09:00, and says today', async () => {
    await runCronAt('2026-09-15T20:00:00Z', offerDueAt('2026-09-16T19:50:00Z'))

    expect(expiryTexts()).toEqual([text('today', '20:50')])
  })

  it('gives the time for a deadline in the small hours, so "tomorrow" cannot read as all day', async () => {
    // Due 02:00 BST on Wednesday 16 September: the 02:00 run on the Tuesday is held until 09:00
    // Tuesday, the day before.
    await runCronAt('2026-09-15T01:00:00Z', offerDueAt('2026-09-16T01:00:00Z'))

    expect(expiryTexts()).toEqual([text('tomorrow', '02:00')])
  })

  it('on Sunday 25 October 2026 an offer due at 20:00 GMT is first due at 21:00 BST on the Saturday and says today', async () => {
    // The clocks go back overnight, so 24 hours before 20:00 GMT is 21:00 BST, in quiet hours.
    await runCronAt('2026-10-24T20:00:00Z', offerDueAt('2026-10-25T20:00:00Z'))

    expect(expiryTexts()).toEqual([text('today', '20:00')])
  })

  it('on Sunday 28 March 2027 an offer due at 21:30 BST is first due at 20:30 GMT on the Saturday and says tomorrow', async () => {
    // The clocks go forward overnight, so 24 hours before 21:30 BST is 20:30 GMT, before quiet hours.
    await runCronAt('2027-03-27T20:30:00Z', offerDueAt('2027-03-28T20:30:00Z'))

    expect(expiryTexts()).toEqual([text('tomorrow', '21:30')])
  })

  it('on Sunday 28 March 2027 an offer due at 22:00 BST is held from 21:00 GMT and says today', async () => {
    await runCronAt('2027-03-27T21:00:00Z', offerDueAt('2027-03-28T21:00:00Z'))

    expect(expiryTexts()).toEqual([text('today', '22:00')])
  })

  it('sends nothing when the text could only arrive after the offer has expired', async () => {
    // A late run at 02:00 BST for an offer due at 08:00 that morning: quiet hours would hold the
    // text until 09:00, an hour after it expired.
    const payload = await runCronAt('2026-09-16T01:00:00Z', offerDueAt('2026-09-16T07:00:00Z'))

    expect(expiryTexts()).toEqual([])
    expect(payload.pendingPaymentLifecycle).toEqual(expect.objectContaining({ sent: 0, skipped: 1 }))
    // Not marked as sent, so nothing claims the customer was told.
    expect(updateParkingBookingById).not.toHaveBeenCalledWith(
      expect.anything(),
      'parking-1',
      expect.objectContaining({ unpaid_day_before_sms_sent: true }),
      expect.any(String)
    )
  })
})
