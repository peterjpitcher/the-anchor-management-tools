#!/usr/bin/env tsx

import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'
import dotenv from 'dotenv'
import path from 'path'

const SCRIPT_NAME = 'check-job-tables'
const DEFAULT_LIMIT = 10
const HARD_LIMIT_CAP = 200

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`[${SCRIPT_NAME}] ❌ ${message}`, error)
    return
  }
  console.error(`[${SCRIPT_NAME}] ❌ ${message}`)
}

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

function parsePositiveLimit(raw: string | null): number {
  if (!raw || raw.trim().length === 0) {
    return DEFAULT_LIMIT
  }

  const normalized = raw.trim()
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`[${SCRIPT_NAME}] Invalid --limit "${raw}". Provide a positive integer.`)
  }

  const parsed = Number.parseInt(normalized, 10)
  if (parsed > HARD_LIMIT_CAP) {
    throw new Error(
      `[${SCRIPT_NAME}] --limit ${parsed} exceeds hard cap ${HARD_LIMIT_CAP}. Run in smaller batches.`
    )
  }

  return parsed
}

type Args = {
  limit: number
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)

  if (rest.includes('--confirm')) {
    throw new Error(`[${SCRIPT_NAME}] This script is read-only and does not support --confirm.`)
  }

  if (rest.includes('--help')) {
    console.log(`${SCRIPT_NAME} (read-only)\n`)
    console.log('Usage:')
    console.log(`  tsx scripts/database/${SCRIPT_NAME}.ts [--limit <n>]`)
    console.log('')
    console.log('Options:')
    console.log(`  --limit <n>   Number of rows to inspect per query (default ${DEFAULT_LIMIT}, hard cap ${HARD_LIMIT_CAP})`)
    return { limit: DEFAULT_LIMIT }
  }

  const limitRaw = findFlagValue(rest, '--limit') ?? process.env.CHECK_JOB_TABLES_LIMIT ?? null
  return {
    limit: parsePositiveLimit(limitRaw),
  }
}

type Row = Record<string, unknown>

function unwrapReadResult<T>(params: {
  operation: string
  data: T[] | null
  error: { message?: string } | null
  failureMessage: string
}): T[] | null {
  try {
    return (assertScriptQuerySucceeded({
      operation: params.operation,
      error: params.error,
      data: params.data,
    }) ?? []) as T[]
  } catch (error) {
    markFailure(params.failureMessage, error)
    return null
  }
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
  const args = parseArgs(process.argv)
  const supabase = createAdminClient()

  console.log(`[${SCRIPT_NAME}] JOB TABLES ANALYSIS (limit=${args.limit})\n`)

  const { data: jobQueueDataRaw, error: jobQueueError } = await supabase
    .from('job_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(args.limit)

  const jobQueueData = unwrapReadResult<Row>({
    operation: `[${SCRIPT_NAME}] Load job_queue sample rows`,
    data: jobQueueDataRaw as Row[] | null,
    error: jobQueueError,
    failureMessage: 'job_queue table: NOT FOUND or ERROR',
  })

  if (jobQueueData) {
    console.log('job_queue table exists')
    console.log(`   Recent records: ${jobQueueData.length}`)
    if (jobQueueData.length > 0) {
      console.log('   Sample record:', JSON.stringify(jobQueueData[0], null, 2))
    }
  }

  console.log('\n')

  const { data: bgJobsDataRaw, error: bgJobsError } = await supabase
    .from('background_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(args.limit)

  const bgJobsData = unwrapReadResult<Row>({
    operation: `[${SCRIPT_NAME}] Load background_jobs sample rows`,
    data: bgJobsDataRaw as Row[] | null,
    error: bgJobsError,
    failureMessage: 'background_jobs table: NOT FOUND or ERROR',
  })

  if (bgJobsData) {
    console.log('background_jobs table exists')
    console.log(`   Recent records: ${bgJobsData.length}`)
    if (bgJobsData.length > 0) {
      console.log('   Sample record:', JSON.stringify(bgJobsData[0], null, 2))
    }
  }

  console.log('\n')

  const { data: jobsDataRaw, error: jobsError } = await supabase
    .from('jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(args.limit)

  const jobsData = unwrapReadResult<Row>({
    operation: `[${SCRIPT_NAME}] Load jobs sample rows`,
    data: jobsDataRaw as Row[] | null,
    error: jobsError,
    failureMessage: 'jobs table: NOT FOUND or ERROR',
  })

  if (jobsData) {
    console.log('jobs table exists')
    console.log(`   Recent records: ${jobsData.length}`)
    if (jobsData.length > 0) {
      console.log('   Sample record:', JSON.stringify(jobsData[0], null, 2))
    }
  }

  console.log('\nCHECKING FOR BULK SMS JOBS\n')

  const { data: pendingJobQueueRaw, error: pendingJobQueueError } = await supabase
    .from('job_queue')
    .select('*')
    .eq('type', 'send_bulk_sms')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(args.limit)

  const pendingJobQueue = unwrapReadResult<Row>({
    operation: `[${SCRIPT_NAME}] Load pending send_bulk_sms rows from job_queue`,
    data: pendingJobQueueRaw as Row[] | null,
    error: pendingJobQueueError,
    failureMessage: 'Error checking pending bulk SMS jobs in job_queue.',
  })

  if (pendingJobQueue && pendingJobQueue.length > 0) {
    console.log(`Found ${pendingJobQueue.length} pending bulk SMS jobs in job_queue`);
  }

  const { data: pendingBgJobsRaw, error: pendingBgJobsError } = await supabase
    .from('background_jobs')
    .select('*')
    .eq('type', 'send_bulk_sms')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(args.limit)

  const pendingBgJobs = unwrapReadResult<Row>({
    operation: `[${SCRIPT_NAME}] Load pending send_bulk_sms rows from background_jobs`,
    data: pendingBgJobsRaw as Row[] | null,
    error: pendingBgJobsError,
    failureMessage: 'Error checking pending bulk SMS jobs in background_jobs.',
  })

  if (pendingBgJobs && pendingBgJobs.length > 0) {
    console.log(`Found ${pendingBgJobs.length} pending bulk SMS jobs in background_jobs`)
  }

  const { data: pendingJobsRaw, error: pendingJobsError } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'send_bulk_sms')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(args.limit)

  const pendingJobs = unwrapReadResult<Row>({
    operation: `[${SCRIPT_NAME}] Load pending send_bulk_sms rows from jobs`,
    data: pendingJobsRaw as Row[] | null,
    error: pendingJobsError,
    failureMessage: 'Error checking pending bulk SMS jobs in jobs.',
  })

  if (pendingJobs && pendingJobs.length > 0) {
    console.log(`Found ${pendingJobs.length} pending bulk SMS jobs in jobs`)
  }
}

void main().catch((error) => {
  markFailure('check-job-tables failed.', error)
})
