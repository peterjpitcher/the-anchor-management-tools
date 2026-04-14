import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/cron/alerting', () => ({
  escapeHtml: vi.fn((s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;')),
  redactPii: vi.fn((s: string) =>
    s
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
      .replace(/\+?\d[\d\s\-().]{6,}\d/g, '[REDACTED_PHONE]')
  ),
}))

import { sendBillingRunAlert, type BillingRunResults } from '@/lib/oj-projects/billing-alerts'
import { sendEmail } from '@/lib/email/emailService'
import { redactPii } from '@/lib/cron/alerting'

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  // Set a default alert email
  process.env.OJ_PROJECTS_BILLING_ALERT_EMAIL = 'alerts@test.com'
  process.env.PAYROLL_ACCOUNTANT_EMAIL = 'payroll@test.com'
  process.env.NODE_ENV = 'test'
  process.env.NEXT_PUBLIC_APP_URL = 'https://test.example.com'
})

afterEach(() => {
  // Restore original env
  process.env = { ...originalEnv }
})

function makeResults(overrides: Partial<BillingRunResults> = {}): BillingRunResults {
  return {
    period: '2026-04',
    invoice_date: '2026-04-01',
    processed: 5,
    sent: 3,
    skipped: 1,
    failed: 1,
    vendors: [
      {
        vendor_id: 'v-1',
        vendor_name: 'Test Vendor',
        status: 'failed',
        error: 'DB connection timeout',
      },
    ],
    ...overrides,
  }
}

describe('sendBillingRunAlert', () => {
  it('sends email when there are failures', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: true })

    await sendBillingRunAlert(makeResults())

    expect(sendEmail).toHaveBeenCalledTimes(1)
    const call = vi.mocked(sendEmail).mock.calls[0][0]
    expect(call.to).toBe('alerts@test.com')
    expect(call.subject).toContain('OJ Projects Billing Alert')
    expect(call.subject).toContain('2026-04')
    expect(call.subject).toContain('1 issue')
    expect(call.html).toContain('Failed Vendors')
  })

  it('does not send when no failures', async () => {
    const results = makeResults({
      failed: 0,
      vendors: [
        { vendor_id: 'v-1', vendor_name: 'OK Vendor', status: 'sent', invoice_id: 'inv-1' },
      ],
    })

    await sendBillingRunAlert(results)

    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('does not send when vendor list is empty', async () => {
    const results = makeResults({ failed: 0, vendors: [] })

    await sendBillingRunAlert(results)

    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('uses OJ_PROJECTS_BILLING_ALERT_EMAIL as primary env var', async () => {
    process.env.OJ_PROJECTS_BILLING_ALERT_EMAIL = 'primary@test.com'
    process.env.PAYROLL_ACCOUNTANT_EMAIL = 'fallback@test.com'
    vi.mocked(sendEmail).mockResolvedValue({ success: true })

    await sendBillingRunAlert(makeResults())

    const call = vi.mocked(sendEmail).mock.calls[0][0]
    expect(call.to).toBe('primary@test.com')
  })

  it('falls back to PAYROLL_ACCOUNTANT_EMAIL when primary is not set', async () => {
    delete process.env.OJ_PROJECTS_BILLING_ALERT_EMAIL
    process.env.PAYROLL_ACCOUNTANT_EMAIL = 'fallback@test.com'
    vi.mocked(sendEmail).mockResolvedValue({ success: true })

    await sendBillingRunAlert(makeResults())

    const call = vi.mocked(sendEmail).mock.calls[0][0]
    expect(call.to).toBe('fallback@test.com')
  })

  it('skips sending when neither env var is configured', async () => {
    delete process.env.OJ_PROJECTS_BILLING_ALERT_EMAIL
    delete process.env.PAYROLL_ACCOUNTANT_EMAIL

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await sendBillingRunAlert(makeResults())

    expect(sendEmail).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('No alert email configured')
    )

    consoleSpy.mockRestore()
  })

  it('redacts PII from vendor names in error context', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: true })

    const results = makeResults({
      vendors: [
        {
          vendor_id: 'v-1',
          vendor_name: 'John at john@example.com +447995087315',
          status: 'failed',
          error: 'DB error',
        },
      ],
    })

    await sendBillingRunAlert(results)

    // redactPii should have been called with the vendor name
    expect(redactPii).toHaveBeenCalledWith(
      'John at john@example.com +447995087315'
    )
  })

  it('does not throw when sendEmail fails', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'SMTP down' })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Should not throw
    await expect(sendBillingRunAlert(makeResults())).resolves.toBeUndefined()

    consoleSpy.mockRestore()
  })

  it('does not throw when sendEmail throws', async () => {
    vi.mocked(sendEmail).mockRejectedValue(new Error('Network failure'))

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(sendBillingRunAlert(makeResults())).resolves.toBeUndefined()

    consoleSpy.mockRestore()
  })
})
