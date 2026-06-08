import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { NextRequest, NextResponse } from 'next/server'
import { createRateLimiter } from '@/lib/rate-limit'

type RateLimitOptions = {
  prefix: string
  window: `${number} s` | `${number} m` | `${number} h` | `${number} d`
  max: number
  message?: string
  localWindowMs?: number
}

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

export async function applyDistributedRateLimit(
  request: NextRequest,
  options: RateLimitOptions
): Promise<NextResponse | null> {
  const message = options.message ?? 'Too many requests. Please try again later.'
  const identifier = getClientIp(request)
  const limiter = getUpstashLimiter(options)

  if (!limiter) {
    const localLimiter = createRateLimiter({
      windowMs: options.localWindowMs ?? 60 * 60 * 1000,
      max: options.max,
      message,
      keyGenerator: () => `${options.prefix}:${identifier}`,
    })
    return localLimiter(request)
  }

  const result = await limiter.limit(identifier)

  if (result.success) {
    return null
  }

  const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))

  return NextResponse.json(
    { success: false, error: { code: 'RATE_LIMITED', message } },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(options.max),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': new Date(result.reset).toISOString(),
      },
    }
  )
}
