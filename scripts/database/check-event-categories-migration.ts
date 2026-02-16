#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const HARD_CAP = 500

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

function printList(label: string, entries: string[], limit: number) {
  console.log(label)
  const sliced = entries.slice(0, limit)
  sliced.forEach((entry) => console.log(`  - ${entry}`))
  if (entries.length > sliced.length) {
    console.log(`  ... (${entries.length - sliced.length} more)`)
  }
}

async function checkMigrationStatus() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-event-categories-migration is strictly read-only; do not pass --confirm.')
  }

  const maxPrint = parseBoundedInt({ argv, flag: '--max-print', defaultValue: 200, hardCap: HARD_CAP })
  console.log('Checking event_categories migration status...\n')
  console.log(`Max print: ${maxPrint} (hard cap ${HARD_CAP})\n`)

  const failures: string[] = []
  const supabase = createAdminClient()

  // Prefer helper RPC functions if they exist, but do not attempt to create them (read-only script).
  let columnNames: string[] | null = null
  const { data: columns, error: columnsError } = await supabase.rpc('get_table_columns', {
    table_name: 'event_categories'
  })

  if (columnsError) {
    failures.push(`get_table_columns failed: ${columnsError.message || 'unknown error'}`)
  } else {
    columnNames =
      (columns as Array<{ column_name?: unknown }> | null | undefined)
        ?.map((col) => col?.column_name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0) ?? []
  }

  if (!columnNames || columnNames.length === 0) {
    const { data: sampleRows, error: sampleError } = await supabase
      .from('event_categories')
      .select('*')
      .limit(1)

    if (sampleError) {
      failures.push(`select(event_categories.*) failed: ${sampleError.message || 'unknown error'}`)
    } else if (!sampleRows || sampleRows.length === 0) {
      failures.push('event_categories returned no rows; unable to infer column list')
    } else {
      columnNames = Object.keys(sampleRows[0] ?? {})
    }
  }

  printList('Current columns in event_categories table:', columnNames ?? [], maxPrint)

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
    const exists = Boolean(columnNames?.includes(col))
    console.log(`  - ${col}: ${exists ? 'EXISTS' : 'MISSING'}`)
  })

  const { data: constraints, error: constraintsError } = await supabase.rpc('get_table_constraints', {
    table_name: 'event_categories'
  })

  if (constraintsError) {
    failures.push(`get_table_constraints failed: ${constraintsError.message || 'unknown error'}`)
  } else {
    const constraintNames =
      (constraints as Array<{ constraint_name?: unknown }> | null | undefined)
        ?.map((c) => c?.constraint_name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0) ?? []

    console.log('')
    printList('Constraints on event_categories table:', constraintNames, maxPrint)

    const newConstraints = ['check_default_event_status', 'check_default_performer_type']
    console.log('\nNew constraints from migration:')
    newConstraints.forEach((constraint) => {
      const exists = constraintNames.includes(constraint)
      console.log(`  - ${constraint}: ${exists ? 'EXISTS' : 'MISSING'}`)
    })
  }

  const { data: indexes, error: indexesError } = await supabase.rpc('get_table_indexes', {
    table_name: 'event_categories'
  })

  if (indexesError) {
    failures.push(`get_table_indexes failed: ${indexesError.message || 'unknown error'}`)
  } else {
    const indexNames =
      (indexes as Array<{ indexname?: unknown }> | null | undefined)
        ?.map((i) => i?.indexname)
        .filter((name): name is string => typeof name === 'string' && name.length > 0) ?? []

    console.log('')
    printList('Indexes on event_categories table:', indexNames, maxPrint)

    const hasSlugIndex = indexNames.some((i) => i.includes('slug'))
    console.log(`\nSlug index present: ${hasSlugIndex ? 'yes' : 'no'}`)
  }

  if (columnNames?.includes('slug')) {
    const { data: uniqueConstraints, error: uniqueConstraintsError } = await supabase.rpc(
      'get_column_constraints',
      {
        table_name: 'event_categories',
        column_name: 'slug'
      }
    )

    if (uniqueConstraintsError) {
      failures.push(`get_column_constraints failed: ${uniqueConstraintsError.message || 'unknown error'}`)
    } else {
      const hasUniqueConstraint = (uniqueConstraints as Array<{ constraint_type?: unknown }> | null | undefined)?.some(
        (c) => c?.constraint_type === 'UNIQUE'
      )
      console.log(`Slug unique constraint present: ${hasUniqueConstraint ? 'yes' : 'no'}`)
    }
  }

  if (failures.length > 0) {
    const preview = failures.slice(0, 3).join(' | ')
    throw new Error(
      `check-event-categories-migration completed with ${failures.length} error(s): ${preview}`
    )
  }
}

void checkMigrationStatus().catch((error) => {
  markFailure('check-event-categories-migration failed.', error)
})
