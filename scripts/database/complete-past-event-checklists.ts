#!/usr/bin/env tsx

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { getSupabaseAdminClient } from '../../src/lib/supabase-singleton'
import { EVENT_CHECKLIST_DEFINITIONS } from '../../src/lib/event-checklist'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function markPastEventChecklistsComplete() {
  const supabase = getSupabaseAdminClient()

  const cutoffDate = '2025-10-17'
  const completedAt = new Date().toISOString()

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, date, name')
    .lt('date', cutoffDate)

  if (eventsError) {
    console.error('Failed to load past events:', eventsError)
    process.exit(1)
  }

  if (!events || events.length === 0) {
    console.log('No past events found before cutoff date. Nothing to update.')
    return
  }

  const payload = events.flatMap(event =>
    EVENT_CHECKLIST_DEFINITIONS.map(definition => ({
      event_id: event.id,
      task_key: definition.key,
      completed_at: completedAt
    }))
  )

  const batches = chunkArray(payload, 500)
  let totalUpdated = 0

  for (const batch of batches) {
    const { error } = await supabase
      .from('event_checklist_statuses')
      .upsert(batch, { onConflict: 'event_id,task_key', ignoreDuplicates: false })

    if (error) {
      console.error('Failed to upsert checklist statuses:', error)
      process.exit(1)
    }

    totalUpdated += batch.length
  }

  console.log(`Marked ${totalUpdated} checklist tasks complete across ${events.length} events.`)
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error('Chunk size must be greater than zero')
  }
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size))
  }
  return result
}

markPastEventChecklistsComplete().catch(error => {
  console.error('Unexpected error while marking checklists complete:', error)
  process.exit(1)
})
