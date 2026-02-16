import { NextRequest, NextResponse } from 'next/server'
import { jobQueue } from '@/lib/unified-job-queue'
import { logger } from '@/lib/logger'
import { authorizeCronRequest } from '@/lib/cron-auth'

export const runtime = 'nodejs'
export const maxDuration = 60 // 60 seconds max execution time
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

function isHealthCheck(request: NextRequest): boolean {
  const processParam = request.nextUrl.searchParams.get('process')
  if (processParam === 'false') {
    return true
  }

  return request.nextUrl.searchParams.get('health') === 'true'
}

async function handleProcessing(request: NextRequest, method: 'GET' | 'POST') {
  // Reduced default to 30 and hard-capped to prevent large accidental flood runs.
  const requestedBatch = Number.parseInt(request.nextUrl.searchParams.get('batch') || '30', 10)
  const batchSize = Number.isFinite(requestedBatch)
    ? Math.max(1, Math.min(100, requestedBatch))
    : 30

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
    const authResult = authorizeCronRequest(request)
    if (!authResult.authorized) {
      logger.warn('Unauthorized job processor access attempt', {
        metadata: {
          env: process.env.NODE_ENV,
          reason: authResult.reason,
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
    const authResult = authorizeCronRequest(request)
    if (!authResult.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (isHealthCheck(request)) {
      return NextResponse.json({
        status: 'ok',
        service: 'job-processor',
        timestamp: new Date().toISOString()
      })
    }

    return await handleProcessing(request, 'GET')
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
