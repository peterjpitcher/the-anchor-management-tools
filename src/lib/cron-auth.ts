import type { NextRequest } from 'next/server'

type CronRequest = Request | NextRequest

export type CronAuthResult = {
  authorized: boolean
  reason?: string
}

function headerEquals(header: string | null, value: string | undefined) {
  if (!header || !value) return false
  return header.trim() === value
}

export function authorizeCronRequest(request: CronRequest): CronAuthResult {
  const cronSecret = process.env.CRON_SECRET?.trim()
  const authHeader = request.headers.get('authorization')?.trim() ?? null
  const vercelCronHeader = request.headers.get('x-vercel-cron')

  if (!cronSecret && process.env.NODE_ENV !== 'production') {
    // In non-production environments allow cron execution without auth for convenience
    return { authorized: true }
  }

  if (cronSecret) {
    const bearerSecret = `Bearer ${cronSecret}`
    if (headerEquals(authHeader, bearerSecret) || headerEquals(authHeader, cronSecret)) {
      return { authorized: true }
    }
  }

  if (vercelCronHeader) {
    return { authorized: true }
  }

  return {
    authorized: false,
    reason: 'Missing or invalid cron credentials'
  }
}
