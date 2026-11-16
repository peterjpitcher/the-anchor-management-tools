import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendSMS = vi.hoisted(() => vi.fn())
vi.mock('@/lib/twilio', () => ({ sendSMS }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { EMAIL_FAULT_ALERT_TEMPLATE_KEY, emailFaultAlertSlot, textOpsAboutEmailFault } from '@/lib/ops-alerts/email-fault-text'

describe('the text sent when email itself is broken', () => {
  const saved = process.env.OPS_ALERT_SMS_NUMBER
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OPS_ALERT_SMS_NUMBER = '+447700900123'
    sendSMS.mockResolvedValue({ success: true, sid: 'SM1' })
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    if (saved === undefined) delete process.env.OPS_ALERT_SMS_NUMBER
    else process.env.OPS_ALERT_SMS_NUMBER = saved
    errorSpy.mockRestore()
  })

  it('texts the operations mobile, outside the guest rules, once per reason per hour', async () => {
    expect(await textOpsAboutEmailFault('provider_rejected_key')).toBe(true)

    expect(sendSMS).toHaveBeenCalledTimes(1)
    const [to, body, options] = sendSMS.mock.calls[0]
    expect(to).toBe('+447700900123')
    expect(body).toContain('refusing our sign-in')
    expect(body).not.toMatch(/undefined|NaN|Invalid Date/)
    expect(options).toMatchObject({
      createCustomerIfMissing: false,
      skipMessageLogging: true,
      skipQuietHours: true,
      metadata: { template_key: EMAIL_FAULT_ALERT_TEMPLATE_KEY, stage: emailFaultAlertSlot('provider_rejected_key') },
    })
  })

  it('uses the hour as the dedupe slot, and a slot of its own for each reason', () => {
    const at = (iso: string) => new Date(iso)
    expect(emailFaultAlertSlot('alert_email_failed', at('2026-11-14T07:40:00Z'))).toBe(
      emailFaultAlertSlot('alert_email_failed', at('2026-11-14T07:59:59Z'))
    )
    expect(emailFaultAlertSlot('alert_email_failed', at('2026-11-14T07:40:00Z'))).not.toBe(
      emailFaultAlertSlot('alert_email_failed', at('2026-11-14T08:00:00Z'))
    )
    expect(emailFaultAlertSlot('alert_email_failed', at('2026-11-14T07:40:00Z'))).not.toBe(
      emailFaultAlertSlot('provider_rejected_key', at('2026-11-14T07:40:00Z'))
    )
  })

  it('sends nothing and says so when no number is set', async () => {
    delete process.env.OPS_ALERT_SMS_NUMBER

    expect(await textOpsAboutEmailFault('alert_email_failed')).toBe(false)
    expect(sendSMS).not.toHaveBeenCalled()
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('no operations mobile is set')
  })

  it('never throws, whatever the text sender does', async () => {
    sendSMS.mockRejectedValueOnce(new Error('twilio down'))
    expect(await textOpsAboutEmailFault('alert_email_failed')).toBe(false)

    sendSMS.mockResolvedValueOnce({ success: false, error: 'SMS sending paused by safety guard' })
    expect(await textOpsAboutEmailFault('alert_email_failed')).toBe(false)
  })
})
