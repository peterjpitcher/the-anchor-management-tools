import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as any, flagOn: true }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => state.db),
}))

vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn(async () => state.flagOn),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: vi.fn(async () => undefined),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/services/audit', () => ({
  AuditService: { logAuditEvent: vi.fn(async () => undefined) },
}))

vi.mock('@/lib/unified-job-queue', () => ({
  jobQueue: { enqueue: vi.fn() },
}))

import { reportCronFailure } from '@/lib/cron/alerting'
import { sendSMS } from '@/lib/twilio'
import { AuditService } from '@/services/audit'
import { jobQueue } from '@/lib/unified-job-queue'
import { enqueueDelayedFallbackForEmailEvent, delayedFallbackJobKey } from '@/lib/notifications/delayed-fallback/enqueue'
import { evaluateFallbackSkip, resolveQuietHoursWait, runDelayedFallbackJob } from '@/lib/notifications/delayed-fallback/run'
import type { DelayedFallbackRender, DelayedFallbackRenderer } from '@/lib/notifications/delayed-fallback/types'

const mockedSendSMS = sendSMS as unknown as Mock
const mockedEnqueue = jobQueue.enqueue as unknown as Mock

const NOW = new Date('2026-09-20T10:00:00.000Z')

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-1',
    customer_id: 'customer-1',
    template_key: 'private_booking_deposit_reminder_7day',
    policy: 'email_first',
    category: 'transactional',
    urgency: 'standard',
    selected_channel: 'email',
    final_status: 'sent',
    delayed_fallback_allowed: true,
    delayed_fallback_sent_at: null,
    metadata: {
      private_booking_id: 'booking-1',
      trigger_type: 'deposit_reminder_7day',
      booking_facts: { event_date: '2026-10-03', hold_expiry_date: '2026-09-25', deposit_amount: 250 },
    },
    ...overrides,
  }
}

function seed(overrides: Record<string, unknown> = {}): FakeSupabase {
  return createFakeSupabase({
    notification_deliveries: [delivery(overrides)],
    notification_attempts: [
      { id: 'attempt-1', delivery_id: 'delivery-1', channel: 'email', attempt_order: 1, status: 'sent', resend_message_id: 'resend-1' },
    ],
    private_booking_audit: [],
  })
}

function readyRender(overrides: Partial<Extract<DelayedFallbackRender, { kind: 'ready' }>> = {}): DelayedFallbackRender {
  return {
    kind: 'ready',
    booking: {
      type: 'private_booking',
      id: 'booking-1',
      status: 'draft',
      startsAt: '2026-10-03T18:00:00.000Z',
      facts: { event_date: '2026-10-03', hold_expiry_date: '2026-09-25', deposit_amount: 250 },
    },
    sms: {
      to: '+447700900123',
      body: 'Hi Alex, quick nudge. Your hold on 3 October 2026 expires in 5 days.',
      customerId: 'customer-1',
      metadata: { private_booking_id: 'booking-1', trigger_type: 'deposit_reminder_7day' },
    },
    ...overrides,
  } as DelayedFallbackRender
}

function renderer(render: () => DelayedFallbackRender): DelayedFallbackRenderer {
  return { matches: (key) => key.startsWith('private_booking_'), render: vi.fn(async () => render()) }
}

