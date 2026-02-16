#!/usr/bin/env tsx

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  assertFixSmsTemplateKeysLimit,
  assertFixSmsTemplateKeysCompletedWithoutFailures,
  assertFixSmsTemplateKeysMutationAllowed,
  assertFixSmsTemplateUpdateSucceeded,
  isFixSmsTemplateKeysMutationEnabled,
  readFixSmsTemplateKeysLimit,
  readFixSmsTemplateKeysOffset,
  resolvePendingSmsTemplateFixJobs,
  shouldFixLegacyTemplate,
  type PendingSmsTemplateFixJob
} from '../../src/lib/sms-template-key-fix-safety'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const LEGACY_TEMPLATE_KEY = 'table_booking_confirmation'
const REPLACEMENT_TEMPLATE_KEY = 'booking_confirmation_regular'

function resolveTemplate(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const template = (payload as { template?: unknown }).template
  return typeof template === 'string' ? template : null
}

async function fixTemplateKeys(): Promise<void> {
  const argv = process.argv
  const confirm = argv.includes('--confirm')
  const mutationEnabled = isFixSmsTemplateKeysMutationEnabled(argv, process.env)
  const HARD_CAP = 500

  if (argv.includes('--help')) {
    console.log(`
fix-sms-template-keys (safe by default)

Dry-run (default):
  tsx scripts/fixes/fix-sms-template-keys.ts

Mutation mode (requires multi-gating + explicit caps):
  RUN_FIX_SMS_TEMPLATE_KEYS_MUTATION=true \\
  ALLOW_FIX_SMS_TEMPLATE_KEYS_SCRIPT=true \\
    tsx scripts/fixes/fix-sms-template-keys.ts --confirm --limit 50 [--offset 0]

Notes:
  - --limit is required in mutation mode (hard cap ${HARD_CAP}).
  - This script only targets pending send_sms jobs with payload.template="${LEGACY_TEMPLATE_KEY}".
`)
    return
  }

  if (confirm && !mutationEnabled && !argv.includes('--dry-run')) {
    throw new Error(
      'fix-sms-template-keys received --confirm but RUN_FIX_SMS_TEMPLATE_KEYS_MUTATION is not enabled. Set RUN_FIX_SMS_TEMPLATE_KEYS_MUTATION=true and ALLOW_FIX_SMS_TEMPLATE_KEYS_SCRIPT=true to apply updates.'
    )
  }

  if (mutationEnabled) {
    assertFixSmsTemplateKeysMutationAllowed()
  }

  const supabase = createAdminClient()

  console.log(
    `🔧 Fixing SMS template keys in pending jobs (${mutationEnabled ? 'MUTATION' : 'DRY-RUN'})...\n`
  )
  console.log(`Legacy template key: ${LEGACY_TEMPLATE_KEY}`)
  console.log(`Replacement key: ${REPLACEMENT_TEMPLATE_KEY}`)
  console.log('')

  const { count: legacyCount, error: legacyCountError } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('type', 'send_sms')
    .eq('status', 'pending')
    .eq('payload->>template', LEGACY_TEMPLATE_KEY)

  if (legacyCountError) {
    throw new Error(
      `Failed counting pending legacy-template SMS jobs: ${legacyCountError.message || 'unknown error'}`
    )
  }

  console.log(`Pending jobs with legacy key: ${typeof legacyCount === 'number' ? legacyCount : 0}`)

  if (!mutationEnabled) {
    const { data: sampleJobs, error: sampleError } = await supabase
      .from('jobs')
      .select('id, payload')
      .eq('type', 'send_sms')
      .eq('status', 'pending')
      .eq('payload->>template', LEGACY_TEMPLATE_KEY)
      .order('created_at', { ascending: true })
      .limit(10)

    const sample = resolvePendingSmsTemplateFixJobs({
      jobs: sampleJobs as PendingSmsTemplateFixJob[] | null,
      error: sampleError
    })

    if (sample.length > 0) {
      console.log('\nSample pending job IDs:')
      sample.forEach((job) => console.log(`- ${job.id}`))
    }

    console.log('\nDry-run mode: no job rows updated.')
    console.log(
      'To mutate, pass --confirm + --limit, and set RUN_FIX_SMS_TEMPLATE_KEYS_MUTATION=true and ALLOW_FIX_SMS_TEMPLATE_KEYS_SCRIPT=true.'
    )
    return
  }

  const limit = assertFixSmsTemplateKeysLimit(
    readFixSmsTemplateKeysLimit(argv, process.env),
    HARD_CAP
  )
  const offset = readFixSmsTemplateKeysOffset(argv, process.env) ?? 0
  const rangeStart = offset
  const rangeEnd = offset + limit - 1

  console.log(`\nProcessing window: offset=${offset} limit=${limit}`)

  const { data: pendingJobs, error: pendingJobsError } = await supabase
    .from('jobs')
    .select('id, payload')
    .eq('type', 'send_sms')
    .eq('status', 'pending')
    .eq('payload->>template', LEGACY_TEMPLATE_KEY)
    .order('created_at', { ascending: true })
    .range(rangeStart, rangeEnd)

  const jobs = resolvePendingSmsTemplateFixJobs({
    jobs: pendingJobs as PendingSmsTemplateFixJob[] | null,
    error: pendingJobsError
  })

  if (jobs.length === 0) {
    console.log('✅ No pending SMS jobs found')
    return
  }

  const jobsNeedingFix = jobs.filter((job) => shouldFixLegacyTemplate(job.payload))
  if (jobsNeedingFix.length !== jobs.length) {
    throw new Error(
      `Unexpected non-legacy job rows returned (${jobsNeedingFix.length}/${jobs.length}). Aborting.`
    )
  }

  console.log(`Targeting ${jobsNeedingFix.length} job(s) for update...`)

  const failures: string[] = []
  let fixedCount = 0

  for (const job of jobsNeedingFix) {
    const payload =
      job.payload && typeof job.payload === 'object'
        ? (job.payload as Record<string, unknown>)
        : {}
    const previousTemplate = resolveTemplate(job.payload) ?? '<missing>'

    const updatedPayload = {
      ...payload,
      template: REPLACEMENT_TEMPLATE_KEY
    }

    const { data: updatedRows, error: updateError } = await supabase
      .from('jobs')
      .update({
        payload: updatedPayload,
        updated_at: new Date().toISOString()
      })
      .eq('id', job.id)
      .eq('type', 'send_sms')
      .eq('status', 'pending')
      .eq('payload->>template', LEGACY_TEMPLATE_KEY)
      .select('id')

    try {
      assertFixSmsTemplateUpdateSucceeded({
        error: updateError,
        updatedRows,
        expectedCount: 1
      })
      fixedCount += 1
      console.log(
        `✅ Updated job ${job.id}: template ${previousTemplate} -> ${REPLACEMENT_TEMPLATE_KEY}`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`job:${job.id}:${message}`)
      console.error(`❌ Failed to update job ${job.id}: ${message}`)
    }
  }

  const { data: auditRows, error: auditError } = await supabase
    .from('audit_logs')
    .insert({
      user_id: 'system-script',
      user_email: 'script@system',
      operation_type: 'update',
      resource_type: 'jobs',
      operation_status: failures.length > 0 ? 'failure' : 'success',
      details: {
        script: 'fix-sms-template-keys.ts',
        legacy_template: LEGACY_TEMPLATE_KEY,
        replacement_template: REPLACEMENT_TEMPLATE_KEY,
        pending_job_count: typeof legacyCount === 'number' ? legacyCount : null,
        offset,
        limit,
        targeted_job_count: jobsNeedingFix.length,
        fixed_count: fixedCount,
        failure_count: failures.length
      },
      error_message: failures.length > 0 ? failures.slice(0, 3).join(' | ') : null
    })
    .select('id')

  assertFixSmsTemplateUpdateSucceeded({
    error: auditError,
    updatedRows: auditRows,
    expectedCount: 1
  })

  assertFixSmsTemplateKeysCompletedWithoutFailures({
    failureCount: failures.length,
    failures
  })

  console.log(`\n✅ Fixed ${fixedCount} jobs with legacy template keys`)
}

fixTemplateKeys().catch((error) => {
  console.error('❌ fix-sms-template-keys script failed:', error)
  process.exitCode = 1
})
