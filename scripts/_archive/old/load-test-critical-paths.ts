#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface LoadTestResult {
  operation: string
  avgTime: number
  minTime: number
  maxTime: number
  samples: number
  errors: number
}

async function measureOperation(name: string, operation: () => Promise<any>, samples: number = 10): Promise<LoadTestResult> {
  const times: number[] = []
  let errors = 0
  
  for (let i = 0; i < samples; i++) {
    const start = Date.now()
    try {
      await operation()
      times.push(Date.now() - start)
    } catch (error) {
      errors++
    }
  }
  
  return {
    operation: name,
    avgTime: times.reduce((a, b) => a + b, 0) / times.length,
    minTime: Math.min(...times),
    maxTime: Math.max(...times),
    samples: times.length,
    errors
  }
}

async function runLoadTests() {
  console.log('🚀 PERFORMANCE LOAD TESTING\n')
  
  const results: LoadTestResult[] = []
  
  // Test 1: Customer list query
  console.log('Testing customer list query...')
  results.push(await measureOperation('Customer List (100)', async () => {
    await supabase.from('customers').select('*').limit(100)
  }))
  
  // Test 2: Event with bookings (join)
  console.log('Testing event with bookings...')
  results.push(await measureOperation('Event + Bookings', async () => {
    await supabase
      .from('events')
      .select(`
        *,
        bookings (
          id,
          seats,
          customer:customers (
            first_name,
            last_name
          )
        )
      `)
      .limit(10)
  }))
  
  // Test 3: Customer with full history
  console.log('Testing customer full history...')
  const { data: customers } = await supabase.from('customers').select('id').limit(1)
  if (customers?.[0]) {
    results.push(await measureOperation('Customer Full History', async () => {
      await supabase
        .from('customers')
        .select(`
          *,
          bookings (*),
          messages (*),
          customer_category_stats (*)
        `)
        .eq('id', customers[0].id)
        .single()
    }))
  }
  
  // Test 4: Bulk message query
  console.log('Testing message queries...')
  results.push(await measureOperation('Messages (1000)', async () => {
    await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000)
  }))
  
  // Test 5: Complex aggregation
  console.log('Testing aggregations...')
  results.push(await measureOperation('Booking Stats', async () => {
    await supabase
      .from('bookings')
      .select('event_id, seats')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
  }))
  
  // Display results
  console.log('\n📊 PERFORMANCE TEST RESULTS:\n')
  console.log('Operation                    | Avg (ms) | Min (ms) | Max (ms) | Errors')
  console.log('----------------------------|----------|----------|----------|--------')
  
  results.forEach(result => {
    const name = result.operation.padEnd(27)
    const avg = result.avgTime.toFixed(0).padStart(8)
    const min = result.minTime.toString().padStart(8)
    const max = result.maxTime.toString().padStart(8)
    const errors = result.errors.toString().padStart(6)
    
    console.log(`${name} | ${avg} | ${min} | ${max} | ${errors}`)
  })
  
  // Identify slow queries
  console.log('\n⚠️  PERFORMANCE WARNINGS:\n')
  results.forEach(result => {
    if (result.avgTime > 1000) {
      console.log(`🔴 ${result.operation}: Average ${result.avgTime}ms (>1s threshold)`)
    } else if (result.avgTime > 500) {
      console.log(`🟠 ${result.operation}: Average ${result.avgTime}ms (>500ms threshold)`)
    } else if (result.maxTime > 1000) {
      console.log(`🟡 ${result.operation}: Max ${result.maxTime}ms (spikes >1s)`)
    }
  })
  
  // Database size check
  console.log('\n📏 DATABASE SIZE ANALYSIS:\n')
  
  const tables = ['customers', 'events', 'bookings', 'messages', 'employees']
  for (const table of tables) {
    const { count } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
    
    console.log(`  ${table}: ${count?.toLocaleString()} records`)
  }
}

runLoadTests().catch(console.error)