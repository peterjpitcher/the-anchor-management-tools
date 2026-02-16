#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptCompletedWithoutFailures } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`ERROR: ${message}`, error)
    return
  }
  console.error(`ERROR: ${message}`)
}

function isMissingColumnError(message: string): boolean {
  return message.includes('column') && message.includes('does not exist')
}

async function checkCurrentSchema() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-schema-env is strictly read-only; do not pass --confirm.')
  }

  console.log('Checking current database schema (env)...\n')
  const supabase = createAdminClient()

  const failures: string[] = []

  async function checkColumn(table: string, column: string): Promise<'EXISTS' | 'MISSING' | 'ERROR'> {
    const { error } = await supabase.from(table).select(column).limit(1)
    if (!error) {
      return 'EXISTS'
    }

    const message = error.message || 'unknown error'
    if (isMissingColumnError(message)) {
      return 'MISSING'
    }

    failures.push(`${table}.${column}: ${message}`)
    return 'ERROR'
  }

  console.log('Events table:')
  for (const column of [
    'image_url',
    'hero_image_url',
    'image_urls',
    'gallery_image_urls',
    'poster_image_url',
    'thumbnail_image_url'
  ]) {
    const result = await checkColumn('events', column)
    console.log(`- ${column}: ${result}`)
  }

  console.log('\nEvent categories table:')
  for (const column of ['faqs', 'image_url']) {
    const result = await checkColumn('event_categories', column)
    console.log(`- ${column}: ${result}`)
  }

  console.log('\nPrivate bookings table:')
  for (const column of [
    'customer_name',
    'customer_first_name',
    'source',
    'special_requirements',
    'accessibility_needs'
  ]) {
    const result = await checkColumn('private_bookings', column)
    console.log(`- ${column}: ${result}`)
  }

  console.log('\nProfiles table:')
  for (const column of ['sms_notifications', 'email_notifications']) {
    const result = await checkColumn('profiles', column)
    console.log(`- ${column}: ${result}`)
  }

  console.log('\nMenu items table:')
  console.log(`- image_url: ${await checkColumn('menu_items', 'image_url')}`)

  assertScriptCompletedWithoutFailures({
    scriptName: 'check-schema-env',
    failureCount: failures.length,
    failures
  })
}

void checkCurrentSchema().catch((error) => {
  markFailure('check-schema-env failed.', error)
})
