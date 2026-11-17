import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The callback texts on POST /api/private-booking-enquiry (owner decision, 17 November 2026).
 * They go only when the website sends callback_requested: true, run after the answer through
 * after(), never change the answer, and never go on an idempotent replay. sendSMS and the job
 * queue are mocked: nothing here sends.
 */

const ADMIN_CLIENT = { __brand: 'admin-client' }
const auditInsert = vi.hoisted(() => vi.fn())
// private_booking_audit: the acknowledgement note and the staff alert counter rows are inserts;
// the staff alert cap counts come back as zero, so every alert here is under the cap.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    ...ADMIN_CLIENT,
    from: () => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ count: 0, error: null }).then(resolve),
        insert: auditInsert,
      }
      return builder
    },
  }),
}))

// after() runs its callback once the response has gone; here it is collected and run by the test.
const afterCallbacks = vi.hoisted(() => [] as Array<() => unknown>)
const after = vi.hoisted(() => vi.fn((callback: () => unknown) => { afterCallbacks.push(callback) }))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after,
}))

const createBooking = vi.fn()
vi.mock('@/services/private-bookings', () => ({
  PrivateBookingService: { createBooking: (...args: unknown[]) => createBooking(...args) },
}))

const claimIdempotencyKey = vi.hoisted(() => vi.fn())
const persistIdempotencyResponse = vi.hoisted(() => vi.fn())
const computeIdempotencyRequestHash = vi.hoisted(() => vi.fn((payload: unknown) => JSON.stringify(payload)))
vi.mock('@/lib/api/idempotency', () => ({
  getIdempotencyKey: () => 'test-idempotency-key',
  computeIdempotencyRequestHash,
  claimIdempotencyKey,
  persistIdempotencyResponse,
  releaseIdempotencyClaim: vi.fn().mockResolvedValue(undefined),
  markIdempotencyClaimCommitted: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/api/booking-rate-limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/booking-rate-limits')>()),
  limitBookingAttempt: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/api/auth', () => ({
  getApiKeyAuthState: vi.fn().mockResolvedValue('authenticated'),
  withApiAuth: vi.fn(
    async (handler: (request: Request) => Promise<Response>, _permissions: string[], request: Request) =>
      handler(request)
  ),
}))

vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/communications/web-enquiry', () => ({
  recordPrivateBookingWebEnquiryCommunication: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/private-bookings/manager-notifications', () => ({
  sendManagerPrivateBookingCreatedEmail: vi.fn().mockResolvedValue({ sent: true }),
}))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/consent/apply-booking-consent-safe', () => ({
  applyBookingContactConsentSafe: vi.fn().mockResolvedValue(undefined),
}))

// The send path underneath sendWebEnquiryTexts, so a rejected send is exercised for real.
const sendSMS = vi.hoisted(() => vi.fn())
vi.mock('@/lib/twilio', () => ({ sendSMS }))
vi.mock('@/lib/unified-job-queue', () => ({ jobQueue: { enqueue: vi.fn().mockResolvedValue({ success: true }) } }))

const { error } = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error, info: vi.fn() } }))

import { POST, maxDuration } from '@/app/api/private-booking-enquiry/route'
import { sendManagerPrivateBookingCreatedEmail } from '@/lib/private-bookings/manager-notifications'

function enquiry(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/private-booking-enquiry', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'test-key' },
    body: JSON.stringify(body),
  })
}

const CALLBACK = {
  phone: '+447700900123',
  name: 'Alex Example',
  event_type: 'Wake',
  callback_requested: true,
  communication_consent: { service_contact_notice_shown: true },
}

const WITHOUT_FLAG = {
  phone: '+447700900123',
  name: 'Alex Example',
  date: '2026-12-10',
  group_size: 30,
  communication_consent: { service_contact_notice_shown: true },
}

const STAFF = '+447700900201'
const savedNumbers = process.env.PRIVATE_BOOKINGS_ENQUIRY_ALERT_SMS

async function runAfterWork(): Promise<void> {
  const callbacks = afterCallbacks.splice(0)
  for (const callback of callbacks) await callback()
}

beforeEach(() => {
  vi.clearAllMocks()
  afterCallbacks.length = 0
  vi.useFakeTimers()
  // 14:00 London, outside SMS quiet hours, so the staff alert goes straight to sendSMS.
  vi.setSystemTime(new Date('2026-11-17T14:00:00.000Z'))
  process.env.PRIVATE_BOOKINGS_ENQUIRY_ALERT_SMS = STAFF
  claimIdempotencyKey.mockResolvedValue({ state: 'claimed' })
  persistIdempotencyResponse.mockResolvedValue(undefined)
  createBooking.mockResolvedValue({ id: 'pb-test-1', customer_id: 'cust-test-1', booking_reference: 'PB-TEST-1' })
  auditInsert.mockResolvedValue({ error: null })
  sendSMS.mockResolvedValue({ success: true, sid: 'SM-test' })
})

