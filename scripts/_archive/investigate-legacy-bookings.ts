
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing environment variables: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function investigate() {
  console.log('--- Investigating Private Bookings ---')

  // 1. Check Drafts with NULL hold_expiry
  const { data: nullExpiryDrafts, error: err1 } = await supabase
    .from('private_bookings')
    .select('id, created_at, event_date, customer_name, status')
    .eq('status', 'draft')
    .is('hold_expiry', null)

  if (err1) console.error('Error checking drafts:', err1)
  console.log(`Drafts with NULL hold_expiry: ${nullExpiryDrafts?.length ?? 0}`)
  
  if (nullExpiryDrafts) {
      nullExpiryDrafts.forEach(d => {
          console.log(`- Draft ${d.id}: Created ${d.created_at}, Event: ${d.event_date}, Customer: ${d.customer_name}`)
      })
  }

  // 2. Check Confirmed Bookings with NULL contact_phone
  const { data: noPhoneBookings, error: err2 } = await supabase
    .from('private_bookings')
    .select('id, customer_id, contact_phone, event_date')
    .eq('status', 'confirmed')
    .is('contact_phone', null)
    .gt('event_date', new Date().toISOString()) // Future events only

  if (err2) console.error('Error checking confirmed phone numbers:', err2)
  
  console.log(`Future Confirmed Bookings with NULL contact_phone: ${noPhoneBookings?.length ?? 0}`)

  if (noPhoneBookings && noPhoneBookings.length > 0) {
    console.log('Checking if they have linked customers with phones...')
    let linkedWithPhone = 0
    let totallyMissing = 0

    for (const b of noPhoneBookings) {
      if (!b.customer_id) {
        totallyMissing++
        continue
      }
      const { data: customer } = await supabase
        .from('customers')
        .select('mobile_number')
        .eq('id', b.customer_id)
        .single()
      
      if (customer?.mobile_number) {
        linkedWithPhone++
      } else {
        totallyMissing++
      }
    }
    console.log(`- Linked to customer with mobile: ${linkedWithPhone}`)
    console.log(`- Totally missing phone (no direct, no customer link): ${totallyMissing}`)
  }

  // 3. Check for Confirmed Bookings within 14 days that SHOULD have triggered but haven't
  const now = new Date()
  const fourteenDays = new Date()
  fourteenDays.setDate(now.getDate() + 14)

  const { data: upcoming, error: err3 } = await supabase
    .from('private_bookings')
    .select('id, event_date, customer_first_name')
    .eq('status', 'confirmed')
    .is('final_payment_date', null) // Unpaid
    .gt('event_date', now.toISOString())
    .lte('event_date', fourteenDays.toISOString())

  if (err3) console.error('Error checking upcoming:', err3)
  
  console.log(`Upcoming UNPAID Confirmed Bookings (next 14 days): ${upcoming?.length ?? 0}`)
  
  if (upcoming && upcoming.length > 0) {
      // Check if they have logs in the queue
      for (const b of upcoming) {
          const { data: queueItems } = await supabase
            .from('private_booking_sms_queue')
            .select('*')
            .eq('booking_id', b.id)
            .eq('trigger_type', 'balance_reminder_14day')
          
          if (queueItems && queueItems.length > 0) {
              for (const q of queueItems) {
                  console.log(`- Booking ${b.id} (${b.event_date}): Queue ID ${q.id}, Status: ${q.status}, Error: ${q.error_message || 'None'}, Sent At: ${q.sent_at}`)
              }
          } else {
              console.log(`- Booking ${b.id} (${b.event_date}): NOT in queue.`)
          }
      }
  }

  // 4. General check for failed items in the queue
  const { data: failedItems, error: err4 } = await supabase
      .from('private_booking_sms_queue')
      .select('id, booking_id, trigger_type, error_message, created_at')
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(5)

  if (err4) console.error('Error checking failed queue items:', err4)

  if (failedItems && failedItems.length > 0) {
      console.log('\n--- Recent Failed Queue Items ---')
      failedItems.forEach(f => {
          console.log(`[${f.created_at}] Type: ${f.trigger_type}, Booking: ${f.booking_id}, Error: ${f.error_message}`)
      })
  } else {
      console.log('\nNo recent failed queue items found.')
  }
}

investigate()
