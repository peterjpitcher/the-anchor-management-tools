import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import { authorizeCronRequest } from '@/lib/cron-auth'

export async function GET(request: NextRequest) {
  console.log('[Cron] Customer labels endpoint called')
  
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

    console.log('[Cron] Starting customer label application')
    
    const supabase = createAdminClient()
    
    // First, rebuild customer category stats to ensure they're up to date
    console.log('[Cron] Rebuilding customer category stats...')
    const { data: backfillData, error: backfillError } = await supabase.rpc('rebuild_customer_category_stats')
    
    if (backfillError) {
      console.error('[Cron] Error rebuilding customer stats:', backfillError)
      // Continue anyway - partial data is better than none
    } else {
      console.log(`[Cron] Rebuilt ${backfillData || 0} customer category stats`)
    }
    
    // Call the database function to apply labels retroactively
    console.log('[Cron] Applying customer labels retroactively...')
    const { data, error } = await supabase.rpc('apply_customer_labels_retroactively')
    
    if (error) {
      console.error('[Cron] Error applying customer labels:', error)
      return NextResponse.json(
        { error: 'Failed to apply customer labels', details: error.message },
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
    
    console.log('[Cron] Customer labels applied successfully')
    
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
