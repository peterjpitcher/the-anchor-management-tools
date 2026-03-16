import 'server-only'

import { google } from 'googleapis'
import { fromZonedTime } from 'date-fns-tz'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOAuth2Client } from '@/lib/google-calendar'

const calendar = google.calendar('v3')
const CALENDAR_TIME_ZONE = 'Europe/London'

// Each rota shift is colour-coded by department so the calendar is scannable at a glance.
// Google Calendar colour IDs: 1=Lavender 2=Sage 6=Tangerine 8=Graphite 11=Tomato
const DEPT_COLOUR: Record<string, string> = {
  bar: '1',      // Lavender (matches bar=info/blue badge)
  kitchen: '6',  // Tangerine (matches kitchen=warning/orange badge)
  runner: '2',   // Sage (matches runner=success/green badge)
}

function getRotaCalendarId(): string | null {
  return process.env.GOOGLE_CALENDAR_ROTA_ID ?? null
}

function isRotaCalendarConfigured(): boolean {
  return Boolean(
    getRotaCalendarId() &&
    (process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
      (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN))
  )
}

function formatTime(t: string): string {
  const [h, m] = t.split(':')
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`
}

function addOneDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().split('T')[0]
}

function toUtcIso(dateStr: string, timeStr: string): string {
  const [h, m] = timeStr.split(':')
  const local = `${dateStr}T${h.padStart(2, '0')}:${m.padStart(2, '0')}:00`
  return fromZonedTime(local, CALENDAR_TIME_ZONE).toISOString()
}

function shiftColour(department: string | null, status: string): string {
  if (status === 'sick') return '11' // Tomato/Red
  return DEPT_COLOUR[department ?? ''] ?? '8' // Graphite/Gray for unknown dept
}

export interface RotaShiftRow {
  id: string
  week_id: string
  employee_id: string | null
  shift_date: string
  start_time: string
  end_time: string
  department: string | null
  status: string
  notes: string | null
  is_overnight: boolean
  is_open_shift: boolean
  name: string | null
}

export interface SyncResult {
  created: number
  updated: number
  failed: number
}

/**
 * Push a published rota week directly to the management Google Calendar.
 * Returns counts of created/updated/failed events so callers can report
 * completeness. Errors per shift are isolated — one bad shift never stops
 * the others. Returns { created:0, updated:0, failed:0 } if not configured.
 */
export async function syncRotaWeekToCalendar(
  weekId: string,
  shifts: RotaShiftRow[]
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, failed: 0 }
  if (!isRotaCalendarConfigured()) {
    console.log('[RotaCalendar] GOOGLE_CALENDAR_ROTA_ID not configured — skipping sync')
    return result
  }

  const calendarId = getRotaCalendarId()!
  const admin = createAdminClient()

  // -- Fetch employee names in one query -----------------------------------
  const employeeIds = [...new Set(
    shifts.filter(s => s.employee_id).map(s => s.employee_id!)
  )]
  const { data: employees } = await admin
    .from('employees')
    .select('employee_id, first_name, last_name')
    .in('employee_id', employeeIds)

  const empName = new Map<string, string>()
  for (const e of employees ?? []) {
    empName.set(
      e.employee_id,
      [e.first_name, e.last_name].filter(Boolean).join(' ') || 'Unknown'
    )
  }

  // -- Fetch existing event-ID mappings for this week ----------------------
  const { data: existing } = await admin
    .from('rota_google_calendar_events')
    .select('shift_id, google_event_id')
    .eq('week_id', weekId)

  const existingMap = new Map<string, string>()
  for (const row of existing ?? []) {
    existingMap.set(row.shift_id, row.google_event_id)
  }

  const auth = await getOAuth2Client()
  const currentShiftIds = new Set(shifts.map(s => s.id))

  // -- Delete events for shifts removed since last publish -----------------
  // Parallel: removed-shift deletes are independent of each other.
  const removedShiftEntries = [...existingMap].filter(([shiftId]) => !currentShiftIds.has(shiftId))
  await Promise.all(removedShiftEntries.map(async ([shiftId, eventId]) => {
    await safeDeleteEvent(auth, calendarId, eventId, shiftId)
    await admin.from('rota_google_calendar_events').delete().eq('shift_id', shiftId)
  }))

  // -- Rebuild mapping from Google Calendar extended properties ------------
  // This recovers from partial syncs (e.g. server-action fire-and-forgets
  // killed by Vercel before the mapping upsert could complete).
  // List all events in the week's date range, find those tagged with a
  // shiftId extended property, and fill in any gaps in the mapping table.
  if (shifts.length > 0) {
    const weekStart = shifts.reduce((min, s) => s.shift_date < min ? s.shift_date : min, shifts[0].shift_date)
    const weekEnd   = shifts.reduce((max, s) => s.shift_date > max ? s.shift_date : max, shifts[0].shift_date)
    // Add one day so timeMax is exclusive and covers overnight shifts ending at midnight
    const timeMaxDate = new Date(weekEnd + 'T23:59:59Z')
    timeMaxDate.setUTCDate(timeMaxDate.getUTCDate() + 1)
    try {
      const listRes = await calendar.events.list({
        auth: auth as any,
        calendarId,
        timeMin: weekStart + 'T00:00:00Z',
        timeMax: timeMaxDate.toISOString(),
        singleEvents: true,
        maxResults: 500,
      })
      // Build a set of google_event_ids already in the mapping table so we can
      // spot events that are in GCal but not in the mapping (i.e. orphans).
      const knownEventIds = new Set(existingMap.values())
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

      // Collect actions before executing — allows parallel processing.
      const toRecover: Array<{ evId: string; evShiftId: string }> = []
      const toDelete: Array<{ evId: string; label: string }> = []

      for (const ev of listRes.data.items ?? []) {
        if (!ev.id) continue
        const evShiftId = ev.extendedProperties?.private?.shiftId

        if (evShiftId) {
          if (currentShiftIds.has(evShiftId) && !existingMap.has(evShiftId)) {
            toRecover.push({ evId: ev.id, evShiftId })
          } else if (!currentShiftIds.has(evShiftId)) {
            toDelete.push({ evId: ev.id, label: evShiftId })
          }
        } else if (
          !knownEventIds.has(ev.id) &&
          appUrl &&
          ev.description?.includes(appUrl + '/rota')
        ) {
          // Event was created by a previous sync (has our rota URL) but has no
          // extended property (created before this fix) and is not in the
          // mapping table — it's an orphan from a killed fire-and-forget.
          // Safe to delete because this is a dedicated management-only calendar.
          toDelete.push({ evId: ev.id, label: '(legacy-orphan)' })
        }
      }

      // Recover orphaned-but-valid events in parallel, updating existingMap
      // so the create/update pass below knows which events already exist.
      await Promise.all(toRecover.map(async ({ evId, evShiftId }) => {
        existingMap.set(evShiftId, evId)
        await admin.from('rota_google_calendar_events').upsert({
          shift_id: evShiftId,
          week_id: weekId,
          google_event_id: evId,
          updated_at: new Date().toISOString(),
        })
        console.log('[RotaCalendar] Recovered orphaned event', evId, 'for shift', evShiftId)
      }))

      // Delete stale/legacy-orphan events in parallel batches of 10
      // to stay comfortably under Google Calendar API rate limits.
      if (toDelete.length > 0) {
        console.log('[RotaCalendar] Deleting', toDelete.length, 'orphan event(s) for week', weekId)
        for (let i = 0; i < toDelete.length; i += 10) {
          await Promise.all(
            toDelete.slice(i, i + 10).map(({ evId, label }) =>
              safeDeleteEvent(auth, calendarId, evId, label)
            )
          )
        }
      }
    } catch (err: any) {
      // Non-fatal: if listing fails we fall through to normal upsert logic
      console.warn('[RotaCalendar] Event listing for orphan recovery failed:', err?.message)
    }
  }

  // -- Delete calendar events for cancelled shifts ------------------------
  await Promise.all(
    shifts
      .filter(s => s.status === 'cancelled')
      .map(async (shift) => {
        const existingEventId = existingMap.get(shift.id)
        if (existingEventId) {
          await safeDeleteEvent(auth, calendarId, existingEventId, shift.id)
          await admin.from('rota_google_calendar_events').delete().eq('shift_id', shift.id)
        }
      })
  )

  // -- Create / update events for active shifts ----------------------------
  // Process in parallel batches of 10 to stay under GCal API rate limits.
  // Each shift's entire processing (prep + API call + DB upsert) is wrapped
  // in its own try/catch so that one bad shift (e.g. null time fields)
  // never aborts the batch or any subsequent batches.
  const activeShifts = shifts.filter(s => s.status !== 'cancelled')
  for (let i = 0; i < activeShifts.length; i += 10) {
    // Brief pause between batches to stay under GCal rate limits.
    if (i > 0) await new Promise(resolve => setTimeout(resolve, 150))

    await Promise.all(activeShifts.slice(i, i + 10).map(async (shift) => {
      try {
        // Guard against missing time fields — would crash formatTime/toUtcIso
        // outside the API try/catch, aborting the whole batch.
        if (!shift.start_time || !shift.end_time || !shift.shift_date) {
          console.error('[RotaCalendar] Shift missing required fields — skipping', shift.id, {
            shift_date: shift.shift_date,
            start_time: shift.start_time,
            end_time: shift.end_time,
          })
          result.failed++
          return
        }

        const existingEventId = existingMap.get(shift.id)

        const name = shift.is_open_shift
          ? 'Open Shift'
          : (shift.employee_id ? (empName.get(shift.employee_id) ?? 'Unknown') : 'Unknown')

        const dept = shift.department
          ? shift.department.charAt(0).toUpperCase() + shift.department.slice(1)
          : ''

        const timeRange = `${formatTime(shift.start_time)}–${formatTime(shift.end_time)}`
        const sickTag = shift.status === 'sick' ? '[SICK] ' : ''
        const shiftLabel = shift.name ? ` — ${shift.name}` : ''
        const summary = `${sickTag}${name}${shiftLabel}${dept ? ` (${dept})` : ''} ${timeRange}`

        // Auto-detect overnight: if end_time is lexically ≤ start_time (e.g. 23:00→02:00)
        // the shift crosses midnight even if is_overnight wasn't set in the DB.
        const effectivelyOvernight = shift.is_overnight || shift.end_time <= shift.start_time
        const endDate = effectivelyOvernight ? addOneDay(shift.shift_date) : shift.shift_date
        const startIso = toUtcIso(shift.shift_date, shift.start_time)
        const endIso = toUtcIso(endDate, shift.end_time)

        const description = [
          `Employee: ${name}`,
          dept ? `Department: ${dept}` : null,
          shift.status === 'sick' ? 'Status: Sick' : null,
          shift.notes ? `Notes: ${shift.notes}` : null,
          '',
          `${process.env.NEXT_PUBLIC_APP_URL}/rota`,
        ].filter(Boolean).join('\n')

        const eventBody = {
          summary,
          description,
          start: { dateTime: startIso, timeZone: CALENDAR_TIME_ZONE },
          end: { dateTime: endIso, timeZone: CALENDAR_TIME_ZONE },
          colorId: shiftColour(shift.department, shift.status),
          extendedProperties: {
            private: { shiftId: shift.id },
          },
        }

        let googleEventId: string | null = null

        // One retry on per-user/per-project rate-limit (403 rateLimitExceeded).
        // Waits 2 s then repeats. Throws on the second failure so the outer
        // catch can log and count it as failed. Not used for 403 quotaExceeded
        // (daily limit) — retrying the same day won't help.
        const withRateLimitRetry = async (fn: () => Promise<string | null>): Promise<string | null> => {
          try {
            return await fn()
          } catch (err: any) {
            const reason = err?.errors?.[0]?.reason ?? ''
            if (err?.code === 403 && (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded')) {
              console.warn('[RotaCalendar] Rate limit hit for shift', shift.id, '— retrying after 2 s')
              await new Promise(resolve => setTimeout(resolve, 2000))
              return await fn()
            }
            throw err
          }
        }

        try {
          if (existingEventId) {
            googleEventId = await withRateLimitRetry(async () => {
              const res = await calendar.events.update({
                auth: auth as any,
                calendarId,
                eventId: existingEventId,
                requestBody: eventBody,
              })
              return res.data.id ?? null
            })
          } else {
            googleEventId = await withRateLimitRetry(async () => {
              const res = await calendar.events.insert({
                auth: auth as any,
                calendarId,
                requestBody: eventBody,
              })
              return res.data.id ?? null
            })
          }
        } catch (err: any) {
          // Existing event was deleted externally — re-create
          if (existingEventId && (err?.code === 404 || err?.code === 410)) {
            try {
              googleEventId = await withRateLimitRetry(async () => {
                const res = await calendar.events.insert({
                  auth: auth as any,
                  calendarId,
                  requestBody: eventBody,
                })
                return res.data.id ?? null
              })
            } catch (err2: any) {
              console.error('[RotaCalendar] Re-create failed for shift', shift.id, err2?.message)
            }
          } else {
            console.error('[RotaCalendar] GCal API error for shift', shift.id,
              `(${existingEventId ? 'update' : 'insert'})`, err?.code, err?.message)
          }
        }

        if (googleEventId) {
          if (existingEventId) {
            result.updated++
          } else {
            result.created++
          }
          await admin.from('rota_google_calendar_events').upsert({
            shift_id: shift.id,
            week_id: weekId,
            google_event_id: googleEventId,
            updated_at: new Date().toISOString(),
          })
        } else {
          result.failed++
        }
      } catch (err: any) {
        // Catch anything not already handled (e.g. unexpected prep failures)
        console.error('[RotaCalendar] Unexpected error for shift', shift.id, err?.message)
        result.failed++
      }
    }))
  }

  console.log(
    '[RotaCalendar] Sync complete for week', weekId,
    `— ${result.created} created, ${result.updated} updated, ${result.failed} failed`,
    `(${shifts.length} total shifts)`
  )
  return result
}

async function safeDeleteEvent(
  auth: any,
  calendarId: string,
  eventId: string,
  shiftId: string
): Promise<void> {
  try {
    await calendar.events.delete({ auth: auth as any, calendarId, eventId })
  } catch (err: any) {
    if (err?.code !== 404 && err?.code !== 410) {
      console.error('[RotaCalendar] Delete failed for shift', shiftId, err?.message)
    }
  }
}
