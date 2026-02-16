#!/usr/bin/env tsx

import { createAdminClient } from '../../src/lib/supabase/admin'
import dotenv from 'dotenv'
import path from 'path'

const SCRIPT_NAME = 'check-customers-table'

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`[${SCRIPT_NAME}] ❌ ${message}`, error)
    return
  }
  console.error(`[${SCRIPT_NAME}] ❌ ${message}`)
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const supabase = createAdminClient()

  console.log('=== Checking Customers Table Structure ===\n')

  // Get a sample customer to see its structure
  const { data: customers, error } = await (supabase.from('customers') as any).select('*').limit(1)

  if (error) {
    markFailure('Error fetching customers.', error)
    return
  }

  if (customers && customers.length > 0) {
    console.log('Sample customer columns:')
    console.log(Object.keys(customers[0]))
    console.log('\nSample customer data (partial):')
    const sample = customers[0]
    console.log({
      id: sample.id,
      first_name: sample.first_name,
      last_name: sample.last_name,
      mobile_number: sample.mobile_number,
      sms_opt_in: sample.sms_opt_in,
    })
    console.log(`\nType of first_name: ${typeof sample.first_name}`)
    console.log(`Type of last_name: ${typeof sample.last_name}`)
  } else {
    console.log('No customers found')
    markFailure('Expected at least one customer row.')
  }

  if (process.exitCode === 1) {
    console.log('\n❌ Customers table check completed with failures.')
  } else {
    console.log('\n✅ Customers table check complete!')
  }
}

void main().catch((error) => {
  markFailure('check-customers-table failed.', error)
})

