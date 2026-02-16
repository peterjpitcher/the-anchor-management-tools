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

async function queryAnonPendingBookingsCount(
  supabaseUrl: string,
  anonKey: string
): Promise<{ count: number | null; errorMessage: string | null }> {
  const requestUrl = new URL('/rest/v1/pending_bookings', supabaseUrl)
  requestUrl.searchParams.set('select', 'id')
  requestUrl.searchParams.set('limit', '1')

  const response = await fetch(requestUrl.toString(), {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      prefer: 'count=exact'
    }
  })

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const payload = await response.json() as { message?: string }
      if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
        message = payload.message.trim()
      }
    } catch {
      // Keep fallback status text when no JSON error payload is returned.
    }
    return { count: null, errorMessage: message }
  }

  const contentRange = response.headers.get('content-range')
  if (contentRange) {
    const [, total] = contentRange.split('/')
    const parsedTotal = Number.parseInt(total ?? '', 10)
    if (Number.isFinite(parsedTotal) && parsedTotal >= 0) {
      return { count: parsedTotal, errorMessage: null }
    }
  }

  const rows = await response.json() as unknown[]
  return { count: rows.length, errorMessage: null }
}

async function checkBookingDuplicates() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-booking-duplicates is strictly read-only; do not pass --confirm.')
  }

  const limit = parseLimit(argv)
  const skipRlsTest = argv.includes('--skip-rls-test')

  console.log('🔍 Checking for pending booking issues...\n')
  console.log(`Limit: ${limit} (hard cap ${HARD_CAP})`)
  console.log(`Skip RLS test: ${skipRlsTest ? 'yes' : 'no'}\n`)

  const supabase = createAdminClient()

  const { count: totalCount, error: countError } = await supabase
    .from('pending_bookings')
    .select('*', { count: 'exact', head: true })

  if (countError) {
    markFailure('Failed to count pending_bookings.', countError)
    return
  }

  console.log(`Total pending_bookings rows: ${totalCount ?? 0}\n`)

  const { data: sampleRows, error: sampleError } = await supabase
    .from('pending_bookings')
    .select('id, token, event_id, created_at, confirmed_at, expires_at, events(id)')
    .order('created_at', { ascending: false })
    .limit(limit)

  const sample = (assertScriptQuerySucceeded({
    operation: 'Load pending_bookings sample',
    error: sampleError,
    data: sampleRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    token: string | null
    event_id: string | null
    created_at: string | null
    confirmed_at: string | null
    expires_at: string | null
    events: { id: string } | null
  }>

  console.log('1️⃣ Checking for duplicate tokens (sample)...')
  const tokenCounts = new Map<string, number>()
  sample.forEach((booking) => {
    const token = booking.token || ''
    if (!token) {
      return
    }
    tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1)
  })
  const duplicates = Array.from(tokenCounts.entries()).filter(([, count]) => count > 1)
  if (duplicates.length > 0) {
    markFailure(`Found ${duplicates.length} duplicate token(s) in sample.`)
    duplicates.slice(0, 10).forEach(([token, count]) => {
      console.log(`   Token ${token}: ${count} occurrences`)
    })
  } else {
    console.log('✅ No duplicate tokens found in sample')
  }

  console.log('\n2️⃣ Checking for bookings with missing events (sample)...')
  const missingEvents = sample.filter((booking) => Boolean(booking.event_id) && !booking.events)
  if (missingEvents.length > 0) {
    markFailure(`Found ${missingEvents.length} booking(s) with missing event rows in sample.`)
    missingEvents.slice(0, 10).forEach((booking) => {
      console.log(`   Token: ${booking.token || 'unknown'}, Event ID: ${booking.event_id || 'unknown'}`)
    })
  } else {
    console.log('✅ All sampled bookings have valid events')
  }

  console.log('\n3️⃣ Checking recent pending bookings (last hour, sample)...')
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { data: recentRows, error: recentError } = await supabase
    .from('pending_bookings')
    .select('token, created_at, confirmed_at, expires_at')
    .gte('created_at', oneHourAgo)
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 50))

  const recent = (assertScriptQuerySucceeded({
    operation: 'Load pending_bookings (last hour)',
    error: recentError,
    data: recentRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    token: string | null
    created_at: string | null
    confirmed_at: string | null
    expires_at: string | null
  }>

  if (recent.length > 0) {
    console.log(`Found ${recent.length} recent booking(s):`)
    recent.forEach((booking) => {
      const token = booking.token || 'unknown'
      const createdAt = booking.created_at ? new Date(booking.created_at) : null
      const expiresAt = booking.expires_at ? new Date(booking.expires_at) : null
      const status = booking.confirmed_at
        ? 'Confirmed'
        : expiresAt && expiresAt < new Date()
          ? 'Expired'
          : 'Pending'
      console.log(
        `   ${token.length > 8 ? `${token.substring(0, 8)}...` : token} - ${status} (created: ${createdAt ? createdAt.toLocaleTimeString() : 'unknown'})`
      )
    })
  } else {
    console.log('No recent bookings in the last hour')
  }

  if (skipRlsTest) {
    return
  }

  console.log('\n4️⃣ Testing RLS policies (anonymous client)...')
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    markFailure('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY; cannot run RLS test.')
    return
  }

  const anonResult = await queryAnonPendingBookingsCount(supabaseUrl, anonKey)
  if (anonResult.errorMessage) {
    console.log('✅ Anonymous users cannot access pending_bookings:', anonResult.errorMessage)
    return
  }

  markFailure(`Anonymous users can see ${anonResult.count ?? 0} pending bookings (unexpected).`)
}

void checkBookingDuplicates().catch((error) => {
  markFailure('check-booking-duplicates failed.', error)
})
