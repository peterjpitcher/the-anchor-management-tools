import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { retryRecruitmentCalendarSync } from '@/lib/recruitment/calendar'

// Its own time limit rather than the 15-second project default (BK-212).
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await retryRecruitmentCalendarSync()
    return NextResponse.json({ success: true, result })
  } catch (error) {
    console.error('Recruitment calendar retry cron failed', error)
    return NextResponse.json({ error: 'Recruitment calendar retry failed' }, { status: 500 })
  }
}

