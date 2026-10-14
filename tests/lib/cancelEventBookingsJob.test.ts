import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({ marker: 'admin' })) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const mocks = vi.hoisted(() => ({
  cancelEventBookings: vi.fn(),
  logAuditEvent: vi.fn(),
  reportCronFailure: vi.fn(),
}))

vi.mock('@/services/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/events')>()
  return {
    describeUncancelledBookings: actual.describeUncancelledBookings,
    EventService: { cancelEventBookings: mocks.cancelEventBookings },
  }
})
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.logAuditEvent }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: mocks.reportCronFailure }))

import { UnifiedJobQueue } from '@/lib/unified-job-queue'

/**
 * The event cancellation runs as a background job, so nobody sees its result unless the job
 * records it. Bookings the cascade could not cancel must reach the job result and the audit row
 * in words staff can act on, and the job must not throw for them (a throw would retry it).
 */

const payload = {
  eventId: 'event-1',
  eventName: 'Quiz Night',
  eventDate: '2026-10-20',
  eventTime: '19:00',
  cancelledBy: 'user-1',
}

function run() {
  const queue = UnifiedJobQueue.getInstance()
  return (UnifiedJobQueue.prototype as any).executeJob.call(queue, 'cancel_event_bookings', payload)
}

describe('cancel_event_bookings job', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records bookings that could not be cancelled in the job result and a failure audit row', async () => {
    mocks.cancelEventBookings.mockResolvedValue({
      bookingsCancelled: 3,
      bookingsFailed: 2,
      failedBookingIds: ['booking-a', 'booking-b'],
      refundsProcessed: 1,
      refundsFailed: 0,
      customersNotified: 3,
    })

    const result = await run()

    const warning =
      '2 bookings could not be cancelled and their guests were not told. Cancel them individually from the event page.'
    expect(result).toMatchObject({ bookingsCancelled: 3, bookingsFailed: 2, failedBookingIds: ['booking-a', 'booking-b'], warning })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'cancel_event',
        resource_id: 'event-1',
        operation_status: 'failure',
        error_message: warning,
        additional_info: expect.objectContaining({ bookingsFailed: 2, failedBookingIds: ['booking-a', 'booking-b'] }),
      }),
    )
    // Nobody watches the jobs page after cancelling an event, so the owner is emailed too.
    expect(mocks.reportCronFailure).toHaveBeenCalledWith('cancel_event_bookings', new Error(warning), {
      eventId: 'event-1',
      failedBookingIds: ['booking-a', 'booking-b'],
    })
  })

  it('still completes when the owner alert itself fails', async () => {
    mocks.cancelEventBookings.mockResolvedValue({
      bookingsCancelled: 0,
      bookingsFailed: 1,
      failedBookingIds: ['booking-a'],
      refundsProcessed: 0,
      refundsFailed: 0,
      customersNotified: 0,
    })
    mocks.reportCronFailure.mockRejectedValueOnce(new Error('mail down'))

    await expect(run()).resolves.toMatchObject({ bookingsFailed: 1 })
  })

  it('records a plain success when every booking was cancelled', async () => {
    mocks.cancelEventBookings.mockResolvedValue({
      bookingsCancelled: 2,
      bookingsFailed: 0,
      failedBookingIds: [],
      refundsProcessed: 0,
      refundsFailed: 0,
      customersNotified: 2,
    })

    const result = await run()

    expect(result).not.toHaveProperty('warning')
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ operation_status: 'success', additional_info: expect.objectContaining({ bookingsFailed: 0 }) }),
    )
    expect(mocks.logAuditEvent.mock.calls[0][0]).not.toHaveProperty('error_message')
    expect(mocks.reportCronFailure).not.toHaveBeenCalled()
  })
})
