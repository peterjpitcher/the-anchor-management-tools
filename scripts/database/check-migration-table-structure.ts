#!/usr/bin/env tsx

/**
 * Migration table diagnostics (read-only).
 *
 * Safety:
 * - No DB mutations.
 * - Fails closed on unexpected query errors (non-zero exit).
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

function isFlagPresent(flag: string): boolean {
  return process.argv.includes(flag)
}

function isMissingTableError(error: { message?: string } | null): boolean {
  const message = error?.message?.toLowerCase() ?? ''
  return message.includes('does not exist') || message.includes('relation') && message.includes('does not exist')
}

async function run() {
  if (isFlagPresent('--help')) {
    console.log(`
check-migration-table-structure (read-only)

Usage:
  tsx scripts/database/check-migration-table-structure.ts
`)
    return
  }

  if (isFlagPresent('--confirm')) {
    throw new Error('check-migration-table-structure is read-only and does not support --confirm.')
  }

  console.log('🔍 Checking migration table structures (read-only)\n')

  const supabase = createAdminClient()

  const migrationTables = ['supabase_migrations', 'schema_migrations', 'migrations', '_migrations']

  for (const tableName of migrationTables) {
    console.log(`\nTable: ${tableName}`)
    console.log('='.repeat(50))

    const { count, error: countError } = await supabase
      .from(tableName)
      .select('*', { count: 'exact', head: true })

    if (countError) {
      if (isMissingTableError(countError)) {
        console.log('Not found (table does not exist).')
        continue
      }
      throw new Error(`Failed checking ${tableName}: ${countError.message || 'unknown error'}`)
    }

    console.log(`Rows: ${typeof count === 'number' ? count : 0}`)

    const { data: columns, error: columnsError } = await supabase
      .rpc('get_table_columns', { table_name: tableName })
      .select('*')

    if (!columnsError && Array.isArray(columns) && columns.length > 0) {
      console.log('Columns:')
      columns.forEach((col: any) => {
        const name = col?.column_name ?? '<unknown>'
        const type = col?.data_type ?? '<unknown>'
        console.log(`  - ${name}: ${type}`)
      })
      continue
    }

    // Fallback: infer from a sample row (if any).
    const { data: sampleRows, error: sampleError } = await supabase
      .from(tableName)
      .select('*')
      .limit(1)

    if (sampleError) {
      throw new Error(`Failed sampling ${tableName}: ${sampleError.message || 'unknown error'}`)
    }

    if (Array.isArray(sampleRows) && sampleRows.length > 0 && sampleRows[0] && typeof sampleRows[0] === 'object') {
      console.log('Columns (inferred from sample row):')
      Object.keys(sampleRows[0] as Record<string, unknown>).forEach((key) => {
        console.log(`  - ${key}`)
      })
    } else {
      console.log(
        'Table exists but has no rows; cannot infer columns without get_table_columns().'
      )
    }
  }

  console.log('\n✅ Migration table diagnostics complete.')
}

// Run the check
run()
  .catch((error) => markFailure('check-migration-table-structure failed', error))
