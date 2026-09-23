import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Now that a delivery up to four days old is accepted, a denial can land long after staff have
 * issued a replacement payment order. Clearing `paypal_deposit_order_id` by booking id alone
 * would wipe that live checkout and the lookup that recovers it, so the denial must name the
 * order it is about.
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://management.orangejelly.co.uk'
})

vi.mock('@/lib/paypal', () => ({
  resolvePayPalWebhookId: vi.fn(),
  verifyPayPalWebhookDetailed: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/api/idempotency', () => ({
  claimIdempotencyKey: vi.fn(async () => ({ state: 'claimed' })),
  computeIdempotencyRequestHash: vi.fn(() => 'HASH'),
  persistIdempotencyResponse: vi.fn(async () => undefined),
  releaseIdempotencyClaim: vi.fn(async () => undefined),
}))

vi.mock('@/services/private-bookings', () => ({
  finalizeDepositPayment: vi.fn(async () => ({ alreadyRecorded: false })),
}))

vi.mock('@/lib/paypal-refund-webhook', () => ({ handleRefundEvent: vi.fn(async () => undefined) }))

import { resolvePayPalWebhookId, verifyPayPalWebhookDetailed } from '@/lib/paypal'
import { createAdminClient } from '@/lib/supabase/admin'
import { POST } from '@/app/api/webhooks/paypal/private-bookings/route'

const BOOKING_ID = 'b1d0f6cc-0c74-4f29-8e6b-2f2a3a1e1111'

type UpdateCall = { filters: Record<string, unknown>; values: Record<string, unknown> }

function makeSupabase(clearedRows: Array<{ id: string }>) {
  const updates: UpdateCall[] = []
  const auditRows: Record<string, unknown>[] = []
  const webhookRows: Record<string, unknown>[] = []

  const client = {
    from: vi.fn((table: string): any => {
      if (table === 'webhook_logs') {
        return { insert: vi.fn(async (row: Record<string, unknown>) => { webhookRows.push(row); return { error: null } }) }
      }
      if (table === 'audit_logs') {
        return { insert: vi.fn(async (row: Record<string, unknown>) => { auditRows.push(row); return { error: null } }) }
      }
      if (table === 'private_bookings') {
        const call: UpdateCall = { filters: {}, values: {} }
        const chain: any = {
          update(values: Record<string, unknown>) { call.values = values; return chain },
          eq(column: string, value: unknown) { call.filters[column] = value; return chain },
          is(column: string, value: unknown) { call.filters[`${column}:is`] = value; return chain },
          select() { updates.push(call); return Promise.resolve({ data: clearedRows, error: null }) },
        }
        return chain
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  }

  return { client, updates, auditRows, webhookRows }
}

function denialRequest(orderId: string | null): never {
  const resource: Record<string, unknown> = {
    id: 'CAPTURE-1',
    custom_id: `pb-deposit-${BOOKING_ID}`,
    status_details: { reason: 'INSTRUMENT_DECLINED' },
  }
  if (orderId) {
    resource.supplementary_data = { related_ids: { order_id: orderId } }
  }

  const request = new Request('https://management.orangejelly.co.uk/api/webhooks/paypal/private-bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'WH-DENIED-1', event_type: 'PAYMENT.CAPTURE.DENIED', resource }),
  })
  return Object.assign(request, { nextUrl: new URL(request.url) }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolvePayPalWebhookId).mockResolvedValue({
    webhookId: 'REGISTERED-ID',
    source: 'resolved',
    lookupState: 'matched',
    lookupMessage: null,
    url: 'https://management.orangejelly.co.uk',
  } as never)
  vi.mocked(verifyPayPalWebhookDetailed).mockResolvedValue({
    outcome: 'verified',
    verificationStatus: 'SUCCESS',
    transmissionAgeSeconds: 30,
  })
})

describe('private booking capture denied', () => {
  it('clears only the order the denial names', async () => {
    const supabase = makeSupabase([{ id: BOOKING_ID }])
    vi.mocked(createAdminClient).mockReturnValue(supabase.client as never)

    const response = await POST(denialRequest('ORDER-A'))

    expect(response.status).toBe(200)
    expect(supabase.updates).toHaveLength(1)
    expect(supabase.updates[0].filters).toMatchObject({
      id: BOOKING_ID,
      paypal_deposit_order_id: 'ORDER-A',
      'deposit_paid_date:is': null,
    })
    expect(supabase.updates[0].values).toMatchObject({ paypal_deposit_order_id: null })
  })

  it('leaves a replacement order alone when the old denial matches nothing', async () => {
    // Order A denied, staff issue B, A's delayed denial finally arrives: it must not clear B.
    const supabase = makeSupabase([])
    vi.mocked(createAdminClient).mockReturnValue(supabase.client as never)

    const response = await POST(denialRequest('ORDER-A'))

    expect(response.status).toBe(200)
    expect(supabase.updates[0].filters.paypal_deposit_order_id).toBe('ORDER-A')
    expect(
      supabase.auditRows.some(
        (row) => row.operation_type === 'paypal_deposit_capture_denied'
          && (row.additional_info as Record<string, unknown>).cleared === false,
      ),
    ).toBe(true)
  })

  it('clears nothing and raises a manual review when the denial names no order', async () => {
    const supabase = makeSupabase([])
    vi.mocked(createAdminClient).mockReturnValue(supabase.client as never)

    const response = await POST(denialRequest(null))

    expect(response.status).toBe(200)
    expect(supabase.updates).toHaveLength(0)
    expect(
      supabase.auditRows.some((row) => row.operation_type === 'paypal_deposit_capture_denied_unresolved'),
    ).toBe(true)
  })
})
