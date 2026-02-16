#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

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

function parseLimit(argv: string[]): number {
  const idx = argv.indexOf('--limit')
  if (idx === -1) {
    return 10
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

async function checkCurrentSchema() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-current-schema is strictly read-only; do not pass --confirm.')
  }

  const limit = parseLimit(argv)

  console.log('Checking current database schema...\n')
  console.log(`Limit: ${limit} (hard cap ${HARD_CAP})\n`)

  const supabase = createAdminClient()

  console.log('1) events table:')
  let eventsColumns: string[] | null = null
  const { data: eventsSchema, error: eventsSchemaError } = await supabase.rpc('get_table_columns', {
    table_name: 'events'
  })

  if (eventsSchemaError) {
    markFailure('get_table_columns(events) failed; falling back to sample-row inference.', eventsSchemaError)
  } else {
    eventsColumns = (eventsSchema as Array<{ column_name?: unknown }> | null | undefined)
      ?.map((row) => (typeof row?.column_name === 'string' ? row.column_name : null))
      .filter((name): name is string => typeof name === 'string' && name.length > 0) ?? []
  }

  if (!eventsColumns || eventsColumns.length === 0) {
    const { data: sampleRows, error: sampleError } = await supabase.from('events').select('*').limit(1)
    if (sampleError) {
      markFailure('Failed to load events sample row for schema inference.', sampleError)
    } else if (sampleRows && sampleRows.length > 0) {
      eventsColumns = Object.keys(sampleRows[0] ?? {})
    } else {
      markFailure('events returned no rows; unable to infer column list.')
    }
  }

  const eventsCols = eventsColumns ?? []
  const imageCols = eventsCols.filter((col) => col.includes('image'))
  console.log(`Found ${eventsCols.length} event column(s). Image-related: ${imageCols.length}`)
  imageCols.slice(0, 50).forEach((col) => console.log(`  - ${col}`))

  const hasImageUrl = eventsCols.includes('image_url')
  const hasHeroImageUrl = eventsCols.includes('hero_image_url')
  if (!hasImageUrl) {
    markFailure('events.image_url column is missing.')
  }
  if (!hasHeroImageUrl) {
    markFailure('events.hero_image_url column is missing.')
  }

  console.log('\n2) schema migrations:')
  const { data: migrationsRows, error: migrationsError } = await supabase
    .from('schema_migrations')
    .select('*')
    .order('version', { ascending: false })
    .limit(limit)

  if (migrationsError) {
    markFailure('schema_migrations query failed; trying supabase_migrations.', migrationsError)
    const { data: supabaseMigrationsRows, error: supabaseMigrationsError } = await supabase
      .from('supabase_migrations')
      .select('*')
      .order('inserted_at', { ascending: false })
      .limit(limit)

    if (supabaseMigrationsError) {
      markFailure('supabase_migrations query failed.', supabaseMigrationsError)
    } else {
      const rows = (supabaseMigrationsRows ?? []) as Array<Record<string, unknown>>
      console.log(`Loaded ${rows.length} supabase migration row(s) in sample.`)
    }
  } else {
    const rows = (migrationsRows ?? []) as Array<Record<string, unknown>>
    console.log(`Loaded ${rows.length} schema migration row(s) in sample.`)
  }

  console.log('\n3) event_categories.faqs column:')
  const { error: faqsError } = await supabase.from('event_categories').select('faqs').limit(1)
  if (faqsError) {
    markFailure('event_categories.faqs probe failed (column missing or query error).', faqsError)
  } else {
    console.log('event_categories.faqs exists')
  }

  console.log('\n4) private_bookings customer name fields:')
  const { error: customerNameError } = await supabase.from('private_bookings').select('customer_name').limit(1)
  if (customerNameError) {
    markFailure('private_bookings.customer_name probe failed.', customerNameError)
  } else {
    console.log('private_bookings.customer_name exists')
  }

  const { error: firstNameError } = await supabase
    .from('private_bookings')
    .select('customer_first_name')
    .limit(1)
  if (firstNameError) {
    markFailure('private_bookings.customer_first_name probe failed.', firstNameError)
  } else {
    console.log('private_bookings.customer_first_name exists')
  }
}

void checkCurrentSchema().catch((error) => {
  markFailure('check-current-schema failed.', error)
})

