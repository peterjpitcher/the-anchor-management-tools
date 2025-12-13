import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase env vars. Check .env.local for NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const nowIso = new Date().toISOString()
  const reason = `Cleared backlog ${nowIso}`

  console.log('🔻 Clearing event reminder backlog...')

  // Cancel pending/queued reminders so nothing auto-sends when we re-enable
  const { data: dueReminders, error: fetchError } = await supabase
    .from('booking_reminders')
    .select('id, status, reminder_type, scheduled_for')
    .in('status', ['pending', 'queued'])

  if (fetchError) {
    throw new Error(`Failed to fetch reminders: ${fetchError.message}`)
  }

  if (dueReminders && dueReminders.length > 0) {
    const { error: cancelError } = await supabase
      .from('booking_reminders')
      .update({
        status: 'cancelled',
        error_message: reason,
        updated_at: nowIso
      })
      .in('id', dueReminders.map(r => r.id))

    if (cancelError) {
      throw new Error(`Failed to cancel reminders: ${cancelError.message}`)
    }

    console.log(`✅ Cancelled ${dueReminders.length} pending/queued reminders`)
  } else {
    console.log('✅ No pending/queued reminders found')
  }

  // Cancel any reminder-processing jobs still sitting in the queue
  const { data: reminderJobs, error: jobsError } = await supabase
    .from('jobs')
    .select('id, status, created_at')
    .eq('type', 'process_event_reminder')
    .in('status', ['pending', 'processing'])

  if (jobsError) {
    throw new Error(`Failed to load reminder jobs: ${jobsError.message}`)
  }

  if (reminderJobs && reminderJobs.length > 0) {
    const { error: cancelJobsError } = await supabase
      .from('jobs')
      .update({
        status: 'cancelled',
        error_message: reason,
        updated_at: nowIso
      })
      .in('id', reminderJobs.map(j => j.id))

    if (cancelJobsError) {
      throw new Error(`Failed to cancel reminder jobs: ${cancelJobsError.message}`)
    }

    console.log(`✅ Cancelled ${reminderJobs.length} reminder jobs (pending/processing)`)
  } else {
    console.log('✅ No reminder jobs to cancel')
  }

  console.log('\n✨ Backlog cleared. Event reminders are now inert until the new pipeline is enabled.')
}

main().catch(error => {
  console.error('❌ Backlog clear failed:', error)
  process.exit(1)
})
