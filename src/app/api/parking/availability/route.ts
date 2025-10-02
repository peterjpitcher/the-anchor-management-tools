import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { checkParkingCapacity } from '@/lib/parking/capacity'

function parseDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function toIso(date: Date) {
  return date.toISOString()
}

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function endOfDay(date: Date): Date {
  const d = new Date(date)
  d.setUTCHours(23, 59, 59, 999)
  return d
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

      const slots: Array<{ start_at: string; end_at: string; reserved: number; remaining: number; capacity: number }> = []

      if (granularity === 'hour') {
        const cursor = new Date(startDate)
        cursor.setUTCMinutes(0, 0, 0)

        while (cursor <= endDate) {
          const slotStart = new Date(cursor)
          const slotEnd = new Date(cursor)
          slotEnd.setUTCHours(slotEnd.getUTCHours() + 1)

          const capacity = await checkParkingCapacity(toIso(slotStart), toIso(slotEnd))

          slots.push({
            start_at: toIso(slotStart),
            end_at: toIso(slotEnd),
            reserved: Math.max(capacity.capacity - capacity.remaining, 0),
            remaining: capacity.remaining,
            capacity: capacity.capacity
          })

          cursor.setUTCHours(cursor.getUTCHours() + 1)
        }
      } else {
        const cursor = startOfDay(startDate)
        while (cursor <= endDate) {
          const slotStart = startOfDay(cursor)
          const slotEnd = endOfDay(cursor)

          const capacity = await checkParkingCapacity(toIso(slotStart), toIso(slotEnd))

          slots.push({
            start_at: toIso(slotStart),
            end_at: toIso(slotEnd),
            reserved: Math.max(capacity.capacity - capacity.remaining, 0),
            remaining: capacity.remaining,
            capacity: capacity.capacity
          })

          cursor.setUTCDate(cursor.getUTCDate() + 1)
        }
      }

      return createApiResponse({ success: true, data: slots })
    } catch (error) {
      console.error('Error fetching parking availability:', error)
      return createErrorResponse('Failed to fetch availability', 'INTERNAL_ERROR', 500)
    }
  }, ['parking:availability'], request)
}
