import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The one alert path for money that needs a person (BK-114, BK-018; owner decision D17). It goes
 * to the manager inbox, once per booking and kind however often the cause repeats, and a failed
 * send leaves the next run free to try again.
 */

const reportPaymentAlert = vi.fn()
const claims = new Map<string, string>()
const claimIdempotencyKey = vi.fn(async (_client: unknown, key: string) =>
  claims.has(key) ? { state: 'replay', response: { state: 'alerted' } } : (claims.set(key, 'claimed'), { state: 'claimed' }))
const persistIdempotencyResponse = vi.fn(async (_client: unknown, key: string) => { claims.set(key, 'alerted') })
const releaseIdempotencyClaim = vi.fn(async (_client: unknown, key: string) => { claims.delete(key) })

vi.mock('@/lib/cron/alerting', () => ({ reportPaymentAlert: (...args: unknown[]) => reportPaymentAlert(...args) }))
vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: (...args: [unknown, string]) => claimIdempotencyKey(...args),
  computeIdempotencyRequestHash: () => 'hash',
  persistIdempotencyResponse: (...args: [unknown, string]) => persistIdempotencyResponse(...args),
  releaseIdempotencyClaim: (...args: [unknown, string]) => releaseIdempotencyClaim(...args),
}))
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  getAppUrl: () => 'https://management.example.test',
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { alertMoneyNeedsAPerson, MANAGER_ALERT_RECIPIENT } = await import('@/lib/money-alerts')
const { INVOICE_CREDIT_NOTE_ALERT_RECIPIENT } = await import('@/lib/paypal-money-alerts')

const input = {
  domain: 'table_bookings' as const,
  bookingId: 'booking-1',
  kind: 'refund_failed',
  title: 'A table deposit refund did not go through (£40.00)',
  summary: 'The guest is owed money.',
  context: { Amount: '£40.00' },
}

beforeEach(() => {
  vi.clearAllMocks()
  claims.clear()
  reportPaymentAlert.mockResolvedValue({ sent: true })
})

describe('alertMoneyNeedsAPerson', () => {
  it('reuses the manager address the invoice alerts already used', () => {
    expect(MANAGER_ALERT_RECIPIENT).toBe('manager@the-anchor.pub')
    expect(INVOICE_CREDIT_NOTE_ALERT_RECIPIENT).toBe(MANAGER_ALERT_RECIPIENT)
  })

  it('emails the manager inbox, with a link to the booking and no more than the caller gave', async () => {
    const outcome = await alertMoneyNeedsAPerson({} as never, input)

    expect(outcome).toEqual({ sent: true, duplicate: false })
    expect(reportPaymentAlert).toHaveBeenCalledTimes(1)
    expect(reportPaymentAlert).toHaveBeenCalledWith({
      title: input.title,
      summary: input.summary,
      to: 'manager@the-anchor.pub',
      context: {
        Record: 'table_bookings booking-1',
        Link: 'https://management.example.test/table-bookings/booking-1',
        Amount: '£40.00',
      },
    })
  })

  it('sends exactly one email for the same booking and kind, however often it is raised', async () => {
    await alertMoneyNeedsAPerson({} as never, input)
    const second = await alertMoneyNeedsAPerson({} as never, input)
    await alertMoneyNeedsAPerson({} as never, input)

    expect(second).toEqual({ sent: false, duplicate: true })
    expect(reportPaymentAlert).toHaveBeenCalledTimes(1)
  })

  it('sends again for a different kind on the same booking', async () => {
    await alertMoneyNeedsAPerson({} as never, input)
    await alertMoneyNeedsAPerson({} as never, { ...input, kind: 'capture_pending' })

    expect(reportPaymentAlert).toHaveBeenCalledTimes(2)
  })

  it('lets the next run try again when the email was not accepted', async () => {
    reportPaymentAlert.mockResolvedValueOnce({ sent: false, reason: 'send_failed' })

    const first = await alertMoneyNeedsAPerson({} as never, input)
    const retry = await alertMoneyNeedsAPerson({} as never, input)

    expect(first).toEqual({ sent: false, duplicate: false })
    expect(releaseIdempotencyClaim).toHaveBeenCalledTimes(1)
    expect(retry).toEqual({ sent: true, duplicate: false })
    expect(reportPaymentAlert).toHaveBeenCalledTimes(2)
  })

  it('still tells the manager when it cannot check whether it already did', async () => {
    claimIdempotencyKey.mockRejectedValueOnce(new Error('database unavailable'))

    const outcome = await alertMoneyNeedsAPerson({} as never, input)

    expect(outcome.sent).toBe(true)
    expect(reportPaymentAlert).toHaveBeenCalledTimes(1)
  })
})
