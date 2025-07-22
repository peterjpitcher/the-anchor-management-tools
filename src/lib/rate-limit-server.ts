'use server'

import { headers } from 'next/headers'

// Simple in-memory rate limiter for server actions
const rateLimitStore = new Map<string, { badge: number; resetTime: number }>()

class SimpleRateLimiter {
  private windowMs: number
  
  constructor(windowMs: number) {
    this.windowMs = windowMs
  }
  
  check(key: string, limit: number): { success: boolean; remaining: number } {
    const now = Date.now()
    const data = rateLimitStore.get(key)
    
    if (!data || data.resetTime < now) {
      // New window
      rateLimitStore.set(key, { badge: 1, resetTime: now + this.windowMs })
      return { success: true, remaining: limit - 1 }
    }
    
    // Increment count
    data.badge++
    
    // Check limit
    if (data.badge > limit) {
      return { success: false, remaining: 0 }
    }
    
    return { success: true, remaining: limit - data.badge }
  }
}

// Create rate limiters
const apiRateLimit = new SimpleRateLimiter(60 * 1000) // 1 minute window
const smsRateLimit = new SimpleRateLimiter(60 * 1000) // 1 minute window

export async function checkRateLimit(action: 'api' | 'sms' = 'api', customLimit?: number) {
  const headersList = await headers()
  
  // Get IP address
  const forwardedFor = headersList.get('x-forwarded-for')
  const realIp = headersList.get('x-real-ip')
  const ip = forwardedFor?.split(',')[0] || realIp || '127.0.0.1'
  
  // Select rate limiter and limit
  const rateLimiter = action === 'sms' ? smsRateLimit : apiRateLimit
  const limit = customLimit || (action === 'sms' ? 10 : 60)
  
  const { success, remaining } = rateLimiter.check(ip, limit)
  
  if (!success) {
    throw new Error('Too many requests. Please try again later.')
  }
  
  return { remaining }
}