import { NextRequest, NextResponse } from 'next/server'
import { jobQueue } from '@/lib/background-jobs'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const maxDuration = 60 // 60 seconds max execution time

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      logger.warn('Unauthorized job processor access attempt')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    // Get batch size from query params or use default
    const { searchParams } = new URL(request.url)
    const batchSize = parseInt(searchParams.get('batch') || '10')
    
    logger.info('Processing job queue', { metadata: { batchSize } })
    
    // Process jobs
    await jobQueue.processJobs(batchSize)
    
    return NextResponse.json({ 
      success: true,
      message: `Processed up to ${batchSize} jobs`
    })
    
  } catch (error) {
    logger.error('Job processor error', { 
      error: error as Error,
      metadata: { url: request.url }
    })
    
    return NextResponse.json(
      { error: 'Failed to process jobs' },
      { status: 500 }
    )
  }
}

// Health check endpoint
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret for health check too
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    return NextResponse.json({ 
      status: 'ok',
      service: 'job-processor',
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    return NextResponse.json(
      { error: 'Health check failed' },
      { status: 500 }
    )
  }
}