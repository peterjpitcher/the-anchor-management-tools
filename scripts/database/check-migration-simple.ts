#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const HARD_CAP = 5000

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

async function checkMigrationStatus() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-migration-simple is strictly read-only; do not pass --confirm.')
  }

  const checkNullSlugs = argv.includes('--check-null-slugs')
  const checkDuplicateSlugs = argv.includes('--check-duplicate-slugs')
  const maxSlugs = parseBoundedInt({ argv, flag: '--max-slugs', defaultValue: 500, hardCap: HARD_CAP })
  const nullSlugSample = parseBoundedInt({ argv, flag: '--null-slug-sample', defaultValue: 20, hardCap: 200 })

  console.log('Checking event_categories migration status (simple)...\n')
  console.log(`Check NULL slugs: ${checkNullSlugs ? 'yes' : 'no'}`)
  console.log(`Check duplicate slugs: ${checkDuplicateSlugs ? 'yes' : 'no'}`)
  console.log(`Max slugs for duplicate scan: ${maxSlugs} (hard cap ${HARD_CAP})`)
  console.log(`NULL slug sample limit: ${nullSlugSample} (hard cap 200)\n`)

  const supabase = createAdminClient()

  const { data: sample, error: sampleError } = await supabase
    .from('event_categories')
    .select('*')
    .limit(1)

  if (sampleError) {
    throw new Error(`Load sample event_categories row failed: ${sampleError.message || 'unknown error'}`)
  }

  if (!sample || sample.length === 0) {
    console.log('No event categories found in the database.')
    return
  }

  const record = sample[0] as Record<string, unknown>
  const columns = Object.keys(record)
  console.log(`Columns found (${columns.length}):`)
  columns.forEach((col) => console.log(`  - ${col}`))

  const newColumns = [
    'default_end_time',
    'default_price',
    'default_is_free',
    'default_performer_type',
    'default_event_status',
    'slug',
    'meta_description'
  ]

  console.log('\nNew columns from migration:')
  newColumns.forEach((col) => {
    const exists = columns.includes(col)
    console.log(`  - ${col}: ${exists ? 'EXISTS' : 'MISSING'}`)
  })

  if (!columns.includes('slug')) {
    console.log('\nSlug checks skipped: slug column not present.')
    return
  }

  if (checkNullSlugs) {
    const { count: nullCount, error: nullCountError } = await supabase
      .from('event_categories')
      .select('*', { count: 'exact', head: true })
      .is('slug', null)

    if (nullCountError) {
      throw new Error(`Count NULL slugs failed: ${nullCountError.message || 'unknown error'}`)
    }

    console.log(`\nCategories with NULL slugs: ${typeof nullCount === 'number' ? String(nullCount) : 'unknown'}`)

    const { data: nullRows, error: nullRowsError } = await supabase
      .from('event_categories')
      .select('id, name')
      .is('slug', null)
      .limit(nullSlugSample)

    if (nullRowsError) {
      throw new Error(`Load NULL slug sample failed: ${nullRowsError.message || 'unknown error'}`)
    }

    const rows = (nullRows ?? []) as Array<{ id?: unknown; name?: unknown }>
    if (rows.length > 0) {
      console.log('Sample categories needing slugs:')
      rows.forEach((row) => console.log(`  - ${String(row.name || 'unknown')} (id=${String(row.id || 'unknown')})`))
    }
  }

  if (checkDuplicateSlugs) {
    const { count: slugCount, error: slugCountError } = await supabase
      .from('event_categories')
      .select('*', { count: 'exact', head: true })
      .not('slug', 'is', null)

    if (slugCountError) {
      throw new Error(`Count non-null slugs failed: ${slugCountError.message || 'unknown error'}`)
    }

    if (typeof slugCount !== 'number') {
      throw new Error('Duplicate slug scan refused: unable to determine slug row count.')
    }

    if (slugCount > maxSlugs) {
      throw new Error(
        `Duplicate slug scan refused: ${slugCount} non-null slugs exceeds --max-slugs ${maxSlugs} (hard cap ${HARD_CAP}). Use a SQL group-by query instead.`
      )
    }

    const { data: allSlugs, error: allSlugsError } = await supabase
      .from('event_categories')
      .select('slug')
      .not('slug', 'is', null)
      .limit(maxSlugs)

    if (allSlugsError) {
      throw new Error(`Load slugs failed: ${allSlugsError.message || 'unknown error'}`)
    }

    const slugs = (allSlugs ?? []) as Array<{ slug?: unknown }>
    if (slugs.length !== slugCount) {
      throw new Error(`Duplicate slug scan truncated: fetched ${slugs.length} of ${slugCount}. Increase --max-slugs (up to hard cap ${HARD_CAP}).`)
    }

    const slugCounts = new Map<string, number>()
    slugs.forEach((row) => {
      const slug = typeof row.slug === 'string' ? row.slug : String(row.slug || '')
      if (!slug) {
        return
      }
      slugCounts.set(slug, (slugCounts.get(slug) ?? 0) + 1)
    })

    const duplicates = Array.from(slugCounts.entries()).filter(([, count]) => count > 1)
    if (duplicates.length === 0) {
      console.log('\nNo duplicate slugs found.')
      return
    }

    console.log(`\nDuplicate slugs found (${duplicates.length}):`)
    duplicates.forEach(([slug, count]) => console.log(`  - ${slug}: ${count}`))
  }

  console.log('\nConstraint/index checks skipped (read-only script).')
}

void checkMigrationStatus().catch((error) => {
  markFailure('check-migration-simple failed.', error)
})
