import 'server-only'

import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import { fromZonedTime } from 'date-fns-tz'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOAuth2Client } from '@/lib/google-calendar'

const calendar = google.calendar('v3')
const CALENDAR_TIME_ZONE = 'Europe/London'

/** Narrows an unknown error to a Google API error shape.
 *  GaxiosError uses `status` for HTTP status codes and `code` for system errors.
 *  We check both so 404/410/403 detection works regardless of which property holds the value. */
function isGoogleApiError(err: unknown): err is { code?: string | number; status?: number; message: string; errors?: Array<{ reason: string }> } {
  return typeof err === 'object' && err !== null && ('code' in err || 'status' in err)
}

/** Extract the HTTP status code from a Google API error.
 *  GaxiosError stores HTTP status on `status` (preferred) and may also have `code` as a number. */
function getGoogleApiStatus(err: { code?: string | number; status?: number }): number | undefined {
  if (typeof err.status === 'number') return err.status
  if (typeof err.code === 'number') return err.code
  return undefined
}

/**
 * Auth object returned by getOAuth2Client(). googleapis calendar methods
 * accept OAuth2Client but getOAuth2Client() may return JWT or GoogleAuth client
 * depending on config. All are structurally compatible — we cast to OAuth2Client
 * at the function boundary (see calendarAuth() below) rather than scattering
 * `as any` across every API call.
 */
type GoogleCalendarAuth = Awaited<ReturnType<typeof getOAuth2Client>>

/** Cast auth to OAuth2Client for googleapis methods. All auth types returned by
 *  getOAuth2Client() (OAuth2Client, JWT, GoogleAuth client) implement the same
 *  credential interface that the Calendar API requires. */
function calendarAuth(auth: GoogleCalendarAuth): OAuth2Client {
  return auth as unknown as OAuth2Client
}

/** Options to avoid redundant fetches when syncing multiple weeks in a batch. */
export interface SyncOptions {
  /** Pre-fetched employee name map — skips the per-week employee query. */
  employeeNames?: Map<string, string>
  /** Pre-created auth client — skips the per-week getOAuth2Client() call. */
  auth?: GoogleCalendarAuth
  /** Canonical week start date (Monday) from rota_weeks.week_start.
   *  Used for orphan recovery scan boundaries. Falls back to shift-span if not provided. */
  weekStart?: string
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

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

function toUtcIso(dateStr: string, timeStr: string): string {
  const [h, m] = timeStr.split(':')
  const local = `${dateStr}T${h.padStart(2, '0')}:${m.padStart(2, '0')}:00`
  return fromZonedTime(local, CALENDAR_TIME_ZONE).toISOString()
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
  shifts: RotaShiftRow[],
  options?: SyncOptions
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, failed: 0 }
  if (!isRotaCalendarConfigured()) {
    console.warn('[RotaCalendar] GOOGLE_CALENDAR_ROTA_ID not configured — skipping sync')
    return result
  }

  const calendarId = getRotaCalendarId()!
  const admin = createAdminClient()

  // -- Fetch employee names (skip if pre-fetched via options) ---------------
  let empName: Map<string, string>
  if (options?.employeeNames) {
    empName = options.employeeNames
  } else {
    const employeeIds = [...new Set(
      shifts.filter(s => s.employee_id).map(s => s.employee_id!)
    )]
    const { data: employees } = await admin
      .from('employees')
      .select('employee_id, first_name, last_name')
      .in('employee_id', employeeIds)

    empName = new Map<string, string>()
    for (const e of employees ?? []) {
      empName.set(
        e.employee_id,
        [e.first_name, e.last_name].filter(Boolean).join(' ') || 'Unknown'
      )
    }
  }

  // -- Fetch existing event-ID mappings for this week ----------------------
  const { data: existing } = await admin
    .from('rota_google_calendar_events')
    .select('shift_id, google_event_id, week_id')
    .eq('week_id', weekId)

  const existingMap = new Map<string, string>()
  for (const row of existing ?? []) {
    existingMap.set(row.shift_id, row.google_event_id)
  }

  const auth = options?.auth ?? await getOAuth2Client()
  const currentShiftIds = new Set(shifts.map(s => s.id))

