#!/usr/bin/env tsx

import { createAdminClient } from '../../src/lib/supabase/admin'
import dotenv from 'dotenv'
import path from 'path'

const SCRIPT_NAME = 'check-events-table'

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`[${SCRIPT_NAME}] ❌ ${message}`, error)
    return
  }
  console.error(`[${SCRIPT_NAME}] ❌ ${message}`)
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const supabase = createAdminClient()

  console.log('=== Checking Events Table Structure ===\n')

  // Get a sample event to see its structure
  const { data: events, error } = await (supabase.from('events') as any).select('*').limit(1)

  if (error) {
    markFailure('Error fetching events.', error)
    return
  }

  if (events && events.length > 0) {
    console.log('Sample event columns:')
    console.log(Object.keys(events[0]))
    console.log('\nSample event data:')
    console.log(JSON.stringify(events[0], null, 2))
  } else {
    console.log('No events found')
    markFailure('Expected at least one event row.')
  }

  if (process.exitCode === 1) {
    console.log('\n❌ Events table check completed with failures.')
  } else {
    console.log('\n✅ Events table check complete!')
  }
}

void main().catch((error) => {
  markFailure('check-events-table failed.', error)
})

