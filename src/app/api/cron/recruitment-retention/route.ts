import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { runRecruitmentRetentionCleanup } from '@/services/recruitment'

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runRecruitmentRetentionCleanup()
    return NextResponse.json({ success: true, result })
  } catch (error) {
    console.error('Recruitment retention cron failed', error)
    return NextResponse.json({ error: 'Recruitment retention cleanup failed' }, { status: 500 })
  }
}

