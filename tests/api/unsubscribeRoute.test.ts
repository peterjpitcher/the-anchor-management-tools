/**
 * The unsubscribe endpoint: what it says, and what it counts.
 *
 * Two defects fixed on 12 September 2026.
 *
 *  - A database error and an unmatched token both returned "You will not get marketing emails
 *    from us" while saving nothing. On a failure that is the one lie the guest cannot detect:
 *    they stop looking, and they hear from us again next month.
 *  - The RFC 8058 one-click POST was rate-limited per IP, 30 per 10 minutes. Gmail and Yahoo
 *    send those from shared outbound servers, so a burst of opt-outs after a campaign arrives
 *    from a handful of addresses and everything past the thirtieth was thrown away.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const createAdminClient = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

const applyDistributedRateLimit = vi.hoisted(() => vi.fn())
vi.mock('@/lib/distributed-rate-limit', () => ({ applyDistributedRateLimit }))

const lookupUnsubscribeToken = vi.hoisted(() => vi.fn())
const recordUnsubscribeUse = vi.hoisted(() => vi.fn())
vi.mock('@/lib/email/unsubscribe', () => ({ lookupUnsubscribeToken, recordUnsubscribeUse }))

const recordOptOut = vi.hoisted(() => vi.fn())
vi.mock('@/services/consent', () => ({ ConsentService: { recordOptOut } }))

const TOKEN = 'a'.repeat(43)

function postRequest() {
  return new NextRequest(`https://management.orangejelly.co.uk/api/unsubscribe?t=${TOKEN}`, {
    method: 'POST',
  })
}

async function post() {
  const { POST } = await import('@/app/api/unsubscribe/route')
  return POST(postRequest())
}

describe('unsubscribe route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    applyDistributedRateLimit.mockResolvedValue(null)
    recordUnsubscribeUse.mockResolvedValue(undefined)
    recordOptOut.mockResolvedValue(undefined)
    createAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ is: vi.fn().mockResolvedValue({ error: null }) }),
        }),
      })),
    })
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('says nothing was changed when the token does not match', async () => {
    lookupUnsubscribeToken.mockResolvedValue({ ok: false, reason: 'not_found' })

    const response = await post()
    const html = await response.text()

    expect(response.status).toBe(404)
    expect(html).toContain('Nothing has been changed')
    expect(html).toContain('01753 682707')
    // The old wording, which claimed an opt-out that had not happened.
    expect(html).not.toContain('you are not on the marketing list')
    expect(html).not.toContain('Either way you are not on the marketing list')
  })

  it('says it did not work when the lookup is unavailable', async () => {
    lookupUnsubscribeToken.mockResolvedValue({ ok: false, reason: 'unavailable' })

    const response = await post()
    const html = await response.text()

    expect(response.status).toBe(503)
    expect(html).toContain('nothing has changed')
    expect(html).toContain('you may still get marketing emails')
    expect(html).toContain('01753 682707')
  })

  it('reveals nothing about whether an address is on the list', async () => {
    const bodies: string[] = []
    for (const reason of ['not_found', 'unavailable'] as const) {
      lookupUnsubscribeToken.mockResolvedValue({ ok: false, reason })
      bodies.push(await (await post()).text())
    }

    for (const body of bodies) {
      expect(body).not.toMatch(/@/)
      expect(body.toLowerCase()).not.toContain('subscribed to')
    }
  })

  it('still confirms a real opt-out', async () => {
    lookupUnsubscribeToken.mockResolvedValue({
      ok: true,
      subjectType: 'customer',
      customerId: 'customer-1',
      businessContactId: null,
    })

    const response = await post()
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('unsubscribed')
    expect(recordOptOut).toHaveBeenCalledWith(
      'customer-1',
      'email',
      'email_unsubscribe_link',
      expect.anything(),
      ['marketing']
    )
  })

  it('counts the token, not the mail provider IP', async () => {
    lookupUnsubscribeToken.mockResolvedValue({
      ok: true,
      subjectType: 'customer',
      customerId: 'customer-1',
      businessContactId: null,
    })

    await post()

    const options = applyDistributedRateLimit.mock.calls[0][1]
    expect(options.prefix).toBe('email-unsubscribe')
    // Hashed: the identifier becomes part of a Redis key and the raw token is the whole
    // authorisation for this route.
    expect(options.identifier).toMatch(/^[0-9a-f]{64}$/)
    expect(options.identifier).not.toContain(TOKEN)
  })

  it('gives the same token the same budget however many servers it arrives from', async () => {
    lookupUnsubscribeToken.mockResolvedValue({
      ok: true,
      subjectType: 'customer',
      customerId: 'customer-1',
      businessContactId: null,
    })

    const { POST } = await import('@/app/api/unsubscribe/route')
    await POST(
      new NextRequest(`https://management.orangejelly.co.uk/api/unsubscribe?t=${TOKEN}`, {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.1' },
      })
    )
    await POST(
      new NextRequest(`https://management.orangejelly.co.uk/api/unsubscribe?t=${TOKEN}`, {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.9' },
      })
    )

    const [first, second] = applyDistributedRateLimit.mock.calls
    expect(first[1].identifier).toBe(second[1].identifier)
  })
})
