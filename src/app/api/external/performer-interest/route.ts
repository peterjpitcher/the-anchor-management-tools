/**
 * RETIRED, 12 September 2026. Open mic nights are discontinued.
 *
 * This route took a performer's name, phone number, email and a description of their act,
 * stored them, and replied with a confirmation that promised things that no longer exist:
 * "we'll be in touch when we're booking acts", plus practical details for a night that
 * "typically starts around 8pm". Nothing has posted to it since 11 August 2026. It was still
 * live, still accepting personal data, and still sending that promise to anybody who found
 * the form.
 *
 * It answers 410 Gone rather than being deleted outright. A route that has vanished returns
 * the framework's own 404, which reads as a bug to whoever calls it; 410 says the thing is
 * gone deliberately and will not come back, which is the accurate answer for a website form
 * that may still be cached somewhere. It also keeps this note where the next person looks.
 *
 * DELIBERATELY LEFT ALONE: the `performer_submissions` table, the records in it and
 * `/performers` in the app. Past submissions are real people's data and staff may still need
 * to see them; deleting data is the owner's call, not a side effect of retiring an intake
 * form.
 *
 * The write:performers API scope still exists and is unused by this route. The API key that
 * carries it is the website's; revoking the scope is an operational change for the owner.
 */

import { NextRequest } from 'next/server'

import { createCorsPreflightResponse, createErrorResponse } from '@/lib/api/auth'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return createCorsPreflightResponse({
    methods: 'POST, OPTIONS',
    allowedHeaders: 'Content-Type, Authorization, X-API-Key',
  })
}

/**
 * No authentication check and no body read, on purpose.
 *
 * The answer is the same for everybody, so there is nothing to authorise and no reason to
 * accept a payload of somebody's personal details only to throw it away. Logged without any
 * of the submitted content, so retiring the form cannot become a new place that records it.
 */
export async function POST(request: NextRequest) {
  logger.warn('Rejected a submission to the retired performer-interest route', {
    metadata: { userAgent: request.headers.get('user-agent') ?? null },
  })

  return createErrorResponse(
    'Open mic nights are no longer running, so this form is closed. For anything else, email manager@the-anchor.pub or call 01753 682707.',
    'ENDPOINT_RETIRED',
    410,
  )
}
