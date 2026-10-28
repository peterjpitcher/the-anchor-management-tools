import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Cancelling and postponing a whole event (BK-026, BK-089; owner decision D8). A manager sees who is
 * affected and confirms; a cancellation that refunds money needs a named manager; its refunds and
 * messages wait 10 minutes and can be undone until then.
 */

const state = vi.hoisted(() => ({
  canManage: true,
  email: 'peter@example.com' as string | null,
  roles: ['manager'] as string[],
  event: { id: '11111111-1111-4111-8111-111111111111', name: 'Quiz Night', date: '2099-11-20', time: '19:00', event_status: 'scheduled' } as Record<string, unknown> | null,
  impact: { activeBookings: 3, activeSeats: 7, pendingPaymentBookings: 0, paidBookings: 0, amountPaid: 0, reachableByEmail: 3, reachableByTextOnly: 0, unreachable: 0, seatedBookings: 0 },
  pendingJob: null as Record<string, unknown> | null,
  jobStopped: true,
  jobUpdates: [] as Array<Record<string, unknown>>,
}))

const mocks = vi.hoisted(() => ({
  updateEvent: vi.fn(),
  enqueue: vi.fn(),
  audit: vi.fn(),
  sync: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => state.canManage) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.audit }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/google-calendar-events', () => ({ syncPubOpsEventCalendarByEventId: mocks.sync }))
vi.mock('@/lib/unified-job-queue', () => ({ jobQueue: { enqueue: mocks.enqueue } }))
vi.mock('@/services/events', () => ({ EventService: { updateEvent: mocks.updateEvent } }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'manager-1', email: state.email } }, error: null })) },
  })),
}))
vi.mock('@/lib/events/event-change-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/event-change-guard')>()
  return { ...actual, loadEventBookingImpact: vi.fn(async () => state.impact) }
})
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: vi.fn(async () => ({ data: state.roles.map((role_name) => ({ role_name })), error: null })),
    from: (table: string) => {
      if (table === 'events') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.event, error: null }) }) }) }
      }
      // jobs
      const read = {
        eq: () => read,
        contains: () => read,
        order: () => read,
        limit: async () => ({ data: state.pendingJob ? [state.pendingJob] : [], error: null }),
      }
      return {
        select: () => read,
        update: (values: Record<string, unknown>) => {
          state.jobUpdates.push(values)
          const write = { eq: () => write, select: () => write, maybeSingle: async () => ({ data: state.jobStopped ? { id: 'job-1' } : null, error: null }) }
          return write
        },
      }
    },
  }),
}))

import { cancelEvent, getEventLifecycleImpact, postponeEvent, undoEventCancellation } from '@/app/actions/event-lifecycle'
import { EVENT_CANCELLATION_DELAY_MS } from '@/lib/events/event-change-guard'

const EVENT_ID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  state.canManage = true
  state.email = 'peter@example.com'
  state.roles = ['manager']
  state.event = { id: EVENT_ID, name: 'Quiz Night', date: '2099-11-20', time: '19:00', event_status: 'scheduled' }
  state.impact = { activeBookings: 3, activeSeats: 7, pendingPaymentBookings: 0, paidBookings: 0, amountPaid: 0, reachableByEmail: 3, reachableByTextOnly: 0, unreachable: 0, seatedBookings: 0 }
  state.pendingJob = null
  state.jobStopped = true
  state.jobUpdates = []
  mocks.updateEvent.mockResolvedValue({})
  mocks.enqueue.mockResolvedValue({ success: true, jobId: 'job-1' })
})

