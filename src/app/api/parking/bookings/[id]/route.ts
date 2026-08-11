import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getParkingBooking } from '@/lib/parking/repository'

export async function GET(request: Request) {
  return withApiAuth(async () => {
    try {
      const url = new URL(request.url)
      const segments = url.pathname.split('/')
      const bookingId = segments[segments.length - 1]
      if (!bookingId) {
        return createErrorResponse('Booking ID is required', 'VALIDATION_ERROR', 400)
      }

      const supabase = createAdminClient()
      const booking = await getParkingBooking(bookingId, supabase)

      if (!booking) {
        return createErrorResponse('Parking booking not found', 'NOT_FOUND', 404)
      }

      // This payload is one customer's name, mobile, email and vehicle. The
      // shared default for GETs is 'public, max-age=60', which lets any shared
      // cache or proxy keep it and hand it to whoever asks next, and the default
      // 'Vary: Origin' does not separate one API key's response from another's.
      return createApiResponse({ success: true, data: booking }, 200, {
        'Cache-Control': 'private, no-store',
        Vary: 'Origin, X-API-Key, Authorization',
      })
    } catch (error) {
      console.error('Error fetching parking booking via API:', error)
      return createErrorResponse('Failed to fetch parking booking', 'INTERNAL_ERROR', 500)
    }
  }, ['parking:view'], request)
}
