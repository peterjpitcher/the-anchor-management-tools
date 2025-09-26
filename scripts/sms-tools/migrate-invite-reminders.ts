import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

// Load environment variables from the local env file so we can use the service role key
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const OLD_REMINDER_TYPES = [
  'reminder_invite_1_month',
  'reminder_invite_1_week',
  'reminder_invite_1_day',
]

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase environment variables. Check .env.local')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  console.log('🔄 Migrating pending invite reminders to the new no-seats cadence...')

  const { data: pendingRows, error: fetchError } = await supabase
    .from('booking_reminders')
    .select('booking_id')
    .eq('status', 'pending')
    .in('reminder_type', OLD_REMINDER_TYPES)

  if (fetchError) {
    throw new Error(`Failed to load pending invite reminders: ${fetchError.message}`)
  }

  if (!pendingRows || pendingRows.length === 0) {
    console.log('✅ No pending invite reminders found. Nothing to migrate.')
    return
  }

  const uniqueBookingIds = Array.from(new Set(pendingRows.map(row => row.booking_id).filter(Boolean)))

  if (uniqueBookingIds.length === 0) {
    console.log('✅ No valid booking ids found in pending reminders.')
    return
  }

  console.log(`➡️  Found ${pendingRows.length} pending invite reminders across ${uniqueBookingIds.length} bookings.`)

  let clearedReminders = 0
  const failedBookings: string[] = []

  for (const bookingId of uniqueBookingIds) {
    const { data: removedRows, error: deleteError } = await supabase
      .from('booking_reminders')
      .delete()
      .eq('booking_id', bookingId)
      .eq('status', 'pending')
      .in('reminder_type', OLD_REMINDER_TYPES)
      .select('id')

    if (deleteError) {
      console.error(`❌ Failed to clear old reminders for booking ${bookingId}:`, deleteError.message)
      failedBookings.push(bookingId)
      continue
    }

    clearedReminders += removedRows?.length ?? 0
  }

  console.log(`✅ Cleared ${clearedReminders} pending invite reminders.`)

  if (failedBookings.length > 0) {
    console.log(`⚠️ Skipped ${failedBookings.length} bookings due to errors.`)
  }

  console.log('📌 Re-running the scheduler so each booking picks up the new cadence...')

  // We import lazily to avoid loading the entire app unless there is work to do
  const { scheduleBookingReminders } = await import('../../src/app/actions/event-sms-scheduler')

  let rescheduled = 0
  let skipped = 0

  for (const bookingId of uniqueBookingIds) {
    if (failedBookings.includes(bookingId)) {
      skipped += 1
      continue
    }

    const result = await scheduleBookingReminders(bookingId)
    if (!result.success) {
      console.warn(`⚠️ Could not reschedule reminders for booking ${bookingId}: ${result.error}`)
      skipped += 1
      continue
    }

    rescheduled += result.scheduled
  }

  console.log(`✨ Scheduler run complete. Created ${rescheduled} new reminders.`)

  if (skipped > 0) {
    console.log(`⚠️ ${skipped} bookings were skipped because of earlier errors. Review the logs above.`)
  }

  console.log('🎉 Migration finished.')
}

main().catch(error => {
  console.error('❌ Migration failed:', error)
  process.exit(1)
})