describe('bounce webhook: enqueueDelayedFallbackForEmailEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.flagOn = true
    mockedEnqueue.mockResolvedValue({ success: true, jobId: 'job-1' })
  })

  it('queues one job, keyed on the delivery, for a bounced transactional email', async () => {
    state.db = seed()

    const result = await enqueueDelayedFallbackForEmailEvent({ eventType: 'email.bounced', resendEmailId: 'resend-1' })

    expect(result).toEqual({ enqueued: true, reason: 'queued', deliveryId: 'delivery-1' })
    expect(mockedEnqueue).toHaveBeenCalledTimes(1)
    expect(mockedEnqueue).toHaveBeenCalledWith(
      'notification_delayed_fallback',
      { deliveryId: 'delivery-1', trigger_event: 'email.bounced' },
      { unique: delayedFallbackJobKey('delivery-1'), maxAttempts: 3 }
    )
  })

  it.each(['email.failed', 'email.suppressed'])('treats %s as undelivered too', async (eventType) => {
    state.db = seed()
    const result = await enqueueDelayedFallbackForEmailEvent({ eventType, resendEmailId: 'resend-1' })
    expect(result.enqueued).toBe(true)
  })

  it.each(['email.delivered', 'email.delivery_delayed', 'email.opened', 'email.complained'])(
    'does nothing for %s',
    async (eventType) => {
      state.db = seed()
      const result = await enqueueDelayedFallbackForEmailEvent({ eventType, resendEmailId: 'resend-1' })
      expect(result).toEqual({ enqueued: false, reason: 'event_not_undelivered' })
      expect(mockedEnqueue).not.toHaveBeenCalled()
    }
  )

  it('does nothing while the flag is off', async () => {
    state.flagOn = false
    state.db = seed()
    const result = await enqueueDelayedFallbackForEmailEvent({ eventType: 'email.bounced', resendEmailId: 'resend-1' })
    expect(result.reason).toBe('flag_off')
    expect(mockedEnqueue).not.toHaveBeenCalled()
  })

  it('does nothing for an email with no delivery row (marketing, staff mail)', async () => {
    state.db = seed()
    const result = await enqueueDelayedFallbackForEmailEvent({ eventType: 'email.bounced', resendEmailId: 'resend-marketing-9' })
    expect(result.reason).toBe('not_a_tracked_delivery')
    expect(mockedEnqueue).not.toHaveBeenCalled()
  })

  it('does nothing for a marketing delivery even if a row exists', async () => {
    state.db = seed({ category: 'marketing' })
    const result = await enqueueDelayedFallbackForEmailEvent({ eventType: 'email.bounced', resendEmailId: 'resend-1' })
    expect(result.reason).toBe('not_eligible')
    expect(mockedEnqueue).not.toHaveBeenCalled()
  })

  it('does nothing when the delivery does not allow a later text', async () => {
    state.db = seed({ delayed_fallback_allowed: false })
    const result = await enqueueDelayedFallbackForEmailEvent({ eventType: 'email.bounced', resendEmailId: 'resend-1' })
    expect(result.reason).toBe('not_eligible')
    expect(mockedEnqueue).not.toHaveBeenCalled()
  })

  it('a duplicate event after the job has run enqueues nothing', async () => {
    state.db = seed({ delayed_fallback_sent_at: '2026-09-20T09:00:00.000Z', final_status: 'sent' })
    const result = await enqueueDelayedFallbackForEmailEvent({ eventType: 'email.failed', resendEmailId: 'resend-1' })
    expect(result.reason).toBe('already_handled')
    expect(mockedEnqueue).not.toHaveBeenCalled()
  })

  it('a duplicate event before the job has run reuses the same unique key, so the queue returns the existing job', async () => {
    state.db = seed()
    await enqueueDelayedFallbackForEmailEvent({ eventType: 'email.bounced', resendEmailId: 'resend-1' })
    await enqueueDelayedFallbackForEmailEvent({ eventType: 'email.suppressed', resendEmailId: 'resend-1' })
    const keys = mockedEnqueue.mock.calls.map((call) => call[2].unique)
    expect(new Set(keys)).toEqual(new Set([delayedFallbackJobKey('delivery-1')]))
  })

  it('marks the delivery undelivered and alerts staff when the job cannot be queued', async () => {
    state.db = seed()
    mockedEnqueue.mockResolvedValue({ success: false, error: 'jobs table unavailable' })

    const result = await enqueueDelayedFallbackForEmailEvent({ eventType: 'email.bounced', resendEmailId: 'resend-1' })

    expect(result.reason).toBe('enqueue_failed')
    expect(state.db.tables.notification_deliveries[0]).toMatchObject({
      final_status: 'failed',
      metadata: expect.objectContaining({ undelivered_reason: 'fallback_enqueue_failed' }),
    })
    expect(reportCronFailure).toHaveBeenCalledWith('notification-delayed-fallback', expect.any(Error), expect.objectContaining({ delivery_id: 'delivery-1' }))
  })

  it('never throws, even when the database throws', async () => {
    state.db = { from: () => { throw new Error('connection reset') } }
    await expect(enqueueDelayedFallbackForEmailEvent({ eventType: 'email.bounced', resendEmailId: 'resend-1' })).resolves.toMatchObject({ enqueued: false })
  })
})

