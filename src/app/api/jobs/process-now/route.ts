import { NextRequest, NextResponse } from 'next/server'
import { jobQueue } from '@/lib/unified-job-queue'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Manual trigger endpoint for testing
export async function GET(_request: NextRequest) {
  try {
    // This endpoint is for manual testing only
    // In production, this would be triggered by a cron job
    
    logger.info('Manually processing job queue')
    
    // Process up to 10 jobs
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