describe('event lifecycle actions', () => {
  it('shows who a cancellation affects, what is refunded and what guests are told', async () => {
    state.impact = { ...state.impact, paidBookings: 2, amountPaid: 80 }
    const result = await getEventLifecycleImpact(EVENT_ID, 'cancel')
    if (!('success' in result)) throw new Error(result.error)
    expect(result.data.allowed).toBe(true)
    expect(result.data.lines).toEqual([
      '3 bookings (7 seats) will be cancelled.',
      '2 bookings were paid online, and £80.00 will be refunded in full.',
      'Each guest is told the event is cancelled and, if they paid, that their refund is on its way. Guests are told 3 by email.',
      'Refunds and messages start in 10 minutes. Until then you can undo the cancellation from this drawer.',
    ])
  })

  it('refuses a cancellation that is not confirmed', async () => {
    expect(await cancelEvent(EVENT_ID, { confirmed: false })).toEqual({ error: 'Confirm the cancellation first.' })
    expect(mocks.updateEvent).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('needs a named manager when the cancellation refunds money', async () => {
    state.impact = { ...state.impact, paidBookings: 1, amountPaid: 40 }
    state.email = 'manager@the-anchor.pub'
    const result = await cancelEvent(EVENT_ID, { confirmed: true })
    expect(result.error).toContain('a named manager must confirm it')
    expect(mocks.updateEvent).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()

    state.email = 'peter@example.com'
    state.roles = ['staff']
    expect((await cancelEvent(EVENT_ID, { confirmed: true })).error).toContain('a named manager must confirm it')
  })

  it('marks the event cancelled and queues the refunds and messages 10 minutes out', async () => {
    const result = await cancelEvent(EVENT_ID, { confirmed: true })
    expect(result.success).toBe(true)
    expect(mocks.updateEvent).toHaveBeenCalledWith(EVENT_ID, { event_status: 'cancelled' }, { lifecycleAction: true, confirmedChanges: true })
    expect(mocks.enqueue).toHaveBeenCalledWith(
      'cancel_event_bookings',
      expect.objectContaining({ eventId: EVENT_ID, cancelledBy: 'manager-1', previousStatus: 'scheduled' }),
      expect.objectContaining({ delay: EVENT_CANCELLATION_DELAY_MS, unique: `cancel_event_bookings:${EVENT_ID}` }),
    )
    expect(EVENT_CANCELLATION_DELAY_MS).toBe(600000)
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'cancel_event_queued',
      old_values: { event_status: 'scheduled' },
      new_values: { event_status: 'cancelled' },
      additional_info: expect.objectContaining({ confirmed_by_manager: true, active_bookings: 3 }),
    }))
  })

  it('tells staff plainly when the cancellation could not be queued', async () => {
    mocks.enqueue.mockResolvedValue({ success: false, error: 'queue down' })
    const result = await cancelEvent(EVENT_ID, { confirmed: true })
    expect(result.error).toContain('Nobody has been refunded or told')
  })

  it('undoes a waiting cancellation: stops the job, then puts the status back', async () => {
    state.event = { ...state.event!, event_status: 'cancelled' }
    state.pendingJob = { id: 'job-1', scheduled_for: '2099-11-01T10:10:00Z', payload: { eventId: EVENT_ID, previousStatus: 'sold_out' } }
    expect(await undoEventCancellation(EVENT_ID)).toEqual({ success: true })
    expect(state.jobUpdates).toEqual([expect.objectContaining({ status: 'cancelled' })])
    expect(mocks.updateEvent).toHaveBeenCalledWith(EVENT_ID, { event_status: 'sold_out' }, { lifecycleAction: true, confirmedChanges: true })
  })

  it('says it is too late to undo once the refunds and messages have started', async () => {
    state.event = { ...state.event!, event_status: 'cancelled' }
    expect((await undoEventCancellation(EVENT_ID)).error).toContain('Too late to undo')
    state.pendingJob = { id: 'job-1', scheduled_for: '2099-11-01T10:10:00Z', payload: { eventId: EVENT_ID } }
    state.jobStopped = false
    expect((await undoEventCancellation(EVENT_ID)).error).toContain('Too late to undo')
    expect(mocks.updateEvent).not.toHaveBeenCalled()
  })

  it('postpones after confirmation, keeps bookings and queues the notices', async () => {
    const preview = await getEventLifecycleImpact(EVENT_ID, 'postpone')
    if (!('success' in preview)) throw new Error(preview.error)
    expect(preview.data.lines[0]).toBe('3 bookings (7 seats) stay booked and carry over to the new date.')
    const result = await postponeEvent(EVENT_ID, { confirmed: true })
    expect(result.success).toBe(true)
    expect(mocks.updateEvent).toHaveBeenCalledWith(EVENT_ID, { event_status: 'postponed' }, { lifecycleAction: true, confirmedChanges: true })
    expect(mocks.enqueue).toHaveBeenCalledWith('send_event_postponed_notifications', expect.objectContaining({ eventId: EVENT_ID }), expect.anything())
  })

  it('refuses anyone without events manage', async () => {
    state.canManage = false
    expect((await cancelEvent(EVENT_ID, { confirmed: true })).error).toContain('do not have permission')
    expect((await postponeEvent(EVENT_ID, { confirmed: true })).error).toContain('do not have permission')
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })
})