describe('notification_delayed_fallback job', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.flagOn = true
    mockedSendSMS.mockResolvedValue({ success: true, sid: 'SM-fallback-1' })
  })

  it('sends one text rebuilt from the live booking and records it', async () => {
    state.db = seed()
    const fallbackRenderer = renderer(() => readyRender())

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [fallbackRenderer], now: () => NOW })

    expect(outcome).toEqual({ outcome: 'sent', deliveryId: 'delivery-1', scheduledFor: null })
    expect(mockedSendSMS).toHaveBeenCalledTimes(1)
    const [to, body, options] = mockedSendSMS.mock.calls[0]
    expect(to).toBe('+447700900123')
    expect(body).toContain('3 October 2026')
    expect(options.metadata).toMatchObject({
      private_booking_id: 'booking-1',
      template_key: 'private_booking_deposit_reminder_7day',
      source: 'email_bounce_fallback',
      delayed_fallback_delivery_id: 'delivery-1',
    })
    expect(typeof options.metadata.stage).toBe('string')

    const stored = state.db.tables.notification_deliveries[0]
    expect(stored.final_status).toBe('fallback_sent')
    expect(stored.selected_channel).toBe('sms')
    expect(stored.delayed_fallback_sent_at).toBe(NOW.toISOString())
    expect(state.db.tables.notification_attempts).toContainEqual(
      expect.objectContaining({ delivery_id: 'delivery-1', channel: 'sms', attempt_order: 2, status: 'sent', twilio_message_sid: 'SM-fallback-1' })
    )
    expect(state.db.tables.private_booking_audit).toEqual([
      expect.objectContaining({ booking_id: 'booking-1', action: 'sms_sent', new_value: 'private_booking_deposit_reminder_7day' }),
    ])
  })

  it('a second run of the same job does nothing', async () => {
    state.db = seed()
    const fallbackRenderer = renderer(() => readyRender())

    await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [fallbackRenderer], now: () => NOW })
    const second = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [fallbackRenderer], now: () => NOW })

    expect(second).toEqual({ outcome: 'skipped', reason: 'already_handled', deliveryId: 'delivery-1' })
    expect(mockedSendSMS).toHaveBeenCalledTimes(1)
    expect(state.db.tables.private_booking_audit).toHaveLength(1)
  })

  it('two jobs racing for one delivery send one text', async () => {
    state.db = seed()
    const fallbackRenderer = renderer(() => readyRender())

    const results = await Promise.all([
      runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [fallbackRenderer], now: () => NOW }),
      runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [fallbackRenderer], now: () => NOW }),
    ])

    expect(results.filter((result) => result.outcome === 'sent')).toHaveLength(1)
    expect(mockedSendSMS).toHaveBeenCalledTimes(1)
  })

  it('sends nothing for a cancelled booking, and says why on the timeline', async () => {
    state.db = seed()
    const fallbackRenderer = renderer(() => readyRender({ booking: { ...(readyRender() as any).booking, status: 'cancelled' } }))

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [fallbackRenderer], now: () => NOW })

    expect(outcome).toMatchObject({ outcome: 'skipped', reason: 'booking_cancelled' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
    expect(state.db.tables.notification_deliveries[0].final_status).toBe('bounced')
    expect(state.db.tables.private_booking_audit[0]).toMatchObject({ action: 'email_bounced' })
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('sends nothing once the booking has started', async () => {
    state.db = seed()
    const fallbackRenderer = renderer(() => readyRender({ booking: { ...(readyRender() as any).booking, startsAt: '2026-09-20T09:00:00.000Z' } }))

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [fallbackRenderer], now: () => NOW })

    expect(outcome).toMatchObject({ outcome: 'skipped', reason: 'booking_past' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
  })

  it('sends nothing when the booking changed since the email (date moved)', async () => {
    state.db = seed()
    const moved = readyRender()
    ;(moved as any).booking.facts = { event_date: '2026-10-10', hold_expiry_date: '2026-09-25', deposit_amount: 250 }
    const fallbackRenderer = renderer(() => moved)

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [fallbackRenderer], now: () => NOW })

    expect(outcome).toMatchObject({ outcome: 'skipped', reason: 'booking_changed' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
  })

  it('a guest with no number to text: delivery failed, audit row, staff alert, and it is listed', async () => {
    state.db = seed()
    const noPhone = readyRender()
    ;(noPhone as any).sms.to = null
    const fallbackRenderer = renderer(() => noPhone)

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [fallbackRenderer], now: () => NOW })

    expect(outcome).toEqual({ outcome: 'failed', reason: 'no_sms_channel', deliveryId: 'delivery-1' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
    expect(state.db.tables.notification_deliveries[0]).toMatchObject({
      final_status: 'failed',
      metadata: expect.objectContaining({ undelivered_reason: 'no_sms_channel' }),
    })
    expect(state.db.tables.private_booking_audit[0]).toMatchObject({ action: 'message_undelivered', booking_id: 'booking-1' })
    expect(reportCronFailure).toHaveBeenCalledWith(
      'notification-delayed-fallback',
      expect.any(Error),
      expect.objectContaining({ delivery_id: 'delivery-1', reason: 'no_sms_channel' })
    )

    const { loadUndeliveredGuestMessages } = await import('@/lib/notifications/undelivered')
    const listed = await loadUndeliveredGuestMessages({ sinceIso: '2000-01-01T00:00:00.000Z' })
    expect(listed.rows.map((row) => row.id)).toEqual(['delivery-1'])
    expect(listed.rows[0].reason).toBe('Email bounced; no mobile number to text')
    expect(listed.rows[0].booking).toEqual({ href: '/private-bookings/booking-1', label: 'Private booking' })
  })

  it('a failed text: delivery failed with the provider error, audit row and staff alert', async () => {
    state.db = seed()
    mockedSendSMS.mockResolvedValue({ success: false, error: 'Twilio 21211 invalid number', code: 'twilio_error' })

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [renderer(() => readyRender())], now: () => NOW })

    expect(outcome).toMatchObject({ outcome: 'failed', reason: 'sms_failed' })
    expect(state.db.tables.notification_attempts).toContainEqual(
      expect.objectContaining({ channel: 'sms', status: 'failed', error: 'Twilio 21211 invalid number' })
    )
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
  })

  it('skips, rather than reports undelivered, a text it cannot rebuild for a booking cancelled since', async () => {
    state.db = seed()
    const fallbackRenderer = renderer(() => ({
      kind: 'unavailable',
      reason: 'link_expired',
      booking: { type: 'private_booking', id: 'booking-1' },
      current: {
        booking: {
          status: 'cancelled',
          startsAt: '2026-10-03T18:00:00.000Z',
          facts: { event_date: '2026-10-03', hold_expiry_date: '2026-09-25', deposit_amount: 250 },
        },
      },
    }))

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [fallbackRenderer], now: () => NOW })

    expect(outcome).toMatchObject({ outcome: 'skipped', reason: 'booking_cancelled' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
    expect(state.db.tables.notification_deliveries[0].final_status).toBe('bounced')
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('still reports a text it cannot rebuild as undelivered while the booking needs it, in a plain sentence', async () => {
    state.db = seed()
    const fallbackRenderer = renderer(() => ({
      kind: 'unavailable',
      reason: 'link_expired',
      booking: { type: 'private_booking', id: 'booking-1' },
      current: {
        booking: {
          status: 'draft',
          startsAt: '2026-10-03T18:00:00.000Z',
          facts: { event_date: '2026-10-03', hold_expiry_date: '2026-09-25', deposit_amount: 250 },
        },
      },
    }))

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [fallbackRenderer], now: () => NOW })

    expect(outcome).toEqual({ outcome: 'failed', reason: 'link_expired', deliveryId: 'delivery-1' })
    expect(state.db.tables.private_booking_audit[0].metadata.description).toBe(
      'The email bounced and the text fallback failed: the link in the email has expired or has already been used.'
    )
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
  })

  it('a template key with no renderer is undelivered and staff are told', async () => {
    state.db = seed({ template_key: 'table_booking_cancelled', metadata: { table_booking_id: 'tb-1' } })

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [], now: () => NOW })

    expect(outcome).toMatchObject({ outcome: 'failed', reason: 'no_renderer' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
    expect(AuditService.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ resource_type: 'table_booking', resource_id: 'tb-1', operation_status: 'failure' })
    )
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
  })

  it('does nothing, and claims nothing, while the flag is off', async () => {
    state.flagOn = false
    state.db = seed()

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [renderer(() => readyRender())], now: () => NOW })

    expect(outcome).toMatchObject({ outcome: 'skipped', reason: 'flag_off' })
    expect(state.db.tables.notification_deliveries[0].delayed_fallback_sent_at).toBeNull()
    expect(mockedSendSMS).not.toHaveBeenCalled()
  })

  it('ignores a marketing delivery', async () => {
    state.db = seed({ category: 'marketing' })
    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [renderer(() => readyRender())], now: () => NOW })
    expect(outcome).toMatchObject({ outcome: 'skipped', reason: 'not_eligible' })
    expect(mockedSendSMS).not.toHaveBeenCalled()
  })

  it('treats a text deferred by quiet hours as sent and keeps the scheduled time', async () => {
    state.db = seed()
    mockedSendSMS.mockResolvedValue({ success: true, deferred: true, scheduledFor: '2026-09-21T08:00:00.000Z', sid: null })

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [renderer(() => readyRender())], now: () => NOW })

    expect(outcome).toEqual({ outcome: 'sent', deliveryId: 'delivery-1', scheduledFor: '2026-09-21T08:00:00.000Z' })
  })
})

