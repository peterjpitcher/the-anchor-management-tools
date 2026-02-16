#!/usr/bin/env tsx

import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'
import dotenv from 'dotenv'
import { resolve } from 'path'

const SCRIPT_NAME = 'check-failed-jobs'
const DEFAULT_LIMIT = 20
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

function parsePositiveLimit(raw: string | null, label: string): number {
  if (!raw || raw.trim().length === 0) {
    return DEFAULT_LIMIT
  }

  const normalized = raw.trim()
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`[${SCRIPT_NAME}] Invalid ${label} "${raw}". Provide a positive integer.`)
  }

  const parsed = Number.parseInt(normalized, 10)
  if (parsed > HARD_LIMIT_CAP) {
    throw new Error(
      `[${SCRIPT_NAME}] ${label} ${parsed} exceeds hard cap ${HARD_LIMIT_CAP}. Run in smaller batches.`
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

  const limitRaw = findFlagValue(rest, '--limit') ?? process.env.CHECK_FAILED_JOBS_LIMIT ?? null
  return {
    limit: parsePositiveLimit(limitRaw, 'limit'),
  }
}

type BackgroundJobRow = {
  id: string
  type: string
  status: string
  created_at: string
  attempts: number | null
  max_attempts: number | null
  error: string | null
  payload: unknown
}

async function main() {
  dotenv.config({ path: resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)

  console.log(`[${SCRIPT_NAME}] Checking failed jobs in background_jobs table (limit=${args.limit})`)

  const supabase = createAdminClient()

  const { data: failedJobsData, error: failedJobsError } = await supabase
    .from('background_jobs')
    .select('*')
    .eq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(args.limit)

  const failedJobs = (assertScriptQuerySucceeded({
    operation: `[${SCRIPT_NAME}] Load failed background jobs`,
    error: failedJobsError,
    data: failedJobsData,
  }) ?? []) as BackgroundJobRow[]

  if (!failedJobs || failedJobs.length === 0) {
    console.log(`[${SCRIPT_NAME}] No failed jobs found`)
  } else {
    console.log(`[${SCRIPT_NAME}] Found ${failedJobs.length} failed job(s):`)

    failedJobs.forEach((job, index) => {
      console.log(`\n${index + 1}. Job ID: ${job.id}`)
      console.log(`   Type: ${job.type}`)
      console.log(`   Status: ${job.status}`)
      console.log(`   Created: ${new Date(job.created_at).toLocaleString()}`)
      console.log(`   Attempts: ${job.attempts}/${job.max_attempts}`)
      console.log(`   Error: ${job.error}`)
      console.log(`   Payload:`)
      console.log(JSON.stringify(job.payload, null, 4))
    })
  }

  console.log(`\n[${SCRIPT_NAME}] Checking pending jobs with attempts > 0...`)
  const { data: attemptedJobsData, error: attemptedError } = await supabase
    .from('background_jobs')
    .select('*')
    .eq('status', 'pending')
    .gt('attempts', 0)
    .order('created_at', { ascending: false })
    .limit(args.limit)

  const attemptedJobs = (assertScriptQuerySucceeded({
    operation: `[${SCRIPT_NAME}] Load pending background jobs with attempts > 0`,
    error: attemptedError,
    data: attemptedJobsData,
  }) ?? []) as BackgroundJobRow[]

  if (attemptedJobs && attemptedJobs.length > 0) {
    console.log(`Found ${attemptedJobs.length} job(s) with failed attempts:\n`)
    attemptedJobs.forEach((job, index) => {
      console.log(`\n${index + 1}. Job ID: ${job.id}`)
      console.log(`   Type: ${job.type}`)
      console.log(`   Attempts: ${job.attempts}/${job.max_attempts}`)
      console.log(`   Last error: ${job.error || 'No error message'}`)
    })
  } else {
    console.log('No pending jobs with failed attempts')
  }

  console.log(`\n[${SCRIPT_NAME}] Environment check:`)
  console.log(
    `   TWILIO_ACCOUNT_SID: ${
      process.env.TWILIO_ACCOUNT_SID ? `Set (${process.env.TWILIO_ACCOUNT_SID.substring(0, 6)}...)` : 'NOT SET'
    }`
  )
  console.log(`   TWILIO_AUTH_TOKEN: ${process.env.TWILIO_AUTH_TOKEN ? 'Set' : 'NOT SET'}`)
  console.log(`   TWILIO_PHONE_NUMBER: ${process.env.TWILIO_PHONE_NUMBER || 'NOT SET'}`)
}

void main().catch((error) => {
  markFailure('check-failed-jobs failed.', error)
})
