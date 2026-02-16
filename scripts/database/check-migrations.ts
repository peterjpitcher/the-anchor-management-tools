#!/usr/bin/env tsx

import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { createAdminClient } from '../../src/lib/supabase/admin'

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

async function checkMigrations() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-migrations is strictly read-only; do not pass --confirm.')
  }

  const limit = parseBoundedInt({ argv, flag: '--limit', defaultValue: 50, hardCap: HARD_CAP })
  const localLimit = parseBoundedInt({ argv, flag: '--local-limit', defaultValue: 50, hardCap: 500 })

  console.log('Checking applied database migrations...\n')
  console.log(`Limit: ${limit} (hard cap ${HARD_CAP})`)
  console.log(`Local file limit: ${localLimit} (hard cap 500)\n`)

  const supabase = createAdminClient()

  console.log('Querying supabase_migrations table...\n')
  const migrations = await loadMigrations({
    supabase,
    table: 'supabase_migrations',
    limit
  })

  if (migrations.ok) {
    if (migrations.rows.length === 0) {
      console.log('No rows returned from supabase_migrations.')
    } else {
      console.log(`Found ${migrations.rows.length} row(s) in supabase_migrations (limited).`)
      displayMigrations(migrations.rows)
    }
  } else {
    console.log('supabase_migrations query failed; trying schema_migrations...\n')
    const alt = await loadMigrations({
      supabase,
      table: 'schema_migrations',
      limit
    })

    if (!alt.ok) {
      throw new Error(`Could not query migrations tables: ${alt.errorMessage}`)
    }

    if (alt.rows.length === 0) {
      console.log('No rows returned from schema_migrations.')
    } else {
      console.log(`Found ${alt.rows.length} row(s) in schema_migrations (limited).`)
      displayMigrations(alt.rows)
    }
  }

  console.log('\nLocal migration files:\n')
  const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations')
  if (!fs.existsSync(migrationsDir)) {
    console.log('- No supabase/migrations directory found.')
    return
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()

  console.log(`- supabase/migrations: ${files.length} .sql file(s)`)
  files.slice(0, localLimit).forEach((file) => console.log(`  - ${file}`))
  if (files.length > localLimit) {
    console.log(`  ... (${files.length - localLimit} more)`)
  }

  const alreadyRunDir = path.join(migrationsDir, 'already run')
  if (fs.existsSync(alreadyRunDir)) {
    const alreadyRunFiles = fs
      .readdirSync(alreadyRunDir)
      .filter((file) => file.endsWith('.sql'))
      .sort()

    console.log(`\n- supabase/migrations/already run: ${alreadyRunFiles.length} .sql file(s)`)
    alreadyRunFiles.slice(0, localLimit).forEach((file) => console.log(`  - ${file}`))
    if (alreadyRunFiles.length > localLimit) {
      console.log(`  ... (${alreadyRunFiles.length - localLimit} more)`)
    }
  }
}

async function loadMigrations(params: {
  supabase: ReturnType<typeof createAdminClient>
  table: string
  limit: number
}): Promise<{ ok: true; rows: any[] } | { ok: false; errorMessage: string }> {
  const ordered = await params.supabase
    .from(params.table)
    .select('*')
    .order('inserted_at', { ascending: true })
    .limit(params.limit)

  if (!ordered.error) {
    return { ok: true, rows: ordered.data ?? [] }
  }

  if (ordered.error.message?.includes('column') && ordered.error.message?.includes('does not exist')) {
    const plain = await params.supabase.from(params.table).select('*').limit(params.limit)
    if (plain.error) {
      return { ok: false, errorMessage: plain.error.message || 'unknown error' }
    }
    return { ok: true, rows: plain.data ?? [] }
  }

  return { ok: false, errorMessage: ordered.error.message || 'unknown error' }
}

function formatDate(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return 'unknown'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }
  return date.toISOString()
}

function displayMigrations(migrations: any[]) {
  console.log('Migration Name                                          | Applied At')
  console.log('------------------------------------------------------|---------------------------')

  migrations.forEach((migration) => {
    const name = String(migration?.name || migration?.version || 'unknown')
    const appliedAt = migration?.inserted_at ?? migration?.executed_at ?? migration?.created_at ?? null
    const formattedDate = formatDate(appliedAt)

    console.log(`${name.slice(0, 54).padEnd(54)} | ${formattedDate}`)
  })

  console.log(`\nTotal migrations displayed: ${migrations.length}`)
}

void checkMigrations().catch((error) => {
  markFailure('check-migrations failed.', error)
})