describe('quiet hours: the job waits for the morning instead of handing sendSMS a text to hold', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.flagOn = true
    mockedSendSMS.mockResolvedValue({ success: true, sid: 'SM-fallback-1' })
  })

  /** 22:30 on Sunday 20 September 2026, London (BST). */
  const LATE_EVENING = new Date('2026-09-20T21:30:00.000Z')

  it('inside quiet hours: deferred to 09:00 London, with nothing claimed, rebuilt, sent or recorded', async () => {
    state.db = seed()
    const fallbackRenderer = renderer(() => readyRender())

    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [fallbackRenderer], now: () => LATE_EVENING })

    expect(outcome).toEqual({ outcome: 'deferred', deliveryId: 'delivery-1', runAt: '2026-09-21T08:00:00.000Z' })
    expect(fallbackRenderer.render).not.toHaveBeenCalled()
    expect(mockedSendSMS).not.toHaveBeenCalled()
    expect(state.db.tables.notification_deliveries[0]).toMatchObject({ delayed_fallback_sent_at: null, final_status: 'sent' })
    expect(state.db.tables.private_booking_audit).toEqual([])
    expect(reportCronFailure).not.toHaveBeenCalled()
  })

  it('at 09:00 the same job reads the booking again, so a hold cancelled overnight gets no text', async () => {
    state.db = seed()
    let status = 'draft'
    const fallbackRenderer = renderer(() => readyRender({ booking: { ...(readyRender() as any).booking, status } }))

    const first = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [fallbackRenderer], now: () => LATE_EVENING })
    expect(first.outcome).toBe('deferred')

    // The expire-holds cron cancels the hold at 06:00 UTC.
    status = 'cancelled'
    const morning = new Date((first as Extract<typeof first, { outcome: 'deferred' }>).runAt)
    const second = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [fallbackRenderer], now: () => morning })

    expect(second).toMatchObject({ outcome: 'skipped', reason: 'booking_cancelled' })
    expect(fallbackRenderer.render).toHaveBeenCalledTimes(1)
    expect(mockedSendSMS).not.toHaveBeenCalled()
  })

  it('at 09:00 a booking that still needs the text gets it, once', async () => {
    state.db = seed()
    const fallbackRenderer = renderer(() => readyRender())

    const first = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [fallbackRenderer], now: () => LATE_EVENING })
    const morning = new Date((first as Extract<typeof first, { outcome: 'deferred' }>).runAt)
    const second = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [fallbackRenderer], now: () => morning })

    expect(second).toEqual({ outcome: 'sent', deliveryId: 'delivery-1', scheduledFor: null })
    expect(mockedSendSMS).toHaveBeenCalledTimes(1)
    expect(state.db.tables.notification_deliveries[0].delayed_fallback_sent_at).toBe('2026-09-21T08:00:00.000Z')
  })

  it('a job for a delivery already handled stays handled, whatever the hour', async () => {
    state.db = seed({ delayed_fallback_sent_at: '2026-09-20T20:00:00.000Z' })
    const outcome = await runDelayedFallbackJob({ deliveryId: 'delivery-1' }, { renderers: [renderer(() => readyRender())], now: () => LATE_EVENING })
    expect(outcome).toMatchObject({ outcome: 'skipped', reason: 'already_handled' })
  })
})

