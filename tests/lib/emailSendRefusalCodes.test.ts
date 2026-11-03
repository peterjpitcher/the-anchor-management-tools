import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A definite refusal says why, so an automatic sender can tell a refusal about this recipient
 * (stop emailing them) from one that refuses every send (stop the run) and from one about this
 * email only. `code` carries the reason; `providerStatus` the provider's own HTTP answer, only
 * when it answered with a refusal (400 to 599).
 */

const resendSend = vi.hoisted(() => vi.fn())
const graphPost = vi.hoisted(() => vi.fn())
const graphConfigured = vi.hoisted(() => vi.fn(() => true))
const getToken = vi.hoisted(() => vi.fn())
const suppressed = vi.hoisted(() => ({ value: false }))

vi.mock('resend', () => ({
  Resend: vi.fn(function Resend() {
    return { emails: { send: resendSend } }
  }),
}))

vi.mock('@/lib/microsoft-graph', () => ({
  isGraphConfigured: graphConfigured,
}))

// Like the real client, the stand-in fetches its access token inside `post()`.
vi.mock('@microsoft/microsoft-graph-client', () => ({
  Client: {
    initWithMiddleware: vi.fn((options: { authProvider: { getAccessToken: () => Promise<string> } }) => ({
      api: vi.fn(() => ({
        post: async (body: unknown) => {
          await options.authProvider.getAccessToken()
          return graphPost(body)
        },
      })),
    })),
  },
}))

vi.mock('@azure/identity', () => ({
  ClientSecretCredential: vi.fn(function ClientSecretCredential() {
    return { getToken }
  }),
}))

const createAdminClient = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

function mockAdminClient(): void {
  const lookup = vi.fn(async () => ({ data: suppressed.value ? { email: 'client@example.com' } : null, error: null }))
  const logMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'email-log-1' }, error: null })
  const logWrite = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ maybeSingle: logMaybeSingle }) })
  createAdminClient.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'email_suppressions') {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: lookup }) }) }
      }
      if (table === 'email_messages') {
        return { insert: logWrite, upsert: logWrite }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })
}

const message = { to: 'client@example.com', subject: 'Training reminder', text: 'Hello' }

