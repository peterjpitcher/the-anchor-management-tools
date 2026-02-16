#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { createJob, submitApplication, getJobApplications } from '@/lib/hiring/service'
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
    const { count, error } = await (admin.from('hiring_jobs') as any).select('id', { count: 'exact', head: true })
    if (error) {
      throw new Error(`DRY RUN failed: hiring_jobs lookup failed: ${error.message || 'unknown error'}`)
    }
    console.log(`[${SCRIPT_NAME}] DRY RUN ok (hiring_jobs count=${count ?? 0}). No mutations performed.`)
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

  console.log(`[${SCRIPT_NAME}] Creating test job...`)
  const job = await createJob({
    title: `Test Job ${timestamp}`,
    slug: jobSlug,
    status: 'open',
    location: 'The Anchor',
    description: 'A test job for verification',
    employment_type: 'Full-time',
  })

  if (!job?.id) {
    throw new Error('Job creation failed: missing job id')
  }

  console.log(`[${SCRIPT_NAME}] Submitting test application...`)
  const appResult = await submitApplication({
    jobId: job.id,
    candidate: {
      firstName: 'Test',
      lastName: 'Candidate',
      email: candidateEmail,
      phone: '07700900000',
      resumeUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      screenerAnswers: { q1: 'answer 1' },
    },
  })

  if (!appResult.success || !appResult.applicationId) {
    throw new Error(`Application submission failed: ${appResult.error || 'unknown error'}`)
  }

  console.log(`[${SCRIPT_NAME}] Verifying database records...`)
  const { data: application, error: appError } = await (admin.from('hiring_applications') as any)
    .select('id, candidate_id, candidate:hiring_candidates(id, email)')
    .eq('id', appResult.applicationId)
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
  const apps = await getJobApplications(job.id)
  if (!Array.isArray(apps) || apps.length !== 1) {
    throw new Error(`Expected 1 application, found ${Array.isArray(apps) ? apps.length : 'non-array result'}`)
  }

  console.log(`[${SCRIPT_NAME}] Cleaning up test data...`)
  const cleanupDeletes: Array<{ table: string; id: string }> = [
    { table: 'hiring_applications', id: application.id },
    { table: 'hiring_candidates', id: application.candidate_id },
    { table: 'hiring_jobs', id: job.id },
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
