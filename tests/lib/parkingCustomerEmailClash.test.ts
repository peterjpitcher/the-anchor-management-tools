import { afterAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

/**
 * A guest booking parking with a mobile we have no customer for, and an email that is already on
 * another customer's record, got a 500 and was told to phone (found 19 October 2026). Creating
 * the customer for the new mobile hit the unique index on lower(email), and the recovery only
 * looked the mobile up again.
 *
 * The customers table below refuses a duplicate mobile or email the way production's two unique
 * indexes do, with the error Postgres gives for each (checked against a local Postgres).
 */

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

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

vi.mock('@/lib/parking/capacity', () => ({
  checkParkingCapacity: vi.fn().mockResolvedValue({ remaining: 5 }),
}))

const { insertParkingBooking } = vi.hoisted(() => ({ insertParkingBooking: vi.fn() }))

vi.mock('@/lib/parking/repository', () => ({
  getActiveParkingRate: vi.fn().mockResolvedValue({
    hourly_rate: 5,
    daily_rate: 15,
    weekly_rate: 75,
    monthly_rate: 250,
  }),
  insertParkingBooking,
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { createParkingPaymentOrder } from '@/lib/parking/payments'
import { resolveCustomerByPhone } from '@/lib/parking/customers'
import { POST as parkingBookingsPost } from '@/app/api/parking/bookings/route'

type CustomerRow = {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
  mobile_e164: string | null
  email: string | null
  created_at: string
  [column: string]: unknown
}

type DbError = { code: string; message: string; details: string | null; hint: string | null }

function uniqueViolation(index: string, key: string): DbError {
  return {
    code: '23505',
    message: `duplicate key value violates unique constraint "${index}"`,
    details: `Key ${key} already exists.`,
    hint: null,
  }
}

const lower = (value: unknown): string | null => (typeof value === 'string' ? value.toLowerCase() : null)

/**
 * customers, refusing what production refuses:
 *   idx_customers_mobile_e164  : unique (mobile_e164)
 *   idx_customers_email_unique : unique (lower(email)) where email is not null
 * Supports the query shapes resolveCustomerByPhone uses. `beforeInsert` runs before each insert
 * (numbered from 1), to stand in for a concurrent request or to refuse the insert outright.
 */
function customersTable(
  seed: CustomerRow[],
  options: { beforeInsert?: (attempt: number, rows: CustomerRow[]) => DbError | void } = {}
) {
  const rows: CustomerRow[] = seed.map((row) => ({ ...row }))
  const inserts: Array<Record<string, unknown>> = []

  function violation(candidate: Record<string, unknown>, ownId?: string): DbError | null {
    const others = rows.filter((row) => row.id !== ownId)
    if (candidate.mobile_e164 != null && others.some((row) => row.mobile_e164 === candidate.mobile_e164)) {
      return uniqueViolation('idx_customers_mobile_e164', `(mobile_e164)=(${candidate.mobile_e164})`)
    }
    const email = lower(candidate.email)
    if (email != null && others.some((row) => lower(row.email) === email)) {
      return uniqueViolation('idx_customers_email_unique', `(lower(email::text))=(${email})`)
    }
    return null
  }

  function query() {
    const filters: Array<(row: CustomerRow) => boolean> = []
    let insertRow: Record<string, unknown> | null = null
    let updateValues: Record<string, unknown> | null = null

    const matching = () =>
      rows
        .filter((row) => filters.every((filter) => filter(row)))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))

    const builder = {
      select: () => builder,
      order: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value)
        return builder
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]))
        return builder
      },
      limit: async (count: number) => ({ data: matching().slice(0, count), error: null }),
      insert: (row: Record<string, unknown>) => {
        insertRow = row
        return builder
      },
      update: (values: Record<string, unknown>) => {
        updateValues = values
        return builder
      },
      single: async () => {
        if (!insertRow) throw new Error('single() is only expected after insert()')
        inserts.push({ ...insertRow })
        const refused = options.beforeInsert?.(inserts.length, rows)
        const error = refused ?? violation(insertRow)
        if (error) return { data: null, error }
        const created: CustomerRow = {
          id: `customer-new-${inserts.length}`,
          first_name: null,
          last_name: null,
          mobile_number: null,
          mobile_e164: null,
          email: null,
          created_at: `2026-10-19T18:00:0${inserts.length}Z`,
          ...insertRow,
        }
        rows.push(created)
        return { data: { ...created }, error: null }
      },
      maybeSingle: async () => {
        if (!updateValues) throw new Error('maybeSingle() is only expected after update()')
        const [target] = matching()
        if (!target) return { data: null, error: null }
        const error = violation({ ...target, ...updateValues }, target.id)
        if (error) return { data: null, error }
        Object.assign(target, updateValues)
        return { data: { id: target.id }, error: null }
      },
    }
    return builder
  }

  const client = {
    from(table: string) {
      if (table !== 'customers') throw new Error(`Unexpected table ${table}`)
      return query()
    },
  }

  return { rows, inserts, query, client }
}

