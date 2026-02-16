#!/usr/bin/env tsx

/**
 * Critical flow smoke checks (read-only).
 *
 * Safety note:
 * - Strictly read-only and blocks `--confirm`.
 * - Fails closed with non-zero exit when any smoke check fails.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'test-critical-flows'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL

interface TestResult {
  flow: string
  test: string
  status: 'pass' | 'fail'
  error?: string
}

async function runTests() {
  if (process.argv.includes('--confirm')) {
    throw new Error('This script is read-only and does not support --confirm.')
  }

  const supabase = createAdminClient()
  const results: TestResult[] = []

  async function testFlow(flow: string, test: string, testFn: () => Promise<void>) {
    try {
      await testFn()
      results.push({ flow, test, status: 'pass' })
      console.log(`OK ${flow} - ${test}`)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      results.push({ flow, test, status: 'fail', error: message })
      console.log(`FAIL ${flow} - ${test}: ${message}`)
    }
  }

  async function assertTableReadable(table: string, columns: string): Promise<void> {
    const { count, error } = await supabase
      .from(table as never)
      .select(columns, { head: true, count: 'exact' })

    assertScriptQuerySucceeded({
      operation: `${table} lookup`,
      error,
      data: { count },
      allowMissing: true,
    })
  }

  console.log('Critical flow smoke checks (read-only)\n')

  // 1. Authentication Flow
  console.log('\n1) Authentication Flow:')
  
  await testFlow('Auth', 'Unauthenticated access blocked', async () => {
    if (!APP_URL) {
      throw new Error('NEXT_PUBLIC_APP_URL is required for auth smoke checks')
    }

    const response = await fetch(`${APP_URL}/api/cron/reminders`, {
      headers: { 'x-cron-secret': 'wrong-key' }
    })
    if (response.status !== 401) throw new Error(`Expected 401, got ${response.status}`)
  })

  // 2. Customer Management Flow
  console.log('\n2) Customer Management:')
  
  await testFlow('Customer', 'Customers table readable', async () => {
    await assertTableReadable('customers', 'id, mobile_number, sms_opt_in')
  })

  // 3. Event Management Flow
  console.log('\n3) Event Management:')
  
  await testFlow('Event', 'Events table readable', async () => {
    await assertTableReadable('events', 'id, name, date, capacity, event_status')
  })

  // 4. Booking Flow
  console.log('\n4) Booking Management:')
  
  await testFlow('Booking', 'Bookings table readable', async () => {
    await assertTableReadable('bookings', 'id, event_id, customer_id, seats, status, created_at')
  })

  // 5. Message/SMS Flow
  console.log('\n5) SMS Messaging:')
  
  await testFlow('SMS', 'Messages table readable', async () => {
    await assertTableReadable('messages', 'id, customer_id, direction, to_number, twilio_status, created_at')
  })

  await testFlow('SMS', 'Idempotency table readable (distributed dedupe)', async () => {
    await assertTableReadable('idempotency_keys', 'key, request_hash, expires_at')
  })

  // 6. Private Bookings Flow
  console.log('\n6) Private Bookings:')
  
  await testFlow('Private Booking', 'Private bookings table readable', async () => {
    await assertTableReadable('private_bookings', 'id, customer_id, customer_name, contact_phone, status, created_at')
  })

  // 7. Permission/RBAC Flow
  console.log('\n7) Role-Based Access Control:')
  
  await testFlow('RBAC', 'Check permission function exists', async () => {
    const { data, error } = await supabase.rpc('user_has_permission', {
      p_user_id: '00000000-0000-0000-0000-000000000000',
      p_resource: 'events',
      p_action: 'view'
    })
    
    if (error) {
      if (error.code === '42883') {
        throw new Error('user_has_permission function not found')
      }
    }

    assertScriptQuerySucceeded({
      operation: 'user_has_permission RPC',
      error,
      data,
      allowMissing: true,
    })
  })

  // 8. Job Queue Schema
  console.log('\n8) Job Queue Schema:')

  await testFlow('Jobs', 'Jobs table has lease/token columns (prevents double-processing)', async () => {
    await assertTableReadable('jobs', 'id, status, processing_token, lease_expires_at, last_heartbeat_at')
  })

  // Summary
  console.log('\nSummary:')
  const passed = results.filter(r => r.status === 'pass').length
  const failed = results.filter(r => r.status === 'fail').length
  
  console.log(`  Passed: ${passed}`)
  console.log(`  Failed: ${failed}`)
  console.log(`  Success rate: ${Math.round((passed / results.length) * 100)}%`)
  
  if (failed > 0) {
    console.log('\nFailed tests:')
    results.filter(r => r.status === 'fail').forEach(r => {
      console.log(`  - ${r.flow}: ${r.test}`)
      console.log(`    Error: ${r.error}`)
    })
    process.exitCode = 1
  }
}

runTests().catch((error: unknown) => {
  console.error(`[${SCRIPT_NAME}] Fatal error:`, error)
  process.exitCode = 1
})
