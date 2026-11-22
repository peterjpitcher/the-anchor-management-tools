import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The deposit pay page's alert and its rules (owner decision, 22 November 2026): a fault on our
 * side reaches the manager at most once an hour for a booking; a guest changing their mind or a
 * bank saying no is recorded and nothing more.
 *
 * The throttle runs against the real claim logic in `@/lib/api/idempotency` over an in-memory
 * `idempotency_keys` table, because the hour depends on an expired claim being taken again there.
 */

const reportPaymentAlert = vi.hoisted(() => vi.fn())
vi.mock('@/lib/cron/alerting', () => ({ reportPaymentAlert }))
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  getAppUrl: () => 'https://management.example.test',
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/guest/token-throttle', () => ({ checkGuestTokenThrottle: async () => ({ allowed: true }) }))

type Row = { key: string; request_hash: string; response: unknown; expires_at: string }
type Filter = (row: Row) => boolean

/** Just enough of PostgREST for the idempotency module: one table, keyed on `key`. */
function idempotencyStore() {
  const rows = new Map<string, Row>()

  function chain(action: 'select' | 'update' | 'delete', patch?: Partial<Row>) {
    const filters: Filter[] = []
    const matching = (): Row[] => [...rows.values()].filter((row) => filters.every((filter) => filter(row)))
    const run = (): Row[] => {
      const found = matching()
      if (action === 'update') found.forEach((row) => rows.set(row.key, { ...row, ...patch }))
      if (action === 'delete') found.forEach((row) => rows.delete(row.key))
      return found
    }
    const builder = {
      eq(column: keyof Row, value: unknown) {
        filters.push((row) => row[column] === value)
        return builder
      },
      lt(column: keyof Row, value: string) {
        filters.push((row) => String(row[column]) < value)
        return builder
      },
      select() {
        return builder
      },
      async maybeSingle() {
        const found = run()
        return { data: found[0] ?? null, error: null }
      },
      then(resolve: (value: { error: null }) => unknown) {
        run()
        return Promise.resolve({ error: null }).then(resolve)
      },
    }
    return builder
  }

  return {
    rows,
    client: {
      from(table: string) {
        if (table !== 'idempotency_keys') throw new Error(`unexpected table ${table}`)
        return {
          insert: async (row: Row) => {
            if (rows.has(row.key)) return { error: { code: '23505', message: 'duplicate key' } }
            rows.set(row.key, row)
            return { error: null }
          },
          upsert: async (row: Row) => {
            rows.set(row.key, row)
            return { error: null }
          },
          select: () => chain('select'),
          update: (patch: Partial<Row>) => chain('update', patch),
          delete: () => chain('delete'),
        }
      },
    },
  }
}

const { alertDepositPayFault, depositCaptureRefusalNeedsAPerson, depositPayEventType, normaliseDepositPayBlockedReason } =
  await import('@/lib/table-bookings/deposit-pay-steps')
const { describePayPalError, isGuestSidePayPalRefusal } = await import('@/lib/paypal-error-detail')

const MINUTE = 60 * 1000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-22T12:00:00.000Z'))
  vi.clearAllMocks()
  reportPaymentAlert.mockResolvedValue({ sent: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('alertDepositPayFault', () => {
  it('emails the manager with the booking, the step and the error, and no guest details', async () => {
    const store = idempotencyStore()

    await alertDepositPayFault(store.client as never, {
      tableBookingId: 'booking-1',
      step: 'setup_failed',
      detail: { reason: 'order_create_failed', paypalStatus: 401, paypalIssues: ['INVALID_CLIENT', 'X'], paypalName: null },
    })

    expect(reportPaymentAlert).toHaveBeenCalledTimes(1)
    expect(reportPaymentAlert).toHaveBeenCalledWith({
      title: 'A guest could not pay a table deposit',
      summary: expect.stringContaining('at most once an hour'),
      to: 'manager@the-anchor.pub',
      context: {
        Record: 'table_bookings booking-1',
        Link: 'https://management.example.test/table-bookings/booking-1',
        Step: 'setup_failed',
        reason: 'order_create_failed',
        paypalStatus: 401,
        paypalIssues: 'INVALID_CLIENT, X',
      },
    })
  })

  it('sends at most one email an hour for a booking, whatever the step', async () => {
    const store = idempotencyStore()
    const raise = (step: 'setup_failed' | 'capture_refused' | 'capture_call_failed') =>
      alertDepositPayFault(store.client as never, { tableBookingId: 'booking-1', step })

    await raise('setup_failed')
    await raise('capture_refused')
    vi.setSystemTime(Date.now() + 59 * MINUTE)
    await raise('capture_call_failed')
    expect(reportPaymentAlert).toHaveBeenCalledTimes(1)

    // Past the hour the fault is still happening, so the manager hears again, once.
    vi.setSystemTime(Date.now() + 2 * MINUTE)
    await raise('setup_failed')
    await raise('setup_failed')
    expect(reportPaymentAlert).toHaveBeenCalledTimes(2)
  })

  it('throttles each booking on its own', async () => {
    const store = idempotencyStore()

    await alertDepositPayFault(store.client as never, { tableBookingId: 'booking-1', step: 'setup_failed' })
    await alertDepositPayFault(store.client as never, { tableBookingId: 'booking-2', step: 'setup_failed' })

    expect(reportPaymentAlert).toHaveBeenCalledTimes(2)
  })

  it('tries again straight away when the email did not go', async () => {
    const store = idempotencyStore()
    reportPaymentAlert.mockResolvedValueOnce({ sent: false, reason: 'send_failed' })

    await alertDepositPayFault(store.client as never, { tableBookingId: 'booking-1', step: 'setup_failed' })
    await alertDepositPayFault(store.client as never, { tableBookingId: 'booking-1', step: 'setup_failed' })

    expect(reportPaymentAlert).toHaveBeenCalledTimes(2)
  })

  it('never throws, even when the claim table cannot be reached', async () => {
    const broken = { from: () => { throw new Error('database down') } }

    await expect(
      alertDepositPayFault(broken as never, { tableBookingId: 'booking-1', step: 'setup_failed' }),
    ).resolves.toBeUndefined()
    // Could not check whether the manager was already told, so they are told.
    expect(reportPaymentAlert).toHaveBeenCalledTimes(1)
  })
})

describe('which capture refusals reach a person', () => {
  const declined = describePayPalError({
    status: 422,
    details: { name: 'UNPROCESSABLE_ENTITY', debug_id: 'abc', details: [{ issue: 'instrument_declined' }] },
  })
  const serverError = describePayPalError({ status: 500, details: { name: 'INTERNAL_SERVER_ERROR', message: 'An internal error' } })

  it.each([
    ['BOOKING_NOT_FOUND', { ok: false, code: 'BOOKING_NOT_FOUND' }, true],
    ['ORDER_MISMATCH', { ok: false, code: 'ORDER_MISMATCH' }, true],
    ['PAYPAL_ORDER_LOOKUP_FAILED', { ok: false, code: 'PAYPAL_ORDER_LOOKUP_FAILED' }, true],
    ['AMOUNT_MISMATCH', { ok: false, code: 'AMOUNT_MISMATCH' }, true],
    ['a capture PayPal failed on', { ok: false, code: 'CAPTURE_FAILED', detail: { paypal: serverError } }, true],
    ['a capture that failed with no reason given', { ok: false, code: 'CAPTURE_FAILED' }, true],
    ["a capture the guest's bank refused", { ok: false, code: 'CAPTURE_FAILED', detail: { paypal: declined } }, false],
    ['a declined capture', { ok: false, code: 'CAPTURE_DECLINED' }, false],
    ['a booking no longer payable', { ok: false, code: 'NOT_PAYABLE', blockReason: 'hold_expired' }, false],
    // These already reach the manager from captureTableDeposit itself: no second email.
    ['CAPTURE_PENDING', { ok: false, code: 'CAPTURE_PENDING' }, false],
    ['CAPTURED_BOOKING_UPDATE_FAILED', { ok: false, code: 'CAPTURED_BOOKING_UPDATE_FAILED' }, false],
  ] as const)('%s: %s', (_name, result, expected) => {
    expect(depositCaptureRefusalNeedsAPerson(result as never)).toBe(expected)
  })

  it("reads PayPal's error field by field", () => {
    expect(declined).toEqual({
      status: 422,
      name: 'UNPROCESSABLE_ENTITY',
      issues: ['INSTRUMENT_DECLINED'],
      debugId: 'abc',
      message: null,
    })
    expect(isGuestSidePayPalRefusal(declined)).toBe(true)
    expect(isGuestSidePayPalRefusal(serverError)).toBe(false)
    expect(describePayPalError(new Error('socket hang up'))).toEqual({
      status: null,
      name: null,
      issues: [],
      debugId: null,
      message: 'socket hang up',
    })
    expect(describePayPalError(undefined).message).toBeNull()
  })
})

describe('step names and blocked reasons', () => {
  it('names each event after its step', () => {
    expect(depositPayEventType('page_viewed')).toBe('deposit_pay_page_viewed')
    expect(depositPayEventType('capture_refused')).toBe('deposit_pay_capture_refused')
  })

  it('stores only reasons the page knows, never free text from the address bar', () => {
    expect(normaliseDepositPayBlockedReason('hold_expired')).toBe('hold_expired')
    expect(normaliseDepositPayBlockedReason('call 07700 900123')).toBe('other')
    expect(normaliseDepositPayBlockedReason(undefined)).toBe('unknown')
  })
})
