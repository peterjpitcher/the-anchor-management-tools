import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createApiResponse, withApiAuth } from '@/lib/api/auth'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import { describeDbError, readResumeLink } from '@/lib/table-bookings/christmas-leads'

export const dynamic = 'force-dynamic'

/**
 * POST /api/table-bookings/leads/resume: the website swaps a "finish my booking" token for the
 * details the guest typed, to fill its Christmas booking form in (Christmas funnel spec, owner
 * decisions 5 and 6). The token is in the JSON body, `{ "token": "<token>" }`, never in an address:
 * request paths are kept in api_usage and in the hosting logs, and the token must never be logged.
 *
 * API key with create:bookings. Answers 200 `{ success: true, data: { first_name, last_name, email,
 * phone (E.164), booking_date, booking_time, party_size, purpose: 'christmas' } }`; 404
 * `{ success: false, code: 'RESUME_LINK_INVALID' }` for an unknown or expired token (or no token);
 * 503 `RESUME_UNAVAILABLE` when the database cannot be read, after which the website shows its
 * ordinary empty form. Never cached.
 */

const ResumeRequestSchema = z.object({
  token: z.string().min(1).max(200),
})

function failure(code: string, message: string, status: number): Response {
  return createApiResponse({ success: false, code, error: { code, message } }, status, {}, 'POST', 'private')
}

export async function POST(request: NextRequest): Promise<Response> {
  return withApiAuth(
    async (req) => {
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return failure('RESUME_LINK_INVALID', 'That link is not valid', 404)
      }
      const parsed = ResumeRequestSchema.safeParse(body)
      if (!parsed.success) return failure('RESUME_LINK_INVALID', 'That link is not valid', 404)

      try {
        const result = await readResumeLink(createAdminClient(), parsed.data.token)
        if (result.state !== 'ok') return failure('RESUME_LINK_INVALID', 'That link is not valid', 404)
        return createApiResponse({ success: true, data: result.data }, 200, {}, 'POST', 'private')
      } catch (error) {
        // Never the token, and never the database's words to the website.
        logger.error('Christmas resume link could not be read', {
          error: error instanceof Error ? error : new Error(describeDbError(error).message),
          metadata: describeDbError(error),
        })
        return failure('RESUME_UNAVAILABLE', 'The details could not be loaded', 503)
      }
    },
    ['create:bookings'],
    request,
    { cacheMode: 'private' },
  )
}