  // -- Guard: never delete all events when shifts array is empty ----------
  // Protects against the delete/insert gap during republish where
  // rota_published_shifts is momentarily empty between delete and insert.
  if (shifts.length === 0 && existingMap.size > 0) {
    console.warn('[RotaCalendar] Skipping sync — week has mapped events but no shifts provided (snapshot may be in progress)', weekId)
    return result
  }

  // -- Delete events for shifts removed since last publish -----------------
  // Parallel: removed-shift deletes are independent of each other.
  const removedShiftEntries = [...existingMap].filter(([shiftId]) => !currentShiftIds.has(shiftId))
  await Promise.all(removedShiftEntries.map(async ([shiftId, eventId]) => {
    await safeDeleteEvent(auth, calendarId, eventId, shiftId)
    await admin.from('rota_google_calendar_events').delete().eq('shift_id', shiftId)
  }))

  // -- Rebuild mapping from Google Calendar extended properties ------------
  // Recovers from partial syncs and cleans up orphaned events.
  // IMPORTANT: Only delete events that belong to THIS week (identified by
  // weekId extended property or DB lookup). Never touch other weeks' events.
  if (shifts.length > 0) {
    // Use canonical week boundaries if provided, fall back to shift-span
    const scanStart = options?.weekStart
      ?? shifts.reduce((min, s) => s.shift_date < min ? s.shift_date : min, shifts[0].shift_date)
    const scanEnd = options?.weekStart
      ? addDays(options.weekStart, 6)
      : shifts.reduce((max, s) => s.shift_date > max ? s.shift_date : max, shifts[0].shift_date)

    // Add one day so timeMax covers overnight shifts. Note: Google Calendar
    // events.list applies timeMax to event START time, so this is a tolerance
    // window rather than strict overnight coverage. The weekId filter makes
    // this safe regardless of how wide the window is.
    const timeMaxDate = new Date(scanEnd + 'T23:59:59Z')
    timeMaxDate.setUTCDate(timeMaxDate.getUTCDate() + 1)

    try {
      // Paginate through all events in the date range.
      const firstPage = await calendar.events.list({
        auth: calendarAuth(auth),
        calendarId,
        timeMin: scanStart + 'T00:00:00Z',
        timeMax: timeMaxDate.toISOString(),
        singleEvents: true,
        maxResults: 250,
      })
      type GCalEventItem = NonNullable<typeof firstPage.data.items>[number]
      const allEvents: GCalEventItem[] = [...(firstPage.data.items ?? [])]
      let pageToken = firstPage.data.nextPageToken ?? undefined

      while (pageToken) {
        const nextPage = await calendar.events.list({
          auth: calendarAuth(auth),
          calendarId,
          timeMin: scanStart + 'T00:00:00Z',
          timeMax: timeMaxDate.toISOString(),
          singleEvents: true,
          maxResults: 250,
          pageToken,
        })
        allEvents.push(...(nextPage.data.items ?? []))
        pageToken = nextPage.data.nextPageToken ?? undefined
      }

      const knownEventIds = new Set(existingMap.values())
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

      const toRecover: Array<{ evId: string; evShiftId: string }> = []
      const toDelete: Array<{ evId: string; label: string }> = []

      for (const ev of allEvents) {
        if (!ev.id) continue
        const evShiftId = ev.extendedProperties?.private?.shiftId
        const evWeekId = ev.extendedProperties?.private?.weekId

        if (evWeekId) {
          // --- Event has weekId (new-style) ---
          if (evWeekId !== weekId) {
            // Belongs to a different week — leave it alone
            continue
          }
          // Belongs to this week
          if (evShiftId && currentShiftIds.has(evShiftId) && !existingMap.has(evShiftId)) {
            toRecover.push({ evId: ev.id, evShiftId })
          } else if (evShiftId && !currentShiftIds.has(evShiftId)) {
            toDelete.push({ evId: ev.id, label: evShiftId })
          }
        } else if (evShiftId) {
          // --- Legacy event: has shiftId but no weekId ---
          if (currentShiftIds.has(evShiftId)) {
            // Shift belongs to this week — recover immediately (UUIDs are globally unique)
            if (!existingMap.has(evShiftId)) {
              toRecover.push({ evId: ev.id, evShiftId })
            }
          } else {
            // Shift not in current week — check DB for ownership
            const dbRow = (existing ?? []).find(r => r.shift_id === evShiftId)
            if (dbRow && dbRow.week_id === weekId) {
              // DB confirms it belongs to this week → genuine orphan, delete
              toDelete.push({ evId: ev.id, label: evShiftId })
            }
            // If not in DB, or belongs to another week: skip (can't determine ownership safely)
          }
        } else if (
          !knownEventIds.has(ev.id) &&
          appUrl &&
          ev.description?.includes(appUrl + '/rota')
        ) {
          // --- Legacy event: no shiftId, no weekId, but has our /rota URL ---
          // Only delete if the event's start time is within this week's canonical range
          const evStart = ev.start?.dateTime ?? ev.start?.date ?? ''
          const evStartDate = evStart.split('T')[0]
          if (evStartDate >= scanStart && evStartDate <= scanEnd) {
            toDelete.push({ evId: ev.id, label: '(legacy-orphan)' })
          }
        }
      }

      // Recover orphaned-but-valid events in parallel
      await Promise.all(toRecover.map(async ({ evId, evShiftId }) => {
        existingMap.set(evShiftId, evId)
        await admin.from('rota_google_calendar_events').upsert({
          shift_id: evShiftId,
          week_id: weekId,
          google_event_id: evId,
          updated_at: new Date().toISOString(),
        })
        console.warn('[RotaCalendar] Recovered orphaned event', evId, 'for shift', evShiftId)
      }))

      // Delete genuine orphans in batches of 10
      if (toDelete.length > 0) {
        console.warn('[RotaCalendar] Deleting', toDelete.length, 'orphan event(s) for week', weekId)
        for (let i = 0; i < toDelete.length; i += 10) {
          await Promise.all(
            toDelete.slice(i, i + 10).map(({ evId, label }) =>
              safeDeleteEvent(auth, calendarId, evId, label)
            )
          )
        }
      }

      // -- Reverse-orphan detection: find stale DB mappings -----------------
      // existingMap may contain google_event_ids that no longer exist in
      // Google Calendar (e.g. deleted by the old cross-week bug). If we leave
      // them, the create/update loop tries UPDATE → 404 → re-insert, which
      // can fail under rate limiting. Instead, detect stale mappings here
      // (we already have the full event listing) and remove them from
      // existingMap so the create path fires cleanly with a simple INSERT.
      const gcalEventIds = new Set(allEvents.map(ev => ev.id).filter(Boolean))
      let staleCount = 0
      for (const [shiftId, eventId] of existingMap) {
        if (!gcalEventIds.has(eventId)) {
          existingMap.delete(shiftId)
          // Also clean up the stale DB mapping so it doesn't persist
          await admin.from('rota_google_calendar_events').delete().eq('shift_id', shiftId)
          staleCount++
        }
      }
      if (staleCount > 0) {
        console.warn('[RotaCalendar] Removed', staleCount, 'stale mapping(s) for week', weekId, '— events will be re-created')
      }
    } catch (err: unknown) {
      // Non-fatal: if listing fails we fall through to normal upsert logic
      console.warn('[RotaCalendar] Event listing for orphan recovery failed:', err instanceof Error ? err.message : String(err))
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
  // Process in batches of 5 with 500ms inter-batch pause to stay under
  // Google Calendar API rate limits (~60 writes/min per user).
  // Each shift's entire processing (prep + API call + DB upsert) is wrapped
  // in its own try/catch so that one bad shift (e.g. null time fields)
  // never aborts the batch or any subsequent batches.
  const activeShifts = shifts.filter(s => s.status !== 'cancelled')
  for (let i = 0; i < activeShifts.length; i += 5) {
    // Pause between batches to stay under GCal rate limits.
    if (i > 0) await new Promise(resolve => setTimeout(resolve, 500))

    await Promise.all(activeShifts.slice(i, i + 5).map(async (shift) => {
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
          extendedProperties: {
            private: { shiftId: shift.id, weekId: weekId },
          },
        }

        let googleEventId: string | null = null

        // Retry on rate-limit errors (403 rateLimitExceeded or 429 Too Many Requests).
        // Uses exponential backoff: 3s → 6s. Throws on the third failure.
        // Not used for 403 quotaExceeded (daily limit) — retrying won't help.
        const withRateLimitRetry = async (fn: () => Promise<string | null>): Promise<string | null> => {
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              return await fn()
            } catch (err: unknown) {
              const status = isGoogleApiError(err) ? getGoogleApiStatus(err) : undefined
              // GaxiosError stores API error details in response.data, not top-level .errors
              const apiErrors = isGoogleApiError(err) ? (err as Record<string, unknown>).response : undefined
              const reason = (apiErrors && typeof apiErrors === 'object' && 'data' in apiErrors)
                ? ((apiErrors as Record<string, unknown>).data as Record<string, unknown>)?.error
                  ? (((apiErrors as Record<string, unknown>).data as Record<string, unknown>).error as Record<string, unknown>)?.errors
                    ? ((((apiErrors as Record<string, unknown>).data as Record<string, unknown>).error as Record<string, unknown>).errors as Array<{ reason?: string }>)?.[0]?.reason ?? ''
                    : ''
                  : ''
                : ''
              const isRateLimit = (status === 403 && (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded'))
                || status === 429
              if (isRateLimit && attempt < 2) {
                const backoffMs = (attempt + 1) * 3000
                console.warn('[RotaCalendar] Rate limit hit for shift', shift.id, `(${status}) — retrying after ${backoffMs}ms (attempt ${attempt + 1})`)
                await new Promise(resolve => setTimeout(resolve, backoffMs))
                continue
              }
              throw err
            }
          }
          return null // unreachable, but satisfies TypeScript
        }

        try {
          if (existingEventId) {
            googleEventId = await withRateLimitRetry(async () => {
              const res = await calendar.events.update({
                auth: calendarAuth(auth),
                calendarId,
                eventId: existingEventId,
                requestBody: eventBody,
              })
              return res.data.id ?? null
            })
          } else {
            googleEventId = await withRateLimitRetry(async () => {
              const res = await calendar.events.insert({
                auth: calendarAuth(auth),
                calendarId,
                requestBody: eventBody,
              })
              return res.data.id ?? null
            })
          }
        } catch (err: unknown) {
          // Existing event was deleted externally — re-create
          const errCode = isGoogleApiError(err) ? getGoogleApiStatus(err) : undefined
          console.warn('[RotaCalendar] API error for shift', shift.id,
            `existingEventId=${existingEventId ? 'yes' : 'no'}`,
            `errCode=${errCode}`,
            `isGoogleApiError=${isGoogleApiError(err)}`,
            `errType=${err?.constructor?.name}`,
            `errStatus=${isGoogleApiError(err) ? (err as Record<string, unknown>).status : 'N/A'}`,
            `errCodeProp=${isGoogleApiError(err) ? (err as Record<string, unknown>).code : 'N/A'}`,
          )
          if (existingEventId && (errCode === 404 || errCode === 410)) {
            try {
              googleEventId = await withRateLimitRetry(async () => {
                const res = await calendar.events.insert({
                  auth: calendarAuth(auth),
                  calendarId,
                  requestBody: eventBody,
                })
                return res.data.id ?? null
              })
            } catch (err2: unknown) {
              console.error('[RotaCalendar] Re-create failed for shift', shift.id, err2 instanceof Error ? err2.message : String(err2))
            }
          } else {
            console.error('[RotaCalendar] GCal API error for shift', shift.id,
              `(${existingEventId ? 'update' : 'insert'})`, errCode, err instanceof Error ? err.message : String(err))
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
      } catch (err: unknown) {
        // Catch anything not already handled (e.g. unexpected prep failures)
        console.error('[RotaCalendar] Unexpected error for shift', shift.id, err instanceof Error ? err.message : String(err))
        result.failed++
      }
    }))
  }

  console.warn(
    '[RotaCalendar] Sync complete for week', weekId,
    `— ${result.created} created, ${result.updated} updated, ${result.failed} failed`,
    `(${shifts.length} total shifts)`
  )
  return result
}

async function safeDeleteEvent(
  auth: GoogleCalendarAuth,
  calendarId: string,
  eventId: string,
  shiftId: string
): Promise<void> {
  try {
    await calendar.events.delete({ auth: calendarAuth(auth), calendarId, eventId })
  } catch (err: unknown) {
    const errCode = isGoogleApiError(err) ? getGoogleApiStatus(err) : undefined
    if (errCode !== 404 && errCode !== 410) {
      console.error('[RotaCalendar] Delete failed for shift', shiftId, err instanceof Error ? err.message : String(err))
    }
  }
}
