
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkBooking() {
    const token = 'ed551746-5b55-43ad-aaa5-a3b6cb9e6fb9'
    console.log(`Checking pending booking for token: ${token}`)

    // 1. Get Pending Booking
    const { data: pending, error: pendingError } = await supabase
        .from('pending_bookings')
        .select('*')
        .eq('token', token)
        .single()

    if (pendingError) {
        console.error('Error fetching pending booking:', pendingError)
        return
    }

    if (!pending) {
        console.log('No pending booking found for this token.')
        return
    }

    console.log('Pending Booking Found:', JSON.stringify(pending, null, 2))

    if (!pending.booking_id) {
        console.log('Pending booking has no booking_id associated yet.')

        // Check if there are any bookings for this event/customer anyway
        if (pending.customer_id && pending.event_id) {
            console.log('Checking for disconnected bookings for this customer/event...')
            const { data: disconnected, error: discError } = await supabase
                .from('bookings')
                .select('*')
                .eq('event_id', pending.event_id)
                .eq('customer_id', pending.customer_id)

            console.log('Disconnected Bookings:', disconnected)
        }

    } else {
        // 2. Get Actual Booking
        console.log(`\nFetching Booking ID: ${pending.booking_id}`)
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('*')
            .eq('id', pending.booking_id)
            .single()

        if (bookingError) {
            console.error('Error fetching booking:', bookingError)
        } else {
            console.log('Booking Record:', JSON.stringify(booking, null, 2))
        }
    }

    // 3. List all bookings for this event to see what's there
    /*
    if (pending.event_id) {
      console.log(`\nAll Bookings for Event ID: ${pending.event_id}`)
      const { data: allBookings, error: allError } = await supabase
        .from('bookings')
        .select('id, seats, is_reminder_only, customer_id, created_at')
        .eq('event_id', pending.event_id)
      
      if (allError) {
          console.error('Error listing event bookings:', allError)
      } else {
          console.table(allBookings)
      }
    }
    */
}

checkBooking()
