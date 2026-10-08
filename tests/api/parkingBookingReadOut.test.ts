import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/parking/bookings/{id} answers with reference, times, vehicle, amount
 * and status only. Site review of 7 October 2026, finding PY-002.
 *
 * It used to answer with the whole row, so anybody holding a booking id and a
 * key with parking:view was given the name, mobile, email and staff notes.
 */

const FULL_ROW = {
  id: 'f3b0c1a2-0000-4000-8000-000000000001',
  reference: 'PRK-20261110-0001',
  status: 'pending_payment',
  payment_status: 'pending',
  calculated_price: 30,
  override_price: null,
  override_reason: 'regular, knows the landlord',
  pricing_breakdown: [{ label: '2 days', amount: 30 }],
  start_at: '2026-11-10T09:00:00.000Z',
  end_at: '2026-11-12T09:00:00.000Z',
  duration_minutes: 2880,
  customer_id: '9a1d0000-0000-4000-8000-00000000c001',
  customer_first_name: 'Margaret',
  customer_last_name: 'Holloway',
  customer_mobile: '+447700900123',
  customer_email: 'margaret.holloway@example.com',
  vehicle_registration: 'AB12CDE',
  vehicle_make: 'Ford',
  vehicle_model: 'Focus',
  vehicle_colour: 'Blue',
  payment_due_at: '2026-11-09T09:30:00.000Z',
  expires_at: '2026-11-09T09:30:00.000Z',
  notes: 'staff note: rang twice, was rude',
  capacity_override: false,
  capacity_override_reason: null,
  paypal_order_id: 'PAYPAL-ORDER-123',
  created_by: '7c000000-0000-4000-8000-0000000000aa',
  created_at: '2026-11-09T09:00:00.000Z',
  updated_at: '2026-11-09T09:00:00.000Z',
}

const getParkingBooking = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/parking/repository', () => ({ getParkingBooking }))

vi.mock('@/lib/api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/auth')>()
  return {
    ...actual,
    withApiAuth: vi.fn(
      async (handler: (request: Request, apiKey: { id: string }) => Promise<Response>, _permissions: string[], request: Request) =>
        handler(request, { id: 'api-key-1' })
    ),
  }
})

import { GET } from '@/app/api/parking/bookings/[id]/route'
import { withApiAuth } from '@/lib/api/auth'
import { API_PARKING_BOOKING_FIELDS, toApiParkingBooking } from '@/lib/parking/public-booking'

function read(): Request {
  return new Request(`https://example.com/api/parking/bookings/${FULL_ROW.id}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  getParkingBooking.mockResolvedValue(FULL_ROW)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/parking/bookings/{id}', () => {
  it('returns exactly the allow-listed fields', async () => {
    const response = await GET(read())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(Object.keys(payload.data).sort()).toEqual([...API_PARKING_BOOKING_FIELDS].sort())
    expect(payload.data).toMatchObject({
      id: FULL_ROW.id,
      reference: 'PRK-20261110-0001',
      status: 'pending_payment',
      payment_status: 'pending',
      vehicle_registration: 'AB12CDE',
      start_at: '2026-11-10T09:00:00.000Z',
      end_at: '2026-11-12T09:00:00.000Z',
      calculated_price: 30,
      payment_due_at: '2026-11-09T09:30:00.000Z',
    })
  })

  it.each([
    ['the first name', 'Margaret'],
    ['the surname', 'Holloway'],
    ['the mobile', '+447700900123'],
    ['the email', 'margaret.holloway@example.com'],
    ['the staff note', 'rang twice'],
    ['the override reason', 'knows the landlord'],
    ['the customer id', '9a1d0000-0000-4000-8000-00000000c001'],
    ['the PayPal order id', 'PAYPAL-ORDER-123'],
    ['the member of staff', '7c000000-0000-4000-8000-0000000000aa'],
  ])('does not carry %s anywhere in the answer', async (_label, value) => {
    const response = await GET(read())

    expect(await response.text()).not.toContain(value)
  })

  it('keeps every field the website reads', async () => {
    // The website's own allow-list, PUBLIC_PARKING_BOOKING_FIELDS in its
    // lib/api/parking.ts, as it stood on its main branch on 8 October 2026.
    const websiteReads = [
      'id', 'reference', 'status', 'payment_status', 'vehicle_registration', 'vehicle_make',
      'vehicle_model', 'vehicle_colour', 'start_at', 'end_at', 'calculated_price',
      'override_price', 'payment_due_at', 'created_at', 'updated_at',
    ]
    const payload = await (await GET(read())).json()

    for (const field of websiteReads) {
      expect(payload.data).toHaveProperty(field)
    }
  })

  it('is never stored, and tells the key guard the same', async () => {
    const response = await GET(read())

    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('ETag')).toBeNull()
    expect(vi.mocked(withApiAuth).mock.calls[0][3]).toEqual({ cacheMode: 'private' })
  })

  it('answers 404 with a code, not stored, for a booking that does not exist', async () => {
    getParkingBooking.mockResolvedValue(null)
    const response = await GET(read())

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('answers 500 with a code when the booking cannot be read, with nothing about the booking', async () => {
    getParkingBooking.mockRejectedValue(new Error('database is down'))
    const response = await GET(read())
    const text = await response.text()

    expect(response.status).toBe(500)
    expect(JSON.parse(text)).toMatchObject({ success: false, error: { code: 'INTERNAL_ERROR' } })
    expect(text).not.toContain('Margaret')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('toApiParkingBooking', () => {
  it('drops a column added to the table later', () => {
    const picked = toApiParkingBooking({ ...FULL_ROW, date_of_birth: '1961-04-02' } as never)

    expect(JSON.stringify(picked)).not.toContain('1961-04-02')
  })

  it('gives null, not undefined, for an allow-listed field that is missing', () => {
    const { vehicle_colour: _dropped, ...withoutColour } = FULL_ROW
    const picked = toApiParkingBooking(withoutColour as never)

    expect(picked.vehicle_colour).toBeNull()
  })
})
