'use server'

/**
 * @deprecated Use '@/lib/rate-limit' directly.
 * Compatibility wrapper for server-action rate limiting.
 */

import { headers } from 'next/headers'
import { NextRequest } from 'next/server'
import { createRateLimiter, rateLimiters } from '@/lib/rate-limit'

function resolveIdentifier(headersList: Headers): string {
  const forwardedFor = headersList.get('x-forwarded-for')
  const realIp = headersList.get('x-real-ip')
  return forwardedFor?.split(',')[0] || realIp || '127.0.0.1'
}

export async function checkRateLimit(action: 'api' | 'sms' = 'api', customLimit?: number) {
  const headersList = await headers()
  const identifier = resolveIdentifier(headersList)
  const limiter = customLimit
    ? createRateLimiter({
        windowMs: 60 * 1000,
        max: customLimit,
        message: 'Too many requests. Please try again later.'
      })
    : action === 'sms'
      ? rateLimiters.sms
      : rateLimiters.api

  const mockReq = new NextRequest('http://localhost', {
    headers: {
      'x-forwarded-for': identifier
    }
  })

  const rateLimitResponse = await limiter(mockReq)
  if (rateLimitResponse) {
    throw new Error('Too many requests. Please try again later.')
  }

  return { remaining: null }
}
