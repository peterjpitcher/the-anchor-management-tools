#!/usr/bin/env tsx

import { config } from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/server'
import { syncCalendarEvent, isCalendarConfigured } from '@/lib/google-calendar'

// Load environment variables
config({ path: path.resolve(process.cwd(), '.env.local') })

async function testCalendarSync() {
  console.log('=== Testing Google Calendar Sync ===\n')

  // Check configuration
  console.log('1. Configuration Status:')
  console.log('   Calendar configured:', isCalendarConfigured() ? '✓ Yes' : '✗ No')
  console.log('')

  if (!isCalendarConfigured()) {
    console.log('❌ Google Calendar is not configured. Please check your environment variables.')
    process.exit(1)
  }

  // Get a recent private booking to test with
  const supabase = createAdminClient()
  
  console.log('2. Fetching recent private bookings...')
  const { data: bookings, error } = await supabase
    .from('private_bookings')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    console.error('❌ Error fetching bookings:', error.message)
    process.exit(1)
  }

  if (!bookings || bookings.length === 0) {
    console.log('❌ No private bookings found to test with.')
    process.exit(1)
  }

  console.log(`   Found ${bookings.length} bookings\n`)

  // Display bookings
  console.log('3. Recent bookings:')
  bookings.forEach((booking, index) => {
    console.log(`   ${index + 1}. ${booking.customer_name} - ${booking.event_date} - Status: ${booking.status}`)
    console.log(`      Calendar Event ID: ${booking.calendar_event_id || 'Not synced'}`)
  })
  console.log('')

  // Test sync on the most recent booking without a calendar event
  const bookingToSync = bookings.find(b => !b.calendar_event_id) || bookings[0]
  
  console.log('4. Testing calendar sync:')
  console.log(`   Syncing booking: ${bookingToSync.customer_name} (${bookingToSync.id})`)
  console.log(`   Event date: ${bookingToSync.event_date}`)
  console.log(`   Start time: ${bookingToSync.start_time}`)
  console.log(`   Current calendar event ID: ${bookingToSync.calendar_event_id || 'None'}`)
  console.log('')

  try {
    console.log('5. Attempting to sync with Google Calendar...')
    const eventId = await syncCalendarEvent(bookingToSync)
    
    if (eventId) {
      console.log(`   ✓ Success! Calendar event created/updated: ${eventId}`)
      
      // Update the booking with the calendar event ID
      const { error: updateError } = await supabase
        .from('private_bookings')
        .update({ calendar_event_id: eventId })
        .eq('id', bookingToSync.id)
      
      if (updateError) {
        console.error('   ⚠️  Failed to update booking with calendar event ID:', updateError.message)
      } else {
        console.log('   ✓ Booking updated with calendar event ID')
      }
    } else {
      console.log('   ❌ Failed to sync - no event ID returned')
    }
  } catch (error) {
    console.error('   ❌ Error during sync:', error)
  }

  console.log('\n=== Test Complete ===')
}

testCalendarSync().catch(console.error)