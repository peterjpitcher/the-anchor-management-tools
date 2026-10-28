import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Wrong short link guesses are counted per address (BK-203, customer bookings review of 24 October
 * 2026). Guest manage and payment links sit behind short codes, and the redirect had no limit on
 * misses. Only codes that resolve to nothing count, and an address that has used its allowance is
 * refused before any lookup, so it cannot keep guessing.
 */

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }))
vi.mock('@/lib/table-bookings/bookings', () => ({
  createTablePaymentToken: vi.fn(),
  getTablePaymentPreviewByRawToken: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

const limits = vi.hoisted(() => ({
  isDistributedRateLimitExhausted: vi.fn(),
  recordDistributedRateLimitHit: vi.fn(),
}))
vi.mock('@/lib/distributed-rate-limit', () => limits)

import { createClient } from '@supabase/supabase-js'
import { GET } from '@/app/api/redirect/[code]/route'

function database(link: Record<string, unknown> | null) {
  const from = vi.fn((table: string) => {
    if (table === 'short_links') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: link, error: null }) }) }) }
    }
    if (table === 'short_link_aliases') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
    }
    if (table === 'short_link_clicks') return { insert: async () => ({ error: null }) }
    throw new Error(`Unexpected table: ${table}`)
  })
  return { from, rpc: vi.fn().mockResolvedValue({ error: null }) }
}

async function open(code: string) {
  const request = new Request(`https://l.the-anchor.pub/${code}`, { headers: { 'x-forwarded-for': '203.0.113.9' } })
  const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
  return GET(nextRequestLike as never, { params: Promise.resolve({ code }) } as never)
}

describe('short link guess limit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    limits.isDistributedRateLimitExhausted.mockResolvedValue(false)
    limits.recordDistributedRateLimitHit.mockResolvedValue(undefined)
  })

  it('counts a code that resolves to nothing, and still sends the visitor to the website', async () => {
    const db = database(null)
    vi.mocked(createClient).mockReturnValue(db as never)

    const response = await open('zzzzzz')

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://www.the-anchor.pub/')
    expect(limits.recordDistributedRateLimitHit).toHaveBeenCalledOnce()
    expect(limits.recordDistributedRateLimitHit.mock.calls[0][1]).toMatchObject({ prefix: 'short-link-miss', max: 30 })
  })

  it('does not count a real link, so people opening their own links are never slowed', async () => {
    const db = database({ id: 'link-1', short_code: 'abcdef', destination_url: 'https://www.the-anchor.pub/whats-on', metadata: {}, expires_at: null })
    vi.mocked(createClient).mockReturnValue(db as never)

    const response = await open('abcdef')

    expect(response.headers.get('location')).toContain('https://www.the-anchor.pub/whats-on')
    expect(limits.recordDistributedRateLimitHit).not.toHaveBeenCalled()
  })

  it('refuses an address that has used its allowance before looking anything up', async () => {
    const db = database({ id: 'link-1', short_code: 'abcdef', destination_url: 'https://www.the-anchor.pub/whats-on', metadata: {}, expires_at: null })
    vi.mocked(createClient).mockReturnValue(db as never)
    limits.isDistributedRateLimitExhausted.mockResolvedValue(true)

    const response = await open('abcdef')

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('3600')
    expect(await response.text()).toContain('01753 682707')
    expect(db.from).not.toHaveBeenCalled()
  })
})
