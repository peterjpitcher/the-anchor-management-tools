import { NextRequest, NextResponse } from 'next/server'
import { jobQueue } from '@/lib/unified-job-queue'
import { logger } from '@/lib/logger'
import { authorizeCronRequest } from '@/lib/cron-auth'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Manual trigger endpoint for operational diagnostics.
export async function GET(request: NextRequest) {
  try {
    const authResult = authorizeCronRequest(request)
    if (!authResult.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.info('Manually processing job queue')

    // Process a small batch to reduce blast radius for manual runs.
    await jobQueue.processJobs(10)

    return NextResponse.json({
      success: true,
      message: 'Job queue processed manually'
    })

  } catch (error) {
    logger.error('Manual job processing error', {
      error: error as Error
    })

    return NextResponse.json(
      { error: 'Failed to process jobs' },
      { status: 500 }
    )
  }
}
