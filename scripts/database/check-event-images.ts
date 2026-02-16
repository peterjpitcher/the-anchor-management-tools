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

function resolveEventId(argv: string[]): string | null {
  const idx = argv.indexOf('--event-id')
  if (idx !== -1) {
    return argv[idx + 1] || null
  }

  const positional = argv[2]
  if (positional && !positional.startsWith('-')) {
    return positional
  }

  return null
}

async function checkEventImages() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-event-images is strictly read-only; do not pass --confirm.')
  }

  const eventId = resolveEventId(argv)
  if (!eventId) {
    throw new Error(
      'Missing event id. Usage: tsx scripts/database/check-event-images.ts --event-id <uuid> (or pass as first arg).'
    )
  }

  console.log('Checking event image fields...\n')
  console.log(`Event ID: ${eventId}\n`)

  const supabase = createAdminClient()

  const { data: eventRow, error: eventError } = await supabase
    .from('events')
    .select('id, name, hero_image_url, thumbnail_image_url, poster_image_url, created_at')
    .eq('id', eventId)
    .maybeSingle()

  if (eventError) {
    markFailure('Error fetching event row.', eventError)
    return
  }

  if (!eventRow) {
    markFailure(`No event found for id '${eventId}'.`)
    return
  }

  console.log('Event (selected fields):')
  console.log(JSON.stringify(eventRow, null, 2))

  console.log('\nImage-related columns in events table (sample row inference):')
  const { data: sampleRows, error: sampleError } = await supabase.from('events').select('*').limit(1)

  const sample = (assertScriptQuerySucceeded({
    operation: 'Load events sample row',
    error: sampleError,
    data: sampleRows ?? [],
    allowMissing: true
  }) ?? []) as Array<Record<string, unknown>>

  if (sample.length === 0) {
    markFailure('events returned no rows; unable to infer image column list.')
  } else {
    const keys = Object.keys(sample[0] ?? {}).filter((key) => key.toLowerCase().includes('image'))
    keys.forEach((key) => console.log(`  - ${key}`))
  }

  console.log('\nSample event category image fields:')
  const { data: categoryRow, error: categoryError } = await supabase
    .from('event_categories')
    .select('id, name, image_url, default_image_url')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const category = assertScriptQuerySucceeded({
    operation: 'Load event_categories sample row',
    error: categoryError,
    data: categoryRow,
    allowMissing: true
  })

  if (category) {
    console.log(JSON.stringify(category, null, 2))
  } else {
    console.log('(no event categories found)')
  }
}

void checkEventImages().catch((error) => {
  markFailure('check-event-images failed.', error)
})

