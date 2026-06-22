import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { reportCronFailure } from '@/lib/cron/alerting'
import { logger } from '@/lib/logger'
import { GdprService } from '@/services/gdpr'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request)

  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await GdprService.runCommunicationRetentionCleanup()
    logger.info('Communications retention cleanup completed', {
      metadata: result,
    })
    return NextResponse.json({ success: true, result })
  } catch (error) {
    logger.error('Communications retention cleanup failed', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    await reportCronFailure('communications-retention', error)
    return NextResponse.json({ success: false, error: 'Communications retention cleanup failed' }, { status: 500 })
  }
}
