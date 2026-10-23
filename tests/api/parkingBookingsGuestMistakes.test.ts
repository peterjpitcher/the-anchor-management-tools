import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// A guest's typing mistake (a mobile number that cannot be a phone number, a stay under the
// 30-minute minimum, a surname of only spaces) fell through the route's error mapping and came
// back as a 500 INTERNAL_ERROR (found 19 October 2026). These run the real booking service and
// customer resolver, so the messages they throw are the ones the route has to recognise.

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
import { ConsentService } from '@/services/consent'
import { createParkingPaymentOrder } from '@/lib/parking/payments'
import { POST as parkingBookingsPost } from '@/app/api/parking/bookings/route'

type CustomerRow = {
  id: string
  first_name: string
  last_name: string | null
  mobile_number: string
  mobile_e164: string
  email: string | null
}

type StoredKey = { key: string; request_hash: string; response: unknown; expires_at: string }

/**
 * Just enough of the admin client for this route and the real customer resolver: a customers
 * table holding at most one customer, the parking_bookings expiry update, and idempotency_keys.
 */
function fakeAdminClient(options: { onFile?: CustomerRow } = {}) {
  const customerInserts: Array<Record<string, unknown>> = []
  const keys = new Map<string, StoredKey>()

  const customers = () => {
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      order: () => query,
      limit: async () => ({ data: options.onFile ? [options.onFile] : [], error: null }),
      insert: (row: Record<string, unknown>) => {
        customerInserts.push(row)
        // customers.last_name is NOT NULL with no default, as in production.
        const result =
          row.last_name == null
            ? {
                data: null,
                error: {
                  code: '23502',
                  message: 'null value in column "last_name" of relation "customers" violates not-null constraint',
                },
              }
            : { data: { id: 'customer-new', ...row }, error: null }
        return { select: () => ({ single: async () => result }) }
      },
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

  const idempotencyKeys = () => {
    const filters: Array<(row: StoredKey) => boolean> = []
    let mode: 'select' | 'delete' = 'select'
    const query = {
      insert(row: StoredKey) {
        if (keys.has(row.key)) {
          return { error: { code: '23505', message: 'duplicate key value', details: null, hint: null } }
        }
        keys.set(row.key, { ...row })
        return { error: null }
      },
      upsert(row: StoredKey) {
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

  return {
    customerInserts,
    keys,
    from(table: string) {
      if (table === 'customers') return customers()
      if (table === 'parking_bookings') return parkingBookings()
      if (table === 'idempotency_keys') return idempotencyKeys()
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

type Overrides = {
  customer?: Partial<{ first_name: string; last_name: string; mobile_number: string }>
  start_at?: string
  end_at?: string
}

function bookingRequest(overrides: Overrides = {}, headers: Record<string, string> = {}): Request {
  const body = {
    customer: { first_name: 'Pat', last_name: 'Example', mobile_number: '07700900123', ...overrides.customer },
    vehicle: { registration: 'AB12CDE' },
    start_at: overrides.start_at ?? '2026-10-20T06:00:00.000Z',
    end_at: overrides.end_at ?? '2026-10-27T18:00:00.000Z',
    source: 'website',
    communication_consent: consent,
  }
  return new Request('http://localhost/api/parking/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const onFile: CustomerRow = {
  id: 'customer-on-file',
  first_name: 'Pat',
  last_name: 'Example',
  mobile_number: '+447700900123',
  mobile_e164: '+447700900123',
  email: null,
}

async function post(request: Request) {
  const response = await parkingBookingsPost(request as any)
  return { status: response.status, payload: await response.json() }
}

describe('parking booking API: guest typing mistakes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    ;(getActiveParkingRate as unknown as Mock).mockResolvedValue({
      hourly_rate: 5,
      daily_rate: 15,
      weekly_rate: 75,
      monthly_rate: 250,
    })
    ;(checkParkingCapacity as unknown as Mock).mockResolvedValue({ remaining: 5, capacity: 10, active: 5 })
    ;(insertParkingBooking as unknown as Mock).mockImplementation(async (payload: Record<string, unknown>) => ({
      ...payload,
      id: 'parking-booking-1',
      reference: 'PAR-20261019-0001',
    }))
    ;(ConsentService.applyBookingContactConsent as unknown as Mock).mockResolvedValue(undefined)
    ;(createParkingPaymentOrder as unknown as Mock).mockResolvedValue({
      orderId: 'PAYPAL-ORDER-1',
      approveUrl: 'https://paypal.example/approve',
    })
  })

  it('answers 400 for a mobile number that cannot be a phone number, before claiming or reading anything', async () => {
    const client = fakeAdminClient()
    ;(createAdminClient as unknown as Mock).mockReturnValue(client)

    // A mobile cut short. formatPhoneForStorage throws 'Invalid phone number format' for it.
    const { status, payload } = await post(
      bookingRequest({ customer: { mobile_number: '07700' } }, { 'Idempotency-Key': 'website-key-1' })
    )

    expect(status).toBe(400)
    // The wording every other public booking route uses for the same mistake.
    expect(payload).toEqual({ success: false, error: 'Please enter a valid phone number', code: 'VALIDATION_ERROR' })
    expect(client.keys.size).toBe(0)
    expect(getActiveParkingRate).not.toHaveBeenCalled()
    expect(client.customerInserts).toHaveLength(0)
    expect(insertParkingBooking).not.toHaveBeenCalled()
    expect(loggerError).not.toHaveBeenCalled()
  })

  it('answers 400 for a stay under 30 minutes, and books nothing', async () => {
    const client = fakeAdminClient()
    ;(createAdminClient as unknown as Mock).mockReturnValue(client)

    const { status, payload } = await post(
      bookingRequest({ start_at: '2026-10-20T09:00:00.000Z', end_at: '2026-10-20T09:20:00.000Z' })
    )

    expect(status).toBe(400)
    expect(payload).toEqual({
      success: false,
      error: 'Parking must be booked for at least 30 minutes',
      code: 'VALIDATION_ERROR',
    })
    expect(client.customerInserts).toHaveLength(0)
    expect(insertParkingBooking).not.toHaveBeenCalled()
    expect(loggerError).not.toHaveBeenCalled()
  })

  it('answers 400 for a new guest whose surname is only spaces, without trying to add them', async () => {
    const client = fakeAdminClient()
    ;(createAdminClient as unknown as Mock).mockReturnValue(client)

    const { status, payload } = await post(bookingRequest({ customer: { last_name: '   ' } }))

    expect(status).toBe(400)
    expect(payload).toEqual({ success: false, error: 'Please enter your surname', code: 'VALIDATION_ERROR' })
    // The insert this replaces is the one customers.last_name NOT NULL refused.
    expect(client.customerInserts).toHaveLength(0)
    expect(insertParkingBooking).not.toHaveBeenCalled()
    expect(loggerError).not.toHaveBeenCalled()
  })

  it('still books a guest already on file whose surname is only spaces', async () => {
    const client = fakeAdminClient({ onFile })
    ;(createAdminClient as unknown as Mock).mockReturnValue(client)

    const { status, payload } = await post(bookingRequest({ customer: { last_name: '   ' } }))

    expect(status).toBe(201)
    expect(payload).toMatchObject({ success: true, data: { booking_id: 'parking-booking-1' } })
    expect(client.customerInserts).toHaveLength(0)
    expect(insertParkingBooking).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: 'customer-on-file', customer_last_name: null }),
      client
    )
  })

  it('releases the idempotency claim, so the corrected booking goes through on the same key', async () => {
    const client = fakeAdminClient()
    ;(createAdminClient as unknown as Mock).mockReturnValue(client)
    // The surname is not part of the website's key, so the corrected request presents the same one.
    const headers = { 'Idempotency-Key': 'website-key-1' }

    const first = await post(bookingRequest({ customer: { last_name: ' ' } }, headers))
    expect(first.status).toBe(400)
    expect(client.keys.size).toBe(0)

    const corrected = await post(bookingRequest({ customer: { last_name: 'Example' } }, headers))
    expect(corrected.status).toBe(201)
    expect(corrected.payload).toMatchObject({ data: { booking_id: 'parking-booking-1' } })
    expect(client.customerInserts).toEqual([expect.objectContaining({ last_name: 'Example' })])
  })

  it('still answers 500 for a fault that is ours, not the guest', async () => {
    const client = fakeAdminClient()
    ;(createAdminClient as unknown as Mock).mockReturnValue(client)
    ;(checkParkingCapacity as unknown as Mock).mockRejectedValue(
      new Error('Failed to check parking capacity: connection reset')
    )

    const { status, payload } = await post(bookingRequest())

    expect(status).toBe(500)
    expect(payload).toEqual({ success: false, error: 'Failed to create parking booking', code: 'INTERNAL_ERROR' })
    expect(loggerError).toHaveBeenCalledWith('Error creating parking booking via API', expect.any(Object))
  })
})
