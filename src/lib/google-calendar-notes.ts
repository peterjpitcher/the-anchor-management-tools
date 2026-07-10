import 'server-only'

import { createHash } from 'crypto'
import { addHours } from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getOAuth2Client } from '@/lib/google-calendar'
import { PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID } from '@/lib/google-calendar-targets'
import { logger } from '@/lib/logger'

export { PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID } from '@/lib/google-calendar-targets'

const CALENDAR_TIME_ZONE = 'Europe/London'
const SOURCE_PROPERTY = 'anchor_calendar_note'

const calendar = google.calendar('v3')

type CalendarAuth = Awaited<ReturnType<typeof getOAuth2Client>>

export type PubOpsCalendarNoteSyncResult =
  | { state: 'created' | 'updated' | 'deleted' | 'skipped'; noteId: string; googleEventId: string; reason?: string }
  | { state: 'failed'; noteId: string; googleEventId: string; reason: string }

export type PubOpsCalendarNoteQueueItem = {
  note_id: string
  operation: 'upsert' | 'delete'
  generation: number
  attempts: number
}

type ClaimedPubOpsCalendarNoteQueueItem = PubOpsCalendarNoteQueueItem & {
  processing_token: string
}

type PubOpsCalendarNoteQueueState = PubOpsCalendarNoteQueueItem & {
  status: 'pending' | 'synced'
  processing_token: string | null
  lease_expires_at: string | null
}

export type PubOpsCalendarNoteRow = {
  id: string
  note_date: string
  end_date: string | null
  title: string
  notes: string | null
  source: string | null
  start_time: string | null
  end_time: string | null
}

type CalendarDate = { date: string }
type CalendarDateTime = { dateTime: string; timeZone: string }

export type PubOpsCalendarNoteEntry = {
  googleEventId: string
  requestBody: {
    id: string
    summary: string
    description: string
    start: CalendarDate | CalendarDateTime
    end: CalendarDate | CalendarDateTime
    transparency: 'transparent'
    reminders: { useDefault: false }
    extendedProperties: {
      private: Record<string, string>
    }
  }
}

function calendarAuth(auth: CalendarAuth): OAuth2Client {
  return auth as unknown as OAuth2Client
}

function hasCalendarAuthConfig(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
      (process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.GOOGLE_REFRESH_TOKEN)
  )
}

function calendarNoteSyncQueue(client: unknown) {
  return (client as { from: (table: string) => any }).from('calendar_note_google_sync_queue')
}

function calendarNoteSyncRpc(client: unknown) {
  return client as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  }
}

export async function isPubOpsCalendarNoteSyncQueueAvailable(
  supabase: SupabaseClient<any, 'public', any>
): Promise<boolean> {
  try {
    const { error } = await calendarNoteSyncQueue(supabase)
      .select('note_id')
      .limit(1)
    if (error) return false

    const { error: claimError } = await calendarNoteSyncRpc(supabase).rpc(
      'claim_calendar_note_google_sync',
      {
        p_note_id: '00000000-0000-0000-0000-000000000000',
        p_expected_generation: null,
        p_lease_seconds: 600,
      }
    )

    return !claimError
  } catch {
    return false
  }
}

export function generatePubOpsCalendarNoteEventId(noteId: string): string {
  const digest = createHash('sha256').update(`anchor-calendar-note:${noteId}`).digest('hex')
  return `acn${digest.slice(0, 48)}`
}

function addOneDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
}

