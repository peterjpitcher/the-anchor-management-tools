#!/usr/bin/env tsx
/**
 * Google Calendar sync diagnostics (read-only).
 *
 * Safety note:
 * - This script MUST NOT write to the database or to Google Calendar.
 * - For operational resync, use `scripts/tools/resync-private-bookings-calendar.ts` (multi-gated + capped).
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCalendarConfigured } from '@/lib/google-calendar'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const HARD_CAP_LIMIT = 25

function getArgValue(flag: string): string | null {
  const withEqualsPrefix = `${flag}=`
  for (let i = 2; i < process.argv.length; i += 1) {
    const entry = process.argv[i]
    if (entry === flag) {
      const next = process.argv[i + 1]
      return typeof next === 'string' && next.length > 0 ? next : null
    }
    if (typeof entry === 'string' && entry.startsWith(withEqualsPrefix)) {
      const value = entry.slice(withEqualsPrefix.length)
      return value.length > 0 ? value : null
    }
  }
  return null
}

function parseLimit(value: string | null, defaultValue: number): number {
  if (!value) return defaultValue
  const trimmed = value.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`Invalid positive integer for --limit: ${value}`)
  }
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer for --limit: ${value}`)
  }
  if (parsed > HARD_CAP_LIMIT) {
    throw new Error(`--limit exceeds hard cap ${HARD_CAP_LIMIT}`)
  }
  return parsed
}

async function run() {
  if (process.argv.includes('--confirm')) {
    throw new Error(
      'This script is read-only and does not support --confirm. Use scripts/tools/resync-private-bookings-calendar.ts for resync operations.'
    )
  }

  console.log('Google Calendar sync diagnostics (read-only)\n')

  const configured = isCalendarConfigured()
  console.log(`Calendar configured: ${configured ? 'yes' : 'no'}`)
  console.log('')

  if (!configured) {
    throw new Error('Google Calendar is not configured. Aborting diagnostics.')
  }

  const bookingId = getArgValue('--booking-id') ?? process.env.TEST_CALENDAR_SYNC_BOOKING_ID ?? null
  const limit = parseLimit(getArgValue('--limit') ?? process.env.TEST_CALENDAR_SYNC_LIMIT ?? null, bookingId ? 1 : 5)

  console.log(`Target booking id: ${bookingId ?? '(none)'} (set --booking-id or TEST_CALENDAR_SYNC_BOOKING_ID)`)
  console.log(`Limit: ${limit}${bookingId ? ' (forced to 1 by --booking-id)' : ''}`)
  console.log('')

  const supabase = createAdminClient()

  const selectFields =
    'id, customer_name, event_date, start_time, end_time, status, calendar_event_id, created_at'

  const bookings: Array<{
    id: string
    customer_name: string | null
    event_date: string | null
    start_time: string | null
    end_time: string | null
    status: string | null
    calendar_event_id: string | null
    created_at: string | null
  }> = []

  if (bookingId) {
    const { data, error } = await supabase
      .from('private_bookings')
      .select(selectFields)
      .eq('id', bookingId)
      .maybeSingle()

    if (error) {
      throw new Error(`Failed to load booking ${bookingId}: ${error.message}`)
    }
    if (!data) {
      throw new Error(`Booking not found: ${bookingId}`)
    }
    bookings.push(data as (typeof bookings)[number])
  } else {
    const { data, error } = await supabase
      .from('private_bookings')
      .select(selectFields)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      throw new Error(`Failed to load recent private bookings: ${error.message}`)
    }

    bookings.push(...((data ?? []) as unknown as (typeof bookings)))
  }

  if (bookings.length === 0) {
    throw new Error('No private bookings found to inspect.')
  }

  console.log(`Found ${bookings.length} booking(s)\n`)

  let missingCalendarEventId = 0
  let missingDateOrTime = 0

  for (const booking of bookings) {
    const hasDateTime = Boolean(booking.event_date && booking.start_time)
    const hasCalendarEventId = Boolean(booking.calendar_event_id)

    if (!hasCalendarEventId) missingCalendarEventId += 1
    if (!hasDateTime) missingDateOrTime += 1

    console.log(`- ${booking.id}`)
    console.log(`  Customer: ${booking.customer_name ?? '(unknown)'}`)
    console.log(`  Date/time: ${booking.event_date ?? '(missing)'} ${booking.start_time ?? '(missing)'}-${booking.end_time ?? ''}`)
    console.log(`  Status: ${booking.status ?? '(unknown)'}`)
    console.log(`  Calendar event id: ${booking.calendar_event_id ?? '(missing)'}`)
    console.log('')
  }

  console.log('Summary:')
  console.log(`- Missing calendar_event_id: ${missingCalendarEventId}`)
  console.log(`- Missing event_date/start_time: ${missingDateOrTime}`)
  console.log('')
  console.log('✅ Read-only calendar diagnostics completed.')
  console.log('For resync operations (dangerous), use:')
  console.log('  scripts/tools/resync-private-bookings-calendar.ts --booking-id <id> --confirm')
}

run().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
