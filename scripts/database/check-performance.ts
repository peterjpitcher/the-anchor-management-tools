#!/usr/bin/env tsx

/**
 * Performance monitoring script to check application speed
 */

import { config } from 'dotenv'
import path from 'path'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'
import { createAdminClient } from '../../src/lib/supabase/admin'

config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'check-performance'

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`[${SCRIPT_NAME}] ${message}`, error)
    return
  }
  console.error(`[${SCRIPT_NAME}] ${message}`)
}

async function measureQuery(name: string, queryFn: () => Promise<void>) {
  const start = performance.now()
  try {
    await queryFn()
    const end = performance.now()
    const duration = Math.round(end - start)
    console.log(`✅ ${name}: ${duration}ms`)
    return duration
  } catch (error: unknown) {
    const end = performance.now()
    const duration = Math.round(end - start)
    console.log(`❌ ${name}: ${duration}ms (failed)`)
    throw error
  }
}

async function runPerformanceChecks() {
  if (process.argv.includes('--confirm')) {
    throw new Error('check-performance is read-only and does not support --confirm.')
  }

  console.log('Running performance checks (read-only)...\n')

  const supabase = createAdminClient()
  const measurements: number[] = []

  // Test 1: Simple query
  measurements.push(await measureQuery('Simple customer count', async () => {
    const { count, error } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
    assertScriptQuerySucceeded({
      operation: 'Count customers',
      error,
      data: count ?? 0,
      allowMissing: true,
    })
  }))

  // Test 2: Complex dashboard query (old way)
  measurements.push(await measureQuery('Dashboard queries (sequential)', async () => {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const queries = await Promise.all([
      supabase.from('events').select('id', { count: 'exact', head: true }),
      supabase.from('bookings').select('id', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo.toISOString()),
      supabase.from('customers').select('id', { count: 'exact', head: true }),
      supabase.from('messages').select('id', { count: 'exact', head: true }).eq('direction', 'inbound').is('read_at', null),
      supabase.from('employees').select('id', { count: 'exact', head: true }).eq('is_active', true),
    ])

    const operations = [
      'Count events',
      'Count bookings (30d)',
      'Count customers',
      'Count unread inbound messages',
      'Count active employees',
    ]

    queries.forEach((result, index) => {
      assertScriptQuerySucceeded({
        operation: operations[index],
        error: result.error,
        data: result.count ?? 0,
        allowMissing: true,
      })
    })
  }))

  // Test 3: Optimized dashboard query (new way)
  measurements.push(await measureQuery('Dashboard queries (parallel)', async () => {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const queries = await Promise.all([
      supabase.from('events').select('id', { count: 'exact', head: true }),
      supabase.from('bookings').select('id', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo.toISOString()),
      supabase.from('customers').select('id', { count: 'exact', head: true }),
      supabase.from('messages').select('id', { count: 'exact', head: true }).eq('direction', 'inbound').is('read_at', null),
      supabase.from('employees').select('id', { count: 'exact', head: true }).eq('is_active', true),
    ])

    const operations = [
      'Count events (parallel)',
      'Count bookings (30d, parallel)',
      'Count customers (parallel)',
      'Count unread inbound messages (parallel)',
      'Count active employees (parallel)',
    ]

    queries.forEach((result, index) => {
      assertScriptQuerySucceeded({
        operation: operations[index],
        error: result.error,
        data: result.count ?? 0,
        allowMissing: true,
      })
    })
  }))

  // Test 4: Events with bookings
  measurements.push(await measureQuery('Events with booking counts', async () => {
    const { data, error } = await supabase
      .from('events')
      .select(`
        *,
        bookings (id)
      `)
      .order('event_date', { ascending: false })
      .limit(20)
    assertScriptQuerySucceeded({
      operation: 'Load events with bookings',
      error,
      data: data ?? [],
      allowMissing: true,
    })
  }))

  // Test 5: Message thread query
  measurements.push(await measureQuery('Message threads', async () => {
    const { data, error } = await supabase
      .from('messages')
      .select(`
        *,
        customer:customers(id, first_name, last_name)
      `)
      .eq('direction', 'inbound')
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(50)
    assertScriptQuerySucceeded({
      operation: 'Load unread inbound message threads',
      error,
      data: data ?? [],
      allowMissing: true,
    })
  }))

  // Calculate statistics
  const total = measurements.reduce((sum, time) => sum + time, 0)
  const average = Math.round(total / measurements.length)
  const max = Math.max(...measurements)
  const min = Math.min(...measurements)

  console.log('\n📊 Performance Summary:')
  console.log(`   Total time: ${total}ms`)
  console.log(`   Average query: ${average}ms`)
  console.log(`   Fastest query: ${min}ms`)
  console.log(`   Slowest query: ${max}ms`)

  if (average > 1000) {
    console.log('\n⚠️  Performance is still slow. Consider:')
    console.log('   - Enabling Supabase connection pooling')
    console.log('   - Running the performance indexes migration')
    console.log('   - Checking your Supabase plan limits')
  } else if (average > 500) {
    console.log('\n⚡ Performance is moderate. Could be improved with caching.')
  } else {
    console.log('\n🚀 Performance is good!')
  }
}

// Run the checks
void runPerformanceChecks().catch((error) => {
  markFailure('check-performance failed.', error)
})
