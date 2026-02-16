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

async function checkAttendanceDates() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-attendance-dates is strictly read-only; do not pass --confirm.')
  }

  const limit = parseBoundedInt({ argv, flag: '--limit', defaultValue: 20, hardCap: HARD_CAP })
  const includeTotals = argv.includes('--include-totals')
  const totalsLimit = parseBoundedInt({ argv, flag: '--totals-limit', defaultValue: 10, hardCap: 50 })

  console.log('Checking customer attendance dates...\n')
  console.log(`Limit: ${limit} (hard cap ${HARD_CAP})`)
  console.log(`Include totals: ${includeTotals ? 'yes' : 'no'}`)
  console.log(`Totals limit: ${totalsLimit} (hard cap 50)\n`)

  const supabase = createAdminClient()

  const { data: statsRows, error: statsError } = await supabase
    .from('customer_category_stats')
    .select('customer_id, times_attended, last_attended_date')
    .gte('times_attended', 5)
    .order('last_attended_date', { ascending: false })
    .limit(limit)

  const stats = (assertScriptQuerySucceeded({
    operation: 'Load customer_category_stats (times_attended >= 5)',
    error: statsError,
    data: statsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    customer_id: string
    times_attended: number | null
    last_attended_date: string | null
  }>

  const today = new Date()
  const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)
  console.log(`Today: ${today.toISOString().split('T')[0]}`)
  console.log(`90 days ago: ${ninetyDaysAgo.toISOString().split('T')[0]}\n`)

  console.log('Customers with 5+ attendances and their last attendance dates (sample):')
  stats.forEach((row) => {
    const lastDate = row.last_attended_date ? new Date(row.last_attended_date) : null
    const daysAgo =
      lastDate && !Number.isNaN(lastDate.getTime())
        ? Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24))
        : null
    const within90Days = lastDate ? lastDate >= ninetyDaysAgo : false
    console.log(
      `  - customer ${row.customer_id}: ${row.times_attended ?? 'unknown'} events, last: ${row.last_attended_date || 'unknown'} (${daysAgo ?? 'unknown'} days ago) ${within90Days ? 'within 90 days' : 'older'}`
    )
  })

  if (!includeTotals) {
    return
  }

  console.log('\nTop customers by total attendance (RPC sample):')
  const { data: totalsRows, error: totalsError } = await supabase.rpc('get_customer_attendance_totals')

  if (totalsError) {
    markFailure('get_customer_attendance_totals RPC failed.', totalsError)
    return
  }

  const totals = (totalsRows ?? []) as Array<{ customer_id?: unknown; total_attended?: unknown }>
  totals.slice(0, totalsLimit).forEach((row) => {
    console.log(`  - customer ${String(row.customer_id || 'unknown')}: ${String(row.total_attended || 'unknown')} total events`)
  })
}

void checkAttendanceDates().catch((error) => {
  markFailure('check-attendance-dates failed.', error)
})

