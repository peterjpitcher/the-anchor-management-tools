import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

/**
 * A booking text sent in quiet hours goes to our own job queue, never Twilio's scheduler, when it
 * names the booking status it was written for, so the queue can read the booking again at 09:00
 * and drop it if the guest has paid or the hold has gone (BK-084).
 */

vi.hoisted(() => {
  process.env.TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || 'AC_TEST'
  process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'auth_test'
  process.env.TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+15555555555'
  // With a messaging service, Twilio's own scheduler would normally take a held text.
  process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG_TEST'
})

const create = vi.hoisted(() => vi.fn())
vi.mock('twilio', () => ({ default: vi.fn(() => ({ messages: { create } })) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/sms/quiet-hours', () => ({
  evaluateSmsQuietHours: vi.fn(() => ({
    inQuietHours: true,
    // Far enough ahead that Twilio scheduling would be allowed.
    nextAllowedSendAt: new Date(Date.now() + 10 * 60 * 60 * 1000),
    timezone: 'Europe/London',
  })),
}))
vi.mock('@/lib/sms/link-shortening', () => ({ shortenUrlsInSmsBody: vi.fn(async (body: string) => body) }))
const enqueue = vi.hoisted(() => vi.fn())
vi.mock('@/lib/unified-job-queue', () => ({ jobQueue: { enqueue } }))

import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'

function mockActiveCustomer() {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: { sms_status: 'active', sms_opt_in: true, mobile_e164: '+447700900123', mobile_number: '+447700900123' },
    error: null,
  })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  ;(createAdminClient as unknown as Mock).mockReturnValue({ from: vi.fn(() => ({ select })) })
}

describe('sendSMS in quiet hours: held booking texts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveCustomer()
    enqueue.mockResolvedValue({ success: true, jobId: 'job-1' })
    create.mockResolvedValue({ sid: 'SM1', status: 'scheduled', from: '+15555555555' })
  })

  it('queues a booking text that names its expected status, instead of scheduling it with Twilio', async () => {
    const result = await sendSMS('+447700900123', 'The Anchor: Hi Pat, 2 seats held.', {
      customerId: 'customer-1',
      createCustomerIfMissing: false,
      skipSafetyGuards: true,
      metadata: {
        event_booking_id: 'booking-1',
        template_key: 'event_booking_pending_payment',
        expected_booking_status: 'pending_payment',
      },
    })

    expect(enqueue).toHaveBeenCalledOnce()
    expect(enqueue.mock.calls[0][0]).toBe('send_sms')
    expect(enqueue.mock.calls[0][1].metadata).toEqual(expect.objectContaining({ expected_booking_status: 'pending_payment' }))
    expect(create).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({ success: true, deferred: true, deferredBy: 'job_queue' }))
  })

  it('still lets Twilio schedule any other held text', async () => {
    await sendSMS('+447700900123', 'The Anchor: hello.', {
      customerId: 'customer-1',
      createCustomerIfMissing: false,
      skipSafetyGuards: true,
      skipMessageLogging: true,
      metadata: { template_key: 'something_else' },
    })

    expect(enqueue).not.toHaveBeenCalled()
  })
})
