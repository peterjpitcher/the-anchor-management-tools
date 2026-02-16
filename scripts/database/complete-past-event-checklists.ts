#!/usr/bin/env tsx

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { EVENT_CHECKLIST_DEFINITIONS } from '../../src/lib/event-checklist'
import {
  assertCompletePastEventChecklistsEventLimit,
  assertCompletePastEventChecklistsMutationAllowed,
  isCompletePastEventChecklistsMutationEnabled,
  readCompletePastEventChecklistsCutoffDate,
  readCompletePastEventChecklistsEventLimit,
  readCompletePastEventChecklistsOffset
} from '../../src/lib/complete-past-event-checklists-script-safety'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function markPastEventChecklistsComplete() {
  const argv = process.argv
  const confirm = argv.includes('--confirm')
  const mutationEnabled = isCompletePastEventChecklistsMutationEnabled(argv, process.env)

  const HARD_CAP_EVENTS = 200
  const HARD_CAP_ROWS = 5000

  if (argv.includes('--help')) {
    console.log(`
complete-past-event-checklists (safe by default)

Dry-run (default):
  tsx scripts/database/complete-past-event-checklists.ts

Mutation mode (requires multi-gating + explicit caps):
  RUN_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION=true \\
  ALLOW_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION_SCRIPT=true \\
    tsx scripts/database/complete-past-event-checklists.ts --confirm \\
      --event-limit 50 [--offset 0] [--cutoff-date 2025-10-17]

Notes:
  - --event-limit is required in mutation mode (hard cap ${HARD_CAP_EVENTS}).
  - In dry-run mode the script only reports what would be updated.
`)
    return
  }

  if (confirm && !mutationEnabled && !argv.includes('--dry-run')) {
    throw new Error(
      'complete-past-event-checklists received --confirm but RUN_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION is not enabled. Set RUN_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION=true and ALLOW_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION_SCRIPT=true to apply updates.'
    )
  }

  if (mutationEnabled) {
    assertCompletePastEventChecklistsMutationAllowed()
  }

  const supabase = createAdminClient()

  const cutoffDate = readCompletePastEventChecklistsCutoffDate(argv, process.env)
  const completedAt = new Date().toISOString()
  const modeLabel = mutationEnabled ? 'MUTATION' : 'DRY-RUN'

  console.log(`Marking past event checklists complete (${modeLabel})`)
  console.log(`Cutoff date (event.date < cutoff): ${cutoffDate}`)
  console.log(`Checklist tasks per event: ${EVENT_CHECKLIST_DEFINITIONS.length}`)
  console.log('')

  if (!mutationEnabled) {
    const { count: eventCount, error: countError } = await supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .lt('date', cutoffDate)

    if (countError) {
      throw new Error(`Failed counting past events: ${countError.message || 'unknown error'}`)
    }

    const totalEvents = typeof eventCount === 'number' ? eventCount : 0
    const totalTasks = totalEvents * EVENT_CHECKLIST_DEFINITIONS.length

    console.log(`Past events matching cutoff: ${totalEvents}`)
    console.log(`Checklist tasks to upsert: ${totalTasks}`)

    const { data: sampleEvents, error: sampleError } = await supabase
      .from('events')
      .select('id, date, name')
      .lt('date', cutoffDate)
      .order('date', { ascending: false })
      .limit(5)

    if (sampleError) {
      throw new Error(
        `Failed sampling past events: ${sampleError.message || 'unknown error'}`
      )
    }

    if (Array.isArray(sampleEvents) && sampleEvents.length > 0) {
      console.log('\nSample past events:')
      sampleEvents.forEach((event: any) => {
        console.log(`- ${event.date ?? '<unknown date>'}: ${event.name ?? event.id}`)
      })
    }

    console.log('\nDry-run mode: no checklist rows were updated.')
    console.log(
      'To mutate, pass --confirm + --event-limit, and set RUN_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION=true and ALLOW_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION_SCRIPT=true.'
    )
    return
  }

  const eventLimit = assertCompletePastEventChecklistsEventLimit(
    readCompletePastEventChecklistsEventLimit(argv, process.env),
    HARD_CAP_EVENTS
  )
  const offset = readCompletePastEventChecklistsOffset(argv, process.env) ?? 0
  const rangeStart = offset
  const rangeEnd = offset + eventLimit - 1

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, date, name')
    .lt('date', cutoffDate)
    .order('date', { ascending: false })
    .range(rangeStart, rangeEnd)

  if (eventsError) {
    throw new Error(`Failed to load past events: ${eventsError.message || 'unknown error'}`)
  }

  if (!events || events.length === 0) {
    console.log('No past events found in the selected window. Nothing to update.')
    return
  }

  const totalRows = events.length * EVENT_CHECKLIST_DEFINITIONS.length
  if (totalRows > HARD_CAP_ROWS) {
    throw new Error(
      `Refusing to upsert ${totalRows} rows (exceeds hard cap ${HARD_CAP_ROWS}). Reduce --event-limit and retry.`
    )
  }

  const payload = events.flatMap(event =>
    EVENT_CHECKLIST_DEFINITIONS.map(definition => ({
      event_id: event.id,
      task_key: definition.key,
      completed_at: completedAt
    }))
  )

  const batches = chunkArray(payload, 250)
  let totalUpdated = 0

  for (const batch of batches) {
    const { error } = await supabase
      .from('event_checklist_statuses')
      .upsert(batch, { onConflict: 'event_id,task_key', ignoreDuplicates: false })

    if (error) {
      throw new Error(`Failed to upsert checklist statuses: ${error.message || 'unknown error'}`)
    }

    totalUpdated += batch.length
  }

  console.log(`✅ Marked ${totalUpdated} checklist tasks complete across ${events.length} events.`)
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
  console.error('complete-past-event-checklists failed:', error)
  process.exitCode = 1
})