afterEach(() => {
  vi.useRealTimers()
  if (savedNumbers === undefined) delete process.env.PRIVATE_BOOKINGS_ENQUIRY_ALERT_SMS
  else process.env.PRIVATE_BOOKINGS_ENQUIRY_ALERT_SMS = savedNumbers
})

describe('POST /api/private-booking-enquiry callback texts', () => {
  it('gives the after() work room to run', () => {
    expect(maxDuration).toBeGreaterThanOrEqual(60)
  })

  it('sends nothing for a request without the flag, as every other caller sends it', async () => {
    const response = await POST(enquiry(WITHOUT_FLAG) as never)

    expect(response.status).toBe(201)
    expect(after).not.toHaveBeenCalled()
    await runAfterWork()
    expect(sendSMS).not.toHaveBeenCalled()
    // The manager email is unchanged.
    expect(sendManagerPrivateBookingCreatedEmail).toHaveBeenCalledOnce()
  })

  it('sends nothing when the flag is false', async () => {
    await POST(enquiry({ ...CALLBACK, callback_requested: false }) as never)

    expect(after).not.toHaveBeenCalled()
  })

  it('hashes a request without the flag exactly as before', async () => {
    await POST(enquiry(WITHOUT_FLAG) as never)

    expect(computeIdempotencyRequestHash.mock.calls[0][0]).not.toHaveProperty('callback_requested')
  })

  it('answers 201 first, then texts the customer once and alerts the staff number once', async () => {
    const response = await POST(enquiry(CALLBACK) as never)

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ success: true, booking_id: 'pb-test-1' })
    // Nothing has been sent while the answer was being made.
    expect(sendSMS).not.toHaveBeenCalled()
    expect(after).toHaveBeenCalledOnce()
    expect(persistIdempotencyResponse).toHaveBeenCalledOnce()

    await runAfterWork()

    expect(sendSMS).toHaveBeenCalledTimes(2)
    const [ackTo, ackBody, ackOptions] = sendSMS.mock.calls[0]
    expect(ackTo).toBe('+447700900123')
    expect(ackBody).toBe("The Anchor: thanks Alex, we've got your request and we'll call you back. Need us sooner? Call 01753 682707.")
    expect(ackOptions).toEqual({
      customerId: 'cust-test-1',
      metadata: { template_key: 'private_booking_enquiry_ack', private_booking_id: 'pb-test-1' },
    })
    const [to, body, options] = sendSMS.mock.calls[1]
    expect(to).toBe(STAFF)
    expect(body).toMatch(/^New website enquiry: Alex Example, \+447700900123\. Wake\. They've been told we'll call back the same day\. https?:\/\/.+\/private-bookings\/pb-test-1$/)
    expect(options).toMatchObject({ createCustomerIfMissing: false, skipMessageLogging: true })
    expect(options).not.toHaveProperty('customerId')
    // One timeline note for the acknowledgement, one counter row for the staff alert.
    expect(auditInsert.mock.calls.map(([row]) => row.new_value)).toEqual([
      'private_booking_enquiry_ack',
      'private_booking_enquiry_staff_alert',
    ])
  })

  it('stays at 201 when the texts reject, and logs each failure', async () => {
    sendSMS.mockRejectedValue(new Error('twilio down'))

    const response = await POST(enquiry(CALLBACK) as never)
    expect(response.status).toBe(201)

    await expect(runAfterWork()).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith('The acknowledgement text for a website callback request failed', expect.anything())
    expect(error).toHaveBeenCalledWith('A staff alert for a website callback request was not sent', expect.anything())
  })

  it('sends nothing on an idempotent replay of the same enquiry', async () => {
    claimIdempotencyKey.mockResolvedValueOnce({
      state: 'replay',
      response: { success: true, state: 'enquiry_created', booking_id: 'pb-test-1', reference: 'PB-TEST-1' },
    })

    const response = await POST(enquiry(CALLBACK) as never)

    expect(response.status).toBe(201)
    expect(createBooking).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
    await runAfterWork()
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('still texts when the saved enquiry answers 202 because its idempotency answer could not be stored', async () => {
    persistIdempotencyResponse.mockRejectedValueOnce(new Error('db wobble'))

    const response = await POST(enquiry(CALLBACK) as never)

    expect(response.status).toBe(202)
    expect(after).toHaveBeenCalledOnce()
    await runAfterWork()
    expect(sendSMS).toHaveBeenCalledTimes(2)
  })
})
