import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * reportCronFailure says whether the alert email went, so withCronRun only quiets the next hour
 * after an alert that was actually delivered (PR 262 review). It still never throws.
 */

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example' }))

import { reportCronFailure } from '@/lib/cron/alerting'

const ORIGINAL = process.env.CRON_ALERT_EMAIL

beforeEach(() => {
  process.env.CRON_ALERT_EMAIL = 'alerts@example.com'
  sendEmail.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  process.env.CRON_ALERT_EMAIL = ORIGINAL
  vi.restoreAllMocks()
})

describe('reportCronFailure', () => {
  it('answers true when the email was accepted', async () => {
    sendEmail.mockResolvedValue({ success: true, messageId: 'm-1' })
    await expect(reportCronFailure('test-job', new Error('down'))).resolves.toBe(true)
  })

  it('answers false when the send failed', async () => {
    sendEmail.mockResolvedValue({ success: false, error: 'Resend 500' })
    await expect(reportCronFailure('test-job', new Error('down'))).resolves.toBe(false)
  })

  it('answers false, and does not throw, when the send threw', async () => {
    sendEmail.mockRejectedValue(new Error('network'))
    await expect(reportCronFailure('test-job', new Error('down'))).resolves.toBe(false)
  })

  it('answers false when no alert inbox is set', async () => {
    delete process.env.CRON_ALERT_EMAIL
    await expect(reportCronFailure('test-job', new Error('down'))).resolves.toBe(false)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
