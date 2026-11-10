import { NextRequest } from 'next/server'
import { createApiResponse, withApiAuth } from '@/lib/api/auth'
import { applyDistributedRateLimit } from '@/lib/distributed-rate-limit'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import { WebsiteLeadSchema, describeDbError, saveWebsiteLead } from '@/lib/table-bookings/christmas-leads'

export const dynamic = 'force-dynamic'

/**
 * POST /api/table-bookings/leads: the website saves the guest's details when they press Continue
 * on the details step of a Christmas dinner booking (Christmas funnel spec, owner decision 5).
 * Nothing is held. Posting the same lead_ref again updates the row.
 *
 * API key with create:bookings, like the booking route the website calls next. Answers
 * 201 `{ success: true, data: { lead_ref } }`; 400 `{ success: false, code: 'VALIDATION_ERROR',
 * error }` for a body it cannot accept (field names only, never the values); 503
 * `LEAD_SAVE_FAILED` when the database cannot be written, which the website logs and carries on
 * from (the guest is never stopped by a failed lead save). Error bodies carry `code` at the top
 * level, as the contract says, and inside `error` as every other route here does.
 *
 * Per-key hourly ceiling on top of withApiAuth's own limit: every lead can become one email, so a
 * flood of junk details must not become a flood of email from our domain.
 */

const HOURLY_LIMIT = 600

function failure(code: string, message: string, status: number, details?: Record<string, unknown>): Response {
  return createApiResponse(
    { success: false, code, error: { code, message, ...(details ? { details } : {}) } },
    status,
    {},
    'POST',
    'private',
  )
}

export async function POST(request: NextRequest): Promise<Response> {
  return withApiAuth(
    async (req, apiKey) => {
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return failure('VALIDATION_ERROR', 'Invalid JSON body', 400)
      }

      const parsed = WebsiteLeadSchema.safeParse(body)
      if (!parsed.success) {
        return failure('VALIDATION_ERROR', 'Invalid lead details', 400, {
          fields: parsed.error.issues.map((issue) => issue.path.join('.') || 'body'),
        })
      }

      const limited = await applyDistributedRateLimit(request, {
        prefix: 'table-booking-leads',
        identifier: apiKey?.id ?? 'unknown',
        window: '1 h',
        max: HOURLY_LIMIT,
        localWindowMs: 60 * 60 * 1000,
      })
      if (limited) return failure('RATE_LIMIT_EXCEEDED', 'Too many leads this hour', 429)

      try {
        const saved = await saveWebsiteLead(createAdminClient(), parsed.data)
        if (!saved.ok) return failure(saved.code, saved.message, 400)
        return createApiResponse({ success: true, data: { lead_ref: saved.leadRef } }, 201, {}, 'POST', 'private')
      } catch (error) {
        // Fail closed: a clear error to the website and a logged one for us. No guest details in it.
        logger.error('Christmas lead could not be saved', {
          error: error instanceof Error ? error : new Error(describeDbError(error).message),
          metadata: { leadRef: parsed.data.lead_ref, ...describeDbError(error) },
        })
        return failure('LEAD_SAVE_FAILED', 'The details could not be saved', 503)
      }
    },
    ['create:bookings'],
    request,
    { cacheMode: 'private' },
  )
}
