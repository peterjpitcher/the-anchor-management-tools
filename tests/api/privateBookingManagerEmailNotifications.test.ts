import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({
  createRateLimiter: vi.fn(() => vi.fn().mockResolvedValue(null)),
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

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

vi.mock('@/lib/utils', () => ({
  formatPhoneForStorage: vi.fn((value: string) => value),
}))

vi.mock('@/lib/private-bookings/manager-notifications', () => ({
  sendManagerPrivateBookingCreatedEmail: vi.fn(),
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
import { sendManagerPrivateBookingCreatedEmail } from '@/lib/private-bookings/manager-notifications'
import { POST as privateBookingEnquiryPost } from '@/app/api/private-booking-enquiry/route'
import { POST as publicPrivateBookingPost } from '@/app/api/public/private-booking/route'

describe('private-booking manager email notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({})
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-1')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(getIdempotencyKey as unknown as vi.Mock).mockReturnValue('idem-1')
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(sendManagerPrivateBookingCreatedEmail as unknown as vi.Mock).mockResolvedValue({
      sent: true,
    })
  })

  it('keeps private-booking enquiry creation successful when manager email send fails', async () => {
    ;(PrivateBookingService as unknown as { createBooking: vi.Mock }).createBooking.mockResolvedValue({
      id: 'private-booking-1',
      booking_reference: 'PB-1',
      customer_first_name: 'Pat',
      status: 'draft',
      source: 'website',
    })
    ;(sendManagerPrivateBookingCreatedEmail as unknown as vi.Mock).mockResolvedValueOnce({
      sent: false,
      error: 'smtp down',
    })

    const request = new Request('http://localhost/api/private-booking-enquiry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': 'idem-1',
      },
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
    expect(sendManagerPrivateBookingCreatedEmail).toHaveBeenCalledTimes(1)
    expect(sendManagerPrivateBookingCreatedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        createdVia: 'api_private_booking_enquiry',
      })
    )
  })

  it('keeps public private-booking creation successful when manager email task throws', async () => {
    ;(PrivateBookingService as unknown as { createBooking: vi.Mock }).createBooking.mockResolvedValue({
      id: 'public-booking-1',
      booking_reference: 'PB-2',
      customer_first_name: 'Sam',
      status: 'draft',
      source: 'website',
    })
    ;(sendManagerPrivateBookingCreatedEmail as unknown as vi.Mock).mockRejectedValueOnce(
      new Error('mailbox unavailable')
    )

    const request = new Request('http://localhost/api/public/private-booking', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': 'idem-1',
      },
      body: JSON.stringify({
        customer_first_name: 'Sam',
        contact_phone: '+447700900124',
      }),
    })

    const response = await publicPrivateBookingPost(request as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({
      success: true,
      booking_id: 'public-booking-1',
    })
    expect(sendManagerPrivateBookingCreatedEmail).toHaveBeenCalledTimes(1)
    expect(sendManagerPrivateBookingCreatedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        createdVia: 'api_public_private_booking',
      })
    )
  })
})
