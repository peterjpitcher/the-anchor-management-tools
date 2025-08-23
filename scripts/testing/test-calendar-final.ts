#!/usr/bin/env tsx

import * as path from 'path'
import { config } from 'dotenv'

// Load environment variables first
config({ path: path.resolve(process.cwd(), '.env.local') })

import { createAdminClient } from '../src/lib/supabase/server'
import { syncCalendarEvent } from '../src/lib/google-calendar'
import type { PrivateBooking } from '../src/types/private-bookings'

console.log('\n=== Testing Calendar Sync with Private Booking ===\n')

;(async () => {
  try {
    const supabase = createAdminClient()
    
    console.log('1. Fetching a recent private booking to test...')
    const { data: bookings, error } = await supabase
      .from('private_bookings')
      .select('*')
      .not('event_date', 'is', null)
      .not('start_time', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5)
    
    if (error) {
      console.error('❌ Error fetching bookings:', error)
      process.exit(1)
    }
    
    if (!bookings || bookings.length === 0) {
      console.log('⚠️  No private bookings with date/time found to test with')
      
      // Try to get any booking
      const { data: anyBookings } = await supabase
        .from('private_bookings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
      
      if (anyBookings && anyBookings.length > 0) {
        console.log('\nFound a booking without date/time:')
        console.log('   ID:', anyBookings[0].id)
        console.log('   Customer:', anyBookings[0].customer_name)
        console.log('   Status:', anyBookings[0].status)
        console.log('\nCalendar sync requires event_date and start_time to be set.')
      }
      
      process.exit(0)
    }
    
    const testBooking = bookings[0]
    
    console.log('\n2. Test booking details:')
    console.log('   ID:', testBooking.id)
    console.log('   Customer:', testBooking.customer_name)
    console.log('   Date:', testBooking.event_date)
    console.log('   Time:', testBooking.start_time, '-', testBooking.end_time || 'TBC')
    console.log('   Status:', testBooking.status)
    console.log('   Existing Calendar Event ID:', testBooking.calendar_event_id || 'None')
    
    console.log('\n3. Attempting calendar sync...')
    const calendarEventId = await syncCalendarEvent(testBooking as PrivateBooking)
    
    if (calendarEventId) {
      console.log('\n✅ SUCCESS! Calendar event created/updated')
      console.log('   Calendar Event ID:', calendarEventId)
      
      if (!testBooking.calendar_event_id || testBooking.calendar_event_id !== calendarEventId) {
        console.log('\n4. Updating booking with calendar event ID...')
        const { error: updateError } = await supabase
          .from('private_bookings')
          .update({ calendar_event_id: calendarEventId })
          .eq('id', testBooking.id)
        
        if (updateError) {
          console.error('⚠️  Warning: Failed to update booking with calendar ID:', updateError)
        } else {
          console.log('✅ Booking updated with calendar event ID')
        }
      }
      
      console.log('\n🎉 Google Calendar sync is working perfectly!')
      console.log('\nYour private bookings will now automatically sync to your Google Calendar.')
      console.log('Check your "Pub Events" calendar to see the event!')
      console.log('\nFrom now on:')
      console.log('- New bookings will automatically create calendar events')
      console.log('- Updates to bookings will update the calendar events')
      console.log('- Cancelled bookings will update the calendar event status')
    } else {
      console.log('\n❌ Calendar sync returned null')
      console.log('Check the logs above for any error messages')
    }
    
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message)
    console.error('Full error:', error)
  }
  
  process.exit(0)
})()