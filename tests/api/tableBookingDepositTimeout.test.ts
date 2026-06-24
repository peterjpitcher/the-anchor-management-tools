import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  sendTableBookingCancelledSmsIfAllowed: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTableBookingCancelledSmsIfAllowed } from '@/lib/table-bookings/bookings'
import { logAuditEvent } from '@/app/actions/audit'
import { GET } from '@/app/api/cron/table-booking-deposit-timeout/route'

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

describe('table booking deposit timeout cron', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-24T12:00:00.000Z'))
    ;(authorizeCronRequest as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ authorized: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not cancel a pending booking while its payment hold is still valid', async () => {
    const selectBuilder = createBuilder({
      data: [{
        id: 'booking-1',
        customer_id: 'customer-1',
        booking_reference: 'TB-1',
        booking_date: '2026-07-25',
        booking_time: '18:00',
        booking_type: 'regular',
        hold_expires_at: '2026-07-24T12:15:00.000Z',
        payment_status: 'pending',
        paypal_deposit_capture_id: null,
      }],
      error: null,
    })
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') return selectBuilder
        throw new Error(`Unexpected table: ${table}`)
      }),
    }
    ;(createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(supabase)

    const response = await GET(new Request('http://localhost/api/cron/table-booking-deposit-timeout') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ cancelled: 0 })
    expect(selectBuilder.lte).toHaveBeenCalledWith('hold_expires_at', '2026-07-24T12:00:00.000Z')
    expect(supabase.from).toHaveBeenCalledTimes(1)
    expect(sendTableBookingCancelledSmsIfAllowed).not.toHaveBeenCalled()
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it('cancels expired payment holds and expires matching hold/payment rows', async () => {
    const selectBuilder = createBuilder({
      data: [{
        id: 'booking-2',
        customer_id: 'customer-2',
        booking_reference: 'TB-2',
        booking_date: '2026-07-25',
        booking_time: '18:00',
        booking_type: 'regular',
        hold_expires_at: '2026-07-24T11:59:00.000Z',
        payment_status: 'pending',
        paypal_deposit_capture_id: null,
      }],
      error: null,
    })
    const bookingUpdateBuilder = createBuilder({ data: [{ id: 'booking-2' }], error: null })
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

    const response = await GET(new Request('http://localhost/api/cron/table-booking-deposit-timeout') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ cancelled: 1 })
    expect(bookingUpdateBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
      cancellation_reason: 'payment_hold_expired',
      hold_expires_at: null,
    }))
    expect(bookingUpdateBuilder.is).toHaveBeenCalledWith('paypal_deposit_capture_id', null)
    expect(bookingUpdateBuilder.or).toHaveBeenCalledWith('payment_status.is.null,payment_status.eq.pending,payment_status.eq.failed')
    expect(holdUpdateBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' }))
    expect(paymentUpdateBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'table_booking.auto_cancelled',
      resource_id: 'booking-2',
    }))
    expect(sendTableBookingCancelledSmsIfAllowed).toHaveBeenCalledTimes(1)
  })
})
