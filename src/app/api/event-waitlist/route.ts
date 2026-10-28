import { NextRequest } from 'next/server'
import { withApiAuth, createErrorResponse } from '@/lib/api/auth'
import { GUEST_CONTACT } from '@/lib/guest-contact'

/**
 * The event waiting list was removed on 28 October 2026 (owner decision D11, BK-138).
 *
 * Nobody had ever joined it, its offers went by text only, and on a night with promotional texts
 * off it could hold freed seats for a guest who was never told. The website stops offering it in
 * the same release and tells guests to call instead; until that ships, a join from the old page
 * gets this honest answer rather than a silent queue. Nothing is written and nothing is sent.
 */
export async function POST(request: NextRequest) {
  return withApiAuth(
    async () =>
      createErrorResponse(
        `The waiting list has closed. Please call us on ${GUEST_CONTACT.phoneDisplay} to check for space.`,
        'WAITLIST_CLOSED',
        410
      ),
    ['create:bookings'],
    request
  )
}
