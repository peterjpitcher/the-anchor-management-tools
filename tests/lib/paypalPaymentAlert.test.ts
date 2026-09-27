import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The staff alert for PayPal money a person has to look at (reversals, refunds the app could not
 * record). It must only ever reach the staff alert inbox, and a missing inbox must be loud, not
 * silently treated as "told".
 */

vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))

import { sendEmail } from '@/lib/email/emailService'
import { reportPaymentAlert } from '@/lib/cron/alerting'

const ORIGINAL_ALERT_EMAIL = process.env.CRON_ALERT_EMAIL

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(sendEmail).mockResolvedValue({ success: true } as never)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  if (ORIGINAL_ALERT_EMAIL === undefined) delete process.env.CRON_ALERT_EMAIL
  else process.env.CRON_ALERT_EMAIL = ORIGINAL_ALERT_EMAIL
})

describe('reportPaymentAlert', () => {
  it('emails the staff alert inbox and nobody else, with the context escaped', async () => {
    process.env.CRON_ALERT_EMAIL = 'alerts@example.test'

    const result = await reportPaymentAlert({
      title: 'PayPal took back £60.00 on a table booking deposit',
      summary: 'PayPal reversed £60.00 <b>of a payment</b>.',
      context: { Record: 'table_bookings 11111111-1111-4111-8111-111111111111', Link: null },
    })

    expect(result).toEqual({ sent: true })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const options = vi.mocked(sendEmail).mock.calls[0][0]
    expect(options.to).toBe('alerts@example.test')
    expect(options.subject).toMatch(/^\[PAYPAL ACTION NEEDED\] PayPal took back £60\.00 on a table booking deposit - /)
    expect(options.html).toContain('&lt;b&gt;of a payment&lt;/b&gt;')
    // A booking id is not a phone number: it reaches staff intact.
    expect(options.html).toContain('11111111-1111-4111-8111-111111111111')
    // Empty context values are left out rather than printed as "null".
    expect(options.html).not.toContain('>Link<')
  })

  it('reports that nobody was told when no alert inbox is configured', async () => {
    delete process.env.CRON_ALERT_EMAIL

    const result = await reportPaymentAlert({ title: 'PayPal took back £5.00', summary: 'x' })

    expect(result).toEqual({ sent: false, reason: 'not_configured' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('reports a failed send rather than throwing', async () => {
    process.env.CRON_ALERT_EMAIL = 'alerts@example.test'
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'provider down' } as never)

    const result = await reportPaymentAlert({ title: 'PayPal took back £5.00', summary: 'x' })

    expect(result).toEqual({ sent: false, reason: 'send_failed' })
  })
})
