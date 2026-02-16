#!/usr/bin/env tsx

import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptCompletedWithoutFailures } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const HARD_CAP = 50

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`ERROR: ${message}`, error)
    return
  }
  console.error(`ERROR: ${message}`)
}

function parseBoundedInt(params: {
  argv: string[]
  flag: string
  defaultValue: number
  hardCap: number
}): number {
  const idx = params.argv.indexOf(params.flag)
  if (idx === -1) {
    return params.defaultValue
  }

  const raw = params.argv[idx + 1]
  const parsed = Number.parseInt(raw || '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${params.flag} must be a positive integer (got '${raw || ''}')`)
  }
  if (parsed > params.hardCap) {
    throw new Error(`${params.flag} too high (got ${parsed}, hard cap ${params.hardCap})`)
  }
  return parsed
}

function safeJsonPreview(value: unknown, maxLen: number): string {
  try {
    const json = JSON.stringify(value)
    if (typeof json !== 'string' || json.length === 0) {
      return ''
    }
    return json.length > maxLen ? `${json.slice(0, maxLen)}...` : json
  } catch {
    return '[unserializable]'
  }
}

async function checkMigrationHistory() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-migration-history is strictly read-only; do not pass --confirm.')
  }

  const sampleLimit = parseBoundedInt({ argv, flag: '--sample-limit', defaultValue: 10, hardCap: HARD_CAP })
  const includeCounts = argv.includes('--include-counts')
  const localLimit = parseBoundedInt({ argv, flag: '--local-limit', defaultValue: 50, hardCap: 500 })

  console.log('Checking migration history...\n')
  console.log(`Sample limit: ${sampleLimit} (hard cap ${HARD_CAP})`)
  console.log(`Include counts: ${includeCounts ? 'yes (estimated)' : 'no'}`)
  console.log(`Local file limit: ${localLimit} (hard cap 500)\n`)

  const failures: string[] = []
  const supabase = createAdminClient()

  const migrationTables = ['supabase_migrations', 'schema_migrations', 'migrations', '_migrations']

  console.log('1. Migration tracking tables:')
  for (const table of migrationTables) {
    const { error: countError, count } = includeCounts
      ? await supabase.from(table).select('*', { count: 'estimated', head: true })
      : { error: null as { message?: string } | null, count: null as number | null }

    if (countError) {
      failures.push(`Count ${table} failed: ${countError.message || 'unknown error'}`)
      console.log(`  - ${table}: ERROR`)
      continue
    }

    const countSuffix = includeCounts ? ` (estimated count: ${typeof count === 'number' ? String(count) : 'unknown'})` : ''
    console.log(`  - ${table}: OK${countSuffix}`)

    const { data: sampleRows, error: sampleError } = await supabase.from(table).select('*').limit(sampleLimit)
    if (sampleError) {
      failures.push(`Load ${table} sample failed: ${sampleError.message || 'unknown error'}`)
      continue
    }

    const rows = (sampleRows ?? []) as unknown[]
    if (rows.length === 0) {
      continue
    }

    console.log(`    sample (${rows.length}):`)
    rows.forEach((row) => {
      console.log(`      - ${safeJsonPreview(row, 400)}`)
    })
  }

  console.log('\n2. Local migration files:')
  const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations')
  if (!fs.existsSync(migrationsDir)) {
    console.log('  - No supabase/migrations directory found.')
  } else {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort()

    console.log(`  - supabase/migrations: ${files.length} .sql file(s)`)
    files.slice(0, localLimit).forEach((file) => console.log(`    - ${file}`))
    if (files.length > localLimit) {
      console.log(`    ... (${files.length - localLimit} more)`)
    }

    const alreadyRunDir = path.join(migrationsDir, 'already run')
    if (fs.existsSync(alreadyRunDir)) {
      const alreadyRunFiles = fs
        .readdirSync(alreadyRunDir)
        .filter((file) => file.endsWith('.sql'))
        .sort()

      console.log(`\n  - supabase/migrations/already run: ${alreadyRunFiles.length} .sql file(s)`)
      alreadyRunFiles.slice(0, localLimit).forEach((file) => console.log(`    - ${file}`))
      if (alreadyRunFiles.length > localLimit) {
        console.log(`    ... (${alreadyRunFiles.length - localLimit} more)`)
      }
    }
  }

  console.log('\n3. Key tables (existence checks):')
  const keyTables = ['events', 'customers', 'bookings', 'employees', 'private_bookings', 'event_categories', 'audit_logs']
  for (const table of keyTables) {
    const { data, error } = await supabase.from(table).select('id').limit(1)
    if (error) {
      failures.push(`Check table ${table} failed: ${error.message || 'unknown error'}`)
      console.log(`  - ${table}: ERROR`)
      continue
    }
    const rows = (data ?? []) as Array<{ id?: unknown }>
    console.log(`  - ${table}: OK${rows.length > 0 ? ' (has rows)' : ' (no rows returned)'}`)
  }

  assertScriptCompletedWithoutFailures({
    scriptName: 'check-migration-history',
    failureCount: failures.length,
    failures
  })
}

void checkMigrationHistory().catch((error) => {
  markFailure('check-migration-history failed.', error)
})
