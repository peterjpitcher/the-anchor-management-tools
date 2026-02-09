import { NextRequest, NextResponse } from 'next/server'
import { fromZonedTime } from 'date-fns-tz'
import { getLondonDateIso, requireFohPermission } from '@/lib/foh/api-auth'
import { isSundayLunchOnlyEvent } from '@/lib/events/sunday-lunch-only-policy'

type UpcomingEventRow = {
  id: string
  name: string | null
  date: string | null
  time: string | null
  start_datetime: string | null
}

function toEventStartIso(row: {
  start_datetime: string | null
  date: string | null
  time: string | null
}): string | null {
  if (row.start_datetime) {
    const parsed = Date.parse(row.start_datetime)
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString()
    }
  }

  if (!row.date || !row.time) return null
  const eventTime = row.time.length === 5 ? `${row.time}:00` : row.time
  const zoned = fromZonedTime(`${row.date}T${eventTime}`, 'Europe/London')
  const parsed = zoned.getTime()
  if (!Number.isFinite(parsed)) return null
  return zoned.toISOString()
}

export async function GET(request: NextRequest) {
  const auth = await requireFohPermission('view')
  if (!auth.ok) {
    return auth.response
  }

  const limitParam = Number.parseInt(request.nextUrl.searchParams.get('limit') || '4', 10)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 12) : 4
  const todayIso = getLondonDateIso()
  const nowMs = Date.now()

  const { data, error } = await (auth.supabase.from('events') as any)
    .select('id, name, date, time, start_datetime, event_status')
    .eq('event_status', 'scheduled')
    .gte('date', todayIso)
    .order('date', { ascending: true, nullsFirst: false })
    .order('time', { ascending: true, nullsFirst: false })
    .limit(240)

  if (error) {
    return NextResponse.json({ error: 'Failed to load upcoming events' }, { status: 500 })
  }

  const rows = (Array.isArray(data) ? (data as UpcomingEventRow[]) : []).filter(
    (row) =>
      !isSundayLunchOnlyEvent({
        id: row.id || null,
        name: row.name || null,
        date: row.date || null,
        start_datetime: row.start_datetime || null
      })
  )
  const upcomingEvents = rows
    .map((row) => {
      const startIso = toEventStartIso({
        start_datetime: row.start_datetime || null,
        date: row.date || null,
        time: row.time || null
      })
      const startMs = startIso ? Date.parse(startIso) : Number.NaN
      return {
        id: row.id,
        name: row.name || 'Untitled event',
        date: row.date || todayIso,
        time: row.time || null,
        start_datetime: startIso,
        start_ms: startMs
      }
    })
    .filter((row) => Number.isFinite(row.start_ms) && row.start_ms >= nowMs)
    .sort((a, b) => a.start_ms - b.start_ms || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      name: row.name,
      date: row.date,
      time: row.time,
      start_datetime: row.start_datetime
    }))

  return NextResponse.json({
    success: true,
    data: upcomingEvents
  })
}
