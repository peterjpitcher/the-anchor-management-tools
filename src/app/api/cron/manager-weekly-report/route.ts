import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { reportCronFailure } from '@/lib/cron/alerting'
import { deliverManagerReport, type ManagerReportDeliveryResult } from '@/lib/manager-report/delivery'

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

/**
 * A report went out with sections that could not be read: tell the operator which ones.
 * This holds on a failed run too, because a later step can fail after the provider accepted
 * the email, and the retry that finishes it sends nothing.
 */
async function alertNotChecked(result: ManagerReportDeliveryResult): Promise<void> {
  if (result.sent > 0 && result.notCheckedSections?.length) {
    await alert(new Error('Weekly report sent with sections not checked'), { sections: result.notCheckedSections })
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
      await alertNotChecked(result)
      return NextResponse.json(result, { status: 500 })
    }
    await alertNotChecked(result)
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Manager weekly report failed', { error: message })
    await alert(error instanceof Error ? error : new Error(message))
    return NextResponse.json({ success: false, error: 'Manager report delivery failed' }, { status: 500 })
  }
}
