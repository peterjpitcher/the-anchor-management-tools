import crypto from 'crypto'
import type { NextRequest } from 'next/server'
import { createErrorResponse } from '@/lib/api/auth'
import { checkDistributedRateLimit } from '@/lib/distributed-rate-limit'

/**
 * Flood limits for the public booking routes (BK-108, customer bookings review of 24 October 2026).
 *
 * These used to be in-memory counters, so each server copy kept its own count, and event bookings
 * and the event waitlist had none at all. They now count in Upstash across every copy (falling
 * back to a per-copy count when Upstash is not configured or fails, so our outage never refuses a
 * guest).
 *
 * The website forwards no client IP, so every proxied booking arrives from the website's own
 * servers. The guest's phone number (or, for an enquiry with no phone, the email) is the identity
 * that counts. It is hashed before it becomes part of a Redis key: a phone number is personal data.
 */

/** A guest hunting for a free slot can submit several times; twenty an hour from one number is nobody genuine. */
export const GUEST_BOOKING_MAX_PER_HOUR = 20

/** A private hire enquiry is one form per party. Ten an hour from one contact is a script. */
export const PRIVATE_ENQUIRY_MAX_PER_HOUR = 10

/** Anonymous callers (no valid API key), per IP. Unchanged from the old in-memory limit. */
export const ANONYMOUS_BOOKING_MAX_PER_HOUR = 10

/** Unpaid event holds one customer may have at once, across all events (BK-108 step 4). */
export const MAX_PENDING_EVENT_HOLDS_PER_CUSTOMER = 3

export const GUEST_RATE_LIMIT_MESSAGE =
  'Too many booking attempts for this phone number. Please try again later or call us on 01753 682707.'

export function hashRateLimitSubject(subject: string): string {
  return crypto.createHash('sha256').update(subject.trim().toLowerCase()).digest('hex').slice(0, 32)
}

/**
 * Count one attempt for this subject. Returns the 429 to send, or null to carry on. The code is
 * RATE_LIMIT_EXCEEDED, which the website already reads.
 */
export async function limitBookingAttempt(
  request: NextRequest | Request,
  options: {
    /** One per operation, so two routes never share a count. */
    prefix: string
    /** The guest identity (a normalised phone or email). Hashed here. Omit to count by IP. */
    subject?: string
    max: number
    message?: string
  }
): Promise<Response | null> {
  const decision = await checkDistributedRateLimit(request as NextRequest, {
    prefix: options.prefix,
    window: '1 h',
    max: options.max,
    ...(options.subject ? { identifier: hashRateLimitSubject(options.subject) } : {}),
  })

  if (!decision.limited) return null

  const response = createErrorResponse(
    options.message ?? GUEST_RATE_LIMIT_MESSAGE,
    'RATE_LIMIT_EXCEEDED',
    429
  )
  response.headers.set('Retry-After', String(decision.retryAfterSeconds))
  return response
}
