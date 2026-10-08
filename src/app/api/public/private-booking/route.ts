/**
 * RETIRED, 8 October 2026. Use POST /api/private-booking-enquiry.
 *
 * This was the first private hire enquiry route. It was marked deprecated with a
 * sunset date of 30 September 2026 and carried on working after that date. It
 * accepted a full booking payload, line items and prices included, from anybody
 * who passed a bot check, with no API key required.
 *
 * Nothing of ours calls it. Checked against the website's main branch on
 * 8 October 2026: both private hire forms post to the website's own server, which
 * sends the enquiry to /api/private-booking-enquiry with its API key, and the
 * Christmas form goes to /api/external/create-booking. The site review of
 * 7 October 2026 records this as finding MG-007.
 *
 * It answers 410 Gone rather than being deleted outright, as
 * external/performer-interest does: a route that has vanished returns the
 * framework's own 404, which reads as a bug to whoever calls it, and 410 says the
 * thing is gone on purpose. The answer still points at the route that replaced it.
 *
 * DELIBERATELY LEFT ALONE: `GET /api/public/private-booking/config`, in the
 * folder beside this file. The website's price calculator reads it.
 */

import { NextRequest } from 'next/server'

import { createCorsPreflightResponse, createErrorResponse } from '@/lib/api/auth'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const SUCCESSOR_HEADERS = {
  Deprecation: 'true',
  Sunset: 'Wed, 30 Sep 2026 00:00:00 GMT',
  Link: '</api/private-booking-enquiry>; rel="successor-version"',
} as const

export async function OPTIONS() {
  return createCorsPreflightResponse({
    methods: 'POST, OPTIONS',
    allowedHeaders: 'Content-Type, Authorization, X-API-Key',
  })
}

/**
 * No authentication check and no body read, on purpose.
 *
 * The answer is the same for everybody, so there is nothing to authorise and no
 * reason to accept a payload of somebody's contact details only to throw it away.
 * Logged without any of the submitted content. The message is a sentence a guest
 * could be shown, with the phone number, in case an old page somewhere still posts
 * here: a failed enquiry must always leave the guest a way to reach the pub.
 */
export async function POST(request: NextRequest) {
  logger.warn('Rejected a submission to the retired public private-booking route', {
    metadata: { userAgent: request.headers.get('user-agent') ?? null },
  })

  const response = createErrorResponse(
    'This enquiry form has been replaced, so we could not take your enquiry here. Please call 01753 682707 or email manager@the-anchor.pub and we will help.',
    'ENDPOINT_RETIRED',
    410,
    undefined,
    // Never stored: createErrorResponse would otherwise mark this as publicly
    // cacheable for a minute.
    'private',
  )

  for (const [name, value] of Object.entries(SUCCESSOR_HEADERS)) {
    response.headers.set(name, value)
  }

  return response
}
