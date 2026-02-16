#!/usr/bin/env tsx

import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'
import { config } from 'dotenv'
import path from 'path'

config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'check-bulk-sms-jobs'

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`[${SCRIPT_NAME}] ${message}`, error)
    return
  }
  console.error(`[${SCRIPT_NAME}] ${message}`)
}

async function checkBulkSMSJobs() {
  if (process.argv.includes('--confirm')) {
    throw new Error('check-bulk-sms-jobs is read-only and does not support --confirm.')
  }

  console.log('Checking Bulk SMS Jobs...\n')

  const supabase = createAdminClient()
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // 1. Bulk SMS jobs overview (last 7 days)
  console.log('1. Bulk SMS jobs (last 7 days):')
  const { data: recentJobsRaw, error: recentJobsError } = await supabase
    .from('jobs')
    .select('id, type, status, created_at, updated_at, failed_at, error_message, payload')
    .in('type', ['send_bulk_sms', 'send_sms'])
    .gte('created_at', sevenDaysAgo)
    .order('created_at', { ascending: false })

  const recentJobs = (assertScriptQuerySucceeded({
    operation: 'Load recent send_bulk_sms/send_sms jobs',
    error: recentJobsError,
    data: recentJobsRaw ?? [],
    allowMissing: true,
  }) ?? []) as Array<{
    id: string
    type: string
    status: string
    created_at: string
    payload: unknown
    error_message: string | null
  }>

  const bulkJobs = recentJobs.filter((job) => job.type === 'send_bulk_sms')
  const smsJobs = recentJobs.filter((job) => job.type === 'send_sms')

  console.log(`Found ${bulkJobs.length} bulk jobs and ${smsJobs.length} send_sms jobs in the last 7 days.`)

  const byStatus = (jobs: Array<{ status: string }>) =>
    jobs.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1
      return acc
    }, {} as Record<string, number>)

  console.log('\nBulk job status summary:')
  console.table(
    Object.entries(byStatus(bulkJobs)).map(([status, count]) => ({
      Status: status,
      Count: count,
    }))
  )

  const showJobs = (
    label: string,
    jobs: Array<{ id: string; created_at: string; status: string; payload: unknown; error_message: string | null }>
  ) => {
    if (jobs.length === 0) return
    console.log(`\n${label}:`)
    jobs.slice(0, 10).forEach((job) => {
      const payload = (job.payload ?? {}) as {
        customerIds?: unknown
        customer_ids?: unknown
        message?: unknown
      }
      const recipients = Array.isArray(payload.customerIds)
        ? payload.customerIds.length
        : Array.isArray(payload.customer_ids)
          ? payload.customer_ids.length
          : null
      const messageBody = typeof payload.message === 'string' ? payload.message : null
      const messagePreview = messageBody ? messageBody.substring(0, 60) : null

      console.log(`\nJob ID: ${job.id}`)
      console.log(`Created: ${new Date(job.created_at).toLocaleString('en-GB')}`)
      console.log(`Status: ${job.status}`)
      if (recipients !== null) console.log(`Recipients: ${recipients}`)
      if (messagePreview) console.log(`Message preview: "${messagePreview}${messageBody!.length > 60 ? '...' : ''}"`)
      if (job.error_message) console.log(`Error: ${job.error_message}`)
    })
  }

  showJobs(
    'Pending bulk jobs (first 10)',
    bulkJobs.filter((job) => job.status === 'pending')
  )

  showJobs(
    'Failed bulk jobs (first 10)',
    bulkJobs.filter((job) => job.status === 'failed')
  )

  // 2. Recent send_sms job health (last 24 hours)
  console.log('\n2. send_sms job health (last 24 hours):')
  const { data: dayJobsRaw, error: dayJobsError } = await supabase
    .from('jobs')
    .select('id, status, created_at, payload, error_message')
    .eq('type', 'send_sms')
    .gte('created_at', oneDayAgo)
    .order('created_at', { ascending: false })
    .limit(50)

  const dayJobs = (assertScriptQuerySucceeded({
    operation: 'Load recent send_sms jobs (24h)',
    error: dayJobsError,
    data: dayJobsRaw ?? [],
    allowMissing: true,
  }) ?? []) as Array<{ id: string; status: string; error_message: string | null }>

  const pending = dayJobs.filter((j) => j.status === 'pending').length
  const failed = dayJobs.filter((j) => j.status === 'failed').length
  console.log(`Found ${pending} pending and ${failed} failed send_sms jobs in last 24 hours.`)

  if (failed > 0) {
    console.log('\nRecent failed send_sms jobs (first 5):')
    dayJobs
      .filter((j) => j.status === 'failed')
      .slice(0, 5)
      .forEach((job) => {
        console.log(`- ${job.id} (${job.error_message || 'unknown error'})`)
      })
  }

  // 3. Outbound messages count (last 24 hours)
  console.log('\n3. Outbound message count (last 24 hours):')
  const { count: outboundCount, error: outboundCountError } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('direction', 'outbound')
    .gte('created_at', oneDayAgo)

  assertScriptQuerySucceeded({
    operation: 'Count outbound messages (24h)',
    error: outboundCountError,
    data: outboundCount ?? 0,
    allowMissing: true,
  })
  console.log(`Outbound messages created in last 24h: ${outboundCount || 0}`)

  // 4. Queue backlog indicator
  console.log('\n4. Queue backlog indicator:')
  const { count: pendingJobsCount, error: pendingJobsCountError } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')

  assertScriptQuerySucceeded({
    operation: 'Count pending jobs in queue',
    error: pendingJobsCountError,
    data: pendingJobsCount ?? 0,
    allowMissing: true,
  })

  if ((pendingJobsCount || 0) > 0) {
    console.log(`${pendingJobsCount} jobs are pending in the queue`)
  } else {
    console.log('No pending jobs - queue is being processed')
  }

  if (process.exitCode === 1) {
    console.log('\nBulk SMS job check completed with failures.')
  } else {
    console.log('\nBulk SMS job check complete.')
  }
}

void checkBulkSMSJobs().catch((error) => {
  markFailure('check-bulk-sms-jobs failed.', error)
})
