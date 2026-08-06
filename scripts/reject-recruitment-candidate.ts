#!/usr/bin/env tsx

/**
 * Rejects a single recruitment application via the shared
 * `decideRecruitmentApplication` service (decision: 'reject'), which:
 *   - transitions the application status to 'rejected' (writing a status event),
 *   - records the reason as an internal candidate note (kind 'reject'),
 *   - sets `rejection_reason` on the application,
 *   - starts the GDPR retention clock on the candidate.
 *
 * It deliberately does NOT email the candidate: in the app the rejection email
 * is a separate, approval-gated step, and the caller here has not asked to send
 * one. Nobody is contacted by running this.
 *
 * Target is resolved by email so the wrong application cannot be rejected by a
 * stale id; the script refuses to run unless the candidate has exactly one
 * scoreable (posting-linked) application.
 *
 * Safety: dry-run by default. A real run requires --confirm and the env guards
 * RUN_REJECT_CANDIDATE_MUTATION=true + ALLOW_REJECT_CANDIDATE_MUTATION_SCRIPT=true.
 *
 * Usage:
 *   npx tsx scripts/reject-recruitment-candidate.ts
 *   RUN_REJECT_CANDIDATE_MUTATION=true ALLOW_REJECT_CANDIDATE_MUTATION_SCRIPT=true \
 *     npx tsx scripts/reject-recruitment-candidate.ts --confirm
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { decideRecruitmentApplication } from '@/services/recruitment'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'reject-recruitment-candidate'
const RUN_MUTATION_ENV = 'RUN_REJECT_CANDIDATE_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_REJECT_CANDIDATE_MUTATION_SCRIPT'

// The owner (peter@orangejelly.co.uk) requested this rejection; attribute the
// status event and internal note to them.
const ACTOR = { id: 'b44dd268-7c66-4163-8ff3-cc962b2d528c', email: 'peter@orangejelly.co.uk' }

const TARGET_EMAIL = 'jievyn@hotmail.com'
const REASON =
  'Applicant is under 18 (CV states age 16, Year 12 student). The Bar Staff role requires regular late shifts in licensed premises, including finishes after midnight, which we cannot staff with under-18 workers. Rejected on eligibility for this role, not on merit.'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.trim().toLowerCase())
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') return JSON.stringify(error)
  return String(error)
}

async function main() {
  const confirm = process.argv.includes('--confirm')
  console.log(`[${SCRIPT_NAME}] ${confirm ? 'MUTATION' : 'DRY RUN'} starting`)

  const supabase = createAdminClient()

  const { data: candidate, error } = await supabase
    .from('recruitment_candidates')
    .select('id, first_name, last_name, email')
    .eq('email_normalized', TARGET_EMAIL.toLowerCase())
    .maybeSingle()

  if (error) throw error
  if (!candidate) throw new Error(`[${SCRIPT_NAME}] candidate not found for ${TARGET_EMAIL}`)

  const { data: apps, error: appsError } = await supabase
    .from('recruitment_applications')
    .select('id, status, ai_score')
    .eq('candidate_id', candidate.id)
    .not('job_posting_id', 'is', null)
    .order('created_at', { ascending: false })

  if (appsError) throw appsError
  if (!apps || apps.length !== 1) {
    throw new Error(`[${SCRIPT_NAME}] expected exactly 1 scoreable application, found ${apps?.length ?? 0}; refusing to guess.`)
  }
  const application = apps[0]

  if (application.status === 'rejected') {
    console.log(`[${SCRIPT_NAME}] ${candidate.first_name} ${candidate.last_name} is already rejected; nothing to do.`)
    return
  }

  console.log(`[${SCRIPT_NAME}] candidate  : ${candidate.first_name} ${candidate.last_name} <${candidate.email}>`)
  console.log(`[${SCRIPT_NAME}] application: ${application.id} (status ${application.status}, score ${application.ai_score})`)
  console.log(`[${SCRIPT_NAME}] reason     : ${REASON}`)
  console.log(`[${SCRIPT_NAME}] email      : none will be sent`)

  if (!confirm) {
    console.log(`[${SCRIPT_NAME}] DRY RUN: would set status -> rejected, record the reason note, set rejection_reason, start the retention clock. No email.`)
    console.log(`[${SCRIPT_NAME}] Re-run with --confirm (+ env guards) to apply.`)
    return
  }

  if (!isTruthyEnv(process.env[RUN_MUTATION_ENV])) {
    throw new Error(`[${SCRIPT_NAME}] mutation blocked by safety guard. Set ${RUN_MUTATION_ENV}=true to enable.`)
  }
  assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: ALLOW_MUTATION_ENV })

  await decideRecruitmentApplication(
    { applicationId: application.id, decision: 'reject', reason: REASON, user: ACTOR },
    supabase,
  )

  const { data: after } = await supabase
    .from('recruitment_applications')
    .select('status, rejection_reason, rejected_at')
    .eq('id', application.id)
    .maybeSingle()

  console.log(`[${SCRIPT_NAME}] done: status now ${after?.status}, rejected_at ${after?.rejected_at ?? '(unset)'}`)
}

main().catch(error => {
  console.error(`[${SCRIPT_NAME}] fatal:`, describeError(error))
  process.exitCode = 1
})
