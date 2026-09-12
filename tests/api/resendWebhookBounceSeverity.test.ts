/**
 * What a bounce is allowed to do to an address, and what a bounce is allowed to say about a
 * guest's choices.
 *
 * Two separate defects, both measured on 12 September 2026:
 *  - every `email.bounced` event suppressed the address for ever, and 10 of the last 18
 *    bounces were temporary (3 full inboxes, 7 general transient);
 *  - every bounce also wrote an opt-out into `customer_consents`, 9 rows claiming guests
 *    had chosen to stop marketing when all they had done was bounce.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const verifyWebhook = vi.hoisted(() => vi.fn())

vi.mock('resend', () => ({
  Resend: vi.fn(function Resend() {
    return { webhooks: { verify: verifyWebhook } }
  }),
}))

const createAdminClient = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

const recordOptOut = vi.hoisted(() => vi.fn())
vi.mock('@/services/consent', () => ({
  ConsentService: { recordOptOut },
}))

vi.mock('@/lib/notifications/delayed-fallback/enqueue', () => ({
  enqueueDelayedFallbackForEmailEvent: vi.fn().mockResolvedValue(undefined),
}))

type Harness = {
  suppressionUpsert: ReturnType<typeof vi.fn>
  customerUpdate: ReturnType<typeof vi.fn>
  dncUpsert: ReturnType<typeof vi.fn>
  businessContactSelect: ReturnType<typeof vi.fn>
}

function buildHarness(): Harness {
  const suppressionUpsert = vi.fn().mockResolvedValue({ error: null })
  const customerUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
  const dncUpsert = vi.fn().mockResolvedValue({ error: null })
  const businessContactSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'contact-1', email: 'guest@example.com', marketing_status: 'subscribed' },
        error: null,
      }),
    }),
  })

  createAdminClient.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'webhook_logs') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ contains: vi.fn().mockResolvedValue({ error: null }) }),
          }),
        }
      }
      if (table === 'email_messages') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'email-message-1',
                  status: 'sent',
                  customer_id: 'customer-1',
                  business_contact_id: 'contact-1',
                },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({ data: [{ id: 'email-message-1' }], error: null }),
            }),
          }),
        }
      }
      if (table === 'email_suppressions') return { upsert: suppressionUpsert }
      if (table === 'customers') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'customer-1', email_delivery_failures: 1 },
                error: null,
              }),
            }),
          }),
          update: customerUpdate,
        }
      }
      if (table === 'business_contacts') {
        return {
          select: businessContactSelect,
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        }
      }
      if (table === 'marketing_do_not_contact') return { upsert: dncUpsert }
      if (table === 'email_webhook_unmatched') {
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })

  return { suppressionUpsert, customerUpdate, dncUpsert, businessContactSelect }
}

async function post(svixId: string) {
  const { POST } = await import('@/app/api/webhooks/resend/route')
  return POST(
    new Request('http://localhost/api/webhooks/resend', {
      method: 'POST',
      headers: {
        'svix-id': svixId,
        'svix-timestamp': '1780000000',
        'svix-signature': 'v1,test',
      },
      body: '{}',
    })
  )
}

describe('Resend webhook bounce severity', () => {
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

  it('does not suppress or deactivate on a full inbox', async () => {
    const harness = buildHarness()
    verifyWebhook.mockReturnValue({
      type: 'email.bounced',
      created_at: '2026-05-31T12:00:00.000Z',
      data: {
        email_id: 'email-1',
        to: ['guest@example.com'],
        bounce: {
          type: 'Transient',
          subType: 'MailboxFull',
          message: "The recipient's inbox was full",
        },
      },
    })

    const response = await post('msg_transient_full')

    expect(response.status).toBe(200)
    expect(harness.suppressionUpsert).not.toHaveBeenCalled()
    // The failure is still recorded, so a repeatedly failing address is still visible.
    expect(harness.customerUpdate).toHaveBeenCalledWith({
      email_delivery_failures: 2,
      last_email_failure_reason: "The recipient's inbox was full",
    })
    expect(harness.customerUpdate.mock.calls[0][0]).not.toHaveProperty('email_status')
    expect(harness.customerUpdate.mock.calls[0][0]).not.toHaveProperty('email_deactivated_at')
  })

  it('does not put a business contact on the do-not-contact list for a temporary bounce', async () => {
    const harness = buildHarness()
    verifyWebhook.mockReturnValue({
      type: 'email.bounced',
      created_at: '2026-05-31T12:00:00.000Z',
      data: {
        email_id: 'email-1',
        to: ['guest@example.com'],
        bounce: { type: 'Transient', subType: 'General', message: 'you might be able to send' },
      },
    })

    await post('msg_transient_b2b')

    expect(harness.dncUpsert).not.toHaveBeenCalled()
    expect(harness.businessContactSelect).not.toHaveBeenCalled()
  })

  it('still suppresses and deactivates on a permanent bounce', async () => {
    const harness = buildHarness()
    verifyWebhook.mockReturnValue({
      type: 'email.bounced',
      created_at: '2026-05-31T12:00:00.000Z',
      data: {
        email_id: 'email-1',
        to: ['guest@example.com'],
        bounce: { type: 'Permanent', subType: 'General', message: 'user unknown' },
      },
    })

    const response = await post('msg_permanent')

    expect(response.status).toBe(200)
    expect(harness.suppressionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'guest@example.com', reason: 'bounce' }),
      { onConflict: 'email' }
    )
    expect(harness.customerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        email_status: 'bounced',
        email_deactivated_at: '2026-05-31T12:00:00.000Z',
      })
    )
    expect(harness.dncUpsert).toHaveBeenCalled()
  })

  it('never writes a marketing opt-out from a bounce, permanent or not', async () => {
    buildHarness()
    verifyWebhook.mockReturnValue({
      type: 'email.bounced',
      created_at: '2026-05-31T12:00:00.000Z',
      data: {
        email_id: 'email-1',
        to: ['guest@example.com'],
        bounce: { type: 'Permanent', subType: 'NoEmail', message: 'user unknown' },
      },
    })

    await post('msg_permanent_consent')

    expect(recordOptOut).not.toHaveBeenCalled()
  })

  it('keeps the opt-out for a spam complaint, which is a choice the guest made', async () => {
    buildHarness()
    verifyWebhook.mockReturnValue({
      type: 'email.complained',
      created_at: '2026-05-31T12:00:00.000Z',
      data: { email_id: 'email-1', to: ['guest@example.com'] },
    })

    await post('msg_complaint')

    expect(recordOptOut).toHaveBeenCalledWith(
      'customer-1',
      'email',
      'direct_message',
      expect.objectContaining({ captureMethod: 'provider_event' })
    )
  })

  it('does not write an opt-out when the provider suppresses an address', async () => {
    buildHarness()
    verifyWebhook.mockReturnValue({
      type: 'email.suppressed',
      created_at: '2026-05-31T12:00:00.000Z',
      data: { email_id: 'email-1', to: ['guest@example.com'], suppressed: { message: 'on the list' } },
    })

    await post('msg_suppressed')

    expect(recordOptOut).not.toHaveBeenCalled()
  })
})

describe('Resend webhook stale claim recovery', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.RESEND_WEBHOOK_SECRET = 'whsec_test'
    process.env.RESEND_API_KEY = 're_test'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.useRealTimers()
  })

  function buildClaimHarness(existing: { status: string; processed_at: string | null }) {
    const retakeSelect = vi.fn().mockResolvedValue({ data: [{ id: 'webhook-log-1' }], error: null })
    const retakeStatusEq = vi.fn().mockReturnValue({ select: retakeSelect })
    const retakeContains = vi.fn().mockReturnValue({ eq: retakeStatusEq })
    const retakeTypeEq = vi.fn().mockReturnValue({ contains: retakeContains })
    const update = vi.fn().mockReturnValue({
      eq: retakeTypeEq,
    })

    createAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'webhook_logs') {
          return {
            insert: vi.fn().mockResolvedValue({
              error: { code: '23505', message: 'duplicate key value violates unique constraint' },
            }),
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                contains: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'webhook-log-1', ...existing }, error: null }),
                }),
              }),
            }),
            update,
          }
        }
        if (table === 'email_messages') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'email-message-1', status: 'sent', customer_id: null, business_contact_id: null },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockResolvedValue({ data: [{ id: 'email-message-1' }], error: null }),
              }),
            }),
          }
        }
        if (table === 'customers') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
            update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
          }
        }
        if (table === 'email_suppressions') {
          return { upsert: vi.fn().mockResolvedValue({ error: null }) }
        }
        if (table === 'email_webhook_unmatched') {
          return { insert: vi.fn().mockResolvedValue({ error: null }) }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    return { update, retakeStatusEq }
  }

  it('reprocesses an event whose claim was left processing', async () => {
    // One row in 12,641 is stuck like this: written before the work, never finished, and
    // treated as a duplicate for ever.
    vi.setSystemTime(new Date('2026-09-12T12:00:00.000Z'))
    const harness = buildClaimHarness({ status: 'processing', processed_at: '2026-09-12T11:00:00.000Z' })

    verifyWebhook.mockReturnValue({
      type: 'email.delivered',
      created_at: '2026-09-12T11:00:00.000Z',
      data: { email_id: 'email-1', to: ['guest@example.com'] },
    })

    const response = await post('msg_stale')

    expect(await response.json()).toEqual({ success: true })
    expect(harness.retakeStatusEq).toHaveBeenCalledWith('status', 'processing')
  })

  it('leaves a claim that is still running alone', async () => {
    vi.setSystemTime(new Date('2026-09-12T12:00:00.000Z'))
    buildClaimHarness({ status: 'processing', processed_at: '2026-09-12T11:59:30.000Z' })

    verifyWebhook.mockReturnValue({
      type: 'email.delivered',
      created_at: '2026-09-12T11:59:30.000Z',
      data: { email_id: 'email-1', to: ['guest@example.com'] },
    })

    const response = await post('msg_running')

    expect(await response.json()).toEqual({ success: true, duplicate: true })
  })

  it('treats a processed claim as a duplicate', async () => {
    vi.setSystemTime(new Date('2026-09-12T12:00:00.000Z'))
    buildClaimHarness({ status: 'processed', processed_at: '2026-09-01T11:00:00.000Z' })

    verifyWebhook.mockReturnValue({
      type: 'email.delivered',
      created_at: '2026-09-01T11:00:00.000Z',
      data: { email_id: 'email-1', to: ['guest@example.com'] },
    })

    const response = await post('msg_done')

    expect(await response.json()).toEqual({ success: true, duplicate: true })
  })
})