describe('resolveQuietHoursWait', () => {
  it.each([
    ['22:30 on Saturday 24 October 2026, the last night of BST', '2026-10-24T21:30:00.000Z', '2026-10-25T09:00:00.000Z'],
    ['00:30 BST on 25 October, before the clocks go back', '2026-10-24T23:30:00.000Z', '2026-10-25T09:00:00.000Z'],
    ['01:30 GMT on 25 October, the hour that happens twice', '2026-10-25T01:30:00.000Z', '2026-10-25T09:00:00.000Z'],
    ['22:30 on Saturday 27 March 2027, the night the clocks go forward', '2027-03-27T22:30:00.000Z', '2027-03-28T08:00:00.000Z'],
    ['00:30 GMT on 28 March 2027, before the jump', '2027-03-28T00:30:00.000Z', '2027-03-28T08:00:00.000Z'],
    ['03:30 BST on 28 March 2027, after the jump', '2027-03-28T02:30:00.000Z', '2027-03-28T08:00:00.000Z'],
    ['20:56 London, close enough to 21:00 that sendSMS could hold it', '2026-09-20T19:56:00.000Z', '2026-09-21T08:00:00.000Z'],
    ['08:59 London', '2026-09-21T07:59:00.000Z', '2026-09-21T08:00:00.000Z'],
    ['23:00 on a winter weekday', '2026-12-01T23:00:00.000Z', '2026-12-02T09:00:00.000Z'],
  ])('%s: waits until 09:00 London', (_label, nowIso, expected) => {
    expect(resolveQuietHoursWait(new Date(nowIso))?.toISOString()).toBe(expected)
  })

  it.each([
    ['09:00 London exactly', '2026-09-21T08:00:00.000Z'],
    ['20:54 London', '2026-09-20T19:54:00.000Z'],
    ['midday on the autumn clock-change Sunday', '2026-10-25T12:00:00.000Z'],
    ['midday on the spring clock-change Sunday', '2027-03-28T11:00:00.000Z'],
  ])('%s: sends now', (_label, nowIso) => {
    expect(resolveQuietHoursWait(new Date(nowIso))).toBeNull()
  })
})

