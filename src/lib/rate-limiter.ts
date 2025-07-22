import { createClient } from '@/lib/supabase/server';
import { headers } from 'next/headers';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyPrefix?: string; // Optional prefix for the rate limit key
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/**
 * Simple in-memory rate limiter using Supabase for persistence
 * Uses a sliding window approach
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const supabase = await createClient();
  const now = Date.now();
  const windowStart = now - config.windowMs;
  const key = config.keyPrefix ? `${config.keyPrefix}:${identifier}` : identifier;

  try {
    // Get current rate limit data
    const { data: rateLimitData, error: fetchError } = await supabase
      .from('rate_limits')
      .select('*')
      .eq('key', key)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Rate limit fetch error:', fetchError);
      // On error, allow the request but log it
      return {
        allowed: true,
        remaining: config.maxRequests,
        resetAt: new Date(now + config.windowMs),
      };
    }

    // If no existing record, create one
    if (!rateLimitData) {
      const { error: insertError } = await supabase
        .from('rate_limits')
        .insert({
          key,
          requests: [{ timestamp: now }],
          window_ms: config.windowMs,
          max_requests: config.maxRequests,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (insertError) {
        console.error('Rate limit insert error:', insertError);
      }

      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetAt: new Date(now + config.windowMs),
      };
    }

    // Filter out expired requests
    const validRequests = (rateLimitData.requests || [])
      .filter((req: any) => req.timestamp > windowStart);

    // Check if limit exceeded
    if (validRequests.length >= config.maxRequests) {
      const oldestRequest = validRequests[0];
      const resetAt = new Date(oldestRequest.timestamp + config.windowMs);

      return {
        allowed: false,
        remaining: 0,
        resetAt,
      };
    }

    // Add new request
    validRequests.push({ timestamp: now });

    // Update the record
    const { error: updateError } = await supabase
      .from('rate_limits')
      .update({
        requests: validRequests,
        updated_at: new Date().toISOString(),
      })
      .eq('key', key);

    if (updateError) {
      console.error('Rate limit update error:', updateError);
    }

    return {
      allowed: true,
      remaining: config.maxRequests - validRequests.length,
      resetAt: new Date(now + config.windowMs),
    };
  } catch (error) {
    console.error('Rate limit error:', error);
    // On error, allow the request but log it
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetAt: new Date(now + config.windowMs),
    };
  }
}

/**
 * Get client IP address from headers
 */
export async function getClientIp(): Promise<string> {
  const headersList = await headers();
  
  // Check various headers in order of preference
  const forwardedFor = headersList.get('x-forwarded-for');
  if (forwardedFor) {
    // Take the first IP if there are multiple
    return forwardedFor.split(',')[0].trim();
  }
  
  const realIp = headersList.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  
  const cfConnectingIp = headersList.get('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp;
  }
  
  // Default fallback
  return 'unknown';
}

/**
 * Rate limit configurations for different endpoints
 */
export const rateLimitConfigs = {
  // Public API endpoints
  publicApi: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30, // 30 requests per minute
    keyPrefix: 'api',
  },
  
  // Booking creation
  createBooking: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 10, // 10 bookings per hour per IP
    keyPrefix: 'booking:create',
  },
  
  // Availability checks
  checkAvailability: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 60, // 60 checks per minute
    keyPrefix: 'availability',
  },
  
  // SMS sending
  sendSms: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 20, // 20 SMS per hour
    keyPrefix: 'sms',
  },
  
  // Payment operations
  payment: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 5, // 5 payment attempts per hour
    keyPrefix: 'payment',
  },
  
  // Webhook endpoints
  webhook: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100, // 100 webhook calls per minute
    keyPrefix: 'webhook',
  },
};

/**
 * Clean up old rate limit entries (call this periodically)
 */
export async function cleanupRateLimits() {
  const supabase = await createClient();
  const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
  
  try {
    const { error } = await supabase
      .from('rate_limits')
      .delete()
      .lt('updated_at', cutoffTime.toISOString());
      
    if (error) {
      console.error('Rate limit cleanup error:', error);
    }
  } catch (error) {
    console.error('Rate limit cleanup error:', error);
  }
}