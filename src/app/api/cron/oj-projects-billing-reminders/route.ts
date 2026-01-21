import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { isGraphConfigured, sendInternalReminder } from '@/lib/microsoft-graph'
import { formatInTimeZone } from 'date-fns-tz'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const LONDON_TZ = 'Europe/London'

function toIsoDateUtc(date: Date) {
  return date.toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const londonYear = Number(formatInTimeZone(now, LONDON_TZ, 'yyyy'))
  const londonMonth1 = Number(formatInTimeZone(now, LONDON_TZ, 'MM')) // 1..12
  const londonDay = Number(formatInTimeZone(now, LONDON_TZ, 'dd')) // 01..31

  const todayUtc = new Date(Date.UTC(londonYear, londonMonth1 - 1, londonDay))
  const billingDateUtc = new Date(Date.UTC(londonYear, londonMonth1, 1)) // 1st of next month
  const daysUntilBilling = Math.round((billingDateUtc.getTime() - todayUtc.getTime()) / 86400000)

  const shouldSend = daysUntilBilling === 3 || daysUntilBilling === 1
  if (!shouldSend) {
    return NextResponse.json({
      sent: false,
      days_until_billing: daysUntilBilling,
    })
  }

  const periodStartUtc = new Date(Date.UTC(londonYear, londonMonth1 - 1, 1))
  const periodEndUtc = new Date(Date.UTC(londonYear, londonMonth1, 0))

  const billingDateIso = toIsoDateUtc(billingDateUtc)
  const periodStartIso = toIsoDateUtc(periodStartUtc)
  const periodEndIso = toIsoDateUtc(periodEndUtc)

  const subject = `OJ Projects: finalise timesheets (billing on ${billingDateIso})`
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk'
  const body = [
    `Reminder to finalise OJ Projects timesheets before automated billing on ${billingDateIso}.`,
    '',
    `Billing period: ${periodStartIso} to ${periodEndIso}`,
    '',
    `Review and update entries here: ${appUrl}/oj-projects`,
  ].join('\n')

  if (!isGraphConfigured()) {
    return NextResponse.json({
      sent: false,
      error: 'Email service is not configured',
      days_until_billing: daysUntilBilling,
    })
  }

  const res = await sendInternalReminder(subject, body)
  if (!res.success) {
    return NextResponse.json({ sent: false, error: res.error || 'Failed to send reminder' }, { status: 500 })
  }

  return NextResponse.json({
    sent: true,
    days_until_billing: daysUntilBilling,
    billing_date: billingDateIso,
    period_start: periodStartIso,
    period_end: periodEndIso,
  })
}

