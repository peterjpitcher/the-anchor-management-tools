import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { EventBookingService } from '@/services/event-bookings'
import {
  FOH_BOOKING_CLIENT_CONTRACT,
  FOH_BOOKING_CLIENT_HEADER,
  FOH_CLIENT_OUTDATED_CODE,
} from '@/lib/foh/booking-client-contract'

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(),
  getLondonDateIso: vi.fn(() => '2026-08-14'),
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/table-bookings/bookings', () => ({
  sendManagerTableBookingCreatedEmailIfAllowed: vi.fn().mockResolvedValue({ sent: true }),
}))
vi.mock('@/lib/utils', () => ({
  formatPhoneForStorage: vi.fn((value: string) => value),
}))
vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone: vi.fn(),
}))
vi.mock('@/services/event-bookings', () => ({
  EventBookingService: {
    normalizeBookingMode: vi.fn(() => 'table'),
    createBooking: vi.fn(),
  },
}))

const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CUSTOMER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const BOOKING_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const TABLE_BOOKING_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function makeRequest(body: Record<string, unknown>, currentClient = true) {
  return new NextRequest('http://localhost/api/foh/event-bookings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(currentClient
        ? { [FOH_BOOKING_CLIENT_HEADER]: FOH_BOOKING_CLIENT_CONTRACT }
        : {}),
    },
    body: JSON.stringify(body),
  })
}

function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn> | unknown> = {}
  const chain = () => builder
  for (const method of ['select', 'update', 'insert', 'eq', 'is']) {
    builder[method] = vi.fn(chain)
  }
  builder.maybeSingle = vi.fn().mockResolvedValue(result)
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result)
  return builder
}

function createSupabaseMock(eventDate: string) {
  const builders: Record<string, Array<ReturnType<typeof makeBuilder>>> = {}
  const from = vi.fn((table: string) => {
    const result = table === 'events'
      ? {
          data: {
            id: EVENT_ID,
            booking_mode: 'table',
            name: 'Cowboys & Queens Country Music Bingo',
            date: eventDate,
            start_datetime: `${eventDate}T18:00:00+00:00`,
          },
          error: null,
        }
      : table === 'customers'
        ? {
            data: {
              id: CUSTOMER_ID,
              mobile_e164: null,
              mobile_number: null,
              email: null,
            },
            error: null,
          }
        : table === 'table_bookings'
          ? { data: { id: TABLE_BOOKING_ID }, error: null }
          : { data: null, error: null }
    const builder = makeBuilder(result)
    builders[table] = [...(builders[table] || []), builder]
    return builder
  })
  return { from, builders }
}

function mockAuth(db: ReturnType<typeof createSupabaseMock>) {
  vi.mocked(requireFohPermission).mockResolvedValueOnce({
    ok: true,
    userId: 'user-1',
    supabase: db as unknown as Awaited<ReturnType<typeof requireFohPermission>>['supabase'],
  } as unknown as Awaited<ReturnType<typeof requireFohPermission>>)
}

function mockConfirmedBooking() {
  vi.mocked(EventBookingService.createBooking).mockResolvedValueOnce({
    rpcFailed: false,
    rollbackFailed: false,
    paymentLinkFailed: false,
    resolvedState: 'confirmed',
    resolvedReason: null,
    bookingId: BOOKING_ID,
    seatsRemaining: 20,
    nextStepUrl: null,
    manageUrl: null,
    smsMeta: null,
    tableBookingId: TABLE_BOOKING_ID,
    tableName: 'Low 4a',
    eventSeatingType: 'seated',
    rpcResult: {
      state: 'confirmed',
      event_name: 'Cowboys & Queens Country Music Bingo',
      payment_mode: 'cash_only',
      booking_id: BOOKING_ID,
    },
  } as never)
}

describe('POST /api/foh/event-bookings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects an outdated FOH screen before it can create a placeholder customer', async () => {
    const db = createSupabaseMock('2026-08-14')
    mockAuth(db)

    const response = await POST(makeRequest({ walk_in: true }, false))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: FOH_CLIENT_OUTDATED_CODE,
      refresh_required: true,
    })
    expect(EventBookingService.createBooking).not.toHaveBeenCalled()
  })

  it('keeps the selected customer on a named walk-in', async () => {
    const db = createSupabaseMock('2026-08-14')
    mockAuth(db)
    mockConfirmedBooking()

    const response = await POST(makeRequest({
      customer_mode: 'selected',
      customer_id: CUSTOMER_ID,
      event_id: EVENT_ID,
      seats: 3,
      walk_in: true,
    }))

    expect(response.status).toBe(201)
    expect(EventBookingService.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: CUSTOMER_ID,
        source: 'walk-in',
      }),
    )
  })

  it('rejects selected-customer intent when the id is missing', async () => {
    const db = createSupabaseMock('2026-08-14')
    mockAuth(db)

    const response = await POST(makeRequest({
      customer_mode: 'selected',
      event_id: EVENT_ID,
      seats: 3,
      walk_in: true,
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/selected customer was not included/i),
    })
    expect(EventBookingService.createBooking).not.toHaveBeenCalled()
  })

  it('rejects a future event walk-in and tells staff to create a booking', async () => {
    const db = createSupabaseMock('2026-08-15')
    mockAuth(db)
    mockConfirmedBooking()

    const response = await POST(makeRequest({
      customer_mode: 'selected',
      customer_id: CUSTOMER_ID,
      event_id: EVENT_ID,
      seats: 3,
      walk_in: true,
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/use add booking/i),
    })
    expect(EventBookingService.createBooking).not.toHaveBeenCalled()
    expect(db.builders.table_bookings).toBeUndefined()
  })
})
