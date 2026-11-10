import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  sendTableBookingCancelledSmsIfAllowed: vi.fn().mockResolvedValue({ status: 'sent', channel: 'email', fallbackUsed: false, error: null }),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/table-bookings/paypal-deposit-reconcile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/table-bookings/paypal-deposit-reconcile')>()),
  reconcileTableDepositOrder: vi.fn(),
}))

vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/lib/table-bookings/deposit-hold-reminder', () => ({
  runDepositHoldReminders: vi.fn().mockResolvedValue({ considered: 1, sent: 1, failed: 0, skipped: {} }),
}))

vi.mock('@/lib/table-bookings/christmas-leads', () => ({
  issueLapsedHoldLead: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTableBookingCancelledSmsIfAllowed } from '@/lib/table-bookings/bookings'
import { logAuditEvent } from '@/app/actions/audit'
import { reconcileTableDepositOrder } from '@/lib/table-bookings/paypal-deposit-reconcile'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { runDepositHoldReminders } from '@/lib/table-bookings/deposit-hold-reminder'
import { issueLapsedHoldLead } from '@/lib/table-bookings/christmas-leads'
import { GET } from '@/app/api/cron/table-booking-deposit-timeout/route'

/**
 * A lapsed Christmas deposit hold (Christmas funnel spec, owner decision 6): it is saved as an
 * unfinished booking for the staff tab, and the cancellation notice it already gets carries the
 * "Finish my booking" link. No new message, and nothing changes for any other booking. The
 * harness is tests/api/tableBookingDepositTimeout.test.ts's.
 */

function createBuilder(response: { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: Promise<{ data: unknown; error: unknown }>['then']
  } = {} as any

  for (const method of ['select', 'eq', 'not', 'lte', 'limit', 'update', 'is', 'or']) {
    builder[method] = vi.fn(() => builder)
  }

  builder.then = (resolve, reject) => Promise.resolve(response).then(resolve, reject)
  return builder
}

function lapsedBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-2',
    customer_id: 'customer-2',
    booking_reference: 'TB-2',
    booking_date: '2026-07-25',
    booking_time: '18:00',
    booking_type: 'regular',
    status: 'pending_payment',
    hold_expires_at: '2026-07-24T11:40:00.000Z',
    payment_status: 'pending',
    paypal_deposit_order_id: null,
    paypal_deposit_capture_id: null,
    party_size: 16,
    deposit_amount: 160,
    deposit_amount_locked: null,
    deposit_waived: false,
    ...overrides,
  }
}

/** The candidate select, then (if it gets that far) the cancel, the hold row and the payment row. */
function wireDb(row: Record<string, unknown>) {
  const selectBuilder = createBuilder({ data: [row], error: null })
  const bookingUpdateBuilder = createBuilder({ data: [{ id: row.id, payment_status: 'pending' }], error: null })
  const holdUpdateBuilder = createBuilder({ data: [{ id: 'hold-1' }], error: null })
  const paymentUpdateBuilder = createBuilder({ data: [{ id: 'payment-1' }], error: null })
  const builders = [selectBuilder, bookingUpdateBuilder, holdUpdateBuilder, paymentUpdateBuilder]
  const supabase = {
    from: vi.fn((table: string) => {
      const next = builders.shift()
      if (!next) throw new Error(`Unexpected table call: ${table}`)
      return next
    }),
  }
  ;(createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(supabase)
  return { supabase, selectBuilder, bookingUpdateBuilder, holdUpdateBuilder, paymentUpdateBuilder }
}

async function run() {
  const response = await GET(new Request('http://localhost/api/cron/table-booking-deposit-timeout') as any)
  return { status: response.status, payload: await response.json() }
}

const RAW = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde'
const FINISH_URL = `https://www.the-anchor.pub/book-table?christmas=1#resume=${RAW}`

describe('table booking deposit timeout cron: lapsed Christmas holds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-20T12:00:00.000Z'))
    ;(authorizeCronRequest as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ authorized: true })
    vi.mocked(issueLapsedHoldLead).mockResolvedValue({ finishUrl: FINISH_URL, rawToken: RAW, outcome: 'issued' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const christmasHold = (overrides: Record<string, unknown> = {}) =>
    lapsedBooking({ booking_type: 'christmas', booking_date: '2026-12-15', hold_expires_at: '2026-11-20T11:40:00.000Z', ...overrides })

  it('saves the lapsed Christmas hold and puts the link in the one cancellation notice', async () => {
    wireDb(christmasHold())

    const { payload } = await run()

    expect(payload).toEqual({ cancelled: 1 })
    expect(issueLapsedHoldLead).toHaveBeenCalledTimes(1)
    expect(issueLapsedHoldLead).toHaveBeenCalledWith(expect.anything(), { tableBookingId: 'booking-2', now: new Date('2026-11-20T12:00:00.000Z') })
    expect(sendTableBookingCancelledSmsIfAllowed).toHaveBeenCalledTimes(1)
    expect(sendTableBookingCancelledSmsIfAllowed).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tableBookingId: 'booking-2',
      refundResult: { refunded: false, reason: 'hold_expired' },
      finishBooking: { url: FINISH_URL, rawToken: RAW },
    }))
  })

  it('sends the same one notice with no link when the date can no longer be booked online', async () => {
    vi.mocked(issueLapsedHoldLead).mockResolvedValue({ finishUrl: null, rawToken: null, outcome: 'not_bookable_online' })
    wireDb(christmasHold())

    await run()

    expect(sendTableBookingCancelledSmsIfAllowed).toHaveBeenCalledTimes(1)
    expect(sendTableBookingCancelledSmsIfAllowed).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ finishBooking: null }))
  })

  it('leaves every other booking exactly as before: no lead and no link', async () => {
    wireDb(lapsedBooking({ hold_expires_at: '2026-11-20T11:40:00.000Z' }))

    await run()

    expect(issueLapsedHoldLead).not.toHaveBeenCalled()
    expect(sendTableBookingCancelledSmsIfAllowed).toHaveBeenCalledTimes(1)
    expect(sendTableBookingCancelledSmsIfAllowed).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ finishBooking: null }))
  })

  it('does nothing for a Christmas hold that was not cancelled after all', async () => {
    const { bookingUpdateBuilder } = wireDb(christmasHold())
    bookingUpdateBuilder.then = (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject)

    await run()

    expect(issueLapsedHoldLead).not.toHaveBeenCalled()
    expect(sendTableBookingCancelledSmsIfAllowed).not.toHaveBeenCalled()
  })
})
