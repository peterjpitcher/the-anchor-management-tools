import { NextRequest, NextResponse } from 'next/server'
import { jobQueue } from '@/lib/unified-job-queue'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const maxDuration = 60 // 60 seconds max execution time

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret && process.env.NODE_ENV === 'development') {
    return true
  }

  const bearerSecret = `Bearer ${cronSecret}`
  return (
    authHeader === bearerSecret ||
    authHeader === cronSecret ||
    request.headers.get('x-vercel-cron') === '1'
  )
}

function shouldProcessJobs(request: NextRequest): boolean {
  return (
    request.headers.get('x-vercel-cron') === '1' ||
    request.nextUrl.searchParams.get('process') === 'true'
  )
}

async function handleProcessing(request: NextRequest, method: 'GET' | 'POST') {
  // Reduced to 30 to prevent timeouts with SMS processing
  const batchSize = parseInt(request.nextUrl.searchParams.get('batch') || '30')

  logger.info('Processing job queue', {
    metadata: {
      batchSize,
      method,
    }
  })

  await jobQueue.processJobs(batchSize)

  return NextResponse.json({
    success: true,
    message: `Processed up to ${batchSize} jobs via ${method}`
  })
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      const authHeader = request.headers.get('authorization')
      logger.warn('Unauthorized job processor access attempt', {
        metadata: {
          authHeader: authHeader ? `${authHeader.substring(0, 10)}...` : 'none',
          hasVercelHeader: request.headers.get('x-vercel-cron'),
          env: process.env.NODE_ENV,
        }
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return await handleProcessing(request, 'POST')
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
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (shouldProcessJobs(request)) {
      return await handleProcessing(request, 'GET')
    }

    return NextResponse.json({
      status: 'ok',
      service: 'job-processor',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Job processor GET error', {
      error: error as Error,
      metadata: { url: request.url }
    })

    return NextResponse.json(
      { error: 'Health check failed' },
      { status: 500 }
    )
  }
}
