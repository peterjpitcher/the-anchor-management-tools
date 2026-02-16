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
  const isVercelCronHeaderPresent = vercelCronHeader === '1'

  if (!cronSecret) {
    if (process.env.NODE_ENV !== 'production') {
      // In non-production environments allow cron execution without auth for convenience
      return { authorized: true }
    }

    return {
      authorized: false,
      reason: 'CRON_SECRET is required in production'
    }
  }

  const bearerSecret = `Bearer ${cronSecret}`
  if (headerEquals(authHeader, bearerSecret) || headerEquals(authHeader, cronSecret)) {
    return { authorized: true }
  }

  // Keep this signal for diagnostics only; it is not trusted for auth by itself.
  if (isVercelCronHeaderPresent) {
    return {
      authorized: false,
      reason: 'Vercel cron header present but authorization secret is invalid or missing'
    }
  }

  return {
    authorized: false,
    reason: 'Missing or invalid cron credentials'
  }
}
