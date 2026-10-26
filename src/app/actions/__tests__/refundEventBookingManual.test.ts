import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies before imports (events.ts has a wide surface)
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))
vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))
vi.mock('@/services/events', () => ({
  EventService: {},
  eventSchema: {},
}))
vi.mock('@/services/event-bookings', () => ({
  EventBookingService: { createBooking: vi.fn(), normalizeBookingMode: vi.fn(() => 'table') },
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/utils', () => ({
  formatPhoneForStorage: vi.fn((value: string) => value),
}))
vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone: vi.fn(),
}))
vi.mock('@/lib/events/manage-booking', () => ({
  createEventManageToken: vi.fn(),
  getEventRefundPolicy: vi.fn(() => ({ refundRate: 1 })),
  processEventRefund: vi.fn(),
  updateEventBookingSeatsById: vi.fn(),
}))
vi.mock('@/lib/events/event-payments', () => ({
  sendEventBookingSeatUpdateSms: vi.fn(),
  sendEventPaymentConfirmationSms: vi.fn(),
  sendEventPaymentManualReviewSms: vi.fn(),
}))
vi.mock('@/lib/email/event-ticket-emails', () => ({
  sendEventBookingCancelledEmail: vi.fn(),
  sendEventPaymentConfirmationEmail: vi.fn(),
  sendEventPaymentManualReviewEmail: vi.fn(),
  sendEventTicketTransferredEmail: vi.fn(),
}))
vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))
vi.mock('@/lib/google-calendar-events', () => ({
  deletePubOpsEventCalendarEntryByEventId: vi.fn(),
  syncPubOpsEventCalendarByEventId: vi.fn(),
}))
vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))
vi.mock('@/lib/sms/support', () => ({
  ensureReplyInstruction: vi.fn((body: string) => body),
}))
vi.mock('@/lib/sms/bulk', () => ({
  getSmartFirstName: vi.fn(() => 'there'),
}))
vi.mock('@/lib/unified-job-queue', () => ({
  jobQueue: { enqueue: vi.fn() },
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { processEventRefund } from '@/lib/events/manage-booking'

type QueryResult = { data: unknown; error: unknown }

function createQuery(result: QueryResult) {
  const promise = Promise.resolve(result)
  const chain: Record<string, unknown> = {}
  const self = () => chain
  Object.assign(chain, {
    select: vi.fn(self),
    insert: vi.fn(self),
    update: vi.fn(self),
    delete: vi.fn(self),
    eq: vi.fn(self),
    in: vi.fn(self),
    not: vi.fn(self),
    contains: vi.fn(self),
    order: vi.fn(self),
    limit: vi.fn(self),
    maybeSingle: vi.fn(() => promise),
    single: vi.fn(() => promise),
    then: (onFulfilled?: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      promise.then(onFulfilled, onRejected),
  })
  return chain
}

/** Table results are consumed in call order (FIFO per table). */
function createAdminMock(config: {
  tables?: Record<string, QueryResult[]>
  rpc?: Record<string, QueryResult>
}) {
  const tables = config.tables ?? {}
  return {
    from: vi.fn((table: string) => {
      const queue = tables[table] ?? []
      const result = queue.length > 0 ? (queue.shift() as QueryResult) : { data: null, error: null }
      return createQuery(result)
    }),
    rpc: vi.fn((fn: string) => Promise.resolve(config.rpc?.[fn] ?? { data: null, error: null })),
  }
}

function mockAuthUser(user: { id: string; email: string } | null) {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
  } as never)
}

const MANAGER_ROLES = { data: [{ role_name: 'manager' }], error: null }
const STAFF_ROLES = { data: [{ role_name: 'staff' }], error: null }

const CONFIRMED_BOOKING = {
  id: 'booking-1',
  event_id: 'event-1',
  customer_id: 'customer-1',
  status: 'confirmed',
  is_reminder_only: false,
}

/** £20 paid, £5 already refunded → £15 refundable. */
function paymentsQueues(): QueryResult[] {
  return [
    { data: [{ amount: 20 }], error: null }, // charge rows
    { data: [{ amount: 5 }], error: null }, // refund rows
  ]
}

const REQUEST_ID = '0b9d6f2e-4c1a-4e8b-9f3d-2a7c5e1b8d40'

describe('refundEventBookingManual', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.mocked(checkUserPermission).mockResolvedValue(true)
  })

  it('rejects users without the events manage permission', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false)

    const { refundEventBookingManual } = await import('../events')
    const result = await refundEventBookingManual({ bookingId: '5e0e5be9-7f27-4c6b-8f36-0d0f2e2b6c01', requestId: REQUEST_ID })

    expect(result).toEqual({ error: expect.stringContaining('permission') })
    expect(processEventRefund).not.toHaveBeenCalled()
  })

  it('rejects non-managers even when they can manage events', async () => {
    mockAuthUser({ id: 'user-1', email: 'staffer@the-anchor.pub' })
    vi.mocked(createAdminClient).mockReturnValue(createAdminMock({
      rpc: { get_user_roles: STAFF_ROLES },
    }) as never)

    const { refundEventBookingManual } = await import('../events')
    const result = await refundEventBookingManual({ bookingId: '5e0e5be9-7f27-4c6b-8f36-0d0f2e2b6c01', requestId: REQUEST_ID })

    expect(result).toEqual({ error: 'Only a manager can issue refunds.' })
    expect(processEventRefund).not.toHaveBeenCalled()
  })

  it('caps the refund at the amount still refundable', async () => {
    mockAuthUser({ id: 'user-1', email: 'boss@the-anchor.pub' })
    vi.mocked(createAdminClient).mockReturnValue(createAdminMock({
      tables: {
        bookings: [{ data: CONFIRMED_BOOKING, error: null }],
        payments: paymentsQueues(),
      },
      rpc: { get_user_roles: MANAGER_ROLES },
    }) as never)

    const { refundEventBookingManual } = await import('../events')
    const result = await refundEventBookingManual({
      bookingId: '5e0e5be9-7f27-4c6b-8f36-0d0f2e2b6c01',
      requestId: REQUEST_ID,
      amount: 20,
    })

    expect(result).toEqual({ error: expect.stringContaining('£15.00') })
    expect(processEventRefund).not.toHaveBeenCalled()
  })

  it('refunds the full refundable amount with a stable idempotency key when no amount is given', async () => {
    mockAuthUser({ id: 'user-1', email: 'boss@the-anchor.pub' })
    vi.mocked(createAdminClient).mockReturnValue(createAdminMock({
      tables: {
        bookings: [{ data: CONFIRMED_BOOKING, error: null }],
        payments: paymentsQueues(),
      },
      rpc: { get_user_roles: MANAGER_ROLES },
    }) as never)
    vi.mocked(processEventRefund).mockResolvedValue({
      status: 'succeeded',
      amount: 15,
      currency: 'GBP',
    })

    const { refundEventBookingManual } = await import('../events')
    const result = await refundEventBookingManual({ bookingId: '5e0e5be9-7f27-4c6b-8f36-0d0f2e2b6c01', requestId: REQUEST_ID })

    expect(processEventRefund).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bookingId: 'booking-1',
        customerId: 'customer-1',
        eventId: 'event-1',
        amount: 15,
        reason: 'staff_manual_refund',
        metadata: expect.objectContaining({
          // Keyed per request, not per booking (BK-024). This test used to pin the fixed key
          // 'staff-manual-refund:booking-1', under which a second refund on the booking replayed
          // the first without calling PayPal.
          idempotency_key: `staff-manual-refund:booking-1:${REQUEST_ID}`,
        }),
      })
    )
    expect(result).toEqual({
      success: true,
      data: {
        booking_id: 'booking-1',
        refund_status: 'succeeded',
        refund_amount: 15,
        max_refundable: 15,
        warning: null,
      },
    })
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'refund_event_booking',
        resource_type: 'event_booking',
        resource_id: 'booking-1',
      })
    )
  })

  it('works on cancelled bookings (after-the-fact refunds)', async () => {
    mockAuthUser({ id: 'user-1', email: 'boss@the-anchor.pub' })
    vi.mocked(createAdminClient).mockReturnValue(createAdminMock({
      tables: {
        bookings: [{ data: { ...CONFIRMED_BOOKING, status: 'cancelled' }, error: null }],
        payments: paymentsQueues(),
      },
      rpc: { get_user_roles: MANAGER_ROLES },
    }) as never)
    vi.mocked(processEventRefund).mockResolvedValue({
      status: 'pending',
      amount: 10,
      currency: 'GBP',
    })

    const { refundEventBookingManual } = await import('../events')
    const result = await refundEventBookingManual({
      bookingId: '5e0e5be9-7f27-4c6b-8f36-0d0f2e2b6c01',
      requestId: REQUEST_ID,
      amount: 10,
    })

    expect(result).toEqual({
      success: true,
      data: {
        booking_id: 'booking-1',
        refund_status: 'pending',
        refund_amount: 10,
        max_refundable: 15,
        warning: null,
      },
    })
  })

  it('rejects when there is nothing left to refund', async () => {
    mockAuthUser({ id: 'user-1', email: 'boss@the-anchor.pub' })
    vi.mocked(createAdminClient).mockReturnValue(createAdminMock({
      tables: {
        bookings: [{ data: CONFIRMED_BOOKING, error: null }],
        payments: [
          { data: [{ amount: 20 }], error: null },
          { data: [{ amount: 20 }], error: null },
        ],
      },
      rpc: { get_user_roles: MANAGER_ROLES },
    }) as never)

    const { refundEventBookingManual } = await import('../events')
    const result = await refundEventBookingManual({ bookingId: '5e0e5be9-7f27-4c6b-8f36-0d0f2e2b6c01', requestId: REQUEST_ID })

    expect(result).toEqual({ error: 'There is nothing left to refund on this booking.' })
    expect(processEventRefund).not.toHaveBeenCalled()
  })
  it('passes on the warning when PayPal refunded but the payment record did not update', async () => {
    mockAuthUser({ id: 'user-1', email: 'boss@the-anchor.pub' })
    vi.mocked(createAdminClient).mockReturnValue(createAdminMock({
      tables: {
        bookings: [{ data: CONFIRMED_BOOKING, error: null }],
        payments: paymentsQueues(),
      },
      rpc: { get_user_roles: MANAGER_ROLES },
    }) as never)
    const staffWarning =
      'The refund went through, but the original payment was not updated to show it. Do not refund again: tell the developer so the payment record can be corrected.'
    vi.mocked(processEventRefund).mockResolvedValue({
      status: 'succeeded',
      amount: 15,
      currency: 'GBP',
      staffWarning,
    })

    const { refundEventBookingManual } = await import('../events')
    const result = await refundEventBookingManual({ bookingId: '5e0e5be9-7f27-4c6b-8f36-0d0f2e2b6c01', requestId: REQUEST_ID })

    expect(result).toMatchObject({
      success: true,
      data: { refund_status: 'succeeded', refund_amount: 15, warning: staffWarning },
    })
  })

  // BK-024: every manual refund on a booking shared one key, so the second refund replayed the
  // first, moved no money and still reported "Refund issued".
  it('keys two refunds on the same booking apart, so the second is a new refund', async () => {
    mockAuthUser({ id: 'user-1', email: 'boss@the-anchor.pub' })
    vi.mocked(processEventRefund).mockResolvedValue({ status: 'succeeded', amount: 5, currency: 'GBP' })
    const { refundEventBookingManual } = await import('../events')

    for (const requestId of [REQUEST_ID, '7d3c1a9e-2b4f-4c6d-8e1a-5f9b3c7d2e10']) {
      vi.mocked(createAdminClient).mockReturnValue(createAdminMock({
        tables: { bookings: [{ data: CONFIRMED_BOOKING, error: null }], payments: paymentsQueues() },
        rpc: { get_user_roles: MANAGER_ROLES },
      }) as never)
      await refundEventBookingManual({ bookingId: '5e0e5be9-7f27-4c6b-8f36-0d0f2e2b6c01', requestId, amount: 5 })
    }

    const keys = vi.mocked(processEventRefund).mock.calls.map((call) => (call[1].metadata as Record<string, unknown>).idempotency_key)
    expect(keys).toHaveLength(2)
    expect(new Set(keys).size).toBe(2)
  })

  it('refuses a refund with no request id rather than risk sharing a key', async () => {
    const { refundEventBookingManual } = await import('../events')
    const result = await refundEventBookingManual({ bookingId: '5e0e5be9-7f27-4c6b-8f36-0d0f2e2b6c01' } as never)

    expect(result).toEqual({ error: 'Please reload the page and try the refund again.' })
    expect(processEventRefund).not.toHaveBeenCalled()
  })
})

