#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

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

function parseLimit(argv: string[]): number {
  const idx = argv.indexOf('--limit')
  if (idx === -1) {
    return 50
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

async function checkVenueSpaces() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-venue-spaces is strictly read-only; do not pass --confirm.')
  }

  const limit = parseLimit(argv)

  console.log('Checking venue spaces in database...\n')
  console.log(`Limit: ${limit} (hard cap ${HARD_CAP})\n`)

  const supabase = createAdminClient()

  const { count: totalCount, error: countError } = await supabase
    .from('venue_spaces')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  if (countError) {
    markFailure('Failed to count active venue spaces.', countError)
    return
  }

  const { data: spacesRows, error: spacesError } = await supabase
    .from('venue_spaces')
    .select('id, name, capacity, description')
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(limit)

  const spaces = (assertScriptQuerySucceeded({
    operation: 'Load active venue spaces (sample)',
    error: spacesError,
    data: spacesRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    name: string | null
    capacity: number | null
    description: string | null
  }>

  if (spaces.length === 0) {
    console.log('No active venue spaces found in database')
    return
  }

  console.log(`Found ${spaces.length} active venue space(s) in sample (total active: ${totalCount ?? 0}):\n`)
  spaces.forEach((space, index) => {
    console.log(`${index + 1}. ${space.name || space.id}`)
    if (typeof space.capacity === 'number') {
      console.log(`   Capacity: ${space.capacity} guests`)
    }
    if (space.description) {
      console.log(`   Description: ${space.description}`)
    }
    console.log('')
  })

  if ((totalCount ?? 0) > limit) {
    console.log(`WARNING: Active venue spaces exceed sample limit (${totalCount} > ${limit}).`)
  }
}

void checkVenueSpaces().catch((error) => {
  markFailure('check-venue-spaces failed.', error)
})
