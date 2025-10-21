#!/usr/bin/env tsx

import path from 'path'
import { config } from 'dotenv'
import { createAdminClient } from '../../src/lib/supabase/server'
import { isCalendarConfigured, syncCalendarEvent } from '../../src/lib/google-calendar'
import type { PrivateBooking } from '../../src/types/private-bookings'

config({ path: path.resolve(process.cwd(), '.env.local') })

async function main() {
  console.log('\n=== Private Bookings → Google Calendar Resync ===\n')

  if (!isCalendarConfigured()) {
    console.error('❌ Google Calendar is not configured. Aborting resync.')
    process.exit(1)
  }

  const supabase = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  console.log(`Fetching bookings from ${today} onwards...`)
  const { data: bookings, error } = await supabase
    .from('private_bookings')
    .select('*')
    .gte('event_date', today)
    .order('event_date', { ascending: true })

  if (error) {
    console.error('❌ Failed to load private bookings:', error)
    process.exit(1)
  }

  if (!bookings || bookings.length === 0) {
    console.log('No upcoming private bookings found.')
    return
  }

  console.log(`Found ${bookings.length} bookings to process.\n`)

  let synced = 0
  let skipped = 0
  let failed = 0

  for (const booking of bookings) {
    if (!booking.start_time || !booking.event_date) {
      console.warn(`Skipping booking ${booking.id} - missing date/time`)
      skipped += 1
      continue
    }

    process.stdout.write(`→ Syncing booking ${booking.id} (${booking.customer_name})... `)

    try {
      const eventId = await syncCalendarEvent(booking as PrivateBooking)

      if (!eventId) {
        console.warn('no event ID returned')
        failed += 1
        continue
      }

      const { error: updateError } = await supabase
        .from('private_bookings')
        .update({ calendar_event_id: eventId })
        .eq('id', booking.id)

      if (updateError) {
        console.warn(`synced but failed to record event id (${updateError.message})`)
        failed += 1
        continue
      }

      console.log('done')
      synced += 1
    } catch (err) {
      console.error('failed', err)
      failed += 1
    }
  }

  console.log('\n=== Resync complete ===')
  console.log(`Synced successfully: ${synced}`)
  console.log(`Skipped (missing info): ${skipped}`)
  console.log(`Failed: ${failed}`)
}

main().catch(error => {
  console.error('Unexpected failure during resync:', error)
  process.exit(1)
})
