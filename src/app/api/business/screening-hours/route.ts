import type { NextRequest } from 'next/server'
import { createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { applyDistributedRateLimit } from '@/lib/distributed-rate-limit'
import { getScreeningHours, validateScreeningDates } from '@/lib/business-hours/screening-hours'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const limited = await applyDistributedRateLimit(request, {
      prefix: 'screening-hours', window: '1 m', localWindowMs: 60_000, max: 60,
    })
    if (limited) {
      limited.headers.set('Cache-Control', 'no-store')
      return limited
    }
    let dates: string[]
    try {
      const parameters = request.nextUrl.searchParams
      if (parameters.getAll('dates').length !== 1) throw new Error('Provide dates once')
      dates = validateScreeningDates((parameters.get('dates') ?? '').split(','))
    } catch {
      return createErrorResponse('Provide 1 to 31 real dates between today and 12 months ahead', 'VALIDATION_ERROR', 400, undefined, 'private')
    }
    return createApiResponse(await getScreeningHours(dates), 200, {}, 'GET', 'private')
  } catch {
    console.error('[Screening hours] Operating hours dependency unavailable')
    return createErrorResponse('Operating hours are temporarily unavailable', 'HOURS_UNAVAILABLE', 503, undefined, 'private')
  }
}
