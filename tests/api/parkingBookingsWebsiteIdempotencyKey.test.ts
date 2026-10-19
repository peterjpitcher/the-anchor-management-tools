import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// The website's parking Idempotency-Key is the base64 of the mobile number, the registration,
// both times and the guest's consent choices: about 370 characters. idempotency_keys.key is
// varchar(255), so the claim insert was refused and the route answered 500 to every online
// parking booking (found 19 October 2026). These tests run the real idempotency helpers
// against a table that refuses an over-long key the way production does.

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

vi.mock('@/services/parking', () => ({
  createPendingParkingBooking: vi.fn(),
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
import { createPendingParkingBooking } from '@/services/parking'
import { ConsentService } from '@/services/consent'
import { createParkingPaymentOrder, sendParkingPaymentRequest } from '@/lib/parking/payments'
import { POST as parkingBookingsPost } from '@/app/api/parking/bookings/route'

type StoredKey = { key: string; request_hash: string; response: unknown; expires_at: string }
type DbError = { code: string; message: string; details: string | null; hint: string | null }

const VALUE_TOO_LONG: DbError = {
  code: '22001',
  message: 'value too long for type character varying(255)',
  details: null,
  hint: null,
}

/**
 * Just enough of the admin client for this route: idempotency_keys with the production
 * varchar(255) key, and the parking_bookings expiry update and payability read.
 */
function fakeAdminClient(options: { refuseClaimWith?: DbError } = {}) {
  const keys = new Map<string, StoredKey>()
  const paymentDueAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()

  const idempotencyKeys = () => {
    const filters: Array<(row: StoredKey) => boolean> = []
    let mode: 'select' | 'delete' = 'select'
    const query = {
      insert(row: StoredKey) {
        if (options.refuseClaimWith) return { error: options.refuseClaimWith }
        if (row.key.length > 255) return { error: VALUE_TOO_LONG }
        if (keys.has(row.key)) {
          return { error: { code: '23505', message: 'duplicate key value', details: null, hint: null } }
        }
        keys.set(row.key, { ...row })
        return { error: null }
      },
      upsert(row: StoredKey) {
        if (row.key.length > 255) return { error: VALUE_TOO_LONG }
        keys.set(row.key, { ...row })
        return { error: null }
      },
      select() {
        return query
      },
      delete() {
        mode = 'delete'
        return query
      },
      eq(column: keyof StoredKey, value: unknown) {
        filters.push((row) => row[column] === value)
        return query
      },
      maybeSingle() {
        const row = [...keys.values()].find((candidate) => filters.every((f) => f(candidate)))
        return { data: row ?? null, error: null }
      },
      then(resolve: (value: { error: null }) => void) {
        if (mode === 'delete') {
          for (const [key, row] of keys) {
            if (filters.every((f) => f(row))) keys.delete(key)
          }
        }
        resolve({ error: null })
      },
    }
    return query
  }

  const parkingBookings = () => {
    let bookingId: unknown = null
    const query = {
      update() {
        return query
      },
      select() {
        return query
      },
      eq(_column: string, value: unknown) {
        bookingId = value
        return query
      },
      maybeSingle() {
        return {
          data: { id: bookingId, status: 'pending_payment', payment_due_at: paymentDueAt },
          error: null,
        }
      },
      then(resolve: (value: { error: null }) => void) {
        resolve({ error: null })
      },
    }
    return query
  }

  return {
    keys,
    from(table: string) {
      if (table === 'idempotency_keys') return idempotencyKeys()
      if (table === 'parking_bookings') return parkingBookings()
      throw new Error(`Unexpected table ${table}`)
    },
  }
}

const consent = {
  service_contact_notice_shown: true,
  marketing_email_opt_in: false,
  marketing_sms_opt_in: false,
  whatsapp_opt_in: false,
  marketing_whatsapp_opt_in: false,
  consent_text_version: 'guest-comms-consent-v6',
}

const body = {
  customer: { first_name: 'Pat', last_name: 'Example', mobile_number: '07700900123' },
  vehicle: { registration: 'AB12CDE' },
  start_at: '2026-10-20T06:00:00.000Z',
  end_at: '2026-10-27T18:00:00.000Z',
  source: 'website',
  communication_consent: consent,
}

// Built exactly as the website's app/api/parking/payment/create-order/route.ts builds it.
const websiteKey = Buffer.from(
  `${body.customer.mobile_number}|${body.vehicle.registration}|${body.start_at}|${body.end_at}|${JSON.stringify(consent)}`
).toString('base64')

function websiteRequest(): Request {
  return new Request('http://localhost/api/parking/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': websiteKey },
    body: JSON.stringify(body),
  })
}

describe('website parking booking with the website Idempotency-Key', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(createPendingParkingBooking as unknown as Mock).mockResolvedValue({
      booking: {
        id: 'parking-booking-1',
        reference: 'PAR-1',
        customer_id: 'customer-1',
        calculated_price: 42,
        override_price: null,
        pricing_breakdown: [],
        payment_due_at: '2026-10-26T18:00:00.000Z',
      },
    })
    ;(ConsentService.applyBookingContactConsent as unknown as Mock).mockResolvedValue(undefined)
    ;(createParkingPaymentOrder as unknown as Mock).mockResolvedValue({
      orderId: 'PAYPAL-ORDER-1',
      approveUrl: 'https://paypal.example/approve',
    })
  })

  it('is longer than the table allows, as the website sends it', () => {
    expect(websiteKey.length).toBeGreaterThan(255)
  })

  it('creates the booking and PayPal order instead of answering 500', async () => {
    const client = fakeAdminClient()
    ;(createAdminClient as unknown as Mock).mockReturnValue(client)

    const response = await parkingBookingsPost(websiteRequest() as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({
      success: true,
      data: { booking_id: 'parking-booking-1', paypal_order_id: 'PAYPAL-ORDER-1' },
    })
    expect(sendParkingPaymentRequest).not.toHaveBeenCalled()

    // The finished response is stored under the shortened key, ready for a retry to replay.
    const stored = [...client.keys.values()]
    expect(stored).toHaveLength(1)
    expect(stored[0].key).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(stored[0].response).toMatchObject({ data: { booking_id: 'parking-booking-1' } })
  })

  it('replays the first booking when the guest presses PayPal again', async () => {
    const client = fakeAdminClient()
    ;(createAdminClient as unknown as Mock).mockReturnValue(client)

    await parkingBookingsPost(websiteRequest() as any)
    const retry = await parkingBookingsPost(websiteRequest() as any)
    const payload = await retry.json()

    expect(retry.status).toBe(201)
    expect(payload).toMatchObject({ data: { booking_id: 'parking-booking-1' } })
    expect(createPendingParkingBooking).toHaveBeenCalledTimes(1)
    expect(createParkingPaymentOrder).toHaveBeenCalledTimes(1)
  })

  it("logs the database's code and message when the claim is refused, not [object Object]", async () => {
    ;(createAdminClient as unknown as Mock).mockReturnValue(
      fakeAdminClient({
        refuseClaimWith: {
          code: '22001',
          message: 'value too long for type character varying(255)',
          details: 'Failing row contains (07700900123, AB12CDE)',
          hint: null,
        },
      })
    )

    const response = await parkingBookingsPost(websiteRequest() as any)

    expect(response.status).toBe(500)
    expect(createPendingParkingBooking).not.toHaveBeenCalled()
    expect(loggerError).toHaveBeenCalledTimes(1)
    const [message, context] = loggerError.mock.calls[0]
    expect(message).toBe('Error creating parking booking via API')
    expect(context.error).toBeInstanceOf(Error)
    expect(context.error.message).toBe('value too long for type character varying(255)')
    expect(context.error).toMatchObject({ code: '22001' })
    // details carries the failing row's values, a guest's phone number among them.
    expect(JSON.stringify(context)).not.toContain('07700900123')
  })
})
