import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Two things the Resend outage of 13 and 14 November 2026 and the Sunday rota email showed:
 * - when email itself is broken a person must hear another way, because every alert is an email;
 * - "too many requests" is a definite refusal, so the send is asked again instead of being lost.
 */

const resendSend = vi.hoisted(() => vi.fn())
const textOps = vi.hoisted(() => vi.fn())
const suppressed = vi.hoisted(() => ({ value: false }))

vi.mock('resend', () => ({
  Resend: vi.fn(function Resend() {
    return { emails: { send: resendSend } }
  }),
}))
vi.mock('@/lib/microsoft-graph', () => ({ isGraphConfigured: vi.fn(() => false) }))
vi.mock('@/lib/ops-alerts/email-fault-text', () => ({ textOpsAboutEmailFault: textOps }))

const createAdminClient = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

function mockAdminClient(): void {
  const lookup = vi.fn(async () => ({ data: suppressed.value ? { email: 'guest@example.com' } : null, error: null }))
  const logMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'email-log-1' }, error: null })
  const logWrite = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ maybeSingle: logMaybeSingle }) })
  createAdminClient.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'email_suppressions') {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: lookup }) }) }
      }
      if (table === 'email_messages') return { insert: logWrite, upsert: logWrite }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })
}

const guestEmail = { to: 'guest@example.com', subject: 'Your booking', text: 'Hello', provider: 'resend' as const }
const alertEmail = { to: 'Manager@The-Anchor.example', subject: '[CRON FAILURE] job - production', text: 'Failed', provider: 'resend' as const }
const refusal = (statusCode: number | null, message: string) => ({ data: null, error: { name: 'error', statusCode, message } })

describe('sendEmail when email itself is broken', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    suppressed.value = false
    mockAdminClient()
    textOps.mockResolvedValue(true)
    process.env.RESEND_API_KEY = 're_test'
    process.env.EMAIL_FROM_ADDRESS = 'The Anchor <noreply@example.test>'
    process.env.CRON_ALERT_EMAIL = 'manager@the-anchor.example'
    delete process.env.COMMS_ALERT_EMAIL
    delete process.env.SUSPEND_ALL_EMAIL
    delete process.env.SUSPEND_ALL_COMMS
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    process.env = { ...originalEnv }
  })

  async function send(options: typeof guestEmail) {
    const { sendEmail } = await import('@/lib/email/emailService')
    const pending = sendEmail(options)
    await vi.runAllTimersAsync()
    return pending
  }

  it('texts the operations mobile when the provider refuses our key, whoever the email was for', async () => {
    resendSend.mockResolvedValue(refusal(403, 'API key is invalid'))

    const result = await send(guestEmail)

    expect(result).toMatchObject({ success: false, providerStatus: 403 })
    expect(textOps).toHaveBeenCalledTimes(1)
    expect(textOps).toHaveBeenCalledWith('provider_rejected_key')
    // A refused key is not a rate limit: it is asked once.
    expect(resendSend).toHaveBeenCalledTimes(1)
  })

  it('texts when an alert email cannot be sent, matching the inbox whatever its case', async () => {
    resendSend.mockResolvedValue(refusal(500, 'Internal server error'))

    await send(alertEmail)

    expect(textOps).toHaveBeenCalledWith('alert_email_failed')
  })

  it('texts nobody for an ordinary failed guest email, a suppressed address or a sent email', async () => {
    resendSend.mockResolvedValue(refusal(500, 'Internal server error'))
    await send(guestEmail)

    suppressed.value = true
    await send({ ...alertEmail, to: 'guest@example.com' })
    suppressed.value = false

    resendSend.mockResolvedValue({ data: { id: 'msg-1' }, error: null })
    expect(await send(alertEmail)).toMatchObject({ success: true })

    expect(textOps).not.toHaveBeenCalled()
  })

  it('texts nobody while the email kill switch is on', async () => {
    process.env.SUSPEND_ALL_EMAIL = 'true'
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await send(alertEmail)).toMatchObject({ success: false, code: 'email_suspended' })
    expect(textOps).not.toHaveBeenCalled()
    expect(resendSend).not.toHaveBeenCalled()
  })

  it('asks again after "too many requests" and sends', async () => {
    resendSend
      .mockResolvedValueOnce(refusal(429, 'Too many requests. You can only make 10 requests per second.'))
      .mockResolvedValueOnce({ data: { id: 'msg-2' }, error: null })

    const result = await send(guestEmail)

    expect(result).toMatchObject({ success: true, messageId: 'msg-2' })
    expect(resendSend).toHaveBeenCalledTimes(2)
    expect(textOps).not.toHaveBeenCalled()
  })

  it('gives up after two more tries and reports the rate limit', async () => {
    resendSend.mockResolvedValue(refusal(429, 'Too many requests'))

    const result = await send(guestEmail)

    expect(result).toMatchObject({ success: false, providerStatus: 429, error: 'Too many requests' })
    expect(resendSend).toHaveBeenCalledTimes(3)
  })

  it('reuses the idempotency key on each try', async () => {
    resendSend
      .mockResolvedValueOnce(refusal(429, 'Too many requests'))
      .mockResolvedValueOnce({ data: { id: 'msg-3' }, error: null })

    await send({ ...guestEmail, idempotencyKey: 'marketing:c1:s1' } as typeof guestEmail)

    expect(resendSend.mock.calls.map((call) => call[1])).toEqual([
      { idempotencyKey: 'marketing:c1:s1' },
      { idempotencyKey: 'marketing:c1:s1' },
    ])
  })
})
