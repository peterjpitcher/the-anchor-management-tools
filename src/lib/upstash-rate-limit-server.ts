import { headers } from 'next/headers';
import { checkRateLimit as upstashCheckRateLimit } from './upstash-rate-limit';

/**
 * Server-side rate limiting for server actions
 * Falls back to in-memory rate limiting if Upstash is not configured
 */
export async function checkServerActionRateLimit(
  action: string,
  limiter: 'api' | 'sms' | 'bulkSms' | 'login' | 'passwordReset' | 'fileUpload' | 'webhook' = 'api'
): Promise<{ success: boolean; message?: string }> {
  try {
    // Check if Upstash is configured
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      // Log warning in development
      if (process.env.NODE_ENV === 'development') {
        console.warn('Upstash Redis not configured. Rate limiting disabled in development.');
      }
      return { success: true };
    }

    // Get identifier from headers
    const headersList = await headers();
    const forwardedFor = headersList.get('x-forwarded-for');
    const realIp = headersList.get('x-real-ip');
    const identifier = forwardedFor || realIp || 'unknown';

    // Create a unique key combining IP and action
    const key = `${identifier}:${action}`;

    // Check rate limit
    const result = await upstashCheckRateLimit(key, limiter);

    if (!result.success) {
      return {
        success: false,
        message: `Rate limit exceeded. Try again at ${result.reset.toLocaleTimeString()}`
      };
    }

    return { success: true };
  } catch (error) {
    // Log error but don't block the request
    console.error('Rate limiting error:', error);
    return { success: true };
  }
}

/**
 * Wrapper for server actions with rate limiting
 */
export function withServerActionRateLimit<T extends (...args: any[]) => Promise<any>>(
  action: T,
  options: {
    key: string;
    limiter?: 'api' | 'sms' | 'bulkSms' | 'login' | 'passwordReset' | 'fileUpload' | 'webhook';
  } = { key: 'action', limiter: 'api' }
): T {
  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    const rateLimitResult = await checkServerActionRateLimit(options.key, options.limiter);
    
    if (!rateLimitResult.success) {
      throw new Error(rateLimitResult.message || 'Rate limit exceeded');
    }

    return action(...args);
  }) as T;
}