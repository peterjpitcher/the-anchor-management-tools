import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { deliverManagerReport } from '@/lib/manager-report/delivery'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: Request): Promise<NextResponse> {
  if (!authorizeCronRequest(request).authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await deliverManagerReport()
    if (!result.success) console.error('Manager weekly report failed', { error: result.error })
    return NextResponse.json(result, { status: result.success ? 200 : 500 })
  } catch (error) {
    console.error('Manager weekly report failed', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ success: false, error: 'Manager report delivery failed' }, { status: 500 })
  }
}
