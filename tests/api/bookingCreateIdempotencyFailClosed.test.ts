import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({
  createRateLimiter: vi.fn(() => vi.fn().mockResolvedValue(null)),
}))

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(async (handler: (request: Request) => Promise<Response>, _permissions: string[], request: Request) =>
    handler(request)
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

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

vi.mock('@/lib/utils', () => ({
  formatPhoneForStorage: vi.fn((value: string) => value),
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
import { formatPhoneForStorage } from '@/lib/utils'
import { POST as publicPrivateBookingPost } from '@/app/api/public/private-booking/route'
import { POST as externalCreateBookingPost } from '@/app/api/external/create-booking/route'

const mockedFormatPhoneForStorage = formatPhoneForStorage as unknown as vi.Mock

describe('booking-create routes idempotency fail-closed guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({})
    ;(computeIdempotencyRequestHash as unknown as vi.Mock).mockReturnValue('hash-1')
    ;(claimIdempotencyKey as unknown as vi.Mock).mockResolvedValue({ state: 'claimed' })
    ;(releaseIdempotencyClaim as unknown as vi.Mock).mockResolvedValue(undefined)
  })

  it('does not release the public private-booking idempotency claim when response persistence fails after booking creation', async () => {
    ;(getIdempotencyKey as unknown as vi.Mock).mockReturnValue('idem-1')
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockRejectedValue(new Error('idempotency write failed'))
    ;(PrivateBookingService as unknown as { createBooking: vi.Mock }).createBooking.mockResolvedValue({
      id: 'private-booking-1',
      booking_reference: 'PB-1',
      customer_id: 'customer-1',
    })

    const request = new Request('http://localhost/api/public/private-booking', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': 'idem-1',
      },
      body: JSON.stringify({
        customer_first_name: 'Pat',
        contact_phone: '+447700900123',
        default_country_code: '44',
        items: [],
      }),
    })

    const response = await publicPrivateBookingPost(request as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({
      success: true,
      booking_id: 'private-booking-1',
    })
    expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('does not release the external create-booking idempotency claim when response persistence fails after booking creation', async () => {
    ;(getIdempotencyKey as unknown as vi.Mock).mockReturnValue('idem-2')
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockRejectedValue(new Error('idempotency write failed'))
    ;(PrivateBookingService as unknown as { createBooking: vi.Mock }).createBooking.mockResolvedValue({
      id: 'external-booking-1',
      booking_reference: 'EXT-1',
    })

    const request = new Request('http://localhost/api/external/create-booking', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': 'idem-2',
      },
      body: JSON.stringify({
        name: 'Pat Example',
        email: 'pat@example.com',
        phone: '+447700900123',
      }),
    })

    const response = await externalCreateBookingPost(request as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({
      success: true,
      id: 'external-booking-1',
    })
    expect(persistIdempotencyResponse).toHaveBeenCalledTimes(1)
    expect(releaseIdempotencyClaim).not.toHaveBeenCalled()
  })

  it('passes default_country_code when normalizing external create-booking phone numbers', async () => {
    ;(getIdempotencyKey as unknown as vi.Mock).mockReturnValue('idem-3')
    ;(persistIdempotencyResponse as unknown as vi.Mock).mockResolvedValue(undefined)
    ;(PrivateBookingService as unknown as { createBooking: vi.Mock }).createBooking.mockResolvedValue({
      id: 'external-booking-2',
      booking_reference: 'EXT-2',
    })

    const request = new Request('http://localhost/api/external/create-booking', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': 'idem-3',
      },
      body: JSON.stringify({
        name: 'Jean Example',
        email: 'jean@example.com',
        phone: '06 12 34 56 78',
        default_country_code: '33',
      }),
    })

    const response = await externalCreateBookingPost(request as any)
    expect(response.status).toBe(201)
    expect(mockedFormatPhoneForStorage).toHaveBeenCalledWith('06 12 34 56 78', {
      defaultCountryCode: '33',
    })
  })
})
