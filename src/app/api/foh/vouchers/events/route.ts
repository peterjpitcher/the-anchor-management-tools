import { NextResponse } from 'next/server'
import { requireFohVoucherPermission, getLondonDateIso } from '@/lib/foh/api-auth'
import { EVENT_DAY_CUTOVER_HOUR } from '@/lib/vouchers/constants'

type EventRow = {
  id: string
  name: string
  date: string
  time: string | null
  event_status: string | null
}

function londonHour(now: Date = new Date()): number {
  // hourCycle h23 avoids the en-GB hour12 quirk on Node 20.
  const hourPart = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: 'numeric',
    hourCycle: 'h23'
  })
    .formatToParts(now)
    .find((part) => part.type === 'hour')

  return Number.parseInt(hourPart?.value ?? '0', 10)
}

function shiftIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Quick-pick events for hand-out context (spec 3.3/F35): today's events, plus
// yesterday's until 06:00 London so late-night hand-outs keep the right event.
export async function GET() {
  const auth = await requireFohVoucherPermission('view')
  if (!auth.ok) {
    return auth.response
  }

  const today = getLondonDateIso()
  const dates = londonHour() < EVENT_DAY_CUTOVER_HOUR ? [shiftIsoDate(today, -1), today] : [today]

  const { data, error } = await auth.supabase
    .from('events')
    .select('id, name, date, time, event_status')
    .in('date', dates)
    .order('date', { ascending: true })
    .order('time', { ascending: true })

  if (error) {
    return NextResponse.json({ error: 'Failed to load events' }, { status: 500 })
  }

  const events = ((data ?? []) as EventRow[])
    .filter((event) => !['cancelled', 'draft'].includes(event.event_status ?? 'scheduled'))
    .map((event) => ({
      id: event.id,
      name: event.name,
      date: event.date,
      time: event.time
    }))

  return NextResponse.json({ success: true, data: events })
}
