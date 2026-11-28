import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/emailService'
import { logger } from '@/lib/logger'
import { alertManagerToWrittenOptOut } from '@/lib/sms/opt-out-alert'

const input = {
  customerId: 'cust-1',
  fromNumber: '+447700900123',
  body: 'Please take me off your list, thanks',
  channel: 'sms',
}

function stubCustomer() {
  ;(createAdminClient as unknown as Mock).mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { first_name: 'Jo', last_name: 'Bloggs' }, error: null }) }),
      }),
    }),
  })
}

describe('alertManagerToWrittenOptOut', () => {
  const original = process.env.COMMS_ALERT_EMAIL

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.COMMS_ALERT_EMAIL = 'alerts@example.test'
    stubCustomer()
  })

  afterEach(() => {
    if (original === undefined) delete process.env.COMMS_ALERT_EMAIL
    else process.env.COMMS_ALERT_EMAIL = original
  })

  it('emails the comms alert address with the guest words and a link to their record', async () => {
    ;(sendEmail as unknown as Mock).mockResolvedValue({ success: true })

    await expect(alertManagerToWrittenOptOut(input)).resolves.toBe(true)

    const options = (sendEmail as unknown as Mock).mock.calls[0][0]
    expect(options.to).toBe('alerts@example.test')
    expect(options.subject).toBe('Jo Bloggs asked us to stop messaging them')
    expect(options.html).toContain('Please take me off your list, thanks')
    expect(options.html).toContain('https://management.example.test/customers/cust-1')
    expect(options.html).not.toContain('+447700900123')
  })

  it('logs an error and does not throw when the email fails', async () => {
    ;(sendEmail as unknown as Mock).mockResolvedValue({ success: false, error: 'provider down' })

    await expect(alertManagerToWrittenOptOut(input)).resolves.toBe(false)
    expect(logger.error).toHaveBeenCalled()
  })

  it('logs an error when no alert address is set', async () => {
    delete process.env.COMMS_ALERT_EMAIL
    const cron = process.env.CRON_ALERT_EMAIL
    delete process.env.CRON_ALERT_EMAIL

    await expect(alertManagerToWrittenOptOut(input)).resolves.toBe(false)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalled()

    if (cron !== undefined) process.env.CRON_ALERT_EMAIL = cron
  })
})
