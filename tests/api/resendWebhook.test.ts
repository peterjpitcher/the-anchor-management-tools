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
    const messageSelectMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'email-message-1', status: 'sent' },
      error: null,
    })
    const messageSelectEq = vi.fn().mockReturnValue({ maybeSingle: messageSelectMaybeSingle })
    const messageSelect = vi.fn().mockReturnValue({ eq: messageSelectEq })
    const messageUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const messageUpdate = vi.fn().mockReturnValue({ eq: messageUpdateEq })
    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    const webhookLogFinishContains = vi.fn().mockResolvedValue({ error: null })
    const webhookLogFinishEq = vi.fn().mockReturnValue({ contains: webhookLogFinishContains })
    const webhookLogUpdate = vi.fn().mockReturnValue({ eq: webhookLogFinishEq })
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
        if (table === 'webhook_logs') {
          return {
            insert: webhookLogInsert,
            update: webhookLogUpdate,
          }
        }
        if (table === 'email_messages') {
          return {
            select: messageSelect,
            update: messageUpdate,
          }
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
    expect(messageSelectEq).toHaveBeenCalledWith('resend_message_id', 'email-1')
    expect(messageUpdateEq).toHaveBeenCalledWith('id', 'email-message-1')
    expect(webhookLogInsert).toHaveBeenCalledWith(expect.objectContaining({
      webhook_type: 'resend',
      status: 'processing',
      params: expect.objectContaining({ svix_id: 'msg_1', email_id: 'email-1' }),
    }))
    expect(webhookLogFinishContains).toHaveBeenCalledWith('params', { svix_id: 'msg_1' })
    expect(suppressionUpsert).toHaveBeenCalledWith(expect.objectContaining({
      email: 'guest@example.com',
      reason: 'bounce',
      resend_email_id: 'email-1',
    }), { onConflict: 'email' })
  })

  it('ignores duplicate svix deliveries before side effects', async () => {
    const webhookLogInsert = vi.fn().mockResolvedValue({
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    })
    const webhookLogMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'webhook-log-1', status: 'processed' },
      error: null,
    })
    const webhookLogContains = vi.fn().mockReturnValue({ maybeSingle: webhookLogMaybeSingle })
    const webhookLogEq = vi.fn().mockReturnValue({ contains: webhookLogContains })
    const webhookLogSelect = vi.fn().mockReturnValue({ eq: webhookLogEq })
    const emailMessagesFrom = vi.fn()

    createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return {
            insert: webhookLogInsert,
            select: webhookLogSelect,
          }
        }
        if (table === 'email_messages') {
          emailMessagesFrom()
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    verifyWebhook.mockReturnValue({
      type: 'email.delivered',
      created_at: '2026-05-31T12:00:00.000Z',
      data: { email_id: 'email-1', to: ['guest@example.com'] },
    })

    const { POST } = await import('@/app/api/webhooks/resend/route')
    const response = await POST(new Request('http://localhost/api/webhooks/resend', {
      method: 'POST',
      headers: {
        'svix-id': 'msg_duplicate',
        'svix-timestamp': '1780000000',
        'svix-signature': 'v1,test',
      },
      body: '{}',
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, duplicate: true })
    expect(emailMessagesFrom).not.toHaveBeenCalled()
  })

  it('does not downgrade newer email message status', async () => {
    const webhookLogInsert = vi.fn().mockResolvedValue({ error: null })
    const webhookLogFinishContains = vi.fn().mockResolvedValue({ error: null })
    const webhookLogFinishEq = vi.fn().mockReturnValue({ contains: webhookLogFinishContains })
    const webhookLogUpdate = vi.fn().mockReturnValue({ eq: webhookLogFinishEq })
    const messageSelectMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'email-message-1', status: 'clicked' },
      error: null,
    })
    const messageSelectEq = vi.fn().mockReturnValue({ maybeSingle: messageSelectMaybeSingle })
    const messageSelect = vi.fn().mockReturnValue({ eq: messageSelectEq })
    const messageUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const messageUpdate = vi.fn().mockReturnValue({ eq: messageUpdateEq })
    const customerUpdateIlike = vi.fn().mockResolvedValue({ error: null })
    const customerUpdate = vi.fn().mockReturnValue({ ilike: customerUpdateIlike })

    createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return {
            insert: webhookLogInsert,
            update: webhookLogUpdate,
          }
        }
        if (table === 'email_messages') {
          return {
            select: messageSelect,
            update: messageUpdate,
          }
        }
        if (table === 'customers') {
          return { update: customerUpdate }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    verifyWebhook.mockReturnValue({
      type: 'email.delivered',
      created_at: '2026-05-31T12:00:00.000Z',
      data: { email_id: 'email-1', to: ['guest@example.com'] },
    })

    const { POST } = await import('@/app/api/webhooks/resend/route')
    const response = await POST(new Request('http://localhost/api/webhooks/resend', {
      method: 'POST',
      headers: {
        'svix-id': 'msg_delivered',
        'svix-timestamp': '1780000000',
        'svix-signature': 'v1,test',
      },
      body: '{}',
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(messageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      delivered_at: '2026-05-31T12:00:00.000Z',
    }))
    expect(messageUpdate).toHaveBeenCalledWith(expect.not.objectContaining({
      status: 'delivered',
    }))
  })
})
