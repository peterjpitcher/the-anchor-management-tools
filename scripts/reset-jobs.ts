#!/usr/bin/env tsx

/**
 * Reschedule pending jobs to run now.
 *
 * Safety:
 * - DRY RUN by default.
 * - Mutations require explicit multi-gating (`--confirm` + RUN + ALLOW) plus an explicit `--limit` (hard cap).
 * - If selected rows include send-type jobs, an additional guard is required.
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import {
  assertJobRetryMutationAllowed,
  assertJobRetryMutationSucceeded,
  assertJobRetrySendTypesAllowed,
  isJobRetryMutationRunEnabled,
  resolveJobRetryLimit,
  resolveJobRetryRows,
} from '@/lib/job-retry-script-safety'
import { createAdminClient } from '@/lib/supabase/admin'

const SCRIPT_NAME = 'reset-jobs'
const PREVIEW_LIMIT = 20

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const hasConfirmFlag = argv.includes('--confirm')
  const hasDryRunFlag = argv.includes('--dry-run')
  const mutationEnabled = isJobRetryMutationRunEnabled(process.argv)

  if (hasConfirmFlag && !mutationEnabled && !hasDryRunFlag) {
    throw new Error(`[${SCRIPT_NAME}] --confirm requires RUN_JOB_RETRY_MUTATION_SCRIPT=true (or pass --dry-run).`)
  }

  const supabase = createAdminClient()
  const limit = resolveJobRetryLimit(process.argv)
  const queryLimit = mutationEnabled ? limit : PREVIEW_LIMIT

  if (mutationEnabled && limit === null) {
    throw new Error(`[${SCRIPT_NAME}] mutation requires --limit <n>`)
  }

  console.log(`[${SCRIPT_NAME}] ${mutationEnabled ? 'MUTATION' : 'DRY RUN'} starting`)

  const { data: pendingRowsRaw, error: pendingRowsError, count: pendingCountRaw } = await supabase
    .from('jobs')
    .select('id, type, scheduled_for', { count: 'exact' })
    .eq('status', 'pending')
    .order('scheduled_for', { ascending: true })
    .limit(queryLimit ?? PREVIEW_LIMIT)

  const pendingRows = resolveJobRetryRows({
    operation: `[${SCRIPT_NAME}] Load pending jobs`,
    rows: pendingRowsRaw as Array<{ id: string; type?: string }> | null,
    error: pendingRowsError,
  })

  const totalPending = pendingCountRaw ?? pendingRows.length
  console.log(`[${SCRIPT_NAME}] pending jobs (total): ${totalPending}`)

  if (pendingRows.length === 0) {
    console.log(`[${SCRIPT_NAME}] ✅ No pending jobs found.`)
    return
  }

  console.log(`[${SCRIPT_NAME}] preview (up to ${pendingRows.length}):`)
  for (const row of pendingRows.slice(0, PREVIEW_LIMIT)) {
    console.log(`- ${row.id} :: ${row.type || 'unknown'} :: ${String((row as any).scheduled_for || 'N/A')}`)
  }

  if (!mutationEnabled) {
    console.log(`\n[${SCRIPT_NAME}] DRY RUN ok. No rows updated.`)
    console.log(`[${SCRIPT_NAME}] To reschedule jobs (dangerous), you must:`)
    console.log(`- Pass --confirm`)
    console.log(`- Pass --limit <n> (explicit cap)`)
    console.log(`- Set RUN_JOB_RETRY_MUTATION_SCRIPT=true`)
    console.log(`- Set ALLOW_JOB_RETRY_MUTATION_SCRIPT=true`)
    console.log(
      `- If the selected rows include send jobs, also set ALLOW_JOB_RETRY_SEND_TYPES=true`
    )
    return
  }

  assertJobRetryMutationAllowed('reset-jobs')
  assertJobRetrySendTypesAllowed('reset-jobs', pendingRows)

  const nowIso = new Date().toISOString()
  const ids = pendingRows.map((row) => row.id)

  const { data: updatedRows, error: updateError } = await supabase
    .from('jobs')
    .update({ scheduled_for: nowIso })
    .in('id', ids)
    .select('id')

  const { updatedCount } = assertJobRetryMutationSucceeded({
    operation: `[${SCRIPT_NAME}] Reschedule pending jobs`,
    error: updateError,
    updatedRows,
    expectedCount: ids.length,
  })

  console.log(`[${SCRIPT_NAME}] ✅ Rescheduled ${updatedCount} job(s) to now.`)
  if (totalPending > ids.length) {
    console.log(
      `[${SCRIPT_NAME}] WARNING: rescheduled ${ids.length}/${totalPending}. Re-run with a higher --limit to continue.`
    )
  }
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] failed`, error)
  process.exitCode = 1
})

