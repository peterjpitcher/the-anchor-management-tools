import { NextRequest, NextResponse } from 'next/server'
import { jobQueue } from '@/lib/background-jobs'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const maxDuration = 60 // 60 seconds max execution time

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret - Vercel sends it as CRON_SECRET in the Authorization header
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    // Check for Vercel cron authentication
    const isVercelCron = authHeader === `Bearer ${cronSecret}` || 
                        authHeader === cronSecret || // Vercel might send just the secret
                        request.headers.get('x-vercel-cron') === '1' // Vercel cron header
    
    // In production, allow if it's from Vercel cron
    const isAuthorized = isVercelCron || 
                        (process.env.NODE_ENV === 'development' && !cronSecret)
    
    if (!isAuthorized) {
      logger.warn('Unauthorized job processor access attempt', {
        metadata: { 
          authHeader: authHeader?.substring(0, 10) + '...', 
          hasVercelHeader: request.headers.get('x-vercel-cron'),
          env: process.env.NODE_ENV 
        }
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    // Get batch size from query params or use default
    // Reduced to 30 to prevent timeouts with SMS processing
    const { searchParams } = new URL(request.url)
    const batchSize = parseInt(searchParams.get('batch') || '30')
    
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
    
    // Same authentication logic as POST
    const isVercelCron = authHeader === `Bearer ${cronSecret}` || 
                        authHeader === cronSecret || 
                        request.headers.get('x-vercel-cron') === '1'
    
    const isAuthorized = isVercelCron || 
                        (process.env.NODE_ENV === 'development' && !cronSecret)
    
    if (!isAuthorized) {
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