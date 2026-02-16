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

function parseLimit(argv: string[]): number {
  const idx = argv.indexOf('--limit')
  if (idx === -1) {
    return 20
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

async function checkCustomersAndLabels() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-customers-and-labels is strictly read-only; do not pass --confirm.')
  }

  const limit = parseLimit(argv)

  console.log('Checking customers and label assignments...\n')
  console.log(`Limit: ${limit} (hard cap ${HARD_CAP})\n`)

  const supabase = createAdminClient()

  const { count: customerCount, error: customerCountError } = await supabase
    .from('customers')
    .select('*', { count: 'exact', head: true })

  if (customerCountError) {
    markFailure('Error counting customers.', customerCountError)
    return
  }

  console.log(`Total customers: ${customerCount ?? 0}`)

  const { data: assignmentsRows, error: assignmentsError } = await supabase
    .from('customer_label_assignments')
    .select(
      `
        id,
        customer:customers(first_name, last_name),
        label:customer_labels(name, color)
      `
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  const assignments = (assertScriptQuerySucceeded({
    operation: 'Load customer label assignments (sample)',
    error: assignmentsError,
    data: assignmentsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    customer: { first_name: string | null; last_name: string | null } | null
    label: { name: string | null; color: string | null } | null
  }>

  console.log(`\nSample label assignments: ${assignments.length}`)
  assignments.forEach((row) => {
    const customerName = row.customer ? `${row.customer.first_name || ''} ${row.customer.last_name || ''}`.trim() || 'unknown' : 'unknown'
    const labelName = row.label?.name || 'unknown'
    console.log(`  - ${customerName} -> ${labelName}`)
  })

  const { data: regularLabelRow, error: regularLabelError } = await supabase
    .from('customer_labels')
    .select('id, name, color')
    .eq('name', 'Regular')
    .maybeSingle()

  if (regularLabelError) {
    markFailure('Error checking Regular label.', regularLabelError)
    return
  }

  if (!regularLabelRow) {
    markFailure('Regular label does not exist.')
    return
  }

  console.log(`\nRegular label exists (id: ${String((regularLabelRow as any).id)})`)
}

void checkCustomersAndLabels().catch((error) => {
  markFailure('check-customers-and-labels failed.', error)
})

