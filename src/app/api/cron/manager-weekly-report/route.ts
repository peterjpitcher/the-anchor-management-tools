import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { reportCronFailure } from '@/lib/cron/alerting'
import { deliverManagerReport } from '@/lib/manager-report/delivery'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const JOB = 'manager-weekly-report'

/** An alert failure must never hide the original failure. */
async function alert(error: Error, context?: Record<string, unknown>): Promise<void> {
  try {
    await reportCronFailure(JOB, error, context)
  } catch (alertError) {
    console.error('Manager weekly report alert failed', { message: alertError instanceof Error ? alertError.message : String(alertError) })
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!authorizeCronRequest(request).authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await deliverManagerReport()
    if (!result.success) {
      console.error('Manager weekly report failed', { error: result.error })
      await alert(new Error(result.error ?? 'Manager report delivery failed'))
      return NextResponse.json(result, { status: 500 })
    }
    // Sent from 09:00 with sections that could not be read: tell the operator which ones.
    if (result.sent > 0 && result.notCheckedSections?.length) {
      await alert(new Error('Weekly report sent with sections not checked'), { sections: result.notCheckedSections })
    }
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Manager weekly report failed', { error: message })
    await alert(error instanceof Error ? error : new Error(message))
    return NextResponse.json({ success: false, error: 'Manager report delivery failed' }, { status: 500 })
  }
}
