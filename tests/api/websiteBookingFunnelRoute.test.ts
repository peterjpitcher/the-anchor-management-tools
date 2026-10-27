import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

/**
 * BK-101 and BK-191 (customer bookings review of 24 October 2026): the website's refusals and
 * failures, and the event booking form's opened / submit pressed / blocked / sent signals, are
 * recorded here so they can be counted. Codes only: anything shaped like a guest's details is
 * refused, and nothing a caller sends is echoed back.
 */

const { limited } = vi.hoisted(() => ({ limited: vi.fn(async () => null as Response | null) }))

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(
    async (handler: (request: Request, apiKey: { id: string }) => Promise<Response>, permissions: string[], request: Request) => {
      if (!permissions.includes('write:ops_alerts')) throw new Error('wrong scope')
      return handler(request, { id: '00000000-0000-4000-8000-0000000000a1' })
    },
  ),
  createApiResponse: (payload: unknown, status = 200) => Response.json(payload, { status }),
  createErrorResponse: (message: string, code: string, status = 400, details?: unknown) =>
    Response.json({ success: false, error: { message, code, details } }, { status }),
}))
vi.mock('@/lib/distributed-rate-limit', () => ({ applyDistributedRateLimit: limited }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { createAdminClient } from '@/lib/supabase/admin'
import { POST } from '@/app/api/website/booking-funnel/route'

let db: FakeDb

function post(body: unknown): NextRequest {
  return new NextRequest('https://management.example/api/website/booking-funnel', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  db = createFakeDb()
  ;(createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db.client)
})

describe('POST /api/website/booking-funnel', () => {
  it('records a refusal with its codes, page and the key that sent it', async () => {
    const response = await POST(
      post({
        type: 'refusal',
        route: 'api/table-bookings',
        kind: 'refused',
        status: 400,
        reason: 'OUTSIDE_HOURS',
        upstream_code: null,
        page: '/book-table',
      }),
    )

    expect(response.status).toBe(202)
    expect(db.rows('booking_funnel_events')).toEqual([
      expect.objectContaining({
        source: 'website',
        stage: 'refused',
        route: 'api/table-bookings',
        reason_code: 'OUTSIDE_HOURS',
        upstream_code: null,
        http_status: 400,
        page_path: '/book-table',
        api_key_id: '00000000-0000-4000-8000-0000000000a1',
      }),
    ])
  })

  it('records a failure the two systems disagree about', async () => {
    await POST(post({ type: 'refusal', route: 'api/event-bookings', kind: 'failed', status: 400, reason: 'CONTRACT_DRIFT', upstream_code: 'PRICE_CHANGED' }))

    expect(db.rows('booking_funnel_events')[0]).toMatchObject({ stage: 'failed', reason_code: 'CONTRACT_DRIFT', upstream_code: 'PRICE_CHANGED' })
  })

  it('records a form signal, keeping the reason only for a blocked form', async () => {
    await POST(post({ type: 'form', form: 'event_booking', step: 'blocked', reason: 'no_security_token', page: '/events/tasting-night-2026-11-20' }))
    await POST(post({ type: 'form', form: 'event_booking', step: 'opened', page: '/events/tasting-night-2026-11-20' }))

    expect(db.rows('booking_funnel_events')).toEqual([
      expect.objectContaining({ stage: 'form', route: 'event_booking', reason_code: 'blocked', upstream_code: 'no_security_token' }),
      expect.objectContaining({ stage: 'form', route: 'event_booking', reason_code: 'opened', upstream_code: null }),
    ])
  })

  it.each([
    ['a phone number as a reason', { type: 'refusal', route: 'api/table-bookings', kind: 'refused', reason: '07700 900123' }],
    ['an email address as a reason', { type: 'refusal', route: 'api/table-bookings', kind: 'refused', reason: 'a@b.com' }],
    ['a name in the page', { type: 'refusal', route: 'api/table-bookings', kind: 'refused', reason: 'X', page: 'Alice Booker' }],
    ['a query string in the page', { type: 'refusal', route: 'api/table-bookings', kind: 'refused', reason: 'X', page: '/book-table?phone=07700900123' }],
    ['an extra field', { type: 'refusal', route: 'api/table-bookings', kind: 'refused', reason: 'X', phone: '07700900123' }],
    ['an unknown form', { type: 'form', form: 'christmas', step: 'opened' }],
    ['an unknown kind', { type: 'refusal', route: 'api/table-bookings', kind: 'booked', reason: 'X' }],
  ])('refuses %s without recording or echoing it', async (_label, body) => {
    const response = await POST(post(body))
    const text = await response.text()

    expect(response.status).toBe(400)
    expect(text).not.toContain('07700')
    expect(text).not.toContain('a@b.com')
    expect(text).not.toContain('Alice')
    expect(db.rows('booking_funnel_events')).toHaveLength(0)
  })

  it('refuses a body that is not JSON', async () => {
    expect((await POST(post('not json'))).status).toBe(400)
  })

  it('answers 429 and records nothing past the hourly limit', async () => {
    limited.mockResolvedValueOnce(new Response(null, { status: 429 }))
    const response = await POST(post({ type: 'form', form: 'event_booking', step: 'opened' }))

    expect(response.status).toBe(429)
    expect(db.rows('booking_funnel_events')).toHaveLength(0)
  })

  it('says so when the row cannot be written', async () => {
    db.failNext({ table: 'booking_funnel_events', operation: 'insert', message: 'database down' })
    const response = await POST(post({ type: 'form', form: 'event_booking', step: 'opened' }))

    expect(response.status).toBe(503)
  })
})
