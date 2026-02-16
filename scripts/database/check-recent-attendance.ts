#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const HARD_CAP = 200

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`ERROR: ${message}`, error)
    return
  }
  console.error(`ERROR: ${message}`)
}

function parseBoundedInt(params: {
  argv: string[]
  flag: string
  defaultValue: number
  hardCap: number
}): number {
  const idx = params.argv.indexOf(params.flag)
  if (idx === -1) {
    return params.defaultValue
  }

  const raw = params.argv[idx + 1]
  const parsed = Number.parseInt(raw || '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${params.flag} must be a positive integer (got '${raw || ''}')`)
  }
  if (parsed > params.hardCap) {
    throw new Error(`${params.flag} too high (got ${parsed}, hard cap ${params.hardCap})`)
  }
  return parsed
}

async function checkRecentAttendance() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-recent-attendance is strictly read-only; do not pass --confirm.')
  }

  const days = parseBoundedInt({ argv, flag: '--days', defaultValue: 90, hardCap: 365 })
  const limit = parseBoundedInt({ argv, flag: '--limit', defaultValue: 10, hardCap: HARD_CAP })
  const includeQualifiers = argv.includes('--include-qualifiers')
  const qualifiersLimit = parseBoundedInt({ argv, flag: '--qualifiers-limit', defaultValue: 500, hardCap: 5000 })

  console.log('Checking recent attendance (read-only sample)...\n')
  console.log(`Days: ${days} (hard cap 365)`)
  console.log(`Limit: ${limit} (hard cap ${HARD_CAP})`)
  console.log(`Include qualifiers: ${includeQualifiers ? 'yes' : 'no'}`)
  console.log(`Qualifiers limit: ${qualifiersLimit} (hard cap 5000)\n`)

  const supabase = createAdminClient()
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const sinceDate = since.toISOString().split('T')[0]

  console.log(`Since date: ${sinceDate}\n`)

  console.log('1) Recent bookings (sample, last N days):')
  const { data: recentBookingsRows, error: bookingsError } = await supabase
    .from('bookings')
    .select(
      `
        id,
        customer_id,
        seats,
        created_at,
        events!inner(
          date,
          name
        )
      `
    )
    .gte('events.date', sinceDate)
    .gt('seats', 0)
    .order('events.date', { ascending: false })
    .limit(limit)

  const recentBookings = (assertScriptQuerySucceeded({
    operation: 'Load recent bookings (with events join)',
    error: bookingsError,
    data: recentBookingsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    customer_id: string | null
    seats: number | null
    created_at: string | null
    events: { date: string | null; name: string | null }
  }>

  console.log(`Found ${recentBookings.length} booking(s) in sample.`)
  recentBookings.forEach((row) => {
    console.log(
      `  - customer ${row.customer_id || 'unknown'} booked ${row.seats ?? 0} seat(s) for '${row.events?.name || 'unknown'}' on ${row.events?.date || 'unknown'}`
    )
  })

  console.log('\n2) customer_category_stats recent attendance (sample):')
  const { data: recentStatsRows, error: statsError } = await supabase
    .from('customer_category_stats')
    .select('customer_id, times_attended, last_attended_date')
    .gte('last_attended_date', sinceDate)
    .order('last_attended_date', { ascending: false })
    .limit(limit)

  const recentStats = (assertScriptQuerySucceeded({
    operation: 'Load customer_category_stats (recent attendance)',
    error: statsError,
    data: recentStatsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    customer_id: string
    times_attended: number | null
    last_attended_date: string | null
  }>

  console.log(`Found ${recentStats.length} row(s) in sample.`)
  recentStats.forEach((row) => {
    console.log(
      `  - customer ${row.customer_id}: ${row.times_attended ?? 'unknown'} events, last: ${row.last_attended_date || 'unknown'}`
    )
  })

  if (!includeQualifiers) {
    return
  }

  console.log('\n3) Regular label qualifiers (sample; totals computed over sample rows only):')
  const { data: qualifiersRows, error: qualifiersError } = await supabase
    .from('customer_category_stats')
    .select('customer_id, times_attended, last_attended_date')
    .gte('last_attended_date', sinceDate)
    .limit(qualifiersLimit)

  const qualifiers = (assertScriptQuerySucceeded({
    operation: 'Load qualifier stats rows',
    error: qualifiersError,
    data: qualifiersRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    customer_id: string
    times_attended: number | null
    last_attended_date: string | null
  }>

  const totals = new Map<string, { total: number; lastDate: string }>()
  qualifiers.forEach((row) => {
    const customerId = row.customer_id
    const count = row.times_attended ?? 0
    const lastDate = row.last_attended_date || 'unknown'
    const existing = totals.get(customerId) || { total: 0, lastDate }
    totals.set(customerId, {
      total: existing.total + count,
      lastDate: lastDate > existing.lastDate ? lastDate : existing.lastDate
    })
  })

  const regularQualifiers = Array.from(totals.entries())
    .filter(([, data]) => data.total >= 5)
    .map(([customerId, data]) => ({ customerId, ...data }))
    .slice(0, 10)

  console.log(`Qualifiers (sample): ${regularQualifiers.length}`)
  regularQualifiers.forEach((row) => {
    console.log(`  - customer ${row.customerId}: ${row.total} total events, last: ${row.lastDate}`)
  })
}

void checkRecentAttendance().catch((error) => {
  markFailure('check-recent-attendance failed.', error)
})

