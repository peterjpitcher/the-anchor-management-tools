import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { reportCronFailure } from '@/lib/cron/alerting'
import { runCommunicationsHealthCheck } from '@/lib/communications/monitoring'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request)

  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const report = await runCommunicationsHealthCheck()
    logger.info('Communications monitor completed', {
      metadata: {
        issues: report.issues.length,
        alerted: report.alerted,
      },
    })
    return NextResponse.json({ success: true, report })
  } catch (error) {
    logger.error('Communications monitor failed', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    await reportCronFailure('communications-monitor', error)
    return NextResponse.json({ success: false, error: 'Communications monitor failed' }, { status: 500 })
  }
}
