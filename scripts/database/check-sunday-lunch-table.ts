#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

async function checkSundayLunchTable() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-sunday-lunch-table is strictly read-only; do not pass --confirm.')
  }

  console.log('🔍 Checking sunday_lunch_menu_items table...\n')

  const supabase = createAdminClient()

  const { count, error } = await supabase
    .from('sunday_lunch_menu_items')
    .select('*', { count: 'exact', head: true })

  if (error) {
    if (error.code === '42P01') {
      markFailure('Table sunday_lunch_menu_items does not exist (migration not applied).')
      return
    }
    markFailure('Error checking sunday_lunch_menu_items table.', error)
    return
  }

  console.log('✅ Table sunday_lunch_menu_items exists')
  console.log(`   Contains ${count ?? 0} item(s)`)
}

void checkSundayLunchTable().catch((error) => {
  markFailure('check-sunday-lunch-table failed.', error)
})

