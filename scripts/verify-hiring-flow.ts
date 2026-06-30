#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  createRecruitmentApplication,
  createRecruitmentJobPosting,
} from '@/services/recruitment'
import {
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
} from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'verify-hiring-flow'
const RUN_MUTATION_ENV = 'RUN_VERIFY_HIRING_FLOW_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_VERIFY_HIRING_FLOW_MUTATION_SCRIPT'
const HARD_CAP = 1

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.trim().toLowerCase())
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

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`Invalid positive integer: "${raw}"`)
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer: "${raw}"`)
  }

  return parsed
}

type Args = {
  confirm: boolean
  dryRun: boolean
  limit: number | null
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  const confirm = rest.includes('--confirm')
  const dryRun = !confirm || rest.includes('--dry-run')
  const limit = parsePositiveInt(findFlagValue(rest, '--limit'))
  return { confirm, dryRun, limit }
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  const admin = createAdminClient()

  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)

  if (args.dryRun) {
    const { count, error } = await (admin.from('recruitment_job_postings') as any).select('id', { count: 'exact', head: true })
    if (error) {
      throw new Error(`DRY RUN failed: recruitment_job_postings lookup failed: ${error.message || 'unknown error'}`)
    }
    console.log(`[${SCRIPT_NAME}] DRY RUN ok (recruitment_job_postings count=${count ?? 0}). No mutations performed.`)
    console.log(`[${SCRIPT_NAME}] To run mutations (dangerous), you must:`)
    console.log(`- Pass --confirm`)
    console.log(`- Set ${RUN_MUTATION_ENV}=true`)
    console.log(`- Set ${ALLOW_MUTATION_ENV}=true`)
    console.log(`- Provide --limit=1 (hard cap ${HARD_CAP})`)
    return
  }

  if (!args.confirm) {
    throw new Error(`[${SCRIPT_NAME}] mutation blocked: missing --confirm`)
  }

  if (!isTruthyEnv(process.env[RUN_MUTATION_ENV])) {
    throw new Error(
      `[${SCRIPT_NAME}] mutation blocked by safety guard. Set ${RUN_MUTATION_ENV}=true to enable mutations.`
    )
  }

  assertScriptMutationAllowed({
    scriptName: SCRIPT_NAME,
    envVar: ALLOW_MUTATION_ENV,
  })

  const plannedRuns = 1
  const limit = args.limit
  if (!limit) {
    throw new Error(`[${SCRIPT_NAME}] mutation requires --limit=1 (hard cap ${HARD_CAP})`)
  }
  if (limit > HARD_CAP) {
    throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP})`)
  }
  if (plannedRuns > limit) {
    throw new Error(`[${SCRIPT_NAME}] planned runs (${plannedRuns}) exceeds --limit (${limit})`)
  }

  const timestamp = Date.now()
  const jobSlug = `test-job-${timestamp}`
  const candidateEmail = `test.candidate.${timestamp}@example.com`

  console.log(`[${SCRIPT_NAME}] Creating test recruitment posting...`)
  const job = await createRecruitmentJobPosting({
    title: `Test Job ${timestamp}`,
    slug: jobSlug,
    status: 'open',
    description: 'A test job for verification',
    requirements: 'Basic verification requirements',
    role_type: 'bar',
    employment_type: 'part_time',
    positions_available: 1,
    is_public: false,
  }, null, admin)

  if (!job?.id) {
    throw new Error('Job creation failed: missing job id')
  }

  console.log(`[${SCRIPT_NAME}] Submitting test application...`)
  const appResult = await createRecruitmentApplication({
    job_posting_id: job.id,
    source: 'manual_upload',
    candidate: {
      first_name: 'Test',
      last_name: 'Candidate',
      email: candidateEmail,
      phone: '07700900000',
      source: 'manual_upload',
      consent_source: SCRIPT_NAME,
      consent_at: new Date().toISOString(),
      sms_consent: false,
      future_recruitment_consent: false,
    },
    cover_note: 'Verification application',
    relevant_experience_answer: 'Verification experience',
    travel_answer: 'Can travel to the venue',
    start_availability: 'Immediately',
  }, {
    currentUserId: null,
    skipAi: true,
  }, admin)

  console.log(`[${SCRIPT_NAME}] Verifying database records...`)
  const { data: application, error: appError } = await (admin.from('recruitment_applications') as any)
    .select('id, candidate_id, candidate:recruitment_candidates(id, email)')
    .eq('id', appResult.application.id)
    .maybeSingle()

  if (appError) {
    throw new Error(`Failed to load hiring application: ${appError.message || 'unknown error'}`)
  }

  if (!application) {
    throw new Error('Application not found in DB')
  }

  if (typeof application.candidate_id !== 'string' || application.candidate_id.trim().length === 0) {
    throw new Error('Application record is missing candidate_id')
  }

  const candidate =
    Array.isArray(application.candidate) && application.candidate.length > 0
      ? application.candidate[0]
      : application.candidate

  if (!candidate || typeof candidate.email !== 'string' || candidate.email !== candidateEmail) {
    throw new Error('Candidate relation missing or does not match expected email')
  }

  console.log(`[${SCRIPT_NAME}] Verifying service query...`)
  const { data: apps, error: appsError } = await (admin.from('recruitment_applications') as any)
    .select('id')
    .eq('job_posting_id', job.id)

  if (appsError) {
    throw new Error(`Failed to query recruitment applications: ${appsError.message || 'unknown error'}`)
  }
  if (!Array.isArray(apps) || apps.length !== 1) {
    throw new Error(`Expected 1 application, found ${Array.isArray(apps) ? apps.length : 'non-array result'}`)
  }

  console.log(`[${SCRIPT_NAME}] Cleaning up test data...`)
  const cleanupDeletes: Array<{ table: string; id: string }> = [
    { table: 'recruitment_applications', id: application.id },
    { table: 'recruitment_candidates', id: application.candidate_id },
    { table: 'recruitment_job_postings', id: job.id },
  ]

  for (const entry of cleanupDeletes) {
    const { data, error } = await (admin.from(entry.table) as any).delete().eq('id', entry.id).select('id')
    const { updatedCount } = assertScriptMutationSucceeded({
      operation: `Delete ${entry.table}(${entry.id})`,
      error,
      updatedRows: data as Array<{ id?: string }> | null,
      allowZeroRows: false,
    })

    assertScriptExpectedRowCount({
      operation: `Delete ${entry.table}(${entry.id})`,
      expected: 1,
      actual: updatedCount,
    })
  }

  console.log(`[${SCRIPT_NAME}] MUTATION complete. Verification successful.`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
