import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const verifyWebhook = vi.hoisted(() => vi.fn())

vi.mock('resend', () => ({
  Resend: vi.fn(function Resend() {
    return {
    webhooks: {
      verify: verifyWebhook,
    },
    }
  }),
}))

const createAdminClient = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient,
}))

describe('Resend webhook route', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.RESEND_WEBHOOK_SECRET = 'whsec_test'
    process.env.RESEND_API_KEY = 're_test'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('rejects unsigned webhook requests', async () => {
    const { POST } = await import('@/app/api/webhooks/resend/route')
    const response = await POST(new Request('http://localhost/api/webhooks/resend', {
      method: 'POST',
      body: '{}',
    }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(verifyWebhook).not.toHaveBeenCalled()
  })

  it('updates message state and records suppressions for bounced emails', async () => {
    const messageUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const messageUpdate = vi.fn().mockReturnValue({ eq: messageUpdateEq })
    const suppressionUpsert = vi.fn().mockResolvedValue({ error: null })
    const customerSelect = vi.fn().mockReturnValue({
      ilike: vi.fn().mockResolvedValue({
        data: [{ id: 'customer-1', email_delivery_failures: 1 }],
        error: null,
      }),
    })
    const customerUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })

    createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_messages') {
          return { update: messageUpdate }
        }
        if (table === 'email_suppressions') {
          return { upsert: suppressionUpsert }
        }
        if (table === 'customers') {
          return {
            select: customerSelect,
            update: customerUpdate,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    verifyWebhook.mockReturnValue({
      type: 'email.bounced',
      created_at: '2026-05-31T12:00:00.000Z',
      data: {
        email_id: 'email-1',
        to: ['guest@example.com'],
        bounce: { message: 'Mailbox unavailable', type: 'hard', subType: 'general' },
      },
    })

    const { POST } = await import('@/app/api/webhooks/resend/route')
    const response = await POST(new Request('http://localhost/api/webhooks/resend', {
      method: 'POST',
      headers: {
        'svix-id': 'msg_1',
        'svix-timestamp': '1780000000',
        'svix-signature': 'v1,test',
      },
      body: '{}',
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(messageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'bounced',
      bounced_at: '2026-05-31T12:00:00.000Z',
      error: 'Mailbox unavailable',
    }))
    expect(messageUpdateEq).toHaveBeenCalledWith('resend_message_id', 'email-1')
    expect(suppressionUpsert).toHaveBeenCalledWith(expect.objectContaining({
      email: 'guest@example.com',
      reason: 'bounce',
      resend_email_id: 'email-1',
    }), { onConflict: 'email' })
  })
})
