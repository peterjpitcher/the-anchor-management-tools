import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { sendDueRecruitmentAppointmentReminders } from '@/lib/recruitment/communications'

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await sendDueRecruitmentAppointmentReminders()
    return NextResponse.json({ success: true, result })
  } catch (error) {
    console.error('Recruitment reminders cron failed', error)
    return NextResponse.json({ error: 'Recruitment reminders failed' }, { status: 500 })
  }
}