describe('sendEmail says why a send was refused', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    suppressed.value = false
    graphConfigured.mockReturnValue(true)
    getToken.mockResolvedValue({ token: 'token-1' })
    mockAdminClient()
    process.env.RESEND_API_KEY = 're_test'
    process.env.EMAIL_FROM_ADDRESS = 'The Anchor <noreply@example.test>'
    process.env.MICROSOFT_USER_EMAIL = 'accounts@example.test'
    delete process.env.SUSPEND_ALL_EMAIL
    delete process.env.SUSPEND_ALL_COMMS
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('a suppressed address is recipient_suppressed, and no provider is asked', async () => {
    suppressed.value = true
    const { sendEmail } = await import('@/lib/email/emailService')

    for (const provider of ['resend', 'graph'] as const) {
      const result = await sendEmail({ ...message, provider })
      expect(result).toMatchObject({ success: false, code: 'recipient_suppressed' })
      expect(result.providerStatus).toBeUndefined()
    }
    expect(resendSend).not.toHaveBeenCalled()
    expect(graphPost).not.toHaveBeenCalled()
  })

  describe('through Resend', () => {
    it('a bad to address is recipient_rejected, with the status', async () => {
      resendSend.mockResolvedValue({
        data: null,
        error: { name: 'validation_error', statusCode: 422, message: 'Invalid `to` field. The email address needs to follow the `email@example.com` format.' },
      })
      const { sendEmail } = await import('@/lib/email/emailService')

      const result = await sendEmail({ ...message, provider: 'resend' })

      expect(result).toMatchObject({ success: false, code: 'recipient_rejected', providerStatus: 422 })
      expect(result.uncertain).toBeUndefined()
    })

    it('another validation error is not about the recipient: status only', async () => {
      resendSend.mockResolvedValue({ data: null, error: { name: 'validation_error', statusCode: 422, message: 'Invalid `from` field.' } })
      const { sendEmail } = await import('@/lib/email/emailService')

      const result = await sendEmail({ ...message, provider: 'resend' })

      expect(result.code).toBeUndefined()
      expect(result.providerStatus).toBe(422)
    })

    it('a refused key or a rate limit carries the status', async () => {
      for (const statusCode of [401, 403, 429]) {
        resendSend.mockResolvedValue({ data: null, error: { name: 'restricted_api_key', statusCode, message: 'refused' } })
        const { sendEmail } = await import('@/lib/email/emailService')

        const result = await sendEmail({ ...message, provider: 'resend' })

        expect(result).toMatchObject({ success: false, providerStatus: statusCode })
        expect(result.code).toBeUndefined()
      }
    })

    it('a dropped connection has no status to report', async () => {
      resendSend.mockResolvedValue({ data: null, error: { name: 'application_error', statusCode: null, message: 'Unable to fetch data.' } })
      const { sendEmail } = await import('@/lib/email/emailService')

      const result = await sendEmail({ ...message, provider: 'resend' })

      expect(result).toMatchObject({ success: false, uncertain: true })
      expect(result.providerStatus).toBeUndefined()
      expect(result.code).toBeUndefined()
    })

    it('no key set is email_not_configured', async () => {
      delete process.env.RESEND_API_KEY
      const { sendEmail } = await import('@/lib/email/emailService')

      const result = await sendEmail({ ...message, provider: 'resend' })

      expect(result).toMatchObject({ success: false, code: 'email_not_configured' })
      expect(resendSend).not.toHaveBeenCalled()
    })
  })

  describe('through the mailbox route (Microsoft Graph)', () => {
    it('a sign-in failure is email_sign_in_failed', async () => {
      getToken.mockRejectedValue(new Error('AADSTS7000222: the client secret has expired'))
      const { sendEmail } = await import('@/lib/email/emailService')

      const result = await sendEmail({ ...message, provider: 'graph' })

      expect(result).toMatchObject({ success: false, code: 'email_sign_in_failed' })
      expect(result.uncertain).toBeUndefined()
      expect(graphPost).not.toHaveBeenCalled()
    })

    it('a refused recipient is recipient_rejected, with the status', async () => {
      graphPost.mockRejectedValue(Object.assign(new Error('Invalid recipients'), { statusCode: 400, code: 'ErrorInvalidRecipients' }))
      const { sendEmail } = await import('@/lib/email/emailService')

      const result = await sendEmail({ ...message, provider: 'graph' })

      expect(result).toMatchObject({ success: false, code: 'recipient_rejected', providerStatus: 400 })
    })

    it('a refusal for another reason carries the status only', async () => {
      graphPost.mockRejectedValue(Object.assign(new Error('Forbidden'), { statusCode: 403, code: 'ErrorAccessDenied' }))
      const { sendEmail } = await import('@/lib/email/emailService')

      const result = await sendEmail({ ...message, provider: 'graph' })

      expect(result).toMatchObject({ success: false, providerStatus: 403 })
      expect(result.code).toBeUndefined()
    })

    it('a timeout reports no status (-1 is not an answer)', async () => {
      graphPost.mockRejectedValue(Object.assign(new Error('ETIMEDOUT'), { statusCode: -1 }))
      const { sendEmail } = await import('@/lib/email/emailService')

      const result = await sendEmail({ ...message, provider: 'graph' })

      expect(result).toMatchObject({ success: false, uncertain: true })
      expect(result.providerStatus).toBeUndefined()
    })

    it('a mailbox that is not set up is email_not_configured', async () => {
      graphConfigured.mockReturnValue(false)
      const { sendEmail } = await import('@/lib/email/emailService')

      const result = await sendEmail({ ...message, provider: 'graph' })

      expect(result).toMatchObject({ success: false, code: 'email_not_configured' })
      expect(graphPost).not.toHaveBeenCalled()
    })
  })
})
