import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { logger } from '@/lib/logger'

function isHealthCheck(request: NextRequest): boolean {
  return request.nextUrl.searchParams.get('health') === 'true'
}

export async function GET(request: NextRequest) {
  logger.info('[Cron] Customer labels endpoint called')
  
  try {
    // Verify this is a Vercel cron request
    const authResult = authorizeCronRequest(request)

    if (!authResult.authorized) {
      console.error('[Cron] Authorization failed. Missing cron credentials')
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    if (isHealthCheck(request)) {
      return NextResponse.json({
        status: 'ok',
        service: 'cron-apply-customer-labels',
        timestamp: new Date().toISOString(),
      })
    }

    logger.info('[Cron] Starting customer label application')
    
    const supabase = createAdminClient()
    
    // First, rebuild customer category stats to ensure they're up to date
    logger.info('[Cron] Rebuilding customer category stats')
    const { data: backfillData, error: backfillError } = await supabase.rpc('rebuild_customer_category_stats')
    
    if (backfillError) {
      console.error('[Cron] Error rebuilding customer stats:', backfillError)
      // Continue anyway - partial data is better than none
    } else {
      logger.info('[Cron] Rebuilt customer category stats', {
        metadata: { count: backfillData || 0 }
      })
    }
    
    // Call the database function to apply labels retroactively
    logger.info('[Cron] Applying customer labels retroactively')
    const { data, error } = await supabase.rpc('apply_customer_labels_retroactively')
    
    if (error) {
      console.error('[Cron] Error applying customer labels:', error)
      return NextResponse.json(
        { error: 'Failed to apply customer labels' },
        { status: 500 }
      )
    }
    
    // Log the cron execution
    await logAuditEvent({
      operation_type: 'cron_apply_labels',
      resource_type: 'customer_labels',
      operation_status: 'success',
      additional_info: {
        source: 'cron',
        timestamp: new Date().toISOString()
      }
    })
    
    logger.info('[Cron] Customer labels applied successfully')
    
    return NextResponse.json({
      success: true,
      message: 'Customer labels applied successfully',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('[Cron] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
