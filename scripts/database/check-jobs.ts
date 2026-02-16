#!/usr/bin/env tsx

import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'
import dotenv from 'dotenv'
import path from 'path'

const SCRIPT_NAME = 'check-jobs'
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

  const limitRaw = findFlagValue(rest, '--limit') ?? process.env.CHECK_JOBS_LIMIT ?? null
  return {
    limit: parsePositiveLimit(limitRaw),
  }
}

type JobRow = {
  id: string
  type: string
  status: string
  created_at: string
  error?: string | null
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
  const args = parseArgs(process.argv)

  const supabase = createAdminClient()

  console.log(`[${SCRIPT_NAME}] JOB SYSTEM ANALYSIS (limit=${args.limit})`)

  const { data: recentJobsData, error: recentJobsError } = await (supabase.from('jobs') as any)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(args.limit)

  const recentJobs = (assertScriptQuerySucceeded({
    operation: `[${SCRIPT_NAME}] Load recent jobs`,
    error: recentJobsError,
    data: recentJobsData,
  }) ?? []) as JobRow[]

  const jobCount = recentJobs.length
  console.log(`Found ${jobCount} recent jobs`)

  const statusCounts: Record<string, number> = {}
  const typeCounts: Record<string, number> = {}

  recentJobs.forEach((job) => {
    statusCounts[job.status] = (statusCounts[job.status] || 0) + 1
    typeCounts[job.type] = (typeCounts[job.type] || 0) + 1
  })

  console.log('\nJob Status Distribution:')
  Object.entries(statusCounts).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`)
  })

  console.log('\nJob Type Distribution:')
  Object.entries(typeCounts).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`)
  })

  const { data: failedBulkJobsData, error: failedBulkError } = await (supabase.from('jobs') as any)
    .select('*')
    .eq('type', 'send_bulk_sms')
    .eq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(args.limit)

  const failedBulkJobs = (assertScriptQuerySucceeded({
    operation: `[${SCRIPT_NAME}] Load failed send_bulk_sms jobs`,
    error: failedBulkError,
    data: failedBulkJobsData,
  }) ?? []) as JobRow[]

  if (failedBulkJobs && failedBulkJobs.length > 0) {
    console.log('\nFailed bulk SMS jobs found:')
    failedBulkJobs.forEach((job) => {
      console.log(`  - ID: ${job.id}, Created: ${job.created_at}`)
      if (job.error) console.log(`    Error: ${job.error}`)
    })
  }

  const { data: pendingBulkJobsData, error: pendingBulkError } = await (supabase.from('jobs') as any)
    .select('*')
    .eq('type', 'send_bulk_sms')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(args.limit)

  const pendingBulkJobs = (assertScriptQuerySucceeded({
    operation: `[${SCRIPT_NAME}] Load pending send_bulk_sms jobs`,
    error: pendingBulkError,
    data: pendingBulkJobsData,
  }) ?? []) as JobRow[]

  if (pendingBulkJobs && pendingBulkJobs.length > 0) {
    console.log(`\n${pendingBulkJobs.length} pending bulk SMS jobs waiting to be processed`)
  }

  const { data: recentMessagesData, error: messagesError } = await (supabase.from('messages') as any)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(args.limit)

  const recentMessages = (assertScriptQuerySucceeded({
    operation: `[${SCRIPT_NAME}] Load recent messages`,
    error: messagesError,
    data: recentMessagesData,
  }) ?? []) as Array<Record<string, unknown>>

  console.log(`\nRecent messages in database: ${recentMessages.length}`)

  if (process.exitCode === 1) {
    console.log('\n❌ Jobs check completed with failures.')
  } else {
    console.log('\n✅ Jobs check complete!')
  }
}

void main().catch((error) => {
  markFailure('check-jobs failed.', error)
})
