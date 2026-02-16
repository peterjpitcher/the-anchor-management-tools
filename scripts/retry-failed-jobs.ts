#!/usr/bin/env tsx

/**
 * Retry failed Parse CV jobs by resetting them back to pending.
 *
 * Safety:
 * - DRY RUN by default.
 * - Mutations require explicit multi-gating (`--confirm` + RUN + ALLOW) plus an explicit `--limit` (hard cap).
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import {
  assertJobRetryMutationAllowed,
  assertJobRetryMutationSucceeded,
  isJobRetryMutationRunEnabled,
  resolveJobRetryLimit,
  resolveJobRetryRows,
} from '@/lib/job-retry-script-safety'
import { createAdminClient } from '@/lib/supabase/admin'

const SCRIPT_NAME = 'retry-failed-jobs'
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

  const { data: failedRowsRaw, error: failedRowsError, count: failedCountRaw } = await supabase
    .from('jobs')
    .select('id, type, status', { count: 'exact' })
    .eq('type', 'parse_cv')
    .eq('status', 'failed')
    .order('failed_at', { ascending: true })
    .limit(queryLimit ?? PREVIEW_LIMIT)

  const failedRows = resolveJobRetryRows({
    operation: `[${SCRIPT_NAME}] Load failed parse_cv jobs`,
    rows: failedRowsRaw as Array<{ id: string; type?: string }> | null,
    error: failedRowsError,
  })

  const totalFailed = failedCountRaw ?? failedRows.length
  console.log(`[${SCRIPT_NAME}] failed parse_cv jobs (total): ${totalFailed}`)

  if (failedRows.length === 0) {
    console.log(`[${SCRIPT_NAME}] ✅ No failed parse_cv jobs found.`)
    return
  }

  console.log(`[${SCRIPT_NAME}] preview (up to ${failedRows.length}):`)
  for (const row of failedRows.slice(0, PREVIEW_LIMIT)) {
    console.log(`- ${row.id}`)
  }

  if (!mutationEnabled) {
    console.log(`\n[${SCRIPT_NAME}] DRY RUN ok. No rows updated.`)
    console.log(`[${SCRIPT_NAME}] To retry failed jobs (dangerous), you must:`)
    console.log(`- Pass --confirm`)
    console.log(`- Pass --limit <n> (explicit cap)`)
    console.log(`- Set RUN_JOB_RETRY_MUTATION_SCRIPT=true`)
    console.log(`- Set ALLOW_JOB_RETRY_MUTATION_SCRIPT=true`)
    return
  }

  assertJobRetryMutationAllowed('retry-failed-jobs')

  const nowIso = new Date().toISOString()
  const ids = failedRows.map((row) => row.id)

  const { data: updatedRows, error: updateError } = await supabase
    .from('jobs')
    .update({
      status: 'pending',
      attempts: 0,
      result: null,
      error_message: null,
      failed_at: null,
      completed_at: null,
      scheduled_for: nowIso,
    })
    .in('id', ids)
    .select('id')

  const { updatedCount } = assertJobRetryMutationSucceeded({
    operation: `[${SCRIPT_NAME}] Retry failed parse_cv jobs`,
    error: updateError,
    updatedRows,
    expectedCount: ids.length,
  })

  console.log(`[${SCRIPT_NAME}] ✅ Failed jobs reset to pending (${updatedCount} rows).`)
  if (totalFailed > ids.length) {
    console.log(
      `[${SCRIPT_NAME}] WARNING: retried ${ids.length}/${totalFailed}. Re-run with a higher --limit to continue.`
    )
  }
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] failed`, error)
  process.exitCode = 1
})

