import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { NextRequest } from 'next/server'
import {
  schemaCheckedTable,
  type SchemaCheckedError,
  type SchemaCheckedTable,
} from '../helpers/schemaCheckedTable'

/**
 * A front of house booking for a customer picked from the list saves what staff typed at the till
 * back onto that customer: an email when the customer has none, a phone number when one is missing.
 *
 * Both routes sent `updated_at` with those updates. `customers` has never had that column, so
 * PostgREST refused the whole update with PGRST204. The email was dropped behind a warning that
 * does not print in production, and the phone number answered 500 and stopped the booking. The
 * mocked clients in the other FOH tests accept any column, so nothing failed.
 *
 * `customers` here is a stand-in that refuses a column the real table does not have.
 */

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(),
  getLondonDateIso: vi.fn(() => '2026-06-28'),
}))

vi.mock('@/lib/sms/customers', () => ({ ensureCustomerForPhone: vi.fn() }))

vi.mock('@/lib/table-bookings/bookings', () => ({
  alignTablePaymentHoldToScheduledSend: vi.fn(),
  createTablePaymentToken: vi.fn().mockResolvedValue({ url: 'https://example.com/pay' }),
  mapTableBookingBlockedReason: vi.fn(() => 'no_table'),
  sendTableBookingCreatedSmsIfAllowed: vi.fn(),
}))

vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))

vi.mock('@/lib/events/sunday-lunch-only-policy', () => ({
  isSundayLunchOnlyEvent: vi.fn().mockReturnValue(false),
  SUNDAY_LUNCH_ONLY_EVENT_MESSAGE: 'Sunday lunch only',
}))

vi.mock('@/services/event-bookings', () => ({
  EventBookingService: { createBooking: vi.fn(), normalizeBookingMode: () => 'general' },
}))

import { logger } from '@/lib/logger'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { sendTableBookingCreatedSmsIfAllowed } from '@/lib/table-bookings/bookings'
import { EventBookingService } from '@/services/event-bookings'
import { POST as createTableBooking } from '@/app/api/foh/bookings/route'
import { POST as createEventBooking } from '@/app/api/foh/event-bookings/route'
import { FOH_BOOKING_CLIENT_CONTRACT, FOH_BOOKING_CLIENT_HEADER } from '@/lib/foh/booking-client-contract'

const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222'
const EVENT_ID = '11111111-1111-4111-8111-111111111111'

const HEADERS = {
  'content-type': 'application/json',
  [FOH_BOOKING_CLIENT_HEADER]: FOH_BOOKING_CLIENT_CONTRACT,
}

function signInWith(customers: SchemaCheckedTable): void {
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'customers') return customers.query()
      if (table === 'events') {
        const event = { id: EVENT_ID, booking_mode: 'general', name: 'Quiz Night', date: '2026-06-28', start_datetime: '2026-06-28T19:00:00Z' }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: event, error: null }) }) }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc: vi.fn(async (fn: string) => {
      if (fn === 'create_table_booking_staff_v06') {
        return {
          data: {
            state: 'confirmed',
            table_booking_id: 'tb-1',
            booking_reference: 'TB-1',
            start_datetime: '2026-06-28T12:30:00.000Z',
            party_size: 2,
            table_name: 'A',
          },
          error: null,
        }
      }
      throw new Error(`Unexpected rpc: ${fn}`)
    }),
  }

  ;(requireFohPermission as unknown as Mock).mockResolvedValue({ ok: true, userId: 'user-1', supabase })
}

type Contact = { email?: string; phone?: string }

