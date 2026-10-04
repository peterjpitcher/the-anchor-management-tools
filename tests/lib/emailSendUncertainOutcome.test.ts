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

vi.mock('resend', () => ({
  Resend: vi.fn(function Resend() {
    return { emails: { send: resendSend } }
  }),
}))

vi.mock('@/lib/microsoft-graph', () => ({
  isGraphConfigured: graphConfigured,
}))

vi.mock('@microsoft/microsoft-graph-client', () => ({
  Client: {
    initWithMiddleware: vi.fn(() => ({ api: vi.fn(() => ({ post: graphPost })) })),
  },
}))

vi.mock('@azure/identity', () => ({
  ClientSecretCredential: vi.fn(),
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

    it('an answer from Microsoft saying no is a definite refusal', async () => {
      for (const statusCode of [400, 401, 403, 429, 503]) {
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

    it('a refusal returned by the service is definite', async () => {
      resendSend.mockResolvedValue({ data: null, error: { message: 'Invalid `to` field' } })
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
