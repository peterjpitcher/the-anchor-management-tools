#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * Private bookings -> Google Calendar resync (dangerous).
 *
 * Safety note:
 * - This script performs DB updates and external calendar writes.
 * - It MUST be dry-run by default and require explicit multi-gating + caps to mutate.
 */

import path from 'path'
import { config } from 'dotenv'
import { google } from 'googleapis'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOAuth2Client, isCalendarConfigured, syncCalendarEvent } from '@/lib/google-calendar'
import { getErrorCode, getErrorMessage } from '@/lib/errors'
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection'
import { getSharedOperationsCalendarId } from '@/lib/google-calendar-targets'
import type { PrivateBooking } from '@/types/private-bookings'
import { assertScriptMutationAllowed, assertScriptMutationSucceeded } from '@/lib/script-mutation-safety'

config({ path: path.resolve(process.cwd(), '.env.local') })

const RESYNCABLE_STATUSES = new Set(['draft', 'confirmed'])
const calendar = google.calendar('v3')

function getArgValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag)
  if (idx === -1) return null
  const value = process.argv[idx + 1]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isFlagPresent(flag: string): boolean {
  return process.argv.includes(flag)
}

function parseLimit(value: string | null, defaultValue: number, maxValue: number): number {
  if (!value) return defaultValue
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --limit: ${value}`)
  }
  return Math.min(Math.floor(parsed), maxValue)
}

function parseIsoDate(value: string | null, defaultValue: string): string {
  const candidate = value?.trim() || defaultValue
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    throw new Error(`Invalid --from-date (expected YYYY-MM-DD): ${candidate}`)
  }
  return candidate
}

function assertMutationAllowed(params: { baseUrl?: string }) {
  if (!isFlagPresent('--confirm')) {
    throw new Error('Mutation blocked: missing --confirm')
  }

  assertScriptMutationAllowed({
    scriptName: 'resync-private-bookings-calendar',
    envVar: 'RUN_CALENDAR_RESYNC_MUTATION',
  })
  assertScriptMutationAllowed({
    scriptName: 'resync-private-bookings-calendar',
    envVar: 'ALLOW_CALENDAR_RESYNC_MUTATION',
  })
}

function getSkipReason(booking: PrivateBooking): string | null {
  if (!RESYNCABLE_STATUSES.has(booking.status)) {
    return `status=${booking.status}`
  }
  if (isBookingDateTbd(booking)) {
    return 'date_tbd=true'
  }
  return null
}

async function deleteLegacyCalendarEvent(params: {
  auth: Awaited<ReturnType<typeof getOAuth2Client>>
  calendarId: string
  eventId: string
}): Promise<'deleted' | 'missing'> {
  try {
    await calendar.events.delete({
      auth: params.auth as any,
      calendarId: params.calendarId,
      eventId: params.eventId,
    })
    return 'deleted'
  } catch (error) {
    const code = getErrorCode(error)
    if (code === 404 || code === 410) {
      return 'missing'
    }
    throw error
  }
}

async function main() {
  console.log('\n=== Private Bookings -> Google Calendar Resync ===\n')

  const bookingId = getArgValue('--booking-id') ?? process.env.CALENDAR_RESYNC_BOOKING_ID ?? null
  const today = new Date().toISOString().slice(0, 10)
  const fromDate = parseIsoDate(getArgValue('--from-date') ?? process.env.CALENDAR_RESYNC_FROM_DATE ?? null, today)
  const includeSynced = isFlagPresent('--include-synced')
  const legacyDeleteCalendarId =
    getArgValue('--delete-legacy-calendar-id') ??
    process.env.CALENDAR_RESYNC_DELETE_LEGACY_CALENDAR_ID ??
    null

  // Always cap query volume even in dry-run.
  const queryLimit = parseLimit(
    getArgValue('--limit') ?? process.env.CALENDAR_RESYNC_LIMIT ?? null,
    bookingId ? 1 : 25,
    50
  )

  console.log(`Mode: ${isFlagPresent('--confirm') ? 'CONFIRM (dangerous)' : 'DRY RUN (safe)'}`)
  console.log(`Target booking id: ${bookingId ?? '(none)'} (set --booking-id or CALENDAR_RESYNC_BOOKING_ID)`)
  console.log(`From date: ${fromDate}`)
  console.log(`Include already-synced bookings: ${includeSynced ? 'yes' : 'no'} (--include-synced)`)
  console.log(`Delete legacy calendar events: ${legacyDeleteCalendarId ? legacyDeleteCalendarId : 'no'} (--delete-legacy-calendar-id)`)
  console.log(`Limit: ${queryLimit}${bookingId ? ' (forced to 1 by --booking-id)' : ''}`)
  console.log('')

  if (!isCalendarConfigured()) {
    if (isFlagPresent('--confirm')) {
      throw new Error('Google Calendar is not configured. Aborting resync.')
    }
    console.log('Google Calendar is not configured. Dry run exiting without mutations.')
    return
  }

  const supabase = createAdminClient()

  console.log('Fetching candidate bookings...\n')
  let bookings: PrivateBooking[] = []

  if (bookingId) {
    const { data, error } = await supabase
      .from('private_bookings')
      .select('*')
      .eq('id', bookingId)
      .maybeSingle()

    if (error) {
      throw new Error(`Failed to load booking ${bookingId}: ${error.message}`)
    }
    if (!data) {
      throw new Error(`Booking not found: ${bookingId}`)
    }
    bookings = [data as PrivateBooking]
  } else {
    let query = supabase
      .from('private_bookings')
      .select('*')
      .gte('event_date', fromDate)
      .order('event_date', { ascending: true })
      .limit(queryLimit)

    if (!includeSynced) {
      query = query.is('calendar_event_id', null)
    }

    const { data, error } = await query
    if (error) {
      throw new Error(`Failed to load private bookings: ${error.message}`)
    }
    bookings = (data ?? []) as PrivateBooking[]
  }

  if (bookings.length === 0) {
    console.log('No matching bookings found.')
    return
  }

  const skippedByEligibility: Array<{ booking: PrivateBooking; reason: string }> = []
  const eligibleBookings: PrivateBooking[] = []

  for (const booking of bookings) {
    const skipReason = getSkipReason(booking)
    if (skipReason) {
      skippedByEligibility.push({ booking, reason: skipReason })
    } else {
      eligibleBookings.push(booking)
    }
  }

  console.log(`Found ${bookings.length} booking(s).`)
  console.log(`Eligible for resync: ${eligibleBookings.length}`)
  console.log(`Skipped by eligibility: ${skippedByEligibility.length}\n`)

  for (const booking of eligibleBookings) {
    console.log(`- ${booking.id} | ${booking.customer_name} | ${booking.event_date} ${booking.start_time} | status=${booking.status} | calendar_event_id=${booking.calendar_event_id ?? '(missing)'}`)
  }

  if (skippedByEligibility.length > 0) {
    console.log('\nSkipped booking(s):')
    for (const { booking, reason } of skippedByEligibility) {
      console.log(`- ${booking.id} | ${booking.customer_name} | ${booking.event_date} ${booking.start_time} | ${reason}`)
    }
  }

  if (eligibleBookings.length === 0) {
    console.log('\nNo eligible bookings found after safety filters.')
    return
  }

  if (!isFlagPresent('--confirm')) {
    console.log('\nDry run mode: no calendar writes or DB updates were performed.')
    console.log('\nTo execute (dangerous), you must:')
    console.log('1. Pass --confirm')
    console.log('2. Set env gates:')
    console.log('   RUN_CALENDAR_RESYNC_MUTATION=true')
    console.log('   ALLOW_CALENDAR_RESYNC_MUTATION=true')
    console.log('3. Provide an explicit cap:')
    console.log('   --limit N (max 50) or --booking-id <id>')
    return
  }

  assertMutationAllowed({})

  if (!bookingId && !getArgValue('--limit') && !process.env.CALENDAR_RESYNC_LIMIT) {
    throw new Error('Missing required --limit (explicit cap required for confirmed runs).')
  }

  let synced = 0
  let skipped = 0
  let failed = 0
  let legacyDeleted = 0
  let legacyMissing = 0
  let legacyDeleteFailed = 0
  const failures: string[] = []
  const legacyDeleteFailures: string[] = []
  const sharedCalendarId = getSharedOperationsCalendarId()
  const shouldDeleteLegacyEvents =
    Boolean(legacyDeleteCalendarId) && legacyDeleteCalendarId !== sharedCalendarId
  const legacyDeleteAuth = shouldDeleteLegacyEvents ? await getOAuth2Client() : null

  console.log('\nStarting resync...\n')

  for (const booking of eligibleBookings) {
    if (!booking.start_time || !booking.event_date) {
      console.warn(`Skipping booking ${booking.id} - missing date/time`)
      skipped += 1
      continue
    }

    process.stdout.write(`-> Syncing booking ${booking.id} (${booking.customer_name})... `)

    try {
      const eventId = await syncCalendarEvent(booking)

      if (!eventId) {
        console.warn('no event ID returned')
        failed += 1
        failures.push(`${booking.id}: no event ID returned`)
        continue
      }

      const { data: updatedRow, error: updateError } = await supabase
        .from('private_bookings')
        .update({ calendar_event_id: eventId })
        .eq('id', booking.id)
        .select('id')
        .maybeSingle()

      assertScriptMutationSucceeded({
        operation: `Record calendar event id for booking ${booking.id}`,
        error: updateError,
        updatedRows: updatedRow ? [updatedRow] : [],
      })

      if (shouldDeleteLegacyEvents && legacyDeleteAuth && booking.calendar_event_id) {
        process.stdout.write(' deleting legacy event... ')
        try {
          const legacyDeleteState = await deleteLegacyCalendarEvent({
            auth: legacyDeleteAuth,
            calendarId: legacyDeleteCalendarId!,
            eventId: booking.calendar_event_id,
          })
          if (legacyDeleteState === 'deleted') {
            legacyDeleted += 1
          } else {
            legacyMissing += 1
          }
        } catch (legacyDeleteError) {
          legacyDeleteFailed += 1
          const message = getErrorMessage(legacyDeleteError)
          legacyDeleteFailures.push(`${booking.id}: ${message}`)
          console.warn(`legacy delete failed: ${message}`)
        }
      }

      console.log('done')
      synced += 1
    } catch (err) {
      console.error('failed', err)
      failed += 1
      failures.push(`${booking.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log('\n=== Resync complete ===')
  console.log(`Synced successfully: ${synced}`)
  console.log(`Skipped (missing info): ${skipped}`)
  console.log(`Failed: ${failed}`)
  if (legacyDeleteCalendarId) {
    console.log(`Legacy events deleted: ${legacyDeleted}`)
    console.log(`Legacy events already missing: ${legacyMissing}`)
    console.log(`Legacy delete failures: ${legacyDeleteFailed}`)
  }

  if (legacyDeleteFailures.length > 0) {
    console.log('\nLegacy delete failures:')
    for (const failure of legacyDeleteFailures) {
      console.log(`- ${failure}`)
    }
  }

  if (failed > 0 || legacyDeleteFailed > 0) {
    throw new Error(
      `resync-private-bookings-calendar completed with ${failed} sync failure(s) and ${legacyDeleteFailed} legacy delete failure(s)`
    )
  }

  console.log('\n✅ Resync completed without failures.')
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
