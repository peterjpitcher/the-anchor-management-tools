#!/usr/bin/env tsx

/**
 * Process a bounded batch of pending jobs.
 *
 * Safety:
 * - DRY RUN by default (prints a preflight summary only).
 * - Mutations require explicit multi-gating (`--confirm` + RUN + ALLOW) plus an explicit `--limit` (hard cap).
 * - Send-type jobs require an additional explicit guard.
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { jobQueue } from '@/lib/unified-job-queue'
import {
  assertProcessJobsMutationAllowed,
  assertProcessJobsRunEnabled,
  assertProcessJobsSendTypesAllowed,
  resolveProcessJobsBatchSize,
  resolveProcessJobsPendingRows,
} from '@/lib/process-jobs-script-safety'

const SCRIPT_NAME = 'process-jobs'
const HARD_CAP = 100

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

function findFlagValue(argv: string[], flag: string): string | null {
  const withEqualsPrefix = `${flag}=`
  for (let i = 0; i < argv.length; i += 1) {
    const entry = argv[i]
    if (entry === flag) {
      const next = argv[i + 1]
      return typeof next === 'string' ? next : null
    }
    if (typeof entry === 'string' && entry.startsWith(withEqualsPrefix)) {
      return entry.slice(withEqualsPrefix.length)
    }
  }
  return null
}

function findFirstPositional(argv: string[]): string | null {
  for (const entry of argv) {
    if (!entry.startsWith('--')) {
      return entry
    }
  }
  return null
}

type Args = {
  confirm: boolean
  dryRun: boolean
  limitRaw: string | null
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  const confirm = rest.includes('--confirm')
  const dryRun = !confirm || rest.includes('--dry-run')
  const limitRaw = findFlagValue(rest, '--limit') ?? findFirstPositional(rest) ?? null
  return { confirm, dryRun, limitRaw }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)

  if (!args.dryRun) {
    if (!args.confirm) {
      throw new Error(`[${SCRIPT_NAME}] mutation blocked: missing --confirm`)
    }
    if (!args.limitRaw && !process.env.PROCESS_JOBS_BATCH_SIZE) {
      throw new Error(`[${SCRIPT_NAME}] mutation requires --limit <n> (hard cap ${HARD_CAP})`)
    }
  }

  const batchSize = resolveProcessJobsBatchSize(args.limitRaw ?? process.env.PROCESS_JOBS_BATCH_SIZE)
  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()

  const { data: pendingRowsData, error: pendingRowsError } = await supabase
    .from('jobs')
    .select('id, type')
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(batchSize)

  const pendingRows = resolveProcessJobsPendingRows({
    operation: `[${SCRIPT_NAME}] Load pending jobs preflight (limit=${batchSize})`,
    rows: pendingRowsData as Array<{ id: string; type: string }> | null,
    error: pendingRowsError,
  })

  if (pendingRows.length === 0) {
    console.log(`[${SCRIPT_NAME}] No pending jobs ready to process.`)
    return
  }

  const sendTypeJobs = pendingRows.filter((row) => row.type === 'send_sms' || row.type === 'send_bulk_sms')
  if (args.dryRun) {
    console.log(`[${SCRIPT_NAME}] ready jobs=${pendingRows.length} (limit=${batchSize})`)
    if (sendTypeJobs.length > 0) {
      const preview = sendTypeJobs.slice(0, 3).map((row) => `${row.type}:${row.id}`).join(', ')
      console.log(
        `[${SCRIPT_NAME}] NOTE: pending send-type jobs detected (${sendTypeJobs.length}; ${preview}). Mutation mode will require ALLOW_PROCESS_JOBS_SEND_TYPES=true.`
      )
    }

    console.log(`\n[${SCRIPT_NAME}] DRY RUN ok. No jobs processed.`)
    console.log(`[${SCRIPT_NAME}] To process jobs (dangerous), you must:`)
    console.log(`- Pass --confirm`)
    console.log(`- Provide --limit <n> (hard cap ${HARD_CAP}) or set PROCESS_JOBS_BATCH_SIZE`)
    console.log(`- Set RUN_PROCESS_JOBS_MUTATION=true`)
    console.log(`- Set ALLOW_PROCESS_JOBS_MUTATION=true`)
    if (sendTypeJobs.length > 0) {
      console.log(`- Set ALLOW_PROCESS_JOBS_SEND_TYPES=true (send job override)`)
    }
    return
  }

  assertProcessJobsRunEnabled()
  assertProcessJobsMutationAllowed()
  assertProcessJobsSendTypesAllowed(pendingRows)

  console.log(`[${SCRIPT_NAME}] Processing next batch (limit=${batchSize}, ready=${pendingRows.length})...`)
  await jobQueue.processJobs(batchSize)
  console.log(`[${SCRIPT_NAME}] ✅ Batch complete.`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] failed`, error)
  process.exitCode = 1
})

