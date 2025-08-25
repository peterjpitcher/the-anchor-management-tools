import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function checkReminderIssues() {
  console.log('🔍 Checking for SMS Reminder Issues...\n')
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey)
  const now = new Date()
  const todayStr = now.toISOString().split('T')[0]
  
  // Check for events that have passed but still have pending reminders
  console.log('1️⃣ Checking for past events with pending reminders...')
  const { data: pastEventReminders, error: error1 } = await supabase
    .from('booking_reminders')
    .select(`
      *,
      booking:bookings(
        event:events(
          name,
          date,
          time
        ),
        customer:customers(
          first_name,
          last_name
        )
      )
    `)
    .eq('status', 'pending')
    .lt('booking.event.date', todayStr)
    .order('scheduled_for', { ascending: false })
    .limit(20)
    
  if (pastEventReminders && pastEventReminders.length > 0) {
    console.log(`❌ Found ${pastEventReminders.length} pending reminders for PAST events!`)
    console.log('\nSample past event reminders:')
    pastEventReminders.slice(0, 5).forEach(r => {
      console.log(`  - Event: ${r.booking?.event?.name}`)
      console.log(`    Date: ${r.booking?.event?.date} (PAST)`)
      console.log(`    Customer: ${r.booking?.customer?.first_name} ${r.booking?.customer?.last_name}`)
      console.log(`    Scheduled for: ${r.scheduled_for}`)
      console.log(`    Type: ${r.reminder_type}`)
      console.log('')
    })
  } else {
    console.log('✅ No pending reminders for past events')
  }
  
  // Check for events in the next few days
  console.log('\n2️⃣ Checking upcoming events and their reminder status...')
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const nextWeek = new Date(now)
  nextWeek.setDate(nextWeek.getDate() + 7)
  
  const { data: upcomingEvents, error: error2 } = await supabase
    .from('events')
    .select('*')
    .gte('date', todayStr)
    .lte('date', nextWeek.toISOString().split('T')[0])
    .order('date', { ascending: true })
    
  if (upcomingEvents) {
    console.log(`Found ${upcomingEvents.length} events in the next week:`)
    upcomingEvents.forEach(e => {
      console.log(`  - ${e.name} on ${e.date} at ${e.time}`)
    })
  }
  
  // Check recent messages for the problematic event
  console.log('\n3️⃣ Checking recent SMS messages about "Nikki\'s Karaoke Night"...')
  const { data: messages, error: error3 } = await supabase
    .from('messages')
    .select('*')
    .like('body', '%Nikki%Karaoke%')
    .order('created_at', { ascending: false })
    .limit(10)
    
  if (messages && messages.length > 0) {
    console.log(`Found ${messages.length} messages about Nikki's Karaoke Night`)
    const firstMsg = messages[0]
    console.log(`  Last sent: ${firstMsg.created_at}`)
    console.log(`  Body preview: ${firstMsg.body.substring(0, 100)}...`)
    
    // Check when the event actually was
    const dateMatch = firstMsg.body.match(/tomorrow at (\d{2}:\d{2})/)
    if (dateMatch) {
      const sentDate = new Date(firstMsg.created_at)
      const eventDate = new Date(sentDate)
      eventDate.setDate(eventDate.getDate() + 1)
      console.log(`  Event was scheduled for: ${eventDate.toISOString().split('T')[0]}`)
      console.log(`  That's ${Math.floor((now.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24))} days ago!`)
    }
  }
  
  // Check for duplicate reminder scheduling
  console.log('\n4️⃣ Checking for duplicate reminders...')
  const { data: duplicates, error: error4 } = await supabase
    .from('booking_reminders')
    .select('booking_id, reminder_type, count')
    .order('count', { ascending: false })
    
  // Manual grouping since Supabase doesn't support GROUP BY in this context
  const reminderCounts = new Map()
  if (duplicates) {
    duplicates.forEach(r => {
      const key = `${r.booking_id}-${r.reminder_type}`
      reminderCounts.set(key, (reminderCounts.get(key) || 0) + 1)
    })
    
    const duplicateEntries = Array.from(reminderCounts.entries())
      .filter(([_, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
    
    if (duplicateEntries.length > 0) {
      console.log(`❌ Found duplicate reminders:`)
      duplicateEntries.slice(0, 5).forEach(([key, count]) => {
        console.log(`  - ${key}: ${count} duplicates`)
      })
    } else {
      console.log('✅ No duplicate reminders found')
    }
  }
  
  // Check job queue
  console.log('\n5️⃣ Checking job queue for stuck SMS jobs...')
  const { data: stuckJobs, error: error5 } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'pending')
    .like('type', '%sms%')
    .order('created_at', { ascending: false })
    .limit(10)
    
  if (stuckJobs && stuckJobs.length > 0) {
    console.log(`⚠️ Found ${stuckJobs.length} pending SMS jobs`)
    stuckJobs.forEach(j => {
      console.log(`  - Job ${j.id}: ${j.type} created at ${j.created_at}`)
    })
  } else {
    console.log('✅ No stuck SMS jobs in queue')
  }
  
  console.log('\n' + '='.repeat(50))
  console.log('SUMMARY:')
  console.log('The issue appears to be that the sendEventReminders() function')
  console.log('is checking for events on specific dates (tomorrow and next week)')
  console.log('without verifying that those dates are in the future.')
  console.log('This causes it to repeatedly send reminders for past events.')
  console.log('='.repeat(50))
}

checkReminderIssues().catch(console.error)