#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const HARD_CAP = 200

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

function parseLimit(argv: string[]): number {
  const idx = argv.indexOf('--limit')
  if (idx === -1) {
    return 50
  }

  const raw = argv[idx + 1]
  const parsed = Number.parseInt(raw || '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--limit must be a positive integer (got '${raw || ''}')`)
  }
  if (parsed > HARD_CAP) {
    throw new Error(`--limit too high (got ${parsed}, hard cap ${HARD_CAP})`)
  }
  return parsed
}

function safePreview(value: unknown, maxChars: number): string {
  try {
    const asString = typeof value === 'string' ? value : JSON.stringify(value)
    if (typeof asString !== 'string') {
      return '[unprintable]'
    }
    if (asString.length <= maxChars) {
      return asString
    }
    return `${asString.substring(0, maxChars)}...`
  } catch {
    return '[unserializable]'
  }
}

async function checkAllJobs() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-all-jobs is strictly read-only; do not pass --confirm.')
  }

  const limit = parseLimit(argv)

  console.log('🔍 Checking jobs in the queue...\n')
  console.log(`Limit: ${limit} (hard cap ${HARD_CAP})\n`)

  const supabase = createAdminClient()

  const { count: pendingCount, error: pendingCountError } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')

  if (pendingCountError) {
    markFailure('Failed to count pending jobs.', pendingCountError)
    return
  }

  console.log('1️⃣ Pending jobs:')
  console.log(`Total pending: ${pendingCount || 0}`)

  const { data: pendingJobsRows, error: pendingJobsError } = await supabase
    .from('jobs')
    .select('id, type, created_at, priority, payload')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit)

  const pendingJobs = (assertScriptQuerySucceeded({
    operation: 'Load pending jobs (sample)',
    error: pendingJobsError,
    data: pendingJobsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    type: string | null
    created_at: string | null
    priority: number | null
    payload: unknown
  }>

  if (pendingJobs.length > 0) {
    console.log(`Showing ${pendingJobs.length} pending job(s):\n`)
    pendingJobs.forEach((job) => {
      console.log(`ID: ${job.id}`)
      console.log(`Type: ${job.type || 'unknown'}`)
      console.log(`Created: ${job.created_at || 'unknown'}`)
      console.log(`Priority: ${job.priority ?? 'default'}`)
      console.log(`Payload: ${safePreview(job.payload, 200)}`)
      console.log('---')
    })
  } else {
    console.log('✅ No pending jobs found in sample')
  }

  if ((pendingCount || 0) > limit) {
    console.log(`\n⚠️  Pending jobs exceed sample limit (${pendingCount} > ${limit}).`)
  }

  const { count: processingCount, error: processingCountError } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'processing')

  if (processingCountError) {
    markFailure('Failed to count processing jobs.', processingCountError)
    return
  }

  console.log('\n2️⃣ Jobs currently processing:')
  console.log(`Total processing: ${processingCount || 0}`)

  const { data: processingJobsRows, error: processingJobsError } = await supabase
    .from('jobs')
    .select('id, type, started_at')
    .eq('status', 'processing')
    .order('started_at', { ascending: false })
    .limit(limit)

  const processingJobs = (assertScriptQuerySucceeded({
    operation: 'Load processing jobs (sample)',
    error: processingJobsError,
    data: processingJobsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{ id: string; type: string | null; started_at: string | null }>

  if (processingJobs.length > 0) {
    console.log(`Showing ${processingJobs.length} processing job(s):\n`)
    processingJobs.forEach((job) => {
      const startedAt = job.started_at ? new Date(job.started_at) : null
      const now = new Date()
      const runningFor = startedAt ? Math.floor((now.getTime() - startedAt.getTime()) / 1000) : null

      console.log(`ID: ${job.id}`)
      console.log(`Type: ${job.type || 'unknown'}`)
      console.log(`Started: ${job.started_at || 'unknown'}`)
      if (typeof runningFor === 'number' && Number.isFinite(runningFor)) {
        console.log(`Running for: ${runningFor} seconds`)
        if (runningFor > 60) {
          console.log('⚠️ WARNING: This job has been running for over a minute!')
        }
      }
      console.log('---')
    })
  } else {
    console.log('✅ No jobs currently processing in sample')
  }

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  console.log('\n3️⃣ Failed jobs (last 24 hours):')
  const { data: failedJobsRows, error: failedJobsError } = await supabase
    .from('jobs')
    .select('id, type, failed_at, error')
    .eq('status', 'failed')
    .gte('created_at', yesterday)
    .order('failed_at', { ascending: false })
    .limit(Math.min(limit, 50))

  const failedJobs = (assertScriptQuerySucceeded({
    operation: 'Load failed jobs (last 24h)',
    error: failedJobsError,
    data: failedJobsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{ id: string; type: string | null; failed_at: string | null; error: unknown }>

  if (failedJobs.length > 0) {
    console.log(`Found ${failedJobs.length} failed job(s):\n`)
    failedJobs.forEach((job) => {
      console.log(`ID: ${job.id}`)
      console.log(`Type: ${job.type || 'unknown'}`)
      console.log(`Failed at: ${job.failed_at || 'unknown'}`)
      console.log(`Error: ${safePreview(job.error, 200)}`)
      console.log('---')
    })
  } else {
    console.log('✅ No failed jobs in the last 24 hours')
  }

  console.log('\n4️⃣ Job type distribution (pending sample):')
  const jobTypes = new Map<string, number>()
  pendingJobs.forEach((job) => {
    const type = job.type || 'unknown'
    jobTypes.set(type, (jobTypes.get(type) || 0) + 1)
  })

  if (jobTypes.size > 0) {
    Array.from(jobTypes.entries()).forEach(([type, count]) => {
      console.log(`  ${type}: ${count} job(s)`)
    })
  } else {
    console.log('  (no pending jobs in sample)')
  }

  console.log('\n' + '='.repeat(50))
  console.log('SUMMARY:')
  console.log(`Total pending: ${pendingCount || 0}`)
  console.log(`Total processing: ${processingCount || 0}`)
  console.log(`Failed jobs shown (24h): ${failedJobs.length}`)

  if ((pendingCount || 0) > 100) {
    console.log('\n⚠️ WARNING: Large number of pending jobs detected!')
    console.log('This could cause timeouts. Consider clearing old jobs.')
  }

  if ((processingCount || 0) > 0) {
    console.log('\n⚠️ WARNING: Jobs are in processing state.')
    console.log('If these are stuck, they should be reset or deleted via a gated cleanup script.')
  }

  if (process.exitCode === 1) {
    console.log('\n❌ Job queue check completed with failures.')
  } else {
    console.log('\n✅ Job queue check complete!')
  }
}

void checkAllJobs().catch((error) => {
  markFailure('check-all-jobs failed.', error)
})

