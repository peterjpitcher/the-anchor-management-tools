import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { sendHiringStageReminders } from '@/lib/hiring/reminders'

export async function GET(request: NextRequest) {
  try {
    const authResult = authorizeCronRequest(request)
    if (!authResult.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await sendHiringStageReminders()

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to send reminders' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      sent: result.sent ?? 0,
      skipped: result.skipped ?? false,
      errors: result.errors ?? [],
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Hiring stage reminder cron error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
