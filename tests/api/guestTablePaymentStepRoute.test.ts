import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hashGuestToken } from '@/lib/guest/tokens'

/**
 * The route the deposit pay page's browser reports its steps to (owner decision,
 * 22 November 2026). It takes the booking from the guest token and from nowhere else, takes only
 * the fixed list of client steps, and answers at once: the write happens after the response, so a
 * write that fails is never the guest's problem.
 */

const state = vi.hoisted(() => ({
  afterTasks: [] as Array<Promise<unknown>>,
  holdAfter: false,
  heldAfter: [] as Array<() => Promise<unknown>>,
  throttleAllowed: true,
  tokens: new Map<string, { customer_id: string; table_booking_id: string | null }>(),
  bookings: new Map<string, { id: string; customer_id: string }>(),
  inserts: [] as Array<Record<string, unknown>>,
  insertError: null as { message: string } | null,
  insertThrows: false,
}))

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  // Stands in for Next running the work once the response has gone.
  after: (work: () => Promise<unknown>) => {
    if (state.holdAfter) state.heldAfter.push(work)
    else state.afterTasks.push(work())
  },
}))

const throttleCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock('@/lib/guest/token-throttle', () => ({
  checkGuestTokenThrottle: async (input: Record<string, unknown>) => {
    throttleCalls.push(input)
    return { allowed: state.throttleAllowed, retryAfterSeconds: 60, remaining: 0 }
  },
}))

const supabaseStub = {
  from(table: string) {
    if (table === 'guest_tokens') {
      return {
        select: () => ({
          eq: (_column: string, hashed: string) => ({
            eq: () => ({ maybeSingle: async () => ({ data: state.tokens.get(hashed) ?? null, error: null }) }),
          }),
        }),
      }
    }
    if (table === 'table_bookings') {
      return {
        select: () => ({
          eq: (_column: string, id: string) => ({
            maybeSingle: async () => ({ data: state.bookings.get(id) ?? null, error: null }),
          }),
        }),
      }
    }
    if (table === 'analytics_events') {
      return {
        insert: async (row: Record<string, unknown>) => {
          if (state.insertThrows) throw new Error('connection reset')
          if (state.insertError) return { error: state.insertError }
          state.inserts.push(row)
          return { error: null }
        },
      }
    }
    throw new Error(`unexpected table ${table}`)
  },
}
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => supabaseStub }))

