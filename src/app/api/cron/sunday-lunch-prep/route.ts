import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'

export async function GET(request: Request) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ success: false, error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    success: true,
    skipped: true,
    reason: 'sunday_preorders_retired',
  })
}