/** The customer who already has the email the guest types. */
const EMAIL_OWNER: CustomerRow = {
  id: 'customer-email-owner',
  first_name: 'Margaret',
  last_name: 'Holloway',
  mobile_number: '+447700900001',
  mobile_e164: '+447700900001',
  email: 'Shared.Inbox@Example.com',
  created_at: '2025-01-01T00:00:00Z',
}

const GUEST = {
  first_name: 'Dan',
  last_name: 'Okafor',
  email: 'shared.inbox@example.com',
  mobile_number: '07700 900999',
}

describe('parking booking when the typed email is already on another customer', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  beforeEach(() => {
    vi.clearAllMocks()
    ;(createParkingPaymentOrder as unknown as Mock).mockResolvedValue({
      orderId: 'PAYPAL-ORDER-1',
      approveUrl: 'https://paypal.example/approve',
    })
  })

  afterAll(() => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('books the guest from the website instead of answering 500, leaving the other customer as it was', async () => {
    const customers = customersTable([EMAIL_OWNER])
    const bookingUpdates: Array<Record<string, unknown>> = []
    ;(createAdminClient as unknown as Mock).mockReturnValue({
      from(table: string) {
        if (table === 'customers') return customers.query()
        if (table === 'parking_bookings') {
          // The 30-minute payment window set on a website booking.
          const update = {
            update(values: Record<string, unknown>) {
              bookingUpdates.push(values)
              return update
            },
            eq() {
              return update
            },
            then(resolve: (value: { error: null }) => void) {
              resolve({ error: null })
            },
          }
          return update
        }
        throw new Error(`Unexpected table ${table}`)
      },
    })
    insertParkingBooking.mockImplementation(async (row: Record<string, unknown>) => {
      // sync_parking_customer_name_trigger: the booking takes its name from the customer it is filed under.
      const customer = customers.rows.find((candidate) => candidate.id === row.customer_id)
      return {
        id: 'parking-booking-1',
        reference: 'PAR-20261019-0002',
        ...row,
        customer_first_name: customer?.first_name ?? row.customer_first_name,
        customer_last_name: customer ? customer.last_name : row.customer_last_name,
      }
    })

    // The website always sends an Idempotency-Key; it is left off here because claiming it never
    // touches customers (PR 238 covers that path).
    const response = await parkingBookingsPost(
      new Request('http://localhost/api/parking/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer: GUEST,
          vehicle: { registration: 'AB12 CDE' },
          start_at: '2026-11-10T09:00:00.000Z',
          end_at: '2026-11-12T09:00:00.000Z',
          source: 'website',
        }),
      }) as any
    )
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({
      success: true,
      data: { booking_id: 'parking-booking-1', paypal_order_id: 'PAYPAL-ORDER-1' },
    })
    expect(bookingUpdates).toHaveLength(1)

    // The mobile has a customer of its own, without the email somebody else holds.
    expect(customers.rows).toHaveLength(2)
    const created = customers.rows.find((row) => row.id !== EMAIL_OWNER.id)
    expect(created).toMatchObject({
      first_name: 'Dan',
      last_name: 'Okafor',
      mobile_e164: '+447700900999',
      email: null,
    })

    // The booking carries the guest's own name, mobile and email: texts go to the number typed.
    expect(insertParkingBooking).toHaveBeenCalledTimes(1)
    const booking = await (insertParkingBooking.mock.results[0].value as Promise<Record<string, unknown>>)
    expect(booking).toMatchObject({
      customer_id: created?.id,
      customer_first_name: 'Dan',
      customer_last_name: 'Okafor',
      customer_mobile: '+447700900999',
      customer_email: 'shared.inbox@example.com',
    })

    // The customer who already had the email is untouched.
    expect(customers.rows.find((row) => row.id === EMAIL_OWNER.id)).toEqual(EMAIL_OWNER)
  })

  it('tries the email first, then creates the customer without it', async () => {
    const customers = customersTable([EMAIL_OWNER])

    const result = await resolveCustomerByPhone(customers.client as never, {
      firstName: GUEST.first_name,
      lastName: GUEST.last_name,
      email: GUEST.email,
      phone: GUEST.mobile_number,
    })

    expect(customers.inserts.map((row) => row.email)).toEqual(['shared.inbox@example.com', null])
    expect(result).toMatchObject({ id: 'customer-new-2', mobile_number: '+447700900999' })
    expect(result.email).toBeUndefined()
    expect(errorSpy).not.toHaveBeenCalledWith('Failed to create customer', expect.anything())
    // Logged for us to see, without the guest's email or number.
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warnSpy.mock.calls)).not.toMatch(/shared\.inbox|900999/i)
  })

  it('keeps the email on the new customer when nobody else has it', async () => {
    const customers = customersTable([EMAIL_OWNER])

    const result = await resolveCustomerByPhone(customers.client as never, {
      firstName: GUEST.first_name,
      lastName: GUEST.last_name,
      email: 'dan.okafor@example.com',
      phone: GUEST.mobile_number,
    })

    expect(customers.inserts).toHaveLength(1)
    expect(result.email).toBe('dan.okafor@example.com')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('uses the customer a concurrent request created for the same mobile while it was retrying', async () => {
    const concurrent: CustomerRow = {
      id: 'customer-concurrent',
      first_name: 'Dan',
      last_name: 'Okafor',
      mobile_number: '+447700900999',
      mobile_e164: '+447700900999',
      email: null,
      created_at: '2026-10-19T18:00:00Z',
    }
    const customers = customersTable([EMAIL_OWNER], {
      beforeInsert: (attempt, rows) => {
        if (attempt === 2) rows.push({ ...concurrent })
      },
    })

    const result = await resolveCustomerByPhone(customers.client as never, {
      firstName: GUEST.first_name,
      lastName: GUEST.last_name,
      email: GUEST.email,
      phone: GUEST.mobile_number,
    })

    expect(result.id).toBe('customer-concurrent')
    expect(customers.inserts).toHaveLength(2)
    expect(customers.rows).toHaveLength(2)
  })

  it('does not drop the email for a clash on any other index', async () => {
    const customers = customersTable([EMAIL_OWNER], {
      beforeInsert: () => uniqueViolation('idx_customers_mobile_e164', '(mobile_e164)=(+447700900999)'),
    })

    await expect(
      resolveCustomerByPhone(customers.client as never, {
        firstName: GUEST.first_name,
        lastName: GUEST.last_name,
        email: GUEST.email,
        phone: GUEST.mobile_number,
      })
    ).rejects.toThrow('Failed to create customer')

    expect(customers.inserts).toHaveLength(1)
    expect(customers.rows).toEqual([EMAIL_OWNER])
  })
})
