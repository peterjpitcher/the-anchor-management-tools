import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  invoiceEmailProvider,
  invoicePayPalReceiptsFrom,
  invoiceRemindersGoLiveDate,
} from '@/lib/invoices/release-switches'

// Each switch must fail closed: unset, empty or mistyped means off. Deploying the code must
// not start any new customer email by itself.
describe('invoice release switches', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('are all off when nothing is set', () => {
    vi.stubEnv('INVOICE_EMAIL_PROVIDER', '')
    vi.stubEnv('INVOICE_REMINDERS_GO_LIVE_DATE', '')
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '')
    expect(invoiceEmailProvider()).toBeUndefined()
    expect(invoiceRemindersGoLiveDate()).toBeNull()
    expect(invoicePayPalReceiptsFrom()).toBeNull()
  })

  it('pins the mailbox route only for the exact value graph', () => {
    vi.stubEnv('INVOICE_EMAIL_PROVIDER', ' Graph ')
    expect(invoiceEmailProvider()).toBe('graph')
    for (const wrong of ['resend', 'true', 'yes', 'microsoft']) {
      vi.stubEnv('INVOICE_EMAIL_PROVIDER', wrong)
      expect(invoiceEmailProvider()).toBeUndefined()
    }
  })

  it('accepts a real calendar date and nothing else', () => {
    vi.stubEnv('INVOICE_REMINDERS_GO_LIVE_DATE', '2026-10-19')
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', ' 2026-10-12 ')
    expect(invoiceRemindersGoLiveDate()).toBe('2026-10-19')
    expect(invoicePayPalReceiptsFrom()).toBe('2026-10-12')

    for (const wrong of ['19/10/2026', '2026-10-19T09:30:00Z', '2026-02-31', '2026-13-01', 'true', 'tomorrow']) {
      vi.stubEnv('INVOICE_REMINDERS_GO_LIVE_DATE', wrong)
      vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', wrong)
      expect(invoiceRemindersGoLiveDate()).toBeNull()
      expect(invoicePayPalReceiptsFrom()).toBeNull()
    }
  })
})