const alertMoneyNeedsAPerson = vi.hoisted(() => vi.fn(async () => ({ sent: true, duplicate: false })))
vi.mock('@/lib/money-alerts', () => ({ alertMoneyNeedsAPerson }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { POST } = await import('@/app/g/[token]/table-payment/step/route')

const TOKEN = 'raw-payment-token'

function post(body: unknown, token = TOKEN): Promise<Response> {
  const request = new NextRequest(`https://management.example.test/g/${token}/table-payment/step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return POST(request, { params: Promise.resolve({ token }) })
}

async function settle(): Promise<void> {
  await Promise.all(state.afterTasks)
}

beforeEach(() => {
  vi.clearAllMocks()
  state.afterTasks = []
  state.holdAfter = false
  state.heldAfter = []
  state.throttleAllowed = true
  state.inserts = []
  state.insertError = null
  state.insertThrows = false
  throttleCalls.length = 0
  state.tokens.clear()
  state.bookings.clear()
  state.tokens.set(hashGuestToken(TOKEN), { customer_id: 'customer-1', table_booking_id: 'booking-from-token' })
  state.bookings.set('booking-from-token', { id: 'booking-from-token', customer_id: 'customer-1' })
})

describe('POST /g/[token]/table-payment/step', () => {
  it('records a step against the booking the token names', async () => {
    const response = await post({ step: 'paypal_opened' })
    await settle()

    expect(response.status).toBe(204)
    expect(state.inserts).toEqual([
      {
        customer_id: 'customer-1',
        event_booking_id: null,
        table_booking_id: 'booking-from-token',
        private_booking_id: null,
        event_type: 'deposit_pay_paypal_opened',
        metadata: { step: 'paypal_opened', source: 'guest_payment_link' },
      },
    ])
    expect(alertMoneyNeedsAPerson).not.toHaveBeenCalled()
  })

  it('refuses a token that is not a payment link, and records nothing', async () => {
    const response = await post({ step: 'paypal_opened' }, 'not-a-real-token')
    await settle()

    expect(response.status).toBe(404)
    expect(state.inserts).toEqual([])
  })

  it('refuses a token whose booking belongs to another customer', async () => {
    state.bookings.set('booking-from-token', { id: 'booking-from-token', customer_id: 'someone-else' })

    const response = await post({ step: 'paypal_opened' })
    await settle()

    expect(response.status).toBe(404)
    expect(state.inserts).toEqual([])
  })

  it.each([
    ['a made-up step', { step: 'refunded' }],
    ['a step only the server may record', { step: 'paid' }],
    ['no step', {}],
    ['a body that is not JSON', 'step=paypal_opened'],
  ])('refuses %s', async (_name, body) => {
    const response = await post(body)
    await settle()

    expect(response.status).toBe(400)
    expect(state.inserts).toEqual([])
  })

  it('never takes a booking id from the browser', async () => {
    const response = await post({ step: 'cancelled', table_booking_id: 'someone-elses-booking' })
    await settle()

    expect(response.status).toBe(400)
    expect(state.inserts).toEqual([])

    await post({ step: 'cancelled' })
    await settle()
    expect(state.inserts.map((row) => row.table_booking_id)).toEqual(['booking-from-token'])
  })

  it('refuses error detail with fields it does not know, or text that is too long', async () => {
    expect((await post({ step: 'paypal_error', detail: { email: 'guest@example.com' } })).status).toBe(400)
    expect((await post({ step: 'paypal_error', detail: { message: 'x'.repeat(301) } })).status).toBe(400)
    await settle()
    expect(state.inserts).toEqual([])
  })

  it("stores PayPal's own error, field by field, with anything personal taken out, and does not alert", async () => {
    const response = await post({
      step: 'paypal_error',
      detail: {
        name: 'Error',
        code: 'popup_blocked',
        message: 'Window closed for guest@example.com on 07700 900123',
        debugId: 'abc123def',
      },
    })
    await settle()

    expect(response.status).toBe(204)
    expect(state.inserts[0]).toMatchObject({
      event_type: 'deposit_pay_paypal_error',
      table_booking_id: 'booking-from-token',
      metadata: {
        step: 'paypal_error',
        errorName: 'Error',
        errorCode: 'popup_blocked',
        errorMessage: 'Window closed for [REDACTED_EMAIL] on [REDACTED_PHONE]',
        paypalDebugId: 'abc123def',
      },
    })
    expect(alertMoneyNeedsAPerson).not.toHaveBeenCalled()
  })

  it('tells a person when the capture call never answered the browser', async () => {
    await post({ step: 'capture_call_failed', detail: { message: 'Failed to fetch' } })
    await settle()

    expect(state.inserts[0]).toMatchObject({ event_type: 'deposit_pay_capture_call_failed' })
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledTimes(1)
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledWith(
      supabaseStub,
      expect.objectContaining({
        domain: 'table_bookings',
        bookingId: 'booking-from-token',
        kind: 'deposit_pay_fault',
        ttlHours: 1,
      }),
    )
  })

  it('is rate limited per link, under its own scope', async () => {
    state.throttleAllowed = false

    const response = await post({ step: 'buttons_shown' })
    await settle()

    expect(response.status).toBe(429)
    expect(throttleCalls[0]).toMatchObject({ rawToken: TOKEN, scope: 'guest_table_payment_step' })
    expect(state.inserts).toEqual([])
  })

  it('answers before the write has run', async () => {
    state.holdAfter = true

    const response = await post({ step: 'approved' })

    expect(response.status).toBe(204)
    expect(state.inserts).toEqual([])

    await Promise.all(state.heldAfter.map((work) => work()))
    expect(state.inserts).toHaveLength(1)
  })

  it.each([
    ['the database refuses the row', () => { state.insertError = { message: 'permission denied' } }],
    ['the database call throws', () => { state.insertThrows = true }],
  ])('still answers, and throws nothing, when %s', async (_name, arrange) => {
    arrange()

    const response = await post({ step: 'cancelled' })

    expect(response.status).toBe(204)
    await expect(settle()).resolves.toBeUndefined()
    expect(state.inserts).toEqual([])
  })
})
