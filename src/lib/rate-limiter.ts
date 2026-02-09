import { headers } from 'next/headers'
import { NextRequest } from 'next/server'
import { createRateLimiter, cleanupRateLimits as cleanupInMemoryRateLimits } from '@/lib/rate-limit'

interface RateLimitConfig {
  windowMs: number
  maxRequests: number
  keyPrefix?: string
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
}

/**
 * @deprecated Use '@/lib/rate-limit' directly.
 * Compatibility wrapper that delegates to the shared in-memory limiter.
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const limiter = createRateLimiter({
    windowMs: config.windowMs,
    max: config.maxRequests,
    keyGenerator: () => (config.keyPrefix ? `${config.keyPrefix}:${identifier}` : identifier)
  })

  const mockReq = new NextRequest('http://localhost', {
    headers: { 'x-forwarded-for': identifier }
  })

  const result = await limiter(mockReq)
  if (result) {
    const resetHeader = result.headers.get('X-RateLimit-Reset')
    return {
      allowed: false,
      remaining: 0,
      resetAt: resetHeader ? new Date(resetHeader) : new Date(Date.now() + config.windowMs)
    }
  }

  return {
    allowed: true,
    remaining: Math.max(config.maxRequests - 1, 0),
    resetAt: new Date(Date.now() + config.windowMs)
  }
}

export async function getClientIp(): Promise<string> {
  const headersList = await headers()

  const forwardedFor = headersList.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim()
  }

  const realIp = headersList.get('x-real-ip')
  if (realIp) {
    return realIp
  }

  const cfConnectingIp = headersList.get('cf-connecting-ip')
  if (cfConnectingIp) {
    return cfConnectingIp
  }

  return 'unknown'
}

export const rateLimitConfigs = {
  publicApi: {
    windowMs: 60 * 1000,
    maxRequests: 30,
    keyPrefix: 'api',
  },
  createBooking: {
    windowMs: 60 * 60 * 1000,
    maxRequests: 10,
    keyPrefix: 'booking:create',
  },
  checkAvailability: {
    windowMs: 60 * 1000,
    maxRequests: 60,
    keyPrefix: 'availability',
  },
  sendSms: {
    windowMs: 60 * 60 * 1000,
    maxRequests: 20,
    keyPrefix: 'sms',
  },
  payment: {
    windowMs: 60 * 60 * 1000,
    maxRequests: 5,
    keyPrefix: 'payment',
  },
  webhook: {
    windowMs: 60 * 1000,
    maxRequests: 100,
    keyPrefix: 'webhook',
  },
}

export async function cleanupRateLimits() {
  return cleanupInMemoryRateLimits()
}
