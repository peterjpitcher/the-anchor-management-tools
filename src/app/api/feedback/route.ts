import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createApiResponse, createErrorResponse } from '@/lib/api/auth'
import {
  getIdempotencyKey,
  computeIdempotencyRequestHash,
  claimIdempotencyKey,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'
import { applyDistributedRateLimit } from '@/lib/distributed-rate-limit'
import { getClientIp } from '@/lib/turnstile'
import { sendEmail } from '@/lib/email/emailService'
import { retry } from '@/lib/retry'
import { formatPhoneForStorage } from '@/lib/utils'
import { feedbackSubmissionSchema } from '@/lib/feedback/schema'
import { buildManagerFeedbackEmail } from '@/lib/feedback/manager-email'
import { DEFAULT_FEEDBACK_SOURCE, sanitizeFeedbackSource } from './source'

const MANAGER_EMAIL = process.env.MANAGER_EMAIL || 'manager@the-anchor.pub'

export async function POST(request: NextRequest) {
  // 1. Rate limit
  const rateLimited = await applyDistributedRateLimit(request, {
    prefix: 'feedback-form',
    window: '1 h',
    max: 10
  })
  if (rateLimited) {
    return rateLimited
  }

  // 2. Idempotency key required
  const key = getIdempotencyKey(request)
  if (!key) {
    return createErrorResponse('Missing Idempotency-Key header', 'IDEMPOTENCY_KEY_REQUIRED', 400)
  }

  // 3. Parse JSON body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return createErrorResponse('Invalid JSON body', 'VALIDATION_ERROR', 400)
  }

  // 4. Validate
  const parsedResult = feedbackSubmissionSchema.safeParse(body)
  if (!parsedResult.success) {
    const firstIssue = parsedResult.error.issues[0]?.message ?? 'Invalid submission'
    return createErrorResponse(firstIssue, 'VALIDATION_ERROR', 400)
  }
  const parsed = parsedResult.data

  // 5. Honeypot — silently accept without persisting or emailing
  if (typeof parsed.honeypot === 'string' && parsed.honeypot.trim().length > 0) {
    return createApiResponse({ ok: true }, 201, {}, 'POST')
  }

  // 6. Contact details without consent are rejected outright — silently
  // stripping them would leave the guest waiting for a follow-up that can
  // never come.
  const hasConsent = parsed.contactConsent === true
  const hasContactDetails = Boolean(
    parsed.customerName?.trim() || parsed.customerEmail?.trim() || parsed.customerPhone?.trim()
  )
  if (hasContactDetails && !hasConsent) {
    return createErrorResponse(
      'Tick the box so we can contact you, or clear your details',
      'VALIDATION_ERROR',
      400
    )
  }

  // Consent strip — defence in depth; never trust the client
  const customerName: string | null = hasConsent ? parsed.customerName?.trim() || null : null
  const customerEmail: string | null = hasConsent ? parsed.customerEmail?.trim() || null : null
  let customerPhone: string | null = hasConsent ? parsed.customerPhone?.trim() || null : null

  // 7. Phone normalisation
  if (customerPhone) {
    try {
      customerPhone = formatPhoneForStorage(customerPhone)
    } catch {
      return createErrorResponse('Please enter a valid phone number', 'VALIDATION_ERROR', 400)
    }
  }

  const supabase = createAdminClient()
  const requestHash = computeIdempotencyRequestHash(parsed)

  // 8. Claim idempotency key
  const claim = await claimIdempotencyKey(supabase, key, requestHash)
  if (claim.state === 'conflict') {
    return createErrorResponse(
      'Idempotency key already used with a different request',
      'IDEMPOTENCY_KEY_CONFLICT',
      409
    )
  }
  if (claim.state === 'in_progress') {
    return createErrorResponse(
      'This submission is already being processed',
      'IDEMPOTENCY_KEY_IN_PROGRESS',
      409
    )
  }
  if (claim.state === 'replay') {
    return createApiResponse(claim.response ?? { ok: true }, 201, {}, 'POST')
  }

  // Provenance — carried from the landing page's ?src= query param. Validated
  // server-side; anything unexpected falls back to the default.
  const source =
    sanitizeFeedbackSource((body as Record<string, unknown>).src) ?? DEFAULT_FEEDBACK_SOURCE

  // 9. Insert the row
  const { data: inserted, error: insertError } = await supabase
    .from('review_feedback')
    .insert({
      rating: parsed.rating,
      comments: parsed.comments?.trim() || null,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      contact_consent: hasConsent,
      source,
      submitted_ip: getClientIp(request),
      user_agent: request.headers.get('user-agent')
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    await releaseIdempotencyClaim(supabase, key, requestHash)
    return createErrorResponse('Could not save your feedback', 'FEEDBACK_SAVE_ERROR', 500)
  }

  const id = inserted.id

  // 10. Best-effort manager email — retried on transient failure, but must
  // NOT fail the request (the submission is already saved to the inbox).
  try {
    await retry(
      async () => {
        const emailResult = await sendEmail({
          to: MANAGER_EMAIL,
          ...buildManagerFeedbackEmail({
            rating: parsed.rating,
            comments: parsed.comments,
            customerName,
            customerEmail,
            customerPhone,
            contactConsent: hasConsent
          })
        })
        if (!emailResult.success) {
          throw new Error(emailResult.error || 'Manager notification email failed')
        }
      },
      { maxAttempts: 3, delay: 500, backoff: 'exponential', factor: 2 }
    )
  } catch (emailError) {
    console.error('[Feedback] Manager notification email failed after retries', {
      error: emailError instanceof Error ? emailError.message : String(emailError)
    })
  }

  // 11. Persist idempotency response
  try {
    await persistIdempotencyResponse(supabase, key, requestHash, { ok: true, id })
  } catch (persistError) {
    console.error('[Feedback] Failed to persist idempotency response', {
      error: persistError instanceof Error ? persistError.message : String(persistError)
    })
  }

  // 12. Success — pass the method so the 201 is sent with no-store
  return createApiResponse({ ok: true }, 201, {}, 'POST')
}

export async function OPTIONS() {
  return createApiResponse({}, 200)
}
