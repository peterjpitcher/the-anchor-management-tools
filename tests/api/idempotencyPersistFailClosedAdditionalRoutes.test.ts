import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({
  createRateLimiter: vi.fn(() => vi.fn().mockResolvedValue(null)),
}))

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(
    async (
      handler: (request: Request, apiKey: { id: string }) => Promise<Response>,
      _permissions: string[],
      request: Request
    ) => handler(request, { id: 'api-key-1' })
  ),
  createApiResponse: vi.fn((data: any, status = 200) => {
    const payload =
      data && typeof data === 'object' && 'success' in data ? data : { success: true, data }
    return Response.json(payload, { status })
  }),
  createErrorResponse: vi.fn((message: string, code: string, status = 400) =>
    Response.json({ success: false, error: message, code }, { status })
  ),
}))

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn(),
  computeIdempotencyRequestHash: vi.fn(),
  getIdempotencyKey: vi.fn(),
  persistIdempotencyResponse: vi.fn(),
  releaseIdempotencyClaim: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/services/private-bookings', () => ({
  PrivateBookingService: {
    createBooking: vi.fn(),
  },
}))

vi.mock('@/services/parking', () => ({
  createPendingParkingBooking: vi.fn(),
}))

vi.mock('@/lib/parking/payments', () => ({
  createParkingPaymentOrder: vi.fn(),
  sendParkingPaymentRequest: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/utils', () => ({
  formatPhoneForStorage: vi.fn((value: string) => value),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

const { warn, error } = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn,
    error,
  },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  getIdempotencyKey,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { PrivateBookingService } from '@/services/private-bookings'
import { createPendingParkingBooking } from '@/services/parking'
import { createParkingPaymentOrder, sendParkingPaymentRequest } from '@/lib/parking/payments'
import { logAuditEvent } from '@/app/actions/audit'
import { sendEmail } from '@/lib/email/emailService'
import { POST as privateBookingEnquiryPost } from '@/app/api/private-booking-enquiry/route'
import { POST as parkingBookingsPost } from '@/app/api/parking/bookings/route'
import { POST as performerInterestPost } from '@/app/api/external/performer-interest/route'

describe('additional route idempotency persist fail-closed guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({})
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-1')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockRejectedValue(new Error('idempotency write failed'))
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)
  })

  it('does not release the private-booking-enquiry idempotency claim when response persistence fails after booking creation', async () => {
    ;(getIdempotencyKey as unknown as vi.Mock).mockReturnValue('idem-enquiry-1')
    ;(PrivateBookingService as unknown as { createBooking: vi.Mock }).createBooking.mockResolvedValue({
      id: 'private-booking-1',
      booking_reference: 'PB-1',
    })

    const request = new Request('http://localhost/api/private-booking-enquiry', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'idem-enquiry-1' },
      body: JSON.stringify({
        phone: '+447700900123',
        default_country_code: '44',
        name: 'Pat Example',
      }),
    })

    const response = await privateBookingEnquiryPost(request as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({
      success: true,
      booking_id: 'private-booking-1',
    })
    expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('does not release the parking booking idempotency claim when response persistence fails after booking creation', async () => {
    ;(createPendingParkingBooking as unknown as vi.Mock).mockResolvedValue({
      booking: {
        id: 'parking-booking-1',
        reference: 'P-1',
        calculated_price: 10,
        override_price: null,
        pricing_breakdown: [],
        payment_due_at: '2026-02-15T10:00:00.000Z',
      },
    })
    ;(createParkingPaymentOrder as unknown as vi.Mock).mockResolvedValue({
      approveUrl: 'https://paypal.example/approve',
    })
    ;(sendParkingPaymentRequest as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(logAuditEvent as unknown as vi.Mock).mockResolvedValue(undefined)

    const request = new Request('http://localhost/api/parking/bookings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': 'idem-parking-1',
      },
      body: JSON.stringify({
        customer: {
          first_name: 'Pat',
          last_name: 'Example',
          email: 'pat@example.com',
          mobile_number: '+447700900123',
        },
        vehicle: {
          registration: 'ab12 cde',
          make: 'Toyota',
          model: 'Yaris',
          colour: 'Blue',
        },
        start_at: '2026-02-16T10:00:00.000Z',
        end_at: '2026-02-16T12:00:00.000Z',
        notes: 'Test',
      }),
    })

    const response = await parkingBookingsPost(request as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({
      success: true,
      data: {
        booking_id: 'parking-booking-1',
      },
    })
    expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('surfaces logging_failed SMS meta for parking booking create responses', async () => {
    ;(createPendingParkingBooking as unknown as vi.Mock).mockResolvedValue({
      booking: {
        id: 'parking-booking-logging-failed',
        reference: 'P-LOG',
        calculated_price: 12,
        override_price: null,
        pricing_breakdown: [],
        payment_due_at: '2026-02-15T10:00:00.000Z',
      },
    })
    ;(createParkingPaymentOrder as unknown as vi.Mock).mockResolvedValue({
      approveUrl: 'https://paypal.example/approve-log',
    })
    ;(sendParkingPaymentRequest as unknown as vi.Mock).mockResolvedValue({
      sent: true,
      skipped: false,
      code: 'logging_failed',
      logFailure: true,
    })
    ;(logAuditEvent as unknown as vi.Mock).mockResolvedValue(undefined)

    const request = new Request('http://localhost/api/parking/bookings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customer: {
          first_name: 'Pat',
          last_name: 'Example',
          email: 'pat@example.com',
          mobile_number: '+447700900123',
        },
        vehicle: {
          registration: 'ab12 cde',
          make: 'Toyota',
          model: 'Yaris',
          colour: 'Blue',
        },
        start_at: '2026-02-16T10:00:00.000Z',
        end_at: '2026-02-16T12:00:00.000Z',
        notes: 'Test',
      }),
    })

    const response = await parkingBookingsPost(request as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({
      success: true,
      data: {
        booking_id: 'parking-booking-logging-failed',
      },
      meta: {
        status_code: 201,
        sms: {
          sent: true,
          skipped: false,
          code: 'logging_failed',
          logFailure: true,
        },
      },
    })
  })

  it('surfaces unsent SMS meta when initial parking payment request SMS fails before send', async () => {
    ;(createPendingParkingBooking as unknown as vi.Mock).mockResolvedValue({
      booking: {
        id: 'parking-booking-sms-failed',
        reference: 'P-FAIL',
        calculated_price: 12,
        override_price: null,
        pricing_breakdown: [],
        payment_due_at: '2026-02-15T10:00:00.000Z',
      },
    })
    ;(createParkingPaymentOrder as unknown as vi.Mock).mockResolvedValue({
      approveUrl: 'https://paypal.example/approve-fail',
    })
    ;(sendParkingPaymentRequest as unknown as vi.Mock).mockResolvedValue({
      sent: false,
      skipped: false,
      code: 'provider_unavailable',
      logFailure: false,
    })
    ;(logAuditEvent as unknown as vi.Mock).mockResolvedValue(undefined)

    const request = new Request('http://localhost/api/parking/bookings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customer: {
          first_name: 'Pat',
          last_name: 'Example',
          email: 'pat@example.com',
          mobile_number: '+447700900123',
        },
        vehicle: {
          registration: 'ab12 cde',
          make: 'Toyota',
          model: 'Yaris',
          colour: 'Blue',
        },
        start_at: '2026-02-16T10:00:00.000Z',
        end_at: '2026-02-16T12:00:00.000Z',
        notes: 'Test',
      }),
    })

    const response = await parkingBookingsPost(request as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({
      success: true,
      data: {
        booking_id: 'parking-booking-sms-failed',
      },
      meta: {
        status_code: 201,
        sms: {
          sent: false,
          skipped: false,
          code: 'provider_unavailable',
          logFailure: false,
        },
      },
    })
  })

  it('does not release the performer-interest idempotency claim when response persistence fails after submission insert', async () => {
    ;(getIdempotencyKey as unknown as vi.Mock).mockReturnValue('idem-performer-1')
    ;(sendEmail as unknown as vi.Mock).mockResolvedValue({ success: true })

    const submissionSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'submission-1',
        full_name: 'Pat Example',
        email: 'pat@example.com',
        phone: '+447700900123',
        bio: 'Singer songwriter',
      },
      error: null,
    })
    const submissionSelect = vi.fn().mockReturnValue({ single: submissionSingle })
    const submissionInsert = vi.fn().mockReturnValue({ select: submissionSelect })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn(() => ({
        insert: submissionInsert,
      })),
    })

    const request = new Request('http://localhost/api/external/performer-interest', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': 'idem-performer-1',
      },
      body: JSON.stringify({
        fullName: 'Pat Example',
        email: 'pat@example.com',
        phone: '+447700900123',
        bio: 'Singer songwriter',
        consentDataStorage: true,
        honeypot: '',
      }),
    })

    const response = await performerInterestPost(request as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      success: true,
      data: {
        id: 'submission-1',
      },
    })
    expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })
})
