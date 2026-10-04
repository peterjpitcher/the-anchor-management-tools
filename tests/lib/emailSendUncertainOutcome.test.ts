import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A failed send is one of two different things, and an automatic sender has to know which.
 *
 *  - Definitely refused: the provider (or a check before it) said no. Nothing was sent, so
 *    it is safe to try again.
 *  - Unknown: the request left and then timed out or the connection dropped. The email may
 *    have been sent. Retrying could put the same reminder or receipt in a customer's inbox
 *    twice, so `sendEmail` marks it `uncertain` and the invoice jobs leave it for a person.
 */

const resendSend = vi.hoisted(() => vi.fn())
const graphPost = vi.hoisted(() => vi.fn())
const graphConfigured = vi.hoisted(() => vi.fn(() => true))
const getToken = vi.hoisted(() => vi.fn())

vi.mock('resend', () => ({
  Resend: vi.fn(function Resend() {
    return { emails: { send: resendSend } }
  }),
}))

vi.mock('@/lib/microsoft-graph', () => ({
  isGraphConfigured: graphConfigured,
}))

// Like the real client, the stand-in fetches its access token inside `post()`, so a sign-in
// failure surfaces from the same call as a mail failure.
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

function mockAdminClient() {
  const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  const logMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 'email-log-1' }, error: null })
  const logWrite = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ maybeSingle: logMaybeSingle }) })
  createAdminClient.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'email_suppressions') {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) }) }
      }
      if (table === 'email_messages') {
        return { insert: logWrite, upsert: logWrite }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })
}

const message = { to: 'client@example.com', subject: 'Invoice INV-1', text: 'Hello' }

describe('sendEmail tells a refusal from an unknown outcome', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    graphConfigured.mockReturnValue(true)
    getToken.mockResolvedValue({ token: 'token-1' })
    mockAdminClient()
    process.env.RESEND_API_KEY = 're_test'
    process.env.EMAIL_FROM_ADDRESS = 'Orange Jelly Limited <noreply@auth.orangejelly.co.uk>'
    process.env.MICROSOFT_USER_EMAIL = 'accounts@orangejelly.example'
    delete process.env.SUSPEND_ALL_EMAIL
    delete process.env.SUSPEND_ALL_COMMS
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('through the mailbox route (Microsoft Graph)', () => {
    it('a timeout after the request left is uncertain', async () => {
      graphPost.mockRejectedValue(Object.assign(new Error('ETIMEDOUT'), { statusCode: -1 }))
      const { sendEmail } = await import('@/lib/email/emailService')

      const result = await sendEmail({ ...message, provider: 'graph' })

      expect(result.success).toBe(false)
      expect(result.uncertain).toBe(true)
    })

    it('an error with no status at all is uncertain', async () => {
      graphPost.mockRejectedValue(new Error('socket hang up'))
      const { sendEmail } = await import('@/lib/email/emailService')

      const result = await sendEmail({ ...message, provider: 'graph' })

      expect(result).toMatchObject({ success: false, uncertain: true })
    })

    // A gateway error can follow a message the service had already taken, so only a 4xx
    // ("I read your request and the answer is no") is treated as a definite refusal.
    it('a server error from Microsoft is uncertain', async () => {
      for (const statusCode of [500, 502, 503, 504]) {
        graphPost.mockRejectedValue(Object.assign(new Error('server error'), { statusCode }))
        const { sendEmail } = await import('@/lib/email/emailService')

        const result = await sendEmail({ ...message, provider: 'graph' })

        expect(result).toMatchObject({ success: false, uncertain: true })
      }
    })

    // An expired client secret fails inside the same call, with no status. Nothing reached the
    // mail service, so it must NOT be parked as "may have been sent": every reminder and
    // receipt would be stopped for good for as long as the secret stayed expired.
    it('a sign-in failure is a definite non-send', async () => {
      getToken.mockRejectedValue(new Error('AADSTS7000222: the client secret has expired'))
      const { sendEmail } = await import('@/lib/email/emailService')

      const result = await sendEmail({ ...message, provider: 'graph' })

      expect(result.success).toBe(false)
      expect(result.uncertain).toBeUndefined()
      expect(graphPost).not.toHaveBeenCalled()
    })

    it('an answer from Microsoft saying no is a definite refusal', async () => {
      for (const statusCode of [400, 401, 403, 404, 429]) {
        graphPost.mockRejectedValue(Object.assign(new Error('refused'), { statusCode }))
        const { sendEmail } = await import('@/lib/email/emailService')

        const result = await sendEmail({ ...message, provider: 'graph' })

        expect(result.success).toBe(false)
        expect(result.uncertain).toBeUndefined()
      }
    })

    it('a mailbox that is not configured never sent anything', async () => {
      graphConfigured.mockReturnValue(false)
      const { sendEmail } = await import('@/lib/email/emailService')

      const result = await sendEmail({ ...message, provider: 'graph' })

      expect(result.success).toBe(false)
      expect(result.uncertain).toBeUndefined()
      expect(graphPost).not.toHaveBeenCalled()
    })

    it('an accepted email is a success and never uncertain', async () => {
      graphPost.mockResolvedValue(undefined)
      const { sendEmail } = await import('@/lib/email/emailService')

      const result = await sendEmail({ ...message, provider: 'graph' })

      expect(result.success).toBe(true)
      expect(result.uncertain).toBeUndefined()
    })
  })

  describe('through Resend', () => {
    it('a thrown network error after the request left is uncertain', async () => {
      resendSend.mockRejectedValue(new Error('fetch failed'))
      const { sendEmail } = await import('@/lib/email/emailService')

      const result = await sendEmail({ ...message, provider: 'resend' })

      expect(result).toMatchObject({ success: false, uncertain: true })
    })

    // What the Resend SDK really does when the connection fails: it does not throw, it returns
    // an error with no status. Without this the reminder job released its claim and sent the
    // same reminder again the next weekday.
    it('a dropped connection reported by the SDK is uncertain', async () => {
      resendSend.mockResolvedValue({
        data: null,
        error: { name: 'application_error', statusCode: null, message: 'Unable to fetch data. The request could not be resolved.' },
      })
      const { sendEmail } = await import('@/lib/email/emailService')

      const result = await sendEmail({ ...message, provider: 'resend' })

      expect(result).toMatchObject({ success: false, uncertain: true })
    })

    it('a server error from the service is uncertain', async () => {
      resendSend.mockResolvedValue({ data: null, error: { name: 'internal_server_error', statusCode: 500, message: 'Something went wrong' } })
      const { sendEmail } = await import('@/lib/email/emailService')

      const result = await sendEmail({ ...message, provider: 'resend' })

      expect(result).toMatchObject({ success: false, uncertain: true })
    })

    it('a refusal returned by the service is definite', async () => {
      resendSend.mockResolvedValue({ data: null, error: { name: 'validation_error', statusCode: 422, message: 'Invalid `to` field' } })
      const { sendEmail } = await import('@/lib/email/emailService')

      const result = await sendEmail({ ...message, provider: 'resend' })

      expect(result.success).toBe(false)
      expect(result.uncertain).toBeUndefined()
    })
  })

  it('a kill switch refusal is definite: nothing left the building', async () => {
    process.env.SUSPEND_ALL_EMAIL = 'true'
    const { sendEmail } = await import('@/lib/email/emailService')

    const result = await sendEmail({ ...message, provider: 'graph' })

    expect(result).toMatchObject({ success: false, code: 'email_suspended' })
    expect(result.uncertain).toBeUndefined()
    expect(graphPost).not.toHaveBeenCalled()
  })
})
