#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function main() {
  const db = createAdminClient()

  // 1. Get all recent table bookings (last 30 days) with customer info
  const { data: bookings, error } = await db
    .from('table_bookings')
    .select(`
      id,
      booking_reference,
      booking_date,
      booking_time,
      party_size,
      status,
      source,
      booking_type,
      booking_purpose,
      special_requirements,
      dietary_requirements,
      allergies,
      celebration_type,
      internal_notes,
      created_at,
      confirmed_at,
      cancelled_at,
      deposit_amount,
      payment_status,
      email_verified_at,
      customer_id,
      customers (
        id,
        first_name,
        last_name,
        mobile_number,
        mobile_e164,
        email,
        created_at,
        internal_notes
      )
    `)
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) {
    console.error('Error fetching bookings:', error)
    process.exit(1)
  }

  console.log(`\n=== TOTAL RECENT BOOKINGS (last 30 days): ${bookings.length} ===\n`)

  // 2. Status breakdown
  const statusCounts: Record<string, number> = {}
  for (const b of bookings) {
    statusCounts[b.status] = (statusCounts[b.status] || 0) + 1
  }
  console.log('Status breakdown:')
  for (const [status, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${count}`)
  }

  // 3. Source breakdown
  const sourceCounts: Record<string, number> = {}
  for (const b of bookings) {
    sourceCounts[b.source || 'null'] = (sourceCounts[b.source || 'null'] || 0) + 1
  }
  console.log('\nSource breakdown:')
  for (const [source, count] of Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${source}: ${count}`)
  }

  // 4. Detect suspicious patterns
  console.log('\n=== SUSPICIOUS PATTERN ANALYSIS ===\n')

  // 4a. Customers with many bookings in short time
  const customerBookingCounts: Record<string, { count: number; customer: any; bookings: any[] }> = {}
  for (const b of bookings) {
    const cid = b.customer_id
    if (!customerBookingCounts[cid]) {
      customerBookingCounts[cid] = { count: 0, customer: b.customers, bookings: [] }
    }
    customerBookingCounts[cid].count++
    customerBookingCounts[cid].bookings.push(b)
  }

  const highFreqCustomers = Object.entries(customerBookingCounts)
    .filter(([, v]) => v.count >= 3)
    .sort((a, b) => b[1].count - a[1].count)

  if (highFreqCustomers.length > 0) {
    console.log('HIGH FREQUENCY CUSTOMERS (3+ bookings in 30 days):')
    for (const [cid, info] of highFreqCustomers) {
      const c = info.customer as any
      console.log(`  ${c?.first_name || '?'} ${c?.last_name || '?'} (${c?.mobile_number || '?'}) — ${info.count} bookings`)
      for (const b of info.bookings) {
        console.log(`    ${b.booking_reference} | ${b.booking_date} ${b.booking_time} | party:${b.party_size} | ${b.status} | created:${b.created_at}`)
      }
    }
  }

  // 4b. Bookings created very close together (within 60 seconds)
  console.log('\nRAPID-FIRE BOOKINGS (created within 60s of each other):')
  const sorted = [...bookings].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  for (let i = 1; i < sorted.length; i++) {
    const gap = new Date(sorted[i].created_at).getTime() - new Date(sorted[i - 1].created_at).getTime()
    if (gap < 60000) {
      const b = sorted[i]
      const prev = sorted[i - 1]
      const c = b.customers as any
      const pc = prev.customers as any
      console.log(`  ${gap / 1000}s gap:`)
      console.log(`    ${prev.booking_reference} | ${pc?.first_name} ${pc?.last_name} (${pc?.mobile_number}) | ${prev.booking_date} ${prev.booking_time} | ${prev.status}`)
      console.log(`    ${b.booking_reference} | ${c?.first_name} ${c?.last_name} (${c?.mobile_number}) | ${b.booking_date} ${b.booking_time} | ${b.status}`)
    }
  }

  // 4c. Suspicious names/data patterns
  console.log('\nSUSPICIOUS DATA PATTERNS:')
  for (const b of bookings) {
    const c = b.customers as any
    const flags: string[] = []

    // Generic/test names
    if (c?.first_name && /^(test|bot|fake|asdf|qwer|xxx|aaa|bbb)/i.test(c.first_name)) {
      flags.push(`suspicious name: ${c.first_name}`)
    }

    // Single character names
    if (c?.first_name && c.first_name.length <= 1) {
      flags.push(`very short first name: "${c.first_name}"`)
    }
    if (c?.last_name && c.last_name.length <= 1) {
      flags.push(`very short last name: "${c.last_name}"`)
    }

    // Phone number patterns (sequential, repeated digits)
    if (c?.mobile_number && /(\d)\1{5,}/.test(c.phone)) {
      flags.push(`suspicious phone (repeated digits): ${c.phone}`)
    }

    // Email patterns
    if (c?.email && /^(test|bot|fake|spam|noreply)/i.test(c.email)) {
      flags.push(`suspicious email: ${c.email}`)
    }

    // Bookings with no email verification that required deposit
    if (b.deposit_amount && b.deposit_amount > 0 && !b.email_verified_at && b.status === 'pending_payment') {
      flags.push(`pending deposit (£${b.deposit_amount}) never paid`)
    }

    if (flags.length > 0) {
      console.log(`  ${b.booking_reference} | ${c?.first_name} ${c?.last_name} (${c?.mobile_number}) | ${b.booking_date} | ${b.status}`)
      for (const f of flags) {
        console.log(`    ⚠️  ${f}`)
      }
    }
  }

  // 4d. Cancelled/pending bookings summary
  const pendingOrCancelled = bookings.filter(b =>
    b.status === 'pending_payment' || b.status === 'pending_card_capture' || b.status === 'cancelled'
  )
  console.log(`\nPENDING/CANCELLED BOOKINGS: ${pendingOrCancelled.length}`)
  for (const b of pendingOrCancelled) {
    const c = b.customers as any
    console.log(`  ${b.booking_reference} | ${c?.first_name} ${c?.last_name} (${c?.mobile_number}) | ${b.booking_date} ${b.booking_time} | party:${b.party_size} | ${b.status} | created:${b.created_at}`)
  }

  // 5. Check for orphaned customers created by bots
  console.log('\n=== RECENTLY CREATED CUSTOMERS WITH NO CONFIRMED BOOKINGS ===\n')
  const { data: recentCustomers, error: custError } = await db
    .from('customers')
    .select('id, first_name, last_name, mobile_number, email, created_at')
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(200)

  if (custError) {
    console.error('Error fetching customers:', custError)
  } else {
    // Find customers whose only bookings are cancelled/pending
    for (const cust of recentCustomers) {
      const custBookings = bookings.filter(b => b.customer_id === cust.id)
      const hasConfirmed = custBookings.some(b => b.status === 'confirmed' || b.status === 'completed')
      if (custBookings.length > 0 && !hasConfirmed) {
        console.log(`  ${cust.first_name} ${cust.last_name} (${cust.mobile_number}) | created:${cust.created_at} | ${custBookings.length} bookings, none confirmed`)
      }
    }
  }

  // 6. Check booking_analytics for unusual patterns
  const { data: analytics, error: analyticsError } = await db
    .from('table_booking_analytics')
    .select('*')
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(100)

  if (!analyticsError && analytics && analytics.length > 0) {
    console.log(`\n=== BOOKING ANALYTICS (last 30 days): ${analytics.length} events ===`)
    const eventTypes: Record<string, number> = {}
    for (const a of analytics) {
      eventTypes[a.event_type || a.action || 'unknown'] = (eventTypes[a.event_type || a.action || 'unknown'] || 0) + 1
    }
    for (const [type, count] of Object.entries(eventTypes).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`)
    }
  }

  // 7. Daily booking creation rates
  console.log('\n=== DAILY BOOKING CREATION RATES ===\n')
  const dailyCounts: Record<string, number> = {}
  for (const b of bookings) {
    const day = b.created_at.substring(0, 10)
    dailyCounts[day] = (dailyCounts[day] || 0) + 1
  }
  for (const [day, count] of Object.entries(dailyCounts).sort()) {
    const bar = '█'.repeat(Math.min(count, 50))
    console.log(`  ${day}: ${count.toString().padStart(3)} ${bar}`)
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
