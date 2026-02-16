import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { recalculateEngagementScoresAndLabels } from '@/lib/analytics/engagement-scoring'

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const summary = await recalculateEngagementScoresAndLabels(supabase)

    return NextResponse.json({
      success: true,
      summary
    })
  } catch (error) {
    console.error('Failed to run engagement scoring cron:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to recalculate engagement scores'
      },
      { status: 500 }
    )
  }
}
