import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// Two guests after the last parking space at once both pass the service's own capacity check.
// The enforce_parking_capacity trigger refuses the second insert, but the refusal arrives as a
// plain database error, not an Error, so the route never saw its message and answered 500
// (found 19 October 2026). It must answer 409, which the website shows as "fully booked".

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

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/parking/repository', () => ({
  getActiveParkingRate: vi.fn(),
  insertParkingBooking: vi.fn(),
}))

vi.mock('@/lib/parking/capacity', () => ({
  checkParkingCapacity: vi.fn(),
}))

vi.mock('@/services/consent', () => ({
  ConsentService: { applyBookingContactConsent: vi.fn() },
}))

vi.mock('@/lib/parking/payments', () => ({
  createParkingPaymentOrder: vi.fn(),
  sendParkingPaymentRequest: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/env', () => ({
  getAppUrl: vi.fn(() => 'https://management.example.test'),
}))

const { loggerError } = vi.hoisted(() => ({ loggerError: vi.fn() }))

vi.mock('@/lib/logger', () => ({
  logger: { error: loggerError, warn: vi.fn(), info: vi.fn() },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveParkingRate, insertParkingBooking } from '@/lib/parking/repository'
import { checkParkingCapacity } from '@/lib/parking/capacity'
import { createParkingPaymentOrder } from '@/lib/parking/payments'
import { POST as parkingBookingsPost } from '@/app/api/parking/bookings/route'

// What insertParkingBooking throws when the trigger refuses: PostgREST's error body, as is.
const TRIGGER_REFUSAL = {
  code: 'P0001',
  message: 'No parking spaces remaining for the selected period',
  details: null,
  hint: null,
}

/** A customers table holding the guest, and the parking_bookings expiry update. */
function fakeAdminClient() {
  const customers = () => {
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      order: () => query,
      limit: async () => ({
        data: [
          {
            id: 'customer-1',
            first_name: 'Pat',
            last_name: 'Example',
            mobile_number: '+447700900123',
            mobile_e164: '+447700900123',
            email: null,
          },
        ],
        error: null,
      }),
    }
    return query
  }

  const parkingBookings = () => {
    const query = {
      update: () => query,
      eq: () => query,
      then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
    }
    return query
  }

  return {
    from(table: string) {
      if (table === 'customers') return customers()
      if (table === 'parking_bookings') return parkingBookings()
      throw new Error(`Unexpected table ${table}`)
    },
  }
}

function bookingRequest(): Request {
  return new Request('http://localhost/api/parking/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customer: { first_name: 'Pat', last_name: 'Example', mobile_number: '07700900123' },
      vehicle: { registration: 'AB12CDE' },
      start_at: '2026-10-20T06:00:00.000Z',
      end_at: '2026-10-27T18:00:00.000Z',
      source: 'website',
    }),
  })
}

describe('parking booking API: the last space taken at the same moment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(createAdminClient as unknown as Mock).mockReturnValue(fakeAdminClient())
    ;(getActiveParkingRate as unknown as Mock).mockResolvedValue({
      hourly_rate: 5,
      daily_rate: 15,
      weekly_rate: 75,
      monthly_rate: 250,
    })
    // One space left when this request checked; another request took it before the insert.
    ;(checkParkingCapacity as unknown as Mock).mockResolvedValue({ remaining: 1, capacity: 10, active: 9 })
  })

  it('answers 409 CAPACITY_UNAVAILABLE when the database refuses the insert, not 500', async () => {
    ;(insertParkingBooking as unknown as Mock).mockRejectedValue(TRIGGER_REFUSAL)

    const response = await parkingBookingsPost(bookingRequest() as any)
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload).toEqual({
      success: false,
      error: 'No parking spaces available for the requested period',
      code: 'CAPACITY_UNAVAILABLE',
    })
    expect(createParkingPaymentOrder).not.toHaveBeenCalled()
    expect(loggerError).not.toHaveBeenCalled()
  })

  it('still answers 500 for a database error that is not a refusal', async () => {
    ;(insertParkingBooking as unknown as Mock).mockRejectedValue({
      code: '57014',
      message: 'canceling statement due to statement timeout',
      details: null,
      hint: null,
    })

    const response = await parkingBookingsPost(bookingRequest() as any)

    expect(response.status).toBe(500)
    expect(loggerError).toHaveBeenCalledWith('Error creating parking booking via API', expect.any(Object))
  })
})