describe('evaluateFallbackSkip', () => {
  const base = readyRender() as Extract<DelayedFallbackRender, { kind: 'ready' }>

  it('allows a cancellation message only while the booking is still cancelled', () => {
    expect(evaluateFallbackSkip({ ...base, expectCancelled: true, booking: { ...base.booking, status: 'cancelled' } }, null, NOW)).toBeNull()
    expect(evaluateFallbackSkip({ ...base, expectCancelled: true, booking: { ...base.booking, status: 'confirmed' } }, null, NOW)).toBe('booking_no_longer_cancelled')
  })

  it('allows an after-the-event message for a past booking', () => {
    const past = { ...base.booking, startsAt: '2026-09-01T18:00:00.000Z' }
    expect(evaluateFallbackSkip({ ...base, booking: past }, null, NOW)).toBe('booking_past')
    expect(evaluateFallbackSkip({ ...base, expectPast: true, booking: past }, null, NOW)).toBeNull()
  })

  it('compares only the facts the renderer reports, treating 250 and "250.00" as the same amount', () => {
    expect(evaluateFallbackSkip(base, { event_date: '2026-10-03', deposit_amount: '250.00', unrelated: 'x' }, NOW)).toBeNull()
    expect(evaluateFallbackSkip(base, { deposit_amount: 200 }, NOW)).toBe('booking_changed')
  })
})
