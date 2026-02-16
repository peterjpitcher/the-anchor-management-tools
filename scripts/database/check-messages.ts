#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

function readCustomerIdArg(argv: string[]): string | null {
  const idx = argv.indexOf('--customer-id')
  if (idx !== -1) {
    const next = argv[idx + 1]
    return typeof next === 'string' && next.trim().length > 0 ? next.trim() : null
  }

  const [, , maybeId] = argv
  return typeof maybeId === 'string' && maybeId.trim().length > 0 ? maybeId.trim() : null
}

async function checkMessages() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-messages is strictly read-only; do not pass --confirm.')
  }

  const customerId = readCustomerIdArg(argv)
  const supabase = createAdminClient()

  console.log('=== Message Diagnostic Tool ===')
  console.log('Usage: tsx scripts/database/check-messages.ts [--customer-id <id>] (or positional <id>)\n')

  const { data: messagesRows, error } = await supabase
    .from('messages')
    .select(
      'id, direction, customer_id, body, twilio_status, created_at, from_number, to_number'
    )
    .order('created_at', { ascending: false })
    .limit(20)

  const messages = (assertScriptQuerySucceeded({
    operation: 'Load recent messages',
    error,
    data: messagesRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    direction: string | null
    customer_id: string | null
    body: string | null
    twilio_status: string | null
    created_at: string
    from_number: string | null
    to_number: string | null
  }>

  console.log(`Found ${messages.length} recent message(s)\n`)

  const inbound = messages.filter((m) => m.direction === 'inbound')
  const outbound = messages.filter((m) => m.direction === 'outbound')

  console.log(`Inbound: ${inbound.length}`)
  console.log(`Outbound: ${outbound.length}`)

  const missingDirection = messages.filter((m) => !m.direction)
  const missingCustomerId = messages.filter((m) => !m.customer_id)

  if (missingDirection.length > 0) {
    markFailure(`${missingDirection.length} messages missing direction field`)
  }

  if (missingCustomerId.length > 0) {
    markFailure(`${missingCustomerId.length} messages missing customer_id`)
  }

  console.log('\nSample messages:')
  messages.slice(0, 5).forEach((msg) => {
    console.log(`\n--- Message ${msg.id} ---`)
    console.log(`Direction: ${msg.direction || 'MISSING'}`)
    console.log(`Customer ID: ${msg.customer_id || 'MISSING'}`)
    console.log(`Body: ${(msg.body || '').substring(0, 50)}...`)
    console.log(`Status: ${msg.twilio_status || 'unknown'}`)
    console.log(`Created: ${new Date(msg.created_at).toLocaleString('en-GB')}`)
    console.log(`From: ${msg.from_number || 'N/A'}`)
    console.log(`To: ${msg.to_number || 'N/A'}`)
  })

  if (!customerId) {
    return
  }

  console.log(`\n\nChecking messages for customer ${customerId}...`)
  const { data: customerMessagesRows, error: customerError } = await supabase
    .from('messages')
    .select('id, direction, body, twilio_status, created_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: true })

  const customerMessages = (assertScriptQuerySucceeded({
    operation: `Load messages for customer ${customerId}`,
    error: customerError,
    data: customerMessagesRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    direction: string | null
    body: string | null
    twilio_status: string | null
    created_at: string
  }>

  console.log(`Found ${customerMessages.length} message(s) for this customer`)
  customerMessages.forEach((msg) => {
    const prefix = msg.direction === 'inbound' ? '← IN ' : '→ OUT'
    console.log(`\n${prefix}${new Date(msg.created_at).toLocaleString('en-GB')}`)
    console.log(`   ${(msg.body || '').substring(0, 100)}${(msg.body || '').length > 100 ? '...' : ''}`)
    console.log(`   Status: ${msg.twilio_status || 'unknown'}`)
  })
}

void checkMessages().catch((error) => {
  markFailure('check-messages failed.', error)
})
