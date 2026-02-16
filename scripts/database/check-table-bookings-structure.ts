#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`ERROR: ${message}`, error)
    return
  }
  console.error(`ERROR: ${message}`)
}

async function checkTableBookingsStructure() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-table-bookings-structure is strictly read-only; do not pass --confirm.')
  }

  const showSample = argv.includes('--show-sample')

  console.log('Checking table_bookings structure (sample row)...\n')
  console.log(`Show sample payload: ${showSample ? 'yes' : 'no'}\n`)

  const supabase = createAdminClient()

  const { data: sampleRows, error: sampleError } = await supabase.from('table_bookings').select('*').limit(1)

  const rows = (assertScriptQuerySucceeded({
    operation: 'Load table_bookings sample row',
    error: sampleError,
    data: sampleRows ?? [],
    allowMissing: true
  }) ?? []) as Array<Record<string, unknown>>

  if (rows.length === 0) {
    console.log('No rows found in table_bookings.')
    return
  }

  const sample = rows[0] ?? {}
  console.log('Columns:')
  Object.keys(sample).forEach((key) => {
    const value = sample[key]
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
    console.log(`  - ${key}: ${type}`)
  })

  if (showSample) {
    console.log('\nSample row (may contain PII):')
    console.log(JSON.stringify(sample, null, 2))
  } else {
    console.log('\nUse --show-sample to print the sample row payload.')
  }
}

void checkTableBookingsStructure().catch((error) => {
  markFailure('check-table-bookings-structure failed.', error)
})

