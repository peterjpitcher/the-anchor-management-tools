import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveParkingRate } from '@/lib/parking/repository'

export async function GET(request: Request) {
  return withApiAuth(async () => {
    try {
      const supabase = createAdminClient()
      const rate = await getActiveParkingRate(supabase)

      if (!rate) {
        return createErrorResponse('No parking rates configured', 'CONFIGURATION_MISSING', 404)
      }

      return createApiResponse({ success: true, data: rate })
    } catch (error) {
      console.error('Error fetching parking rates:', error)
      return createErrorResponse('Failed to fetch parking rates', 'INTERNAL_ERROR', 500)
    }
  }, ['parking:view'], request)
}
