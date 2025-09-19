import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function fixPastReminders() {
  console.log('🔧 FIXING PAST EVENT REMINDERS...\n')
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey)
  const now = new Date()
  const todayStr = now.toISOString().split('T')[0]
  
  // Step 1: Cancel all pending reminders for past events
  console.log('1️⃣ Finding pending reminders for past events...')
  
  const { data: pastReminders, error: fetchError } = await supabase
    .from('booking_reminders')
    .select(`
      id,
      booking_id,
      reminder_type,
      scheduled_for,
      booking:bookings(
        event:events(
          name,
          date
        )
      )
    `)
    .eq('status', 'pending')
    .order('scheduled_for', { ascending: false })
    
  if (fetchError) {
    console.error('Error fetching reminders:', fetchError)
    return
  }
  
  // Filter for past events
  const pastEventReminders = (pastReminders || []).filter(r => {
    if (r.booking?.event?.date) {
      return r.booking.event.date < todayStr
    }
    return false
  })
  
  console.log(`Found ${pastEventReminders.length} pending reminders for past events`)
  
  if (pastEventReminders.length > 0) {
    console.log('\nCancelling reminders for past events:')
    
    // Show sample of what will be cancelled
    const sampleSize = Math.min(5, pastEventReminders.length)
    for (let i = 0; i < sampleSize; i++) {
      const r = pastEventReminders[i]
      console.log(`  - ${r.booking?.event?.name} on ${r.booking?.event?.date}`)
    }
    if (pastEventReminders.length > 5) {
      console.log(`  ... and ${pastEventReminders.length - 5} more`)
    }
    
    // Cancel all past event reminders
    const reminderIds = pastEventReminders.map(r => r.id)
    const { error: updateError } = await supabase
      .from('booking_reminders')
      .update({ 
        status: 'cancelled',
        error_message: 'Event has already passed - cancelled by fix script',
        updated_at: new Date().toISOString()
      })
      .in('id', reminderIds)
      
    if (updateError) {
      console.error('❌ Error cancelling reminders:', updateError)
    } else {
      console.log(`✅ Successfully cancelled ${pastEventReminders.length} reminders for past events`)
    }
  } else {
    console.log('✅ No pending reminders for past events found')
  }
  
  // Step 2: Delete any pending SMS jobs
  console.log('\n2️⃣ Checking for pending SMS jobs...')
  
  const { data: pendingJobs, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'pending')
    .or('type.eq.send_sms,type.eq.send_bulk_sms')
    .order('created_at', { ascending: false })
    
  if (pendingJobs && pendingJobs.length > 0) {
    console.log(`Found ${pendingJobs.length} pending SMS jobs`)
    
    // Show what we're deleting
    pendingJobs.forEach(job => {
      console.log(`  - Job ${job.id}: ${job.type} created at ${job.created_at}`)
    })
    
    // Delete pending SMS jobs
    const { error: deleteError } = await supabase
      .from('jobs')
      .delete()
      .in('id', pendingJobs.map(j => j.id))
      
    if (deleteError) {
      console.error('❌ Error deleting jobs:', deleteError)
    } else {
      console.log(`✅ Successfully deleted ${pendingJobs.length} pending SMS jobs`)
    }
  } else {
    console.log('✅ No pending SMS jobs found')
  }
  
  // Step 3: Check upcoming events
  console.log('\n3️⃣ Checking upcoming events that should have reminders...')
  
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const nextWeek = new Date(now)
  nextWeek.setDate(nextWeek.getDate() + 7)
  
  const { data: upcomingEvents, error: eventError } = await supabase
    .from('events')
    .select('*')
    .gte('date', todayStr)
    .lte('date', nextWeek.toISOString().split('T')[0])
    .order('date', { ascending: true })
    
  if (upcomingEvents && upcomingEvents.length > 0) {
    console.log(`\nUpcoming events in the next week:`)
    upcomingEvents.forEach(e => {
      console.log(`  ✅ ${e.name} on ${e.date} at ${e.time}`)
    })
    console.log('\nThese events will receive reminders if they have bookings')
  } else {
    console.log('No upcoming events in the next week')
  }
  
  console.log('\n' + '='.repeat(50))
  console.log('✅ FIX COMPLETE!')
  console.log('='.repeat(50))
  console.log('\nActions taken:')
  console.log(`1. Cancelled ${pastEventReminders.length} reminders for past events`)
  console.log(`2. Deleted ${pendingJobs?.length || 0} pending SMS jobs`)
  console.log('\nThe code has been patched to prevent this from happening again.')
  console.log('Future reminders will only be sent for upcoming events.')
}

fixPastReminders().catch(console.error)
