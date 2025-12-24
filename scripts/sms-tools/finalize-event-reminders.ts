import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const LONDON_TZ = 'Europe/London'

function getLondonDateIso() {
  return new Date().toLocaleDateString('en-CA', { timeZone: LONDON_TZ })
}

async function finalizeEventReminders() {
  console.log('🧹 Finalizing event reminder backlog...\n')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }

  const supabase = createClient(supabaseUrl, supabaseKey)
  const nowIso = new Date().toISOString()
  const todayLondon = getLondonDateIso()

  console.log(`Using London date cutoff: ${todayLondon}`)

  // 1) Cancel pending reminders for past events
  console.log('\n1️⃣ Checking reminders for past events...')

  const { data: reminders, error: remindersError } = await supabase
    .from('booking_reminders')
    .select(`
      id,
      status,
      reminder_type,
      scheduled_for,
      booking:bookings(
        event:events(
          id,
          name,
          date
        )
      )
    `)
    .in('status', ['pending', 'queued', 'sending'])

  if (remindersError) {
    throw new Error(`Failed to load reminders: ${remindersError.message}`)
  }

  const pastEventReminders = (reminders || []).filter(reminder => {
    const eventDate = reminder.booking?.event?.date
    return eventDate ? eventDate < todayLondon : false
  })

  if (pastEventReminders.length === 0) {
    console.log('✅ No pending reminders for past events found')
  } else {
    console.log(`Found ${pastEventReminders.length} reminders tied to past events`) 

    const sample = pastEventReminders.slice(0, 5)
    sample.forEach(reminder => {
      console.log(`  - ${reminder.booking?.event?.name ?? 'Unknown event'} (${reminder.booking?.event?.date})`) 
    })

    const { error: cancelError } = await supabase
      .from('booking_reminders')
      .update({
        status: 'cancelled',
        error_message: 'Cancelled pending reminder for past event (finalize)',
        updated_at: nowIso
      })
      .in('id', pastEventReminders.map(reminder => reminder.id))

    if (cancelError) {
      throw new Error(`Failed to cancel past reminders: ${cancelError.message}`)
    }

    console.log(`✅ Cancelled ${pastEventReminders.length} reminders for past events`)
  }

  // 2) Cancel any pending reminder-processing jobs
  console.log('\n2️⃣ Checking reminder processing jobs...')

  const { data: reminderJobs, error: jobsError } = await supabase
    .from('jobs')
    .select('id, status, created_at')
    .eq('type', 'process_event_reminder')
    .in('status', ['pending', 'processing'])

  if (jobsError) {
    throw new Error(`Failed to load reminder jobs: ${jobsError.message}`)
  }

  if (reminderJobs && reminderJobs.length > 0) {
    console.log(`Found ${reminderJobs.length} pending reminder jobs`) 

    const { error: cancelJobsError } = await supabase
      .from('jobs')
      .update({
        status: 'cancelled',
        error_message: 'Cancelled during reminder finalization',
        updated_at: nowIso
      })
      .in('id', reminderJobs.map(job => job.id))

    if (cancelJobsError) {
      throw new Error(`Failed to cancel reminder jobs: ${cancelJobsError.message}`)
    }

    console.log(`✅ Cancelled ${reminderJobs.length} reminder jobs`)
  } else {
    console.log('✅ No pending reminder jobs found')
  }

  console.log('\n✨ Finalization complete')
}

finalizeEventReminders().catch(error => {
  console.error('❌ Reminder finalization failed:', error)
  process.exit(1)
})
