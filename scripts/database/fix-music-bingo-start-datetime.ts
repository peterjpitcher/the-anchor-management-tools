#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const TARGET_EVENT_ID = '89f35974-94f7-4faa-810a-14cc6daa4ef2'

async function main() {
  const db = createAdminClient()

  // Verify current state
  const { data: before } = await db
    .from('events')
    .select('id, name, date, time, start_datetime')
    .eq('id', TARGET_EVENT_ID)
    .single()

  if (!before) {
    console.error('Event not found')
    return
  }

  console.log('BEFORE:')
  console.log(`  date: ${before.date}`)
  console.log(`  time: ${before.time}`)
  console.log(`  start_datetime: ${before.start_datetime}`)

  // Correct start_datetime: April 24 at 20:00 London time
  // April 24 2026 is during BST, so UTC = 19:00
  const correctedStartDatetime = '2026-04-24T19:00:00+00:00'

  console.log(`\nCorrecting to: ${correctedStartDatetime}`)
  console.log('(2026-04-24 20:00 BST = 2026-04-24 19:00 UTC)')

  const { data: after, error } = await db
    .from('events')
    .update({ start_datetime: correctedStartDatetime })
    .eq('id', TARGET_EVENT_ID)
    .select('id, name, date, time, start_datetime')
    .single()

  if (error) {
    console.error('Update failed:', error)
    return
  }

  console.log('\nAFTER:')
  console.log(`  date: ${after.date}`)
  console.log(`  time: ${after.time}`)
  console.log(`  start_datetime: ${after.start_datetime}`)
  console.log('\nDone. SMS will now show "Fri 24 Apr, 8:00 pm"')
}

main().catch(console.error)
