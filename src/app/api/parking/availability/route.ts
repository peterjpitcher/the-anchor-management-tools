import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { getParkingAvailabilitySlots } from '@/lib/parking/capacity'

function parseDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export async function GET(request: Request) {
  return withApiAuth(async () => {
    try {
      const url = new URL(request.url)
      const startParam = url.searchParams.get('start')
      const endParam = url.searchParams.get('end')
      const granularity = url.searchParams.get('granularity') || 'day'

      const startDate = parseDate(startParam || new Date().toISOString())
      const endDate = parseDate(endParam || new Date(startDate!.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString())

      if (!startDate || !endDate) {
        return createErrorResponse('Invalid start or end date', 'VALIDATION_ERROR', 400)
      }

      if (endDate < startDate) {
        return createErrorResponse('End date must be after start date', 'VALIDATION_ERROR', 400)
      }

      const resolvedGranularity = granularity === 'hour' ? 'hour' : 'day'
      const slots = await getParkingAvailabilitySlots(startDate, endDate, resolvedGranularity)

      return createApiResponse({ success: true, data: slots })
    } catch (error) {
      console.error('Error fetching parking availability:', error)
      return createErrorResponse('Failed to fetch availability', 'INTERNAL_ERROR', 500)
    }
  }, ['parking:availability'], request)
}
