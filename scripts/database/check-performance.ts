#!/usr/bin/env tsx

/**
 * Performance monitoring script to check application speed
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

async function measureQuery(name: string, queryFn: () => Promise<any>) {
  const start = performance.now()
  try {
    await queryFn()
    const end = performance.now()
    const duration = Math.round(end - start)
    console.log(`✅ ${name}: ${duration}ms`)
    return duration
  } catch (error) {
    const end = performance.now()
    const duration = Math.round(end - start)
    console.log(`❌ ${name}: ${duration}ms (failed)`)
    return duration
  }
}

async function runPerformanceChecks() {
  console.log('🔍 Running performance checks...\n')
  
  const measurements: number[] = []
  
  // Test 1: Simple query
  measurements.push(await measureQuery('Simple customer count', async () => {
    const { count } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
  }))
  
  // Test 2: Complex dashboard query (old way)
  measurements.push(await measureQuery('Dashboard queries (sequential)', async () => {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    
    await supabase.from('events').select('id', { count: 'exact', head: true })
    await supabase.from('bookings').select('id', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo.toISOString())
    await supabase.from('customers').select('id', { count: 'exact', head: true })
    await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('direction', 'inbound').is('read_at', null)
    await supabase.from('employees').select('id', { count: 'exact', head: true }).eq('is_active', true)
  }))
  
  // Test 3: Optimized dashboard query (new way)
  measurements.push(await measureQuery('Dashboard queries (parallel)', async () => {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    
    await Promise.all([
      supabase.from('events').select('id', { count: 'exact', head: true }),
      supabase.from('bookings').select('id', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo.toISOString()),
      supabase.from('customers').select('id', { count: 'exact', head: true }),
      supabase.from('messages').select('id', { count: 'exact', head: true }).eq('direction', 'inbound').is('read_at', null),
      supabase.from('employees').select('id', { count: 'exact', head: true }).eq('is_active', true)
    ])
  }))
  
  // Test 4: Events with bookings
  measurements.push(await measureQuery('Events with booking counts', async () => {
    const { data } = await supabase
      .from('events')
      .select(`
        *,
        bookings (id)
      `)
      .order('event_date', { ascending: false })
      .limit(20)
  }))
  
  // Test 5: Message thread query
  measurements.push(await measureQuery('Message threads', async () => {
    const { data } = await supabase
      .from('messages')
      .select(`
        *,
        customer:customers(id, first_name, last_name)
      `)
      .eq('direction', 'inbound')
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(50)
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
runPerformanceChecks().catch(console.error)