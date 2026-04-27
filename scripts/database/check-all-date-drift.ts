#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function main() {
  const db = createAdminClient()

  // Check ALL events where date and start_datetime disagree
  const { data: events, error } = await db
    .from('events')
    .select('id, name, date, time, start_datetime')
    .not('start_datetime', 'is', null)
    .not('date', 'is', null)
    .order('date', { ascending: true })

  if (error) {
    console.error('Query failed:', error)
    return
  }

  const mismatches = (events || []).filter(e => {
    if (!e.start_datetime || !e.date) return false
    const sdDate = e.start_datetime.substring(0, 10)
    return sdDate !== e.date
  })

  console.log(`Total events checked: ${events?.length}`)
  console.log(`Mismatches found: ${mismatches.length}\n`)

  for (const e of mismatches) {
    console.log(`*** ${e.name}`)
    console.log(`    date: ${e.date} | time: ${e.time}`)
    console.log(`    start_datetime: ${e.start_datetime}`)
    console.log()
  }

  if (mismatches.length === 0) {
    console.log('No mismatches found.')
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
