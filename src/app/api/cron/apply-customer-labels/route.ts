import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/app/actions/audit'

export async function GET(request: NextRequest) {
  try {
    // Verify this is a Vercel cron request
    const headersList = await headers()
    const authHeader = headersList.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET_KEY}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    console.log('[Cron] Starting customer label application')
    
    const supabase = createAdminClient()
    
    // Call the database function to apply labels retroactively
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