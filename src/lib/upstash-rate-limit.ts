import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Initialize Redis client from environment variables
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Rate limiters for different use cases
export const rateLimiters = {
  // General API rate limiting (10 requests per 10 seconds)
  api: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "10 s"),
    prefix: "rl:api",
  }),

  // SMS sending rate limit (5 messages per minute per phone number)
  sms: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, "1 m"),
    prefix: "rl:sms",
  }),

  // Bulk SMS rate limit (100 messages per hour)
  bulkSms: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, "1 h"),
    prefix: "rl:bulk-sms",
  }),

  // Login attempts (5 attempts per 15 minutes per IP)
  login: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, "15 m"),
    prefix: "rl:login",
  }),

  // Password reset (3 requests per hour per email)
  passwordReset: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(3, "1 h"),
    prefix: "rl:password-reset",
  }),

  // File upload (20 uploads per hour per user)
  fileUpload: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(20, "1 h"),
    prefix: "rl:upload",
  }),

  // Webhook processing (100 requests per minute)
  webhook: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, "1 m"),
    prefix: "rl:webhook",
  }),
};

/**
 * Rate limit helper for server actions
 */
export async function checkRateLimit(
  identifier: string,
  limiter: keyof typeof rateLimiters = 'api'
): Promise<{ success: boolean; limit: number; remaining: number; reset: Date }> {
  const { success, limit, remaining, reset } = await rateLimiters[limiter].limit(identifier);
  
  return {
    success,
    limit,
    remaining,
    reset: new Date(reset),
  };
}

/**
 * Get rate limit headers for API responses
 */
export function getRateLimitHeaders(result: {
  limit: number;
  remaining: number;
  reset: Date;
}): Record<string, string> {
  return {
    "X-RateLimit-Limit": result.limit.toString(),
    "X-RateLimit-Remaining": result.remaining.toString(),
    "X-RateLimit-Reset": result.reset.toISOString(),
  };
}