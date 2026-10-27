import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Flood limits for the public booking routes (BK-108) and short link guesses (BK-203), customer
 * bookings review of 24 October 2026.
 *
 * Upstash is faked here. The things that matter: the count is shared through Upstash when it is
 * configured; a Redis fault never refuses a guest (it falls back to this server's own count); a
 * guest's phone number is hashed before it becomes a Redis key; and a refusal carries the code the
 * website already reads.
 */

const upstash = vi.hoisted(() => ({
  limit: vi.fn(),
  getRemaining: vi.fn(),
  constructed: [] as Array<{ prefix: string }>,
}))

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))
vi.mock('@upstash/ratelimit', () => {
  class Ratelimit {
    static slidingWindow = vi.fn(() => 'sliding-window')
    constructor(options: { prefix: string }) {
      upstash.constructed.push(options)
    }
    limit = upstash.limit
    getRemaining = upstash.getRemaining
  }
  return { Ratelimit }
})

const { error } = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import {
  checkDistributedRateLimit,
  isDistributedRateLimitExhausted,
  recordDistributedRateLimitHit,
} from '@/lib/distributed-rate-limit'
import { hashRateLimitSubject, limitBookingAttempt } from '@/lib/api/booking-rate-limits'

function requestFrom(ip: string): NextRequest {
  return new NextRequest('http://localhost/api/table-bookings', { method: 'POST', headers: { 'x-forwarded-for': ip } })
}

describe('with Upstash configured', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.example')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('counts through Upstash, keyed on a hash of the guest phone, never the phone itself', async () => {
    upstash.limit.mockResolvedValue({ success: true, remaining: 19, reset: Date.now() + 60_000 })

    const refused = await limitBookingAttempt(requestFrom('198.51.100.1'), {
      prefix: 'table-booking-guest-shared',
      subject: '+447700900123',
      max: 20,
    })

    expect(refused).toBeNull()
    expect(upstash.limit).toHaveBeenCalledWith(hashRateLimitSubject('+447700900123'))
    expect(JSON.stringify(upstash.limit.mock.calls)).not.toContain('7700900123')
  })

  it('refuses with 429 RATE_LIMIT_EXCEEDED, the pub number and a Retry-After header over the limit', async () => {
    upstash.limit.mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 120_000 })

    const refused = await limitBookingAttempt(requestFrom('198.51.100.2'), {
      prefix: 'table-booking-guest-over',
      subject: '+447700900124',
      max: 20,
    })

    expect(refused?.status).toBe(429)
    const body = await refused!.json()
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED')
    expect(body.error.message).toContain('01753 682707')
    expect(Number(refused!.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('never refuses a guest because Redis failed: it logs and counts on this server instead', async () => {
    upstash.limit.mockRejectedValue(new Error('upstash unreachable'))

    const decision = await checkDistributedRateLimit(requestFrom('198.51.100.3'), {
      prefix: 'redis-down',
      window: '1 h',
      max: 2,
      identifier: 'guest-a',
    })

    expect(decision).toEqual({ limited: false })
    expect(error).toHaveBeenCalledWith('Distributed rate limit check failed; counting on this server only', expect.anything())
  })

  it('lets a short link through when the miss count cannot be read', async () => {
    upstash.getRemaining.mockRejectedValue(new Error('upstash unreachable'))

    expect(await isDistributedRateLimitExhausted(requestFrom('198.51.100.4'), { prefix: 'miss-down', window: '1 h', max: 30 })).toBe(false)
  })

  it('reports an address as exhausted once Upstash says nothing remains', async () => {
    upstash.getRemaining.mockResolvedValue({ remaining: 0, reset: Date.now() + 60_000, limit: 30 })

    expect(await isDistributedRateLimitExhausted(requestFrom('198.51.100.5'), { prefix: 'miss-full', window: '1 h', max: 30 })).toBe(true)
  })
})

describe('without Upstash (each server counts for itself)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('still limits one phone and leaves another alone', async () => {
    const options = { prefix: 'local-guest', max: 3 }
    for (let i = 0; i < 3; i += 1) {
      expect(await limitBookingAttempt(requestFrom('198.51.100.6'), { ...options, subject: '+447700900125' })).toBeNull()
    }
    expect((await limitBookingAttempt(requestFrom('198.51.100.6'), { ...options, subject: '+447700900125' }))?.status).toBe(429)
    expect(await limitBookingAttempt(requestFrom('198.51.100.6'), { ...options, subject: '+447700900126' })).toBeNull()
  })

  it('counts only recorded misses, refuses after the limit, and forgets them when the window ends', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-27T10:00:00Z'))
    const options = { prefix: 'local-miss', window: '1 h' as const, max: 2 }
    const guesser = requestFrom('203.0.113.50')

    expect(await isDistributedRateLimitExhausted(guesser, options)).toBe(false)
    await recordDistributedRateLimitHit(guesser, options)
    // Asking does not count.
    expect(await isDistributedRateLimitExhausted(guesser, options)).toBe(false)
    await recordDistributedRateLimitHit(guesser, options)
    expect(await isDistributedRateLimitExhausted(guesser, options)).toBe(true)
    // Another address is unaffected.
    expect(await isDistributedRateLimitExhausted(requestFrom('203.0.113.51'), options)).toBe(false)

    vi.setSystemTime(new Date('2026-10-27T11:00:01Z'))
    expect(await isDistributedRateLimitExhausted(guesser, options)).toBe(false)
  })
})
