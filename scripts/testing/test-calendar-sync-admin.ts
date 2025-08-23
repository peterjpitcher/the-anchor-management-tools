#!/usr/bin/env tsx

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
      .order('created_at', { ascending: false })
      .limit(5)
    
    if (error) {
      console.error('❌ Error fetching bookings:', error)
      process.exit(1)
    }
    
    if (!bookings || bookings.length === 0) {
      console.log('⚠️  No private bookings found to test with')
      process.exit(0)
    }
    
    const testBooking = bookings.find((b: any) => b.event_date && b.start_time) || bookings[0]
    
    console.log('\n2. Test booking details:')
    console.log('   ID:', testBooking.id)
    console.log('   Customer:', testBooking.customer_name)
    console.log('   Date:', testBooking.event_date)
    console.log('   Time:', testBooking.start_time, '-', testBooking.end_time)
    console.log('   Status:', testBooking.status)
    console.log('   Existing Calendar Event ID:', testBooking.calendar_event_id || 'None')
    
    console.log('\n3. Attempting calendar sync...')
    const calendarEventId = await syncCalendarEvent(testBooking as PrivateBooking)
    
    if (calendarEventId) {
      console.log('\n✅ SUCCESS! Calendar event created/updated')
      console.log('   Calendar Event ID:', calendarEventId)
      
      if (!testBooking.calendar_event_id) {
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
      console.log('Check your calendar to see the event!')
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