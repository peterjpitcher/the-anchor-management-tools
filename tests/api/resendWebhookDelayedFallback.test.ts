import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as any }))
const verifyWebhook = vi.hoisted(() => vi.fn())

vi.mock('resend', () => ({
  Resend: vi.fn(function Resend() {
    return { webhooks: { verify: verifyWebhook } }
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => state.db),
}))

vi.mock('@/services/consent', () => ({
  ConsentService: { recordOptOut: vi.fn(async () => undefined) },
}))

vi.mock('@/lib/notifications/delayed-fallback/enqueue', () => ({
  enqueueDelayedFallbackForEmailEvent: vi.fn(async () => ({ enqueued: true, reason: 'queued' })),
}))

import { enqueueDelayedFallbackForEmailEvent } from '@/lib/notifications/delayed-fallback/enqueue'

const mockedEnqueue = enqueueDelayedFallbackForEmailEvent as unknown as Mock

function request(svixId: string) {
  return new Request('http://localhost/api/webhooks/resend', {
    method: 'POST',
    headers: { 'svix-id': svixId, 'svix-timestamp': '1790000000', 'svix-signature': 'v1,test' },
    body: '{}',
  })
}

function seedDb() {
  return createFakeSupabase(
    {
      webhook_logs: [],
      email_messages: [{ id: 'email-row-1', resend_message_id: 'resend-1', status: 'delivered', customer_id: 'customer-1', business_contact_id: null }],
      email_suppressions: [],
      business_contacts: [],
      customers: [{ id: 'customer-1', email_delivery_failures: 0 }],
      email_webhook_unmatched: [],
    },
    { unique: { webhook_logs: (row) => row.params?.svix_id } }
  )
}

describe('Resend webhook and the bounce text fallback', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.RESEND_WEBHOOK_SECRET = 'whsec_test'
    process.env.RESEND_API_KEY = 're_test'
  })

  it('hands a bounce to the fallback exactly once, and not again for a replay of the same event', async () => {
    state.db = seedDb()
    verifyWebhook.mockReturnValue({
      type: 'email.bounced',
      created_at: '2026-09-20T10:00:00.000Z',
      data: { email_id: 'resend-1', to: ['guest@example.com'], bounce: { message: 'mailbox does not exist' } },
    })
    const { POST } = await import('@/app/api/webhooks/resend/route')

    const first = await POST(request('msg_bounce_1'))
    const replay = await POST(request('msg_bounce_1'))

    expect(first.status).toBe(200)
    expect(await replay.json()).toEqual({ success: true, duplicate: true })
    expect(mockedEnqueue).toHaveBeenCalledTimes(1)
    expect(mockedEnqueue).toHaveBeenCalledWith({ eventType: 'email.bounced', resendEmailId: 'resend-1' })
  })

  it('passes a delivered event through too, and the fallback ignores it', async () => {
    state.db = seedDb()
    verifyWebhook.mockReturnValue({
      type: 'email.delivered',
      created_at: '2026-09-20T10:00:00.000Z',
      data: { email_id: 'resend-1', to: ['guest@example.com'] },
    })
    const actual = await vi.importActual<typeof import('@/lib/notifications/delayed-fallback/enqueue')>(
      '@/lib/notifications/delayed-fallback/enqueue'
    )
    mockedEnqueue.mockImplementation(actual.enqueueDelayedFallbackForEmailEvent)
    const { POST } = await import('@/app/api/webhooks/resend/route')

    const response = await POST(request('msg_delivered_1'))

    expect(response.status).toBe(200)
    await expect(mockedEnqueue.mock.results[0].value).resolves.toEqual({ enqueued: false, reason: 'event_not_undelivered' })
  })
})
