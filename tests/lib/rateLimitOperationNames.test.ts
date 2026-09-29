import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}))

import { headers } from 'next/headers'
import { createRateLimiter, rateLimiters } from '@/lib/rate-limit'
import { checkRateLimit } from '@/lib/rate-limit-server'
import { applyDistributedRateLimit } from '@/lib/distributed-rate-limit'

// Every limiter shares one in-memory store, and staff at the pub share one IP. Before limiters
// were named, a bulk send or a few uploads spent the same allowance as login. Under Fluid compute
// more requests land on one instance, so that shared counter would fill faster. These tests pin
// that each operation keeps its own counter while its subject (IP, phone, token) is unchanged.
// The store is module-wide, so each test uses its own IP or phone number.

function requestFrom(ip: string): NextRequest {
  return new NextRequest('http://localhost/api/test', {
    headers: { 'x-forwarded-for': ip },
  })
}

describe('rate limiters keep a separate counter per operation', () => {
  it('does not let one operation use up another operation from the same IP', async () => {
    const login = createRateLimiter({ name: 'test-login', windowMs: 60_000, max: 2 })
    const sms = createRateLimiter({ name: 'test-sms', windowMs: 60_000, max: 2 })
    const pubIp = '203.0.113.10'

    expect(await login(requestFrom(pubIp))).toBeNull()
    expect(await login(requestFrom(pubIp))).toBeNull()
    expect((await login(requestFrom(pubIp)))?.status).toBe(429)

    expect(await sms(requestFrom(pubIp))).toBeNull()
  })

  it('keeps the full SMS allowance after a bulk send used up the bulk allowance', async () => {
    const pubIp = '203.0.113.11'

    for (let i = 0; i < 5; i += 1) {
      expect(await rateLimiters.bulk(requestFrom(pubIp))).toBeNull()
    }
    expect((await rateLimiters.bulk(requestFrom(pubIp)))?.status).toBe(429)

    // All ten SMS a minute are still available: none were spent by the bulk attempts.
    for (let i = 0; i < 10; i += 1) {
      expect(await rateLimiters.sms(requestFrom(pubIp))).toBeNull()
    }
    expect((await rateLimiters.sms(requestFrom(pubIp)))?.status).toBe(429)
  })
})

describe('each operation still enforces its own limit and expiry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-29T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('blocks after the limit with a Retry-After header, then allows again once the window ends', async () => {
    const upload = createRateLimiter({ name: 'test-upload', windowMs: 60_000, max: 2 })
    const ip = '203.0.113.12'

    expect(await upload(requestFrom(ip))).toBeNull()
    expect(await upload(requestFrom(ip))).toBeNull()

    const blocked = await upload(requestFrom(ip))
    expect(blocked?.status).toBe(429)
    expect(blocked?.headers.get('Retry-After')).toBe('60')

    vi.advanceTimersByTime(61_000)

    expect(await upload(requestFrom(ip))).toBeNull()
  })
})

describe('explicit subjects are preserved', () => {
  it('keeps guest phone numbers independent behind the website proxy, and still limits a repeated phone', async () => {
    const guest = createRateLimiter({ name: 'test-table-booking-guest', windowMs: 60 * 60_000, max: 2 })
    const websiteEgressIp = '198.51.100.20'

    const phoneA = 'tb-phone:+447700900001'
    const phoneB = 'tb-phone:+447700900002'

    expect(await guest(requestFrom(websiteEgressIp), phoneA)).toBeNull()
    expect(await guest(requestFrom(websiteEgressIp), phoneA)).toBeNull()
    expect((await guest(requestFrom(websiteEgressIp), phoneA))?.status).toBe(429)

    expect(await guest(requestFrom(websiteEgressIp), phoneB)).toBeNull()
  })

  it('does not let two operations collide on the same explicit key', async () => {
    const first = createRateLimiter({ name: 'test-first', windowMs: 60_000, max: 1 })
    const second = createRateLimiter({ name: 'test-second', windowMs: 60_000, max: 1 })
    const sharedSubject = 'subject:shared'

    expect(await first(requestFrom('203.0.113.13'), sharedSubject)).toBeNull()
    expect((await first(requestFrom('203.0.113.13'), sharedSubject))?.status).toBe(429)

    expect(await second(requestFrom('203.0.113.13'), sharedSubject)).toBeNull()
  })
})

describe('server-action wrapper', () => {
  function headersFor(ip: string): Headers {
    return new Headers({ 'x-forwarded-for': ip })
  }

  beforeEach(() => {
    vi.mocked(headers).mockReset()
  })

  it('keeps login attempts and employee uploads on separate counters for the same IP', async () => {
    vi.mocked(headers).mockResolvedValue(headersFor('203.0.113.14') as never)

    await checkRateLimit('login', 2)
    await checkRateLimit('login', 2)
    await expect(checkRateLimit('login', 2)).rejects.toThrow('Too many requests')

    await expect(checkRateLimit('employee-upload', 2)).resolves.toEqual({ remaining: null })
  })

  it('still limits employee uploads on their own counter', async () => {
    vi.mocked(headers).mockResolvedValue(headersFor('203.0.113.15') as never)

    await checkRateLimit('employee-upload', 2)
    await checkRateLimit('employee-upload', 2)
    await expect(checkRateLimit('employee-upload', 2)).rejects.toThrow('Too many requests')
  })
})

describe('distributed limiter local fallback (no Upstash configured)', () => {
  const savedUrl = process.env.UPSTASH_REDIS_REST_URL
  const savedToken = process.env.UPSTASH_REDIS_REST_TOKEN

  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  afterEach(() => {
    if (savedUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL
    else process.env.UPSTASH_REDIS_REST_URL = savedUrl
    if (savedToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN
    else process.env.UPSTASH_REDIS_REST_TOKEN = savedToken
  })

  it('limits by prefix and IP, keeping different prefixes independent', async () => {
    const ip = '203.0.113.16'

    expect(await applyDistributedRateLimit(requestFrom(ip), { prefix: 'test-feedback', window: '1 h', max: 1 })).toBeNull()
    const blocked = await applyDistributedRateLimit(requestFrom(ip), { prefix: 'test-feedback', window: '1 h', max: 1 })
    expect(blocked?.status).toBe(429)

    expect(await applyDistributedRateLimit(requestFrom(ip), { prefix: 'test-unsubscribe', window: '1 h', max: 1 })).toBeNull()
  })

  it('keeps explicit identifiers independent under one prefix', async () => {
    const ip = '203.0.113.17'
    const options = { prefix: 'test-token', window: '1 h' as const, max: 1 }

    expect(await applyDistributedRateLimit(requestFrom(ip), { ...options, identifier: 'hash-a' })).toBeNull()
    expect((await applyDistributedRateLimit(requestFrom(ip), { ...options, identifier: 'hash-a' }))?.status).toBe(429)

    expect(await applyDistributedRateLimit(requestFrom(ip), { ...options, identifier: 'hash-b' })).toBeNull()
  })
})