const ROUTES = [
  {
    name: 'table booking',
    emailLogMessage: 'Failed to backfill selected customer email for FOH booking',
    async book(contact: Contact): Promise<Response> {
      const request = new Request('http://localhost/api/foh/bookings', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          customer_mode: 'selected',
          customer_id: CUSTOMER_ID,
          date: '2026-06-28',
          time: '13:30',
          party_size: 2,
          purpose: 'food',
          ...contact,
        }),
      })
      return createTableBooking(Object.assign(request, { nextUrl: new URL(request.url) }) as any)
    },
  },
  {
    name: 'event booking',
    emailLogMessage: 'Failed to backfill selected customer email for FOH event booking',
    async book(contact: Contact): Promise<Response> {
      const request = new NextRequest('http://localhost/api/foh/event-bookings', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          customer_mode: 'selected',
          customer_id: CUSTOMER_ID,
          event_id: EVENT_ID,
          seats: 2,
          ...contact,
        }),
      })
      return createEventBooking(request as any)
    },
  },
]

describe.each(ROUTES)('FOH $name for a selected customer', ({ book, emailLogMessage }) => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(sendTableBookingCreatedSmsIfAllowed as unknown as Mock).mockResolvedValue({ sms: null })
    ;(EventBookingService.createBooking as unknown as Mock).mockResolvedValue({
      resolvedState: 'confirmed',
      resolvedReason: null,
      bookingId: 'booking-1',
      seatsRemaining: 10,
      nextStepUrl: null,
      manageUrl: 'https://example.com/manage',
      smsMeta: null,
      tableBookingId: null,
      tableName: null,
      eventSeatingType: null,
      rpcResult: { payment_mode: 'free', event_name: 'Quiz Night' },
    })
  })

  it('saves a typed email onto a customer who has none', async () => {
    const customers = schemaCheckedTable('customers', [
      { id: CUSTOMER_ID, mobile_e164: '+447700900111', mobile_number: '+447700900111', email: null },
    ])
    signInWith(customers)

    const response = await book({ email: 'Pat@Example.com' })

    expect(customers.log.map((query) => query.error)).toEqual([null, null])
    expect(customers.rows[0].email).toBe('pat@example.com')
    expect(response.status).toBe(201)
    expect(logger.warn).not.toHaveBeenCalledWith(emailLogMessage, expect.anything())
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('saves a typed phone number onto a customer who has none, and still books', async () => {
    const customers = schemaCheckedTable('customers', [
      { id: CUSTOMER_ID, mobile_e164: null, mobile_number: null, email: 'pat@example.com' },
    ])
    signInWith(customers)

    const response = await book({ phone: '+447700900222' })

    expect(customers.log.map((query) => query.error)).toEqual([null, null])
    expect(customers.rows[0]).toMatchObject({ mobile_e164: '+447700900222', mobile_number: '+447700900222' })
    expect(response.status).toBe(201)
  })

  it('still books, quietly, when another customer already owns the email', async () => {
    const taken: SchemaCheckedError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_customers_email_unique"',
    }
    const customers = schemaCheckedTable(
      'customers',
      [{ id: CUSTOMER_ID, mobile_e164: '+447700900111', mobile_number: '+447700900111', email: null }],
      { refuseUpdate: () => taken },
    )
    signInWith(customers)

    const response = await book({ email: 'pat@example.com' })

    expect(response.status).toBe(201)
    expect(customers.rows[0].email).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(emailLogMessage, expect.anything())
    expect(logger.error).not.toHaveBeenCalled()
  })

  // logger.warn does not print in production, so a failure that is our fault has to be an error.
  it('still books, and logs an error, when the email cannot be saved for any other reason', async () => {
    const customers = schemaCheckedTable(
      'customers',
      [{ id: CUSTOMER_ID, mobile_e164: '+447700900111', mobile_number: '+447700900111', email: null }],
      { refuseUpdate: () => ({ code: '42501', message: 'permission denied for table customers' }) },
    )
    signInWith(customers)

    const response = await book({ email: 'pat@example.com' })

    expect(response.status).toBe(201)
    expect(logger.error).toHaveBeenCalledWith(
      emailLogMessage,
      expect.objectContaining({
        metadata: expect.objectContaining({ customerId: CUSTOMER_ID, error: 'permission denied for table customers' }),
      }),
    )
  })
})
