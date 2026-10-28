import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The public table booking route when something it depends on fails (BK-039, BK-127 and BK-128,
 * customer bookings review of 24 October 2026). Each test makes one dependency fail and checks
 * what the website reads (status and code), what happens to the idempotency claim, and that the
 * failure is logged as an error.
 *
 * The idempotency module is the REAL one, over an in-memory idempotency_keys table, so the retry
 * test exercises the same claim, mark and replay code production runs.
 */

const {
  ensureCustomerForPhone,
  createTablePaymentToken,
  sendTableBookingCreatedSmsIfAllowed,
  applyBookingContactConsent,
  alertMoneyNeedsAPerson,
  warn,
  error,
} = vi.hoisted(() => ({
  ensureCustomerForPhone: vi.fn(),
  createTablePaymentToken: vi.fn(),
  sendTableBookingCreatedSmsIfAllowed: vi.fn(),
  applyBookingContactConsent: vi.fn(),
  alertMoneyNeedsAPerson: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/lib/phone/uk-mobile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/phone/uk-mobile')>()),
  isUkMobile: () => true,
}))
vi.mock('@/lib/table-bookings/christmas-one-course', () => ({
  recordOneCourseInsideCutoff: vi.fn().mockResolvedValue('not_needed'),
  oneCourseForEveryone: (partySize: number) => Array.from({ length: partySize }, () => 1),
}))
const limitBookingAttempt = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/booking-rate-limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/booking-rate-limits')>()),
  limitBookingAttempt,
}))
vi.mock('@/lib/api/auth', () => ({
  getApiKeyAuthState: vi.fn().mockResolvedValue('authenticated'),
  withApiAuth: vi.fn(
    async (handler: (request: Request) => Promise<Response>, _permissions: string[], request: Request) =>
      handler(request),
  ),
  createApiResponse: (payload: unknown, status = 200) => Response.json(payload, { status }),
  createErrorResponse: (message: string, code: string, status: number) =>
    Response.json({ success: false, error: { code, message } }, { status }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/sms/customers', () => ({ ensureCustomerForPhone }))
vi.mock('@/lib/utils', () => ({ formatPhoneForStorage: vi.fn((value: string) => value) }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/bookings/contact-email', () => ({ recordBookingContactEmail: vi.fn() }))
vi.mock('@/services/consent', () => ({ ConsentService: { applyBookingContactConsent } }))
vi.mock('@/lib/money-alerts', () => ({ alertMoneyNeedsAPerson }))
vi.mock('@/lib/table-bookings/bookings', () => ({
  alignTablePaymentHoldToScheduledSend: vi.fn(async () => undefined),
  createTablePaymentToken,
  mapTableBookingBlockedReason: vi.fn((reason?: string) => reason ?? null),
  sendTableBookingCreatedSmsIfAllowed,
  chargedDepositAmount: (bookingResult: { deposit_amount?: number | null }, fallback: () => number) => {
    const charged = Number(bookingResult.deposit_amount)
    return Number((Number.isFinite(charged) && charged > 0 ? charged : fallback()).toFixed(2))
  },
}))
vi.mock('@/lib/logger', () => ({ logger: { warn, error, info: vi.fn() } }))

import { createAdminClient } from '@/lib/supabase/admin'
import { POST } from '@/app/api/table-bookings/route'

const BOOKING_ID = '11111111-1111-4111-8111-111111111111'

type IdemRow = { key: string; request_hash: string; response: unknown; expires_at: string | null }

/**
 * Just enough of supabase-js for the idempotency module, the booking RPC and the cancel update.
 * Filters are applied to the in-memory idempotency rows the way Postgres would.
 */
function buildSupabase(options: {
  rpcResult: Record<string, unknown>
  failResponseStore?: boolean
  failCancel?: boolean
}) {
  const idem = new Map<string, IdemRow>()
  const rpc = vi.fn(async () => ({ data: options.rpcResult, error: null }))
  const tableBookingUpdates: Array<Record<string, unknown>> = []

  function matches(row: IdemRow, filters: Array<[string, string, unknown]>): boolean {
    return filters.every(([column, op, value]) => {
      const actual =
        column === 'response->>state'
          ? (row.response as { state?: string } | null)?.state ?? null
          : column === 'response->>claimed_at'
            ? (row.response as { claimed_at?: string } | null)?.claimed_at ?? null
            : (row as unknown as Record<string, unknown>)[column]
      if (op === 'eq') return actual === value
      if (op === 'is') return actual === null
      if (op === 'lt') return typeof actual === 'string' && actual < String(value)
      return false
    })
  }

  function idempotencyTable() {
    let mode: 'select' | 'update' | 'delete' = 'select'
    let patch: Partial<IdemRow> = {}
    const filters: Array<[string, string, unknown]> = []

    const run = () => {
      const rows = Array.from(idem.values()).filter((row) => matches(row, filters))
      if (mode === 'update') {
        for (const row of rows) Object.assign(row, patch)
      }
      if (mode === 'delete') {
        for (const row of rows) idem.delete(row.key)
      }
      return rows
    }

    const builder: Record<string, unknown> = {
      insert: async (payload: IdemRow) => {
        if (idem.has(payload.key)) return { error: { code: '23505' } }
        idem.set(payload.key, { ...payload })
        return { error: null }
      },
      upsert: async (payload: IdemRow) => {
        if (options.failResponseStore) return { error: { message: 'statement timeout' } }
        idem.set(payload.key, { ...payload })
        return { error: null }
      },
      select: () => builder,
      update: (payload: Partial<IdemRow>) => {
        mode = 'update'
        patch = payload
        return builder
      },
      delete: () => {
        mode = 'delete'
        return builder
      },
      eq: (column: string, value: unknown) => {
        filters.push([column, 'eq', value])
        return builder
      },
      lt: (column: string, value: unknown) => {
        filters.push([column, 'lt', value])
        return builder
      },
      filter: (column: string, op: string, value: unknown) => {
        filters.push([column, op, value])
        return builder
      },
      maybeSingle: async () => {
        const rows = run()
        return { data: rows[0] ? { ...rows[0] } : null, error: null }
      },
      then: (resolve: (value: unknown) => unknown) => {
        run()
        return Promise.resolve({ error: null }).then(resolve)
      },
    }
    return builder
  }

  function tableBookingsTable() {
    const builder: Record<string, unknown> = {}
    let patch: Record<string, unknown> = {}
    Object.assign(builder, {
      update: (payload: Record<string, unknown>) => {
        patch = payload
        tableBookingUpdates.push(payload)
        return builder
      },
      eq: () => builder,
      select: () => builder,
      maybeSingle: async () =>
        options.failCancel || patch.status !== 'cancelled'
          ? { data: null, error: options.failCancel ? { message: 'deadlock detected' } : null }
          : { data: { id: BOOKING_ID }, error: null },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
    })
    return builder
  }

  return {
    client: {
      from: vi.fn((table: string) => {
        if (table === 'idempotency_keys') return idempotencyTable()
        if (table === 'table_bookings') return tableBookingsTable()
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    },
    idem,
    rpc,
    tableBookingUpdates,
  }
}

function buildRequest(body: Record<string, unknown> = {}): Request {
  return new Request('http://localhost/api/table-bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'test-key', 'idempotency-key': 'idem-table-1' },
    body: JSON.stringify({
      phone: '+447700900123',
      first_name: 'Pat',
      date: '2026-12-05',
      time: '18:00',
      party_size: 4,
      purpose: 'food',
      communication_consent: { service_contact_notice_shown: true },
      ...body,
    }),
  })
}

const CONFIRMED = { state: 'confirmed', table_booking_id: BOOKING_ID, booking_reference: 'TB-1', table_name: 'T1' }
const PENDING = {
  state: 'pending_payment',
  table_booking_id: BOOKING_ID,
  booking_reference: 'TB-2',
  hold_expires_at: '2026-12-04T18:00:00.000Z',
  deposit_amount: 160,
  table_name: 'T2',
}

async function body(response: Response): Promise<{ success?: boolean; data?: Record<string, unknown>; error?: { code?: string } }> {
  return response.json()
}

describe('POST /api/table-bookings when a dependency fails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureCustomerForPhone.mockResolvedValue({ customerId: 'cust-1' })
    createTablePaymentToken.mockResolvedValue({ url: 'https://management.example/g/token/table-payment' })
    sendTableBookingCreatedSmsIfAllowed.mockResolvedValue({ sms: null, notificationChannel: 'sms', notificationSent: true })
    applyBookingContactConsent.mockResolvedValue(undefined)
    alertMoneyNeedsAPerson.mockResolvedValue({ sent: true, duplicate: false })
    limitBookingAttempt.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts every caller per guest phone across servers, and refuses with 429 before any work (BK-108)', async () => {
    const supabase = buildSupabase({ rpcResult: CONFIRMED })
    vi.mocked(createAdminClient).mockReturnValue(supabase.client as never)
    limitBookingAttempt.mockImplementation(async (_request: unknown, options: { prefix: string }) =>
      options.prefix === 'table-booking-guest'
        ? Response.json({ success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many' } }, { status: 429 })
        : null
    )

    const response = await POST(buildRequest() as never)

    expect(response.status).toBe(429)
    expect((await body(response)).error?.code).toBe('RATE_LIMIT_EXCEEDED')
    expect(limitBookingAttempt).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      prefix: 'table-booking-guest', subject: '+447700900123', max: 20,
    }))
    // The website's key is authenticated, so it is never put in the shared per-IP bucket.
    expect(limitBookingAttempt).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ prefix: 'table-booking-ip' }))
    expect(supabase.idem.size).toBe(0)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('answers 500 CUSTOMER_RESOLUTION_FAILED, releases the claim and logs an error when the customer cannot be made', async () => {
    const supabase = buildSupabase({ rpcResult: CONFIRMED })
    vi.mocked(createAdminClient).mockReturnValue(supabase.client as never)
    ensureCustomerForPhone.mockResolvedValue({ customerId: null })

    const response = await POST(buildRequest() as never)

    expect(response.status).toBe(500)
    expect((await body(response)).error?.code).toBe('CUSTOMER_RESOLUTION_FAILED')
    expect(supabase.idem.size).toBe(0)
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('Table booking could not find or create the customer', expect.anything())
  })

  it('still confirms the booking, sends the confirmation and tells the manager when the consent write throws', async () => {
    const supabase = buildSupabase({ rpcResult: CONFIRMED })
    vi.mocked(createAdminClient).mockReturnValue(supabase.client as never)
    applyBookingContactConsent.mockRejectedValue(new Error('customer_consents insert failed'))

    const response = await POST(buildRequest() as never)

    expect(response.status).toBe(201)
    expect((await body(response)).data).toMatchObject({ state: 'confirmed', table_booking_id: BOOKING_ID, notification_sent: true })
    expect(sendTableBookingCreatedSmsIfAllowed).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledWith('Booking saved but the guest contact choices did not record', expect.anything())
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      domain: 'table_bookings', bookingId: BOOKING_ID, kind: 'consent_not_recorded',
    }))
    // The answer is stored, so a retry replays it rather than being told "already processing".
    expect((supabase.idem.get('idem-table-1')?.response as { success?: boolean })?.success).toBe(true)
  })

  it('cancels the unpaid booking, releases the claim and answers PAYMENT_LINK_FAILED when the payment link fails', async () => {
    const supabase = buildSupabase({ rpcResult: PENDING })
    vi.mocked(createAdminClient).mockReturnValue(supabase.client as never)
    createTablePaymentToken.mockRejectedValue(new Error('guest_tokens insert failed'))

    const response = await POST(buildRequest({ party_size: 16 }) as never)

    expect(response.status).toBe(500)
    expect((await body(response)).error?.code).toBe('PAYMENT_LINK_FAILED')
    expect(supabase.tableBookingUpdates).toContainEqual(expect.objectContaining({
      status: 'cancelled', cancellation_reason: 'payment_link_generation_failed', hold_expires_at: null,
    }))
    expect(supabase.idem.size).toBe(0)
    expect(sendTableBookingCreatedSmsIfAllowed).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('Failed to create table payment token; cancelling the pending booking', expect.anything())
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: 'payment_link_failed_cancelled', bookingId: BOOKING_ID,
    }))
  })

  it('keeps the claim, stores the answer and tells the manager when the booking cannot be cancelled either', async () => {
    const supabase = buildSupabase({ rpcResult: PENDING, failCancel: true })
    vi.mocked(createAdminClient).mockReturnValue(supabase.client as never)
    createTablePaymentToken.mockRejectedValue(new Error('guest_tokens insert failed'))

    const response = await POST(buildRequest({ party_size: 16 }) as never)

    expect(response.status).toBe(500)
    expect((await body(response)).error?.code).toBe('PAYMENT_LINK_FAILED_BOOKING_HELD')
    const stored = supabase.idem.get('idem-table-1')?.response as { error?: { code?: string } }
    expect(stored?.error?.code).toBe('PAYMENT_LINK_FAILED_BOOKING_HELD')
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: 'payment_link_failed_held',
    }))

    // A retry is told the same thing rather than booking a second table.
    const retry = await POST(buildRequest({ party_size: 16 }) as never)
    expect(retry.status).toBe(500)
    expect((await body(retry)).error?.code).toBe('PAYMENT_LINK_FAILED_BOOKING_HELD')
    expect(supabase.rpc).toHaveBeenCalledOnce()
  })

  it('replays the saved booking, and never books twice, when the answer could not be stored and the guest retries 11 minutes later', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T12:00:00Z'))
    const supabase = buildSupabase({ rpcResult: CONFIRMED, failResponseStore: true })
    vi.mocked(createAdminClient).mockReturnValue(supabase.client as never)

    const first = await POST(buildRequest() as never)
    expect(first.status).toBe(201)
    expect(error).toHaveBeenCalledWith('Failed to persist table booking idempotency response', expect.anything())

    // Within ten minutes the first request may still be running, so the retry is asked to wait.
    vi.setSystemTime(new Date('2026-11-01T12:05:00Z'))
    const early = await POST(buildRequest() as never)
    expect(early.status).toBe(409)

    // After that the claim is stale: the old code handed the key to a new attempt and booked again.
    vi.setSystemTime(new Date('2026-11-01T12:11:00Z'))
    const late = await POST(buildRequest() as never)

    expect(late.status).toBe(201)
    expect((await body(late)).data).toMatchObject({ state: 'confirmed', table_booking_id: BOOKING_ID })
    expect(supabase.rpc).toHaveBeenCalledOnce()
  })
})
