#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function main() {
  const db = createAdminClient()

  // 1. Find ALL Music Bingo events — check date vs start_datetime
  console.log('=== Music Bingo Events (date vs start_datetime) ===\n')
  const { data: events, error: eventsError } = await db
    .from('events')
    .select('id, name, date, time, start_datetime, event_status, booking_open, capacity, created_at')
    .ilike('name', '%music bingo%')
    .order('date', { ascending: true })

  if (eventsError) {
    console.error('Events query failed:', eventsError)
    return
  }

  if (!events || events.length === 0) {
    console.log('No Music Bingo events found. Trying broader search...')
    const { data: allEvents } = await db
      .from('events')
      .select('id, name, date, time, start_datetime')
      .ilike('name', '%bingo%')
      .order('date', { ascending: true })
    console.log('Bingo events:', JSON.stringify(allEvents, null, 2))
    return
  }

  for (const e of events) {
    const dateMismatch = e.start_datetime && e.date
      ? !e.start_datetime.startsWith(e.date)
      : false
    console.log(`${dateMismatch ? '*** MISMATCH ***' : 'OK'} | id: ${e.id}`)
    console.log(`  name: ${e.name}`)
    console.log(`  date: ${e.date}`)
    console.log(`  time: ${e.time}`)
    console.log(`  start_datetime: ${e.start_datetime}`)
    console.log(`  status: ${e.event_status} | booking_open: ${e.booking_open} | capacity: ${e.capacity}`)
    console.log(`  created_at: ${e.created_at}`)
    console.log()
  }

  // 2. Find bookings for Music Bingo events — check which event_id was used
  const eventIds = events.map(e => e.id)
  console.log('=== Bookings for Music Bingo Events ===\n')
  const { data: bookings, error: bookingsError } = await db
    .from('bookings')
    .select('id, event_id, customer_id, seats, status, source, created_at')
    .in('event_id', eventIds)
    .order('created_at', { ascending: false })
    .limit(30)

  if (bookingsError) {
    console.error('Bookings query failed:', bookingsError)
    return
  }

  for (const b of bookings || []) {
    const event = events.find(e => e.id === b.event_id)
    console.log(`booking: ${b.id} | event_date: ${event?.date} | seats: ${b.seats} | status: ${b.status} | source: ${b.source} | created: ${b.created_at}`)
  }

  // 3. Check messages sent for these bookings — look for the problematic SMS
  console.log('\n=== Recent SMS for Music Bingo Bookings ===\n')
  const bookingIds = (bookings || []).map(b => b.id)
  if (bookingIds.length > 0) {
    const { data: messages, error: messagesError } = await db
      .from('messages')
      .select('id, body, direction, status, event_booking_id, created_at')
      .in('event_booking_id', bookingIds)
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .limit(20)

    if (messagesError) {
      console.error('Messages query failed:', messagesError)
      return
    }

    for (const m of messages || []) {
      const booking = (bookings || []).find(b => b.id === m.event_booking_id)
      const event = events.find(e => e.id === booking?.event_id)
      console.log(`msg: ${m.id} | event_date: ${event?.date} | status: ${m.status}`)
      console.log(`  body: ${m.body?.substring(0, 150)}...`)
      console.log(`  sent: ${m.created_at}`)
      console.log()
    }
  }

  // 4. Specifically look for the Feb 24 event
  console.log('=== Feb 24 2026 Event Check ===\n')
  const feb24Events = events.filter(e => e.date === '2026-02-24')
  if (feb24Events.length === 0) {
    console.log('No Music Bingo event found with date = 2026-02-24')
    console.log('Checking all events on that date...')
    const { data: allFeb24 } = await db
      .from('events')
      .select('id, name, date, time, start_datetime')
      .eq('date', '2026-02-24')
    console.log(JSON.stringify(allFeb24, null, 2))
  } else {
    for (const e of feb24Events) {
      console.log(`Found: ${e.name} | date: ${e.date} | start_datetime: ${e.start_datetime}`)
    }
  }

  // 5. Check if any event has start_datetime on Apr 22
  console.log('\n=== Events with start_datetime on Apr 22 ===\n')
  const { data: apr22Events } = await db
    .from('events')
    .select('id, name, date, time, start_datetime')
    .gte('start_datetime', '2026-04-22T00:00:00')
    .lt('start_datetime', '2026-04-23T00:00:00')
  console.log(JSON.stringify(apr22Events, null, 2))
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
