import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A text to a member of staff (src/lib/sms/staff-alert.ts): never a customer record, never the
 * customer message history, and held to 09:00 inside quiet hours by the job queue because sendSMS
 * cannot hold a text that has no customer. Twilio is mocked: nothing here sends.
 */

const sendSMS = vi.hoisted(() => vi.fn())
vi.mock('@/lib/twilio', () => ({ sendSMS }))

const enqueue = vi.hoisted(() => vi.fn())
vi.mock('@/lib/unified-job-queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/unified-job-queue')>()
  return { ...actual, jobQueue: { enqueue } }
})

/**
 * A stand-in for private_booking_audit: counts come from `counts` by which window and scope a
 * query asked for, or `countError` fails every count; inserts are collected.
 */
const audit = vi.hoisted(() => ({
  counts: { globalHour: 0, recipientHour: 0, recipientDay: 0 },
  countError: null as null | { message: string },
  inserts: [] as Array<Record<string, unknown>>,
  insertError: null as null | { message: string },
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'private_booking_audit') throw new Error(`unexpected table ${table}`)
      const filters: Record<string, unknown> = {}
      let since = ''
      const builder: any = {
        select: () => builder,
        eq: (column: string, value: unknown) => { filters[column] = value; return builder },
        gte: (_column: string, value: string) => { since = value; return builder },
        then: (resolve: (value: unknown) => unknown) => {
          if (audit.countError) return Promise.resolve({ count: null, error: audit.countError }).then(resolve)
          const perRecipient = 'metadata->>recipient_hash' in filters
          const day = Date.now() - Date.parse(since) > 2 * 60 * 60 * 1000
          const count = !perRecipient ? audit.counts.globalHour : day ? audit.counts.recipientDay : audit.counts.recipientHour
          return Promise.resolve({ count, error: null }).then(resolve)
        },
        insert: (row: Record<string, unknown>) => {
          audit.inserts.push(row)
          return Promise.resolve({ error: audit.insertError })
        },
      }
      return builder
    },
  }),
}))
const { error: logError } = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: logError } }))

import { STAFF_ALERT_SMS_JOB_TYPE, runStaffAlertSmsJob, sendStaffAlertSms } from '@/lib/sms/staff-alert'
import { JobReschedule, UnifiedJobQueue } from '@/lib/unified-job-queue'

const ALERT = {
  to: '+447700900201',
  body: 'New website enquiry: test',
  metadata: { template_key: 'private_booking_enquiry_staff_alert', private_booking_id: 'pb-test-1' },
}

// 14:00 and 23:30 London on 17 November 2026 (GMT, so the same in UTC).
const DAYTIME = new Date('2026-11-17T14:00:00.000Z')
const NIGHT = new Date('2026-11-17T23:30:00.000Z')
const NEXT_MORNING = '2026-11-18T09:00:00.000Z'

describe('staff alert texts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    sendSMS.mockResolvedValue({ success: true, sid: 'SM-test' })
    enqueue.mockResolvedValue({ success: true, jobId: 'job-1' })
    audit.counts = { globalHour: 0, recipientHour: 0, recipientDay: 0 }
    audit.countError = null
    audit.inserts = []
    audit.insertError = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends in the day without making a customer or a message history row', async () => {
    vi.setSystemTime(DAYTIME)

    expect(await sendStaffAlertSms(ALERT)).toEqual({ outcome: 'sent' })

    expect(sendSMS).toHaveBeenCalledTimes(1)
    const [to, body, options] = sendSMS.mock.calls[0]
    expect(to).toBe(ALERT.to)
    expect(body).toBe(ALERT.body)
    expect(options).toEqual({
      createCustomerIfMissing: false,
      skipMessageLogging: true,
      metadata: ALERT.metadata,
    })
    // Quiet hours and the safety guards are never skipped.
    expect(options).not.toHaveProperty('customerId')
    expect(options).not.toHaveProperty('skipQuietHours')
    expect(options).not.toHaveProperty('skipSafetyGuards')
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('holds an overnight alert on the job queue until 09:00 instead of sending it', async () => {
    vi.setSystemTime(NIGHT)

    expect(await sendStaffAlertSms(ALERT)).toEqual({ outcome: 'queued', runAt: NEXT_MORNING })

    expect(sendSMS).not.toHaveBeenCalled()
    expect(enqueue).toHaveBeenCalledTimes(1)
    const [type, payload, options] = enqueue.mock.calls[0]
    expect(type).toBe(STAFF_ALERT_SMS_JOB_TYPE)
    expect(payload).toEqual({ to: ALERT.to, message: ALERT.body, metadata: ALERT.metadata })
    expect(options.delay).toBe(Date.parse(NEXT_MORNING) - NIGHT.getTime())
    expect(options.unique).toMatch(/^send_staff_alert_sms:private_booking_enquiry_staff_alert:[0-9a-f]{24}$/)
    // The number is not copied into the queue's lock key.
    expect(options.unique).not.toContain('7700900201')
  })

  it('holds an alert minutes before 09:00 too, where Twilio scheduling would refuse it', async () => {
    vi.setSystemTime(new Date('2026-11-18T08:52:00.000Z'))

    expect(await sendStaffAlertSms(ALERT)).toEqual({ outcome: 'queued', runAt: NEXT_MORNING })
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('reports a failure to hold the alert rather than throwing', async () => {
    vi.setSystemTime(NIGHT)
    enqueue.mockResolvedValueOnce({ success: false, error: 'db down' })

    expect(await sendStaffAlertSms(ALERT)).toEqual({ outcome: 'failed', error: 'db down' })
  })

  it('reports a kill switch as suspended and other refusals as failed', async () => {
    vi.setSystemTime(DAYTIME)
    sendSMS.mockResolvedValueOnce({ success: false, error: 'SMS sending is currently suspended', code: 'sms_suspended' })
    expect(await sendStaffAlertSms(ALERT)).toEqual({ outcome: 'suspended' })

    sendSMS.mockResolvedValueOnce({ success: false, error: 'Failed to send message' })
    expect(await sendStaffAlertSms(ALERT)).toEqual({ outcome: 'failed', error: 'Failed to send message' })

    sendSMS.mockRejectedValueOnce(new Error('network'))
    expect(await sendStaffAlertSms(ALERT)).toEqual({ outcome: 'failed', error: 'network' })
  })

  describe('the staff alert cap', () => {
    // The defaults in src/lib/sms/safety.ts: 120 an hour in all, 3 an hour and 8 a day per number.
    it('sends under the cap and records one counter row, with no phone number in it', async () => {
      vi.setSystemTime(DAYTIME)
      audit.counts = { globalHour: 119, recipientHour: 2, recipientDay: 7 }

      expect(await sendStaffAlertSms(ALERT)).toEqual({ outcome: 'sent' })

      expect(sendSMS).toHaveBeenCalledTimes(1)
      expect(audit.inserts).toHaveLength(1)
      expect(audit.inserts[0]).toMatchObject({
        booking_id: 'pb-test-1',
        action: 'sms_sent',
        field_name: 'sms',
        new_value: 'private_booking_enquiry_staff_alert',
        metadata: { trigger: 'web_enquiry_staff_alert', recipient_hash: expect.stringMatching(/^[0-9a-f]{24}$/) },
        performed_by: null,
      })
      expect(JSON.stringify(audit.inserts[0])).not.toMatch(/7700900201|900201/)
    })

    it.each([
      ['global hourly', { globalHour: 120, recipientHour: 0, recipientDay: 0 }, 'global_hourly_limit'],
      ['recipient hourly', { globalHour: 0, recipientHour: 3, recipientDay: 3 }, 'recipient_hourly_limit'],
      ['recipient daily', { globalHour: 0, recipientHour: 0, recipientDay: 8 }, 'recipient_daily_limit'],
    ])('does not send over the %s limit, and logs it at error', async (_label, counts, reason) => {
      vi.setSystemTime(DAYTIME)
      audit.counts = counts

      expect(await sendStaffAlertSms(ALERT)).toEqual({ outcome: 'capped', reason })

      expect(sendSMS).not.toHaveBeenCalled()
      expect(audit.inserts).toHaveLength(0)
      expect(logError).toHaveBeenCalledWith(
        'A staff alert text was not sent: staff alert limit reached or could not be checked',
        expect.objectContaining({ metadata: expect.objectContaining({ reason }) })
      )
      expect(JSON.stringify(logError.mock.calls)).not.toContain(ALERT.to)
    })

    it('reads the limits from the SMS safety settings', async () => {
      vi.setSystemTime(DAYTIME)
      vi.stubEnv('SMS_SAFETY_RECIPIENT_HOURLY_LIMIT', '1')
      audit.counts = { globalHour: 1, recipientHour: 1, recipientDay: 1 }
      try {
        expect(await sendStaffAlertSms(ALERT)).toEqual({ outcome: 'capped', reason: 'recipient_hourly_limit' })
      } finally {
        vi.unstubAllEnvs()
      }
    })

    it('fails closed: no send when the count cannot be read', async () => {
      vi.setSystemTime(DAYTIME)
      audit.countError = { message: 'db down' }

      const outcome = await sendStaffAlertSms(ALERT)

      expect(outcome).toEqual({ outcome: 'failed', error: 'count_failed: db down' })
      expect(sendSMS).not.toHaveBeenCalled()
      expect(logError).toHaveBeenCalled()
    })

    it('does not count a duplicate the idempotency claim suppressed', async () => {
      vi.setSystemTime(DAYTIME)
      sendSMS.mockResolvedValueOnce({ success: true, suppressed: true, status: 'suppressed_duplicate' })

      expect(await sendStaffAlertSms(ALERT)).toEqual({ outcome: 'sent' })
      expect(audit.inserts).toHaveLength(0)
    })

    it('logs, without throwing, when a sent alert cannot be counted', async () => {
      vi.setSystemTime(DAYTIME)
      audit.insertError = { message: 'insert failed' }

      expect(await sendStaffAlertSms(ALERT)).toEqual({ outcome: 'sent' })
      expect(logError).toHaveBeenCalledWith(
        'A staff alert text went but could not be counted towards the staff alert limits',
        expect.anything()
      )
    })

    it('applies to the held job send too: over the cap it completes without sending', async () => {
      vi.setSystemTime(new Date(NEXT_MORNING))
      audit.counts = { globalHour: 0, recipientHour: 3, recipientDay: 3 }

      expect(await runStaffAlertSmsJob({ to: ALERT.to, message: ALERT.body, metadata: ALERT.metadata })).toEqual({
        outcome: 'capped',
        reason: 'recipient_hourly_limit',
      })
      expect(sendSMS).not.toHaveBeenCalled()
    })

    it('makes the held job retry, not send, when the count cannot be read', async () => {
      vi.setSystemTime(new Date(NEXT_MORNING))
      audit.countError = { message: 'db down' }

      await expect(runStaffAlertSmsJob({ to: ALERT.to, message: ALERT.body, metadata: ALERT.metadata })).rejects.toThrow(
        'count_failed'
      )
      expect(sendSMS).not.toHaveBeenCalled()
    })
  })

  describe('the send_staff_alert_sms job', () => {
    it('sends when it runs after quiet hours', async () => {
      vi.setSystemTime(new Date(NEXT_MORNING))

      expect(await runStaffAlertSmsJob({ to: ALERT.to, message: ALERT.body, metadata: ALERT.metadata })).toEqual({ outcome: 'sent' })
      expect(sendSMS).toHaveBeenCalledTimes(1)
      expect(enqueue).not.toHaveBeenCalled()
    })

    it('throws on a failed send so the queue retries it', async () => {
      vi.setSystemTime(DAYTIME)
      sendSMS.mockResolvedValueOnce({ success: false, error: 'Failed to send message' })

      await expect(runStaffAlertSmsJob({ to: ALERT.to, message: ALERT.body, metadata: ALERT.metadata })).rejects.toThrow(
        'Staff alert text failed'
      )
    })

    it('refuses a job with no number or message', async () => {
      await expect(runStaffAlertSmsJob({ message: ALERT.body })).rejects.toThrow('missing number or message')
      expect(sendSMS).not.toHaveBeenCalled()
    })

    it('is dispatched by the queue, and reschedules itself if it wakes inside quiet hours', async () => {
      vi.setSystemTime(NIGHT)
      const queue = UnifiedJobQueue.getInstance()

      const result = await (queue as any).executeJob(STAFF_ALERT_SMS_JOB_TYPE, {
        to: ALERT.to,
        message: ALERT.body,
        metadata: ALERT.metadata,
      })

      expect(result).toBeInstanceOf(JobReschedule)
      expect((result as JobReschedule).runAt.toISOString()).toBe(NEXT_MORNING)
      expect(sendSMS).not.toHaveBeenCalled()
      expect(enqueue).not.toHaveBeenCalled()
    })
  })
})
