import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { NextRequest, NextResponse } from 'next/server'
import { createRateLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

type RateLimitOptions = {
  prefix: string
  window: `${number} s` | `${number} m` | `${number} h` | `${number} d`
  max: number
  message?: string
  localWindowMs?: number
  /**
   * What to count against, instead of the caller's IP.
   *
   * Added for the one-click unsubscribe endpoint. Gmail and Yahoo send those POSTs from
   * shared outbound servers, so a burst of opt-outs after a campaign all arrive from a
   * handful of addresses and an IP budget throws the rest away. The thing worth limiting
   * there is repeated use of the same token, not repeated use of the same mail provider.
   *
   * Only pass a value that is not the subject's own secret in plain form: it becomes part of
   * a Redis key. Hash it first, as the unsubscribe route does.
   */
  identifier?: string
}

export type DistributedRateLimitDecision =
  | { limited: false }
  | { limited: true; retryAfterSeconds: number; limit: number; remaining: number; resetAt: Date }

const limiterCache = new Map<string, Ratelimit>()

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown'
  }

  return request.headers.get('x-real-ip') || request.headers.get('cf-connecting-ip') || 'unknown'
}

function getUpstashLimiter(options: RateLimitOptions): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    return null
  }

  const cacheKey = `${options.prefix}:${options.window}:${options.max}`
  const existing = limiterCache.get(cacheKey)
  if (existing) {
    return existing
  }

  const limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(options.max, options.window),
    analytics: true,
    prefix: options.prefix,
  })
  limiterCache.set(cacheKey, limiter)
  return limiter
}

function windowToMs(window: RateLimitOptions['window']): number {
  const [amountText, unit] = window.split(' ')
  const amount = Number(amountText)
  const unitMs = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000
  return Number.isFinite(amount) && amount > 0 ? amount * unitMs : 3_600_000
}

async function checkLocally(
  request: NextRequest,
  options: RateLimitOptions,
  identifier: string
): Promise<DistributedRateLimitDecision> {
  const localLimiter = createRateLimiter({
    name: 'distributed-fallback',
    windowMs: options.localWindowMs ?? windowToMs(options.window),
    max: options.max,
    keyGenerator: () => `${options.prefix}:${identifier}`,
  })
  const refused = await localLimiter(request)
  if (!refused) return { limited: false }
  const retryAfterSeconds = Math.max(1, Number(refused.headers.get('Retry-After')) || 60)
  return {
    limited: true,
    retryAfterSeconds,
    limit: options.max,
    remaining: 0,
    resetAt: new Date(Date.now() + retryAfterSeconds * 1000),
  }
}

/**
 * Count one request and say whether it is over the limit, across every server copy when Upstash
 * is configured, per copy otherwise.
 *
 * A Redis fault falls back to the per-copy count and logs an error, so our own outage never turns
 * into a refused booking (BK-108). The caller words the refusal.
 */
export async function checkDistributedRateLimit(
  request: NextRequest,
  options: RateLimitOptions
): Promise<DistributedRateLimitDecision> {
  const identifier = options.identifier?.trim() || getClientIp(request)
  const limiter = getUpstashLimiter(options)

  if (!limiter) {
    return checkLocally(request, options, identifier)
  }

  try {
    const result = await limiter.limit(identifier)
    if (result.success) return { limited: false }
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
      limit: options.max,
      remaining: result.remaining,
      resetAt: new Date(result.reset),
    }
  } catch (error) {
    logger.error('Distributed rate limit check failed; counting on this server only', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { prefix: options.prefix },
    })
    return checkLocally(request, options, identifier)
  }
}

/**
 * Whether a subject has already used its whole allowance, WITHOUT counting this request.
 *
 * For limits that count only some outcomes, such as short link guesses that hit nothing (BK-203):
 * the route asks first, refuses an exhausted subject before doing the work, and counts with
 * checkDistributedRateLimit only when the outcome is one that should be counted. Answers "not
 * exhausted" when it cannot tell: a fault here must not block a real guest's link.
 */
export async function isDistributedRateLimitExhausted(
  request: NextRequest,
  options: RateLimitOptions
): Promise<boolean> {
  const identifier = options.identifier?.trim() || getClientIp(request)
  const limiter = getUpstashLimiter(options)

  if (!limiter) {
    return peekLocalCount(options, identifier) >= options.max
  }

  try {
    const { remaining } = await limiter.getRemaining(identifier)
    return remaining <= 0
  } catch (error) {
    logger.error('Distributed rate limit lookup failed; letting the request through', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { prefix: options.prefix },
    })
    return false
  }
}

/**
 * The per-copy fallback for isDistributedRateLimitExhausted. Kept here, not in the shared store,
 * so peeking never counts: a counter of misses per subject, reset when its window ends.
 */
const localMissCounts = new Map<string, { count: number; resetAt: number }>()

function peekLocalCount(options: RateLimitOptions, identifier: string): number {
  const key = `${options.prefix}:${identifier}`
  const entry = localMissCounts.get(key)
  if (!entry || entry.resetAt < Date.now()) return 0
  return entry.count
}

/**
 * Count one outcome against a peek-first limit (see isDistributedRateLimitExhausted). Never throws.
 */
export async function recordDistributedRateLimitHit(
  request: NextRequest,
  options: RateLimitOptions
): Promise<void> {
  const identifier = options.identifier?.trim() || getClientIp(request)
  const limiter = getUpstashLimiter(options)

  if (!limiter) {
    const key = `${options.prefix}:${identifier}`
    const now = Date.now()
    const entry = localMissCounts.get(key)
    if (!entry || entry.resetAt < now) {
      localMissCounts.set(key, { count: 1, resetAt: now + (options.localWindowMs ?? windowToMs(options.window)) })
    } else {
      entry.count += 1
    }
    return
  }

  try {
    await limiter.limit(identifier)
  } catch (error) {
    logger.error('Could not count a rate-limited outcome', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { prefix: options.prefix },
    })
  }
}

export async function applyDistributedRateLimit(
  request: NextRequest,
  options: RateLimitOptions
): Promise<NextResponse | null> {
  const message = options.message ?? 'Too many requests. Please try again later.'
  const decision = await checkDistributedRateLimit(request, options)

  if (!decision.limited) {
    return null
  }

  return NextResponse.json(
    { success: false, error: { code: 'RATE_LIMITED', message } },
    {
      status: 429,
      headers: {
        'Retry-After': String(decision.retryAfterSeconds),
        'X-RateLimit-Limit': String(options.max),
        'X-RateLimit-Remaining': String(decision.remaining),
        'X-RateLimit-Reset': decision.resetAt.toISOString(),
      },
    }
  )
}
