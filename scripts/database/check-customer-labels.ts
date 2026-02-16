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

async function checkCustomerLabels() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-customer-labels is strictly read-only; do not pass --confirm.')
  }

  const supabase = createAdminClient()

  console.log('=== Checking Customer Labels Status ===\n')

  const { data: labelsRows, error: labelsError } = await supabase
    .from('customer_labels')
    .select('id, name, color, description')
    .order('name', { ascending: true })

  if (labelsError) {
    const code = (labelsError as { code?: string } | null)?.code
    if (code === '42P01') {
      markFailure('Customer labels table does not exist.')
      console.log('\nTo create the customer labels system:')
      console.log('1. Go to Supabase Dashboard > SQL Editor')
      console.log('2. Run the migration at: supabase/migrations/20250706160000_add_customer_labels.sql')
      console.log('3. Then run this script again to verify')
      return
    }

    throw new Error(`Load customer_labels failed: ${labelsError.message || 'unknown database error'}`)
  }

  const labels = (assertScriptQuerySucceeded({
    operation: 'Load customer labels',
    error: null,
    data: labelsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{ id: string; name: string | null; color: string | null; description: string | null }>

  console.log('✅ Customer labels table exists')

  if (labels.length > 0) {
    console.log(`\nFound ${labels.length} label(s):`)
    labels.forEach((label) => {
      console.log(`  - ${label.name || 'unknown'} (${label.color || 'no_color'})`)
      if (label.description) {
        console.log(`    ${label.description}`)
      }
    })
  } else {
    console.log('\n⚠️  No labels found in the database')
    console.log('The table exists but has no default labels.')
  }

  const { count, error: assignmentsError } = await supabase
    .from('customer_label_assignments')
    .select('*', { count: 'exact', head: true })

  if (assignmentsError) {
    const code = (assignmentsError as { code?: string } | null)?.code
    if (code === '42P01') {
      markFailure('Customer label assignments table does not exist.')
      return
    }
    throw new Error(
      `Load customer_label_assignments failed: ${assignmentsError.message || 'unknown database error'}`
    )
  }

  console.log(`\n✅ Customer label assignments table exists (${count || 0} assignment(s))`)

  if (process.exitCode === 1) {
    console.log('\n❌ Customer labels check completed with failures.')
  } else {
    console.log('\n✅ Customer labels check complete!')
  }
}

void checkCustomerLabels().catch((error) => {
  markFailure('check-customer-labels failed.', error)
})
