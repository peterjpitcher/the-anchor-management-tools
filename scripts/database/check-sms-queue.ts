#!/usr/bin/env tsx

import { config } from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'check-sms-queue'

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`[${SCRIPT_NAME}] ${message}`, error)
    return
  }
  console.error(`[${SCRIPT_NAME}] ${message}`)
}

async function checkSmsQueue() {
  if (process.argv.includes('--confirm')) {
    throw new Error('check-sms-queue is read-only and does not support --confirm.')
  }

  const supabase = createAdminClient()

  console.log('Checking sms_queue diagnostics...')

  const { data: queueRows, error: queueError } = await supabase
    .from('sms_queue')
    .select('id, status, trigger_type, created_at, sent_at, error_message')
    .order('created_at', { ascending: false })
    .limit(20)

  const recentQueueRows = (assertScriptQuerySucceeded({
    operation: 'Load recent sms_queue rows',
    error: queueError,
    data: queueRows ?? [],
    allowMissing: true,
  }) ?? []) as Array<{
    id: string
    status: string | null
    trigger_type: string | null
    created_at: string | null
    sent_at: string | null
    error_message: string | null
  }>

  console.log(`Loaded ${recentQueueRows.length} recent sms_queue rows`)
  if (recentQueueRows.length > 0) {
    console.table(
      recentQueueRows.map((row) => ({
        id: row.id,
        status: row.status || 'unknown',
        trigger_type: row.trigger_type || 'unknown',
        created_at: row.created_at || 'unknown',
        sent_at: row.sent_at || 'n/a',
        error_message: row.error_message || '',
      }))
    )
  }

  const statuses = ['pending', 'approved', 'sent', 'failed', 'cancelled'] as const
  const statusCounts: Record<string, number> = {}

  for (const status of statuses) {
    const { count, error } = await supabase
      .from('sms_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', status)

    assertScriptQuerySucceeded({
      operation: `Load sms_queue count for status=${status}`,
      error,
      data: count ?? 0,
      allowMissing: true,
    })

    statusCounts[status] = count || 0
  }

  console.table(
    Object.entries(statusCounts).map(([status, count]) => ({
      status,
      count,
    }))
  )

  if (process.exitCode === 1) {
    console.log('sms_queue diagnostics completed with failures.')
  } else {
    console.log('sms_queue diagnostics complete.')
  }
}

void checkSmsQueue().catch((error) => {
  markFailure('check-sms-queue failed.', error)
})
