// A send refused because the address is on the suppression list carries its own code, so a caller
// can tell staff the address is blocked instead of blaming the email service (correctness#5). The
// wording of the error is not a contract; the code is.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const resendSend = vi.hoisted(() => vi.fn())

vi.mock('resend', () => ({
  Resend: vi.fn(function Resend() {
    return { emails: { send: resendSend } }
  }),
}))

vi.mock('@/lib/microsoft-graph', () => ({
  isGraphConfigured: vi.fn(() => false),
}))

const createAdminClient = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient,
}))

function suppressedClient(options: { logFails?: boolean } = {}) {
  const suppressionMaybeSingle = vi.fn().mockResolvedValue({ data: { email: 'starter@example.com' }, error: null })
  const emailLogMaybeSingle = options.logFails
    ? vi.fn().mockResolvedValue({ data: null, error: { message: 'email_messages insert failed' } })
    : vi.fn().mockResolvedValue({ data: { id: 'email-log-1' }, error: null })
  const emailLogSelect = vi.fn().mockReturnValue({ maybeSingle: emailLogMaybeSingle })

  createAdminClient.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'email_suppressions') {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: suppressionMaybeSingle }) }) }
      }
      if (table === 'email_messages') {
        return {
          insert: vi.fn().mockReturnValue({ select: emailLogSelect }),
          upsert: vi.fn().mockReturnValue({ select: emailLogSelect }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })
}

describe('sendEmail to a suppressed address', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 're_test'
    process.env.EMAIL_FROM_ADDRESS = 'The Anchor <noreply@auth.orangejelly.co.uk>'
    delete process.env.SUSPEND_ALL_EMAIL
    delete process.env.SUSPEND_ALL_COMMS
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('refuses with the recipient_suppressed code and never asks the provider', async () => {
    suppressedClient()

    const { sendEmail } = await import('@/lib/email/emailService')
    const result = await sendEmail({ to: 'starter@example.com', subject: 'Payslip', text: 'Hello' })

    expect(result).toMatchObject({ success: false, code: 'recipient_suppressed' })
    expect(result.uncertain).toBeUndefined()
    expect(resendSend).not.toHaveBeenCalled()
  })

  it('keeps the code when the suppressed send could not be logged', async () => {
    suppressedClient({ logFails: true })

    const { sendEmail } = await import('@/lib/email/emailService')
    // requireLog makes the missing log row an error, which takes the other suppressed return.
    const result = await sendEmail({ to: 'starter@example.com', subject: 'Payslip', text: 'Hello', requireLog: true })

    expect(result).toMatchObject({ success: false, error: 'Email sent state could not be logged', code: 'recipient_suppressed' })
    expect(resendSend).not.toHaveBeenCalled()
  })
})