function normalizeTime(value: string): string {
  const [hours = '00', minutes = '00', seconds = '00'] = value.split(':')
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}`
}

function getTimedRange(note: PubOpsCalendarNoteRow): {
  start: CalendarDateTime
  end: CalendarDateTime
} {
  const startDate = fromZonedTime(
    `${note.note_date}T${normalizeTime(note.start_time as string)}`,
    CALENDAR_TIME_ZONE
  )

  let endDate = note.end_time
    ? fromZonedTime(
        `${note.end_date || note.note_date}T${normalizeTime(note.end_time)}`,
        CALENDAR_TIME_ZONE
      )
    : addHours(startDate, 1)

  if (!Number.isFinite(endDate.getTime()) || endDate.getTime() <= startDate.getTime()) {
    endDate = addHours(startDate, 1)
  }

  return {
    start: {
      dateTime: startDate.toISOString(),
      timeZone: CALENDAR_TIME_ZONE,
    },
    end: {
      dateTime: endDate.toISOString(),
      timeZone: CALENDAR_TIME_ZONE,
    },
  }
}

function buildDescription(note: PubOpsCalendarNoteRow, appBaseUrl: string, syncedAt: Date): string {
  const adminBaseUrl = appBaseUrl.replace(/\/+$/, '')
  const adminUrl = adminBaseUrl
    ? `${adminBaseUrl}/settings/calendar-notes`
    : '/settings/calendar-notes'
  const sourceLabel = note.source === 'ai' ? 'AI-generated' : 'Manual'
  const details = note.notes?.trim() || null

  return [
    details,
    details ? '' : null,
    `Source: ${sourceLabel} calendar note`,
    `Manage notes: ${adminUrl}`,
    '',
    `Last synced: ${syncedAt.toISOString()}`,
  ].filter((line): line is string => line !== null).join('\n')
}

export function buildPubOpsCalendarNoteEntry(input: {
  note: PubOpsCalendarNoteRow
  appBaseUrl?: string
  now?: Date
}): PubOpsCalendarNoteEntry {
  const { note } = input
  const googleEventId = generatePubOpsCalendarNoteEventId(note.id)
  const now = input.now ?? new Date()
  const appBaseUrl = input.appBaseUrl || process.env.NEXT_PUBLIC_APP_URL || ''
  const endDate = note.end_date && note.end_date >= note.note_date
    ? note.end_date
    : note.note_date

  const range = note.start_time
    ? getTimedRange(note)
    : {
        start: { date: note.note_date },
        // Google Calendar treats all-day end dates as exclusive. The app stores
        // end_date as inclusive, so add one day here.
        end: { date: addOneDay(endDate) },
      }

  return {
    googleEventId,
    requestBody: {
      id: googleEventId,
      summary: note.title.trim() || 'Calendar note',
      description: buildDescription(note, appBaseUrl, now),
      start: range.start,
      end: range.end,
      // Calendar notes are informational and should not block availability or
      // send the Pub Ops calendar's default reminders.
      transparency: 'transparent',
      reminders: { useDefault: false },
      extendedProperties: {
        private: {
          source: SOURCE_PROPERTY,
          anchorCalendarNoteId: note.id,
        },
      },
    },
  }
}

function getGoogleErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const candidate = error as {
    code?: string | number
    status?: number
    response?: { status?: number; data?: { error?: { code?: number } } }
  }
  if (typeof candidate.status === 'number') return candidate.status
  if (typeof candidate.code === 'number') return candidate.code
  if (typeof candidate.response?.status === 'number') return candidate.response.status
  if (typeof candidate.response?.data?.error?.code === 'number') {
    return candidate.response.data.error.code
  }
  return undefined
}

function getGoogleErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function deletePubOpsCalendarNoteEntry(
  auth: CalendarAuth,
  noteId: string,
  context?: Record<string, unknown>
): Promise<PubOpsCalendarNoteSyncResult> {
  const googleEventId = generatePubOpsCalendarNoteEventId(noteId)

  try {
    await calendar.events.delete({
      auth: calendarAuth(auth),
      calendarId: PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID,
      eventId: googleEventId,
    })
    return { state: 'deleted', noteId, googleEventId }
  } catch (error) {
    const status = getGoogleErrorStatus(error)
    if (status === 404 || status === 410) {
      return { state: 'skipped', noteId, googleEventId, reason: 'already_missing' }
    }

    logger.warn('Failed to delete Pub Ops calendar note', {
      metadata: {
        noteId,
        googleEventId,
        status,
        error: getGoogleErrorMessage(error),
        ...context,
      },
    })
    return {
      state: 'failed',
      noteId,
      googleEventId,
      reason: getGoogleErrorMessage(error),
    }
  }
}

export async function deletePubOpsCalendarNoteEntryById(
  noteId: string,
  context?: Record<string, unknown>
): Promise<PubOpsCalendarNoteSyncResult> {
  const googleEventId = generatePubOpsCalendarNoteEventId(noteId)

  if (!hasCalendarAuthConfig()) {
    return { state: 'skipped', noteId, googleEventId, reason: 'calendar_not_configured' }
  }

  try {
    const auth = await getOAuth2Client()
    return deletePubOpsCalendarNoteEntry(auth, noteId, context)
  } catch (error) {
    logger.warn('Failed to authenticate for Pub Ops calendar note delete', {
      metadata: {
        noteId,
        googleEventId,
        error: getGoogleErrorMessage(error),
        ...context,
      },
    })
    return { state: 'failed', noteId, googleEventId, reason: getGoogleErrorMessage(error) }
  }
}

async function upsertPubOpsCalendarNoteEntry(
  auth: CalendarAuth,
  noteId: string,
  entry: PubOpsCalendarNoteEntry,
  context?: Record<string, unknown>
): Promise<PubOpsCalendarNoteSyncResult> {
  try {
    const response = await calendar.events.update({
      auth: calendarAuth(auth),
      calendarId: PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID,
      eventId: entry.googleEventId,
      requestBody: entry.requestBody,
    })
    return {
      state: 'updated',
      noteId,
      googleEventId: response.data.id || entry.googleEventId,
    }
  } catch (updateError) {
    const status = getGoogleErrorStatus(updateError)
    if (status !== 404 && status !== 410) {
      logger.warn('Failed to update Pub Ops calendar note', {
        metadata: {
          noteId,
          googleEventId: entry.googleEventId,
          status,
          error: getGoogleErrorMessage(updateError),
          ...context,
        },
      })
      return {
        state: 'failed',
        noteId,
        googleEventId: entry.googleEventId,
        reason: getGoogleErrorMessage(updateError),
      }
    }
  }

  try {
    const response = await calendar.events.insert({
      auth: calendarAuth(auth),
      calendarId: PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID,
      requestBody: entry.requestBody,
    })
    return {
      state: 'created',
      noteId,
      googleEventId: response.data.id || entry.googleEventId,
    }
  } catch (insertError) {
    const status = getGoogleErrorStatus(insertError)
    if (status === 409) {
      try {
        const response = await calendar.events.update({
          auth: calendarAuth(auth),
          calendarId: PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID,
          eventId: entry.googleEventId,
          requestBody: entry.requestBody,
        })
        return {
          state: 'updated',
          noteId,
          googleEventId: response.data.id || entry.googleEventId,
        }
      } catch (retryError) {
        logger.warn('Failed to update Pub Ops calendar note after insert conflict', {
          metadata: {
            noteId,
            googleEventId: entry.googleEventId,
            status: getGoogleErrorStatus(retryError),
            error: getGoogleErrorMessage(retryError),
            ...context,
          },
        })
        return {
          state: 'failed',
          noteId,
          googleEventId: entry.googleEventId,
          reason: getGoogleErrorMessage(retryError),
        }
      }
    }

    logger.warn('Failed to create Pub Ops calendar note', {
      metadata: {
        noteId,
        googleEventId: entry.googleEventId,
        status,
        error: getGoogleErrorMessage(insertError),
        ...context,
      },
    })
    return {
      state: 'failed',
      noteId,
      googleEventId: entry.googleEventId,
      reason: getGoogleErrorMessage(insertError),
    }
  }
}

export async function syncPubOpsCalendarNoteById(
  supabase: SupabaseClient<any, 'public', any>,
  noteId: string,
  context?: Record<string, unknown>
): Promise<PubOpsCalendarNoteSyncResult> {
  const googleEventId = generatePubOpsCalendarNoteEventId(noteId)

  if (!hasCalendarAuthConfig()) {
    return { state: 'skipped', noteId, googleEventId, reason: 'calendar_not_configured' }
  }

  try {
    const auth = await getOAuth2Client()
    const { data: note, error } = await supabase
      .from('calendar_notes')
      .select('id, note_date, end_date, title, notes, source, start_time, end_time')
      .eq('id', noteId)
      .maybeSingle()

    if (error) {
      logger.warn('Failed to load calendar note for Pub Ops sync', {
        metadata: {
          noteId,
          error: error.message,
          ...context,
        },
      })
      return { state: 'failed', noteId, googleEventId, reason: error.message }
    }

    if (!note) {
      return deletePubOpsCalendarNoteEntry(auth, noteId, {
        reason: 'note_missing',
        ...context,
      })
    }

    const entry = buildPubOpsCalendarNoteEntry({
      note: note as PubOpsCalendarNoteRow,
      appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || '',
    })

    return upsertPubOpsCalendarNoteEntry(auth, noteId, entry, context)
  } catch (error) {
    logger.warn('Unexpected Pub Ops calendar note sync failure', {
      metadata: {
        noteId,
        googleEventId,
        error: getGoogleErrorMessage(error),
        ...context,
      },
    })
    return { state: 'failed', noteId, googleEventId, reason: getGoogleErrorMessage(error) }
  }
}

function isCompletedSync(result: PubOpsCalendarNoteSyncResult): boolean {
  if (result.state === 'failed') return false
  if (result.state === 'skipped' && result.reason === 'calendar_not_configured') return false
  return true
}

function getRetryDelayMs(attempts: number): number {
  const safeAttempts = Math.max(0, Math.min(attempts, 8))
  return Math.min(2 ** safeAttempts * 60_000, 6 * 60 * 60 * 1000)
}

async function claimPubOpsCalendarNoteQueueItem(
  supabase: SupabaseClient<any, 'public', any>,
  noteId: string,
  expectedGeneration?: number
): Promise<ClaimedPubOpsCalendarNoteQueueItem | null> {
  const { data, error } = await calendarNoteSyncRpc(supabase).rpc(
    'claim_calendar_note_google_sync',
    {
      p_note_id: noteId,
      p_expected_generation: expectedGeneration ?? null,
      p_lease_seconds: 600,
    }
  )

  if (error) {
    throw new Error(error.message)
  }

  const rows = Array.isArray(data) ? data : []
  return (rows[0] as ClaimedPubOpsCalendarNoteQueueItem | undefined) ?? null
}

async function loadPubOpsCalendarNoteQueueState(
  supabase: SupabaseClient<any, 'public', any>,
  noteId: string
): Promise<{ state: PubOpsCalendarNoteQueueState | null; error: string | null }> {
  const { data, error } = await calendarNoteSyncQueue(supabase)
    .select('note_id, operation, status, generation, attempts, processing_token, lease_expires_at')
    .eq('note_id', noteId)
    .maybeSingle()

  return {
    state: data ? data as PubOpsCalendarNoteQueueState : null,
    error: error?.message ?? null,
  }
}

async function releasePubOpsCalendarNoteClaim(
  supabase: SupabaseClient<any, 'public', any>,
  noteId: string,
  processingToken: string
): Promise<void> {
  const { error } = await calendarNoteSyncQueue(supabase)
    .update({
      processing_token: null,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('note_id', noteId)
    .eq('processing_token', processingToken)

  if (error) {
    logger.warn('Failed to release calendar note sync claim', {
      metadata: { noteId, error: error.message },
    })
  }
}

async function requeuePubOpsCalendarNote(
  supabase: SupabaseClient<any, 'public', any>,
  noteId: string,
  processingToken?: string
): Promise<boolean> {
  const { data, error } = await calendarNoteSyncRpc(supabase).rpc(
    'requeue_calendar_note_google_sync',
    {
      p_note_id: noteId,
      p_processing_token: processingToken ?? null,
    }
  )

  if (error) {
    logger.warn('Failed to requeue calendar note sync', {
      metadata: { noteId, error: error.message },
    })
    return false
  }

  return data !== null && data !== undefined
}

/**
 * Process one durable queue item under a per-note lease. Newer generations wait
 * for the active Google request, then replay immediately so an older request can
 * never be the final write left in Google Calendar.
 */
export async function processPubOpsCalendarNoteQueueItem(
  supabase: SupabaseClient<any, 'public', any>,
  noteId: string,
  options: {
    expectedGeneration?: number
    operation?: 'upsert' | 'delete'
    force?: boolean
    context?: Record<string, unknown>
    replayDepth?: number
  } = {}
): Promise<PubOpsCalendarNoteSyncResult> {
  const googleEventId = generatePubOpsCalendarNoteEventId(noteId)
  const replayDepth = options.replayDepth ?? 0

  try {
    if (options.force) {
      await requeuePubOpsCalendarNote(supabase, noteId)
    }

    let claimed: ClaimedPubOpsCalendarNoteQueueItem | null
    try {
      claimed = await claimPubOpsCalendarNoteQueueItem(
        supabase,
        noteId,
        options.expectedGeneration
      )

      // The batch may have read an older generation just before a user edit.
      // Claim the current pending generation instead of waiting for another run.
      if (!claimed && options.expectedGeneration !== undefined) {
        claimed = await claimPubOpsCalendarNoteQueueItem(supabase, noteId)
      }
    } catch (claimError) {
      const reason = getGoogleErrorMessage(claimError)
      logger.warn('Failed to claim durable calendar note sync item', {
        metadata: { noteId, error: reason, ...options.context },
      })
      return { state: 'failed', noteId, googleEventId, reason: 'calendar_sync_queue_unavailable' }
    }

    if (!claimed) {
      const queueState = await loadPubOpsCalendarNoteQueueState(supabase, noteId)
      if (queueState.error) {
        logger.warn('Failed to inspect calendar note sync state', {
          metadata: { noteId, error: queueState.error, ...options.context },
        })
        return { state: 'failed', noteId, googleEventId, reason: queueState.error }
      }

      if (!queueState.state) {
        return {
          state: 'failed',
          noteId,
          googleEventId,
          reason: options.operation === 'delete'
            ? 'calendar_sync_tombstone_missing'
            : 'calendar_sync_queue_item_missing',
        }
      }

      return {
        state: 'skipped',
        noteId,
        googleEventId,
        reason: queueState.state.status === 'synced' ? 'already_synced' : 'sync_in_progress',
      }
    }

    const operation = claimed.operation
    const result = operation === 'delete'
      ? await deletePubOpsCalendarNoteEntryById(noteId, options.context)
      : await syncPubOpsCalendarNoteById(supabase, noteId, options.context)

    const completed = isCompletedSync(result)
    const nextAttempts = completed ? 0 : claimed.attempts + 1
    const updatePayload = completed
      ? {
          status: 'synced',
          attempts: 0,
          last_error: null,
          processing_token: null,
          lease_expires_at: null,
          updated_at: new Date().toISOString(),
      }
      : {
          status: 'pending',
          attempts: nextAttempts,
          last_error: result.reason || 'Calendar note sync failed',
          available_at: new Date(Date.now() + getRetryDelayMs(claimed.attempts)).toISOString(),
          processing_token: null,
          lease_expires_at: null,
          updated_at: new Date().toISOString(),
        }

    const { data: finalized, error: finalizeError } = await calendarNoteSyncQueue(supabase)
      .update(updatePayload)
      .eq('note_id', noteId)
      .eq('generation', claimed.generation)
      .eq('processing_token', claimed.processing_token)
      .eq('replay_requested', false)
      .select('note_id')
      .maybeSingle()

    if (finalizeError) {
      logger.warn('Failed to finalize calendar note sync claim', {
        metadata: {
          noteId,
          generation: claimed.generation,
          error: finalizeError.message,
          ...options.context,
        },
      })
    }

    if (finalized) {
      return result
    }

    // A newer generation arrived, or an expired lease was reclaimed, while the
    // Google request was running. Invalidate the current state and replay the
    // latest note after releasing only our own token.
    const requeued = await requeuePubOpsCalendarNote(
      supabase,
      noteId,
      claimed.processing_token
    )
    await releasePubOpsCalendarNoteClaim(supabase, noteId, claimed.processing_token)

    if (!requeued || replayDepth >= 3) {
      return result
    }

    return processPubOpsCalendarNoteQueueItem(supabase, noteId, {
      operation: options.operation,
      context: options.context,
      replayDepth: replayDepth + 1,
    })
  } catch (error) {
    logger.warn('Unexpected durable calendar note sync failure', {
      metadata: {
        noteId,
        googleEventId,
        error: getGoogleErrorMessage(error),
        ...options.context,
      },
    })
    return { state: 'failed', noteId, googleEventId, reason: getGoogleErrorMessage(error) }
  }
}
