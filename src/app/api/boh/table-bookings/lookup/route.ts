import { NextRequest, NextResponse } from 'next/server'
import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { logger } from '@/lib/logger'
import { referenceCandidates } from '@/lib/table-bookings/reference-lookup'

/**
 * Finds a table booking by its reference on any date (BK-180), so a guest quoting 'TB-1A2B3C4D'
 * can be found without loading the right day first. Needs table_bookings view.
 */

export async function GET(request: NextRequest) {
  const auth = await requireBohTableBookingPermission('view')
  if (!auth.ok) return auth.response

  const candidates = referenceCandidates(request.nextUrl.searchParams.get('reference') ?? '')
  if (candidates.length === 0) {
    return NextResponse.json({ error: 'Enter a booking reference, for example TB-1A2B3C4D' }, { status: 400 })
  }

  const { data, error } = await auth.supabase
    .from('table_bookings')
    .select('id, booking_reference, booking_date')
    .in('booking_reference', candidates)
    .limit(1)
    .maybeSingle()

  if (error) {
    logger.error('Could not look up a table booking by reference', {
      error: new Error(error.message),
    })
    return NextResponse.json({ error: 'Could not search for that booking. Try again.' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'No table booking has that reference.' }, { status: 404 })
  }

  return NextResponse.json({ success: true, data })
}
