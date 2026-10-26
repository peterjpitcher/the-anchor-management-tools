import type { NextRequest } from 'next/server'
import { changeTableBookingPartySize } from '@/lib/table-bookings/party-size-change'

/** A party-size change from the BOH booking page. The steps are shared with the other staff screen (BK-129). */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return changeTableBookingPartySize(request, context, 'boh')
}
