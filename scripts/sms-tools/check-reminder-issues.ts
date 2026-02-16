#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const HARD_CAP = 2000

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

function parseLimit(argv: string[]): number {
  const idx = argv.indexOf('--limit')
  if (idx === -1) {
    return 500
  }

  const raw = argv[idx + 1]
  const parsed = Number.parseInt(raw || '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--limit must be a positive integer (got '${raw || ''}')`)
  }
  if (parsed > HARD_CAP) {
    throw new Error(`--limit too high (got ${parsed}, hard cap ${HARD_CAP})`)
  }
  return parsed
}

async function checkReminderIssues() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-reminder-issues is strictly read-only; do not pass --confirm.')
  }

  const limit = parseLimit(argv)
  const supabase = createAdminClient()
  const now = new Date()
  const todayStr = now.toISOString().split('T')[0] || ''

  console.log('🔍 Checking for SMS Reminder Issues...\n')
  console.log(`Today: ${todayStr}`)
  console.log(`Limit: ${limit} (hard cap ${HARD_CAP})\n`)

  console.log('1️⃣ Checking for past events with pending reminders (sample)...')
  const { data: reminderRows, error: remindersError } = await supabase
    .from('booking_reminders')
    .select(
      `
        id,
        booking_id,
        status,
        reminder_type,
        scheduled_for,
        bookings!inner(
          events(
            name,
            date,
            time
          ),
          customers(
            first_name,
            last_name
          )
        )
      `
    )
    .eq('status', 'pending')
    .order('scheduled_for', { ascending: false })
    .limit(Math.min(limit, 200))

  const reminders = (assertScriptQuerySucceeded({
    operation: 'Load pending booking reminders (sample)',
    error: remindersError,
    data: reminderRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    reminder_type: string | null
    scheduled_for: string | null
    bookings: {
      events: { name: string | null; date: string | null; time: string | null } | null
      customers: { first_name: string | null; last_name: string | null } | null
    } | null
  }>

  const pastEventReminders = reminders.filter((reminder) => {
    const eventDate = reminder.bookings?.events?.date
    if (!eventDate) {
      return false
    }
    return eventDate < todayStr
  })

  if (pastEventReminders.length > 0) {
    process.exitCode = 1
    console.log(`❌ Found ${pastEventReminders.length} pending reminder(s) for past events in sample.`)
    console.log('\nSample past event reminders:')
    pastEventReminders.slice(0, 5).forEach((r) => {
      console.log(`  - Event: ${r.bookings?.events?.name || 'unknown'}`)
      console.log(`    Date: ${r.bookings?.events?.date || 'unknown'} (PAST)`)
      console.log(
        `    Customer: ${r.bookings?.customers?.first_name || ''} ${r.bookings?.customers?.last_name || ''}`.trim()
      )
      console.log(`    Scheduled for: ${r.scheduled_for || 'unknown'}`)
      console.log(`    Type: ${r.reminder_type || 'unknown'}`)
      console.log('')
    })
  } else {
    console.log('✅ No pending reminders for past events found in sample')
  }

  console.log('\n2️⃣ Checking upcoming events and their reminder status (next 7 days)...')
  const nextWeek = new Date(now)
  nextWeek.setDate(nextWeek.getDate() + 7)
  const nextWeekStr = nextWeek.toISOString().split('T')[0] || ''

  const { data: upcomingEventsRows, error: upcomingError } = await supabase
    .from('events')
    .select('id, name, date, time')
    .gte('date', todayStr)
    .lte('date', nextWeekStr)
    .order('date', { ascending: true })
    .limit(50)

  const upcomingEvents = (assertScriptQuerySucceeded({
    operation: 'Load upcoming events (next 7 days)',
    error: upcomingError,
    data: upcomingEventsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{ name: string | null; date: string | null; time: string | null }>

  if (upcomingEvents.length > 0) {
    console.log(`Found ${upcomingEvents.length} event(s) in the next week:`)
    upcomingEvents.forEach((e) => {
      console.log(`  - ${e.name || 'unknown'} on ${e.date || 'unknown'} at ${e.time || 'unknown'}`)
    })
  } else {
    console.log('No events found in the next week.')
  }

  console.log("\n3️⃣ Checking recent SMS messages about \"Nikki's Karaoke Night\" (sample)...")
  const { data: messagesRows, error: messagesError } = await supabase
    .from('messages')
    .select('id, created_at, body')
    .like('body', '%Nikki%Karaoke%')
    .order('created_at', { ascending: false })
    .limit(10)

  const messages = (assertScriptQuerySucceeded({
    operation: 'Load recent messages matching the diagnostic pattern',
    error: messagesError,
    data: messagesRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{ created_at: string | null; body: string | null }>

  if (messages.length > 0) {
    console.log(`Found ${messages.length} message(s) about Nikki's Karaoke Night`)
    const firstMsg = messages[0]
    console.log(`  Last sent: ${firstMsg?.created_at || 'unknown'}`)
    console.log(`  Body preview: ${(firstMsg?.body || '').substring(0, 100)}...`)

    const body = firstMsg?.body || ''
    const createdAt = firstMsg?.created_at ? new Date(firstMsg.created_at) : null
    const dateMatch = body.match(/tomorrow at (\\d{2}:\\d{2})/)
    if (createdAt && dateMatch) {
      const eventDate = new Date(createdAt)
      eventDate.setDate(eventDate.getDate() + 1)
      console.log(`  Event was scheduled for: ${eventDate.toISOString().split('T')[0]}`)
      console.log(`  That's ${Math.floor((now.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24))} day(s) ago`)
    }
  } else {
    console.log('No messages found for this pattern.')
  }

  console.log('\n4️⃣ Checking for duplicate pending reminders (sample)...')
  const { data: pendingReminderRows, error: duplicateError } = await supabase
    .from('booking_reminders')
    .select('booking_id, reminder_type')
    .eq('status', 'pending')
    .order('scheduled_for', { ascending: false })
    .limit(limit)

  const pendingReminderKeys = (assertScriptQuerySucceeded({
    operation: 'Load pending reminder keys (sample)',
    error: duplicateError,
    data: pendingReminderRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{ booking_id: string | null; reminder_type: string | null }>

  const reminderCounts = new Map<string, number>()
  pendingReminderKeys.forEach((r) => {
    const bookingId = r.booking_id || 'unknown'
    const reminderType = r.reminder_type || 'unknown'
    const key = `${bookingId}-${reminderType}`
    reminderCounts.set(key, (reminderCounts.get(key) || 0) + 1)
  })

  const duplicateEntries = Array.from(reminderCounts.entries())
    .filter(([_, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])

  if (duplicateEntries.length > 0) {
    process.exitCode = 1
    console.log('❌ Found duplicate pending reminders in sample:')
    duplicateEntries.slice(0, 5).forEach(([key, count]) => {
      console.log(`  - ${key}: ${count} duplicates`)
    })
  } else {
    console.log('✅ No duplicate pending reminders found in sample')
  }

  console.log('\n5️⃣ Checking job queue for stuck SMS jobs (sample)...')
  const { data: stuckJobsRows, error: stuckJobsError } = await supabase
    .from('jobs')
    .select('id, type, created_at')
    .eq('status', 'pending')
    .like('type', '%sms%')
    .order('created_at', { ascending: false })
    .limit(10)

  const stuckJobs = (assertScriptQuerySucceeded({
    operation: 'Load pending SMS jobs (sample)',
    error: stuckJobsError,
    data: stuckJobsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{ id: string; type: string | null; created_at: string | null }>

  if (stuckJobs.length > 0) {
    process.exitCode = 1
    console.log(`⚠️ Found ${stuckJobs.length} pending SMS job(s)`)
    stuckJobs.forEach((j) => {
      console.log(`  - Job ${j.id}: ${j.type || 'unknown'} created at ${j.created_at || 'unknown'}`)
    })
  } else {
    console.log('✅ No pending SMS jobs found in sample')
  }

  console.log('\n' + '='.repeat(50))
  console.log('SUMMARY:')
  console.log('If reminders are repeatedly being sent for past events:')
  console.log('- Ensure date window calculations are anchored to "today" and validated to be in the future.')
  console.log('- Ensure idempotency/dedupe keys include booking + reminder type + scheduled-for window.')
  console.log('='.repeat(50))

  if (process.exitCode === 1) {
    console.log('\n❌ Reminder issue check completed with failures.')
  } else {
    console.log('\n✅ Reminder issue check complete!')
  }
}

void checkReminderIssues().catch((error) => {
  markFailure('check-reminder-issues failed.', error)
})
