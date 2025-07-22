import { NextRequest, NextResponse } from 'next/server'

// In-memory store for rate limiting (consider Redis for production)
const rateLimitStore = new Map<string, { badge: number; resetTime: number }>()

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of Array.from(rateLimitStore.entries())) {
    if (value.resetTime < now) {
      rateLimitStore.delete(key)
    }
  }
}, 60000) // Clean every minute

export interface RateLimitConfig {
  windowMs: number // Time window in milliseconds
  max: number // Maximum requests per window
  message?: string // Error message
  keyGenerator?: (req: NextRequest) => string // Function to generate unique key
}

export function createRateLimiter(config: RateLimitConfig) {
  const {
    windowMs,
    max,
    message = 'Too many requests, please try again later.',
    keyGenerator = (req) => {
      // Default: Use IP address or fallback to a header
      return req.headers.get('x-forwarded-for') || 
             req.headers.get('x-real-ip') || 
             'unknown'
    }
  } = config

  return async function rateLimit(req: NextRequest): Promise<NextResponse | null> {
    const key = keyGenerator(req)
    const now = Date.now()
    
    // Get or create rate limit data for this key
    let data = rateLimitStore.get(key)
    
    if (!data || data.resetTime < now) {
      // Create new window
      data = {
        badge: 1,
        resetTime: now + windowMs
      }
      rateLimitStore.set(key, data)
      return null // Allow request
    }
    
    // Increment count
    data.badge++
    
    // Check if limit exceeded
    if (data.badge > max) {
      const retryAfter = Math.ceil((data.resetTime - now) / 1000)
      
      return NextResponse.json(
        { error: message },
        { 
          status: 429,
          headers: {
            'Retry-After': retryAfter.toString(),
            'X-RateLimit-Limit': max.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': new Date(data.resetTime).toISOString()
          }
        }
      )
    }
    
    return null // Allow request
  }
}

// Pre-configured rate limiters for different use cases
export const rateLimiters = {
  // SMS operations: 10 requests per minute per IP
  sms: createRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    message: 'Too many SMS requests. Please wait before sending more messages.'
  }),
  
  // Bulk operations: 5 requests per hour per IP
  bulk: createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    message: 'Too many bulk operations. Please wait before performing more bulk actions.'
  }),
  
  // Authentication: 20 attempts per 15 minutes per IP (increased for production issues)
  auth: createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Increased from 5 to handle shared IPs
    message: 'Too many login attempts. Please try again later.'
  }),
  
  // API general: 100 requests per minute per IP
  api: createRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 100,
    message: 'Too many API requests. Please slow down.'
  }),
  
  // Webhook endpoints: 1000 requests per minute (higher for external services)
  webhook: createRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 1000,
    message: 'Too many webhook requests.'
  })
}

// Helper to apply rate limiting to server actions
export async function withRateLimit<T extends (...args: unknown[]) => Promise<unknown>>(
  action: T,
  limiter: ReturnType<typeof createRateLimiter>,
  identifier: string
): Promise<T> {
  return (async (...args: Parameters<T>) => {
    // Create a mock request object for server actions
    const mockReq = new NextRequest('http://localhost', {
      headers: {
        'x-forwarded-for': identifier
      }
    })
    
    const rateLimitResponse = await limiter(mockReq)
    if (rateLimitResponse) {
      throw new Error('Rate limit exceeded. Please try again later.')
    }
    
    return action(...args)
  }) as T
}