#!/usr/bin/env tsx

/**
 * One-off: re-issue and re-send Paul's interview invite after his email address
 * was corrected (twice — see the candidate notes).
 *
 * This mirrors `issueRecruitmentBookingInviteAction` (src/app/actions/recruitment.ts)
 * exactly — rotate the booking token, send the templated invite, write the audit
 * event — because that action needs a logged-in request context and cannot be
 * invoked from a script. Attributed to the owner, who requested the resend.
 *
 * Re-issuing is the point, not a side effect: `issueRecruitmentBookingLink` mints a
 * fresh token and overwrites `booking_token_hash`, which invalidates the links that
 * were emailed to the two earlier (wrong) addresses. Whoever owns those mailboxes
 * loses a working booking link for Paul's application.
 *
 * Safety: dry-run by default — a real run SENDS AN EMAIL to a real candidate and
 * requires --confirm plus RUN_RESEND_INVITE_MUTATION=true +
 * ALLOW_RESEND_INVITE_MUTATION_SCRIPT=true.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { issueRecruitmentBookingLink } from '@/services/recruitment'
import { sendRecruitmentTemplateEmail } from '@/lib/recruitment/communications'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'resend-paul-interview-invite'
const RUN_MUTATION_ENV = 'RUN_RESEND_INVITE_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_RESEND_INVITE_MUTATION_SCRIPT'

const CANDIDATE_ID = '681c1b49-0418-460f-a284-d370ca7b961a'
const APPLICATION_ID = 'b6d6d24d-181b-4f1d-b6ab-84d074bf2e95'
const EXPECTED_EMAIL = 'forsterpaul390@yahoo.com'
// The owner (peter@orangejelly.co.uk) requested this resend; attribute it to them
// so the audit trail and the communications log match a real actor.
const ACTOR_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'

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
  console.log(`[${SCRIPT_NAME}] ${confirm ? 'MUTATION (WILL SEND EMAIL)' : 'DRY RUN'} starting`)

  const supabase = createAdminClient()

  const { data: candidate, error } = await supabase
    .from('recruitment_candidates')
    .select('id, first_name, last_name, email')
    .eq('id', CANDIDATE_ID)
    .maybeSingle()

  if (error) throw error
  if (!candidate) throw new Error(`[${SCRIPT_NAME}] candidate not found`)

  // Guard: the address has been wrong twice already, and the invite carries a live
  // booking token. Refuse to send anywhere except the address the owner confirmed.
  if (candidate.email !== EXPECTED_EMAIL) {
    throw new Error(
      `[${SCRIPT_NAME}] refusing to send: candidate email is "${candidate.email}", expected "${EXPECTED_EMAIL}". Fix the record first.`
    )
  }

  const { data: application, error: appError } = await supabase
    .from('recruitment_applications')
    .select('id, status, booking_token_expires_at, booking_token_used_at')
    .eq('id', APPLICATION_ID)
    .maybeSingle()

  if (appError) throw appError
  if (!application) throw new Error(`[${SCRIPT_NAME}] application not found`)

  console.log(`[${SCRIPT_NAME}] candidate : ${candidate.first_name} ${candidate.last_name} <${candidate.email}>`)
  console.log(`[${SCRIPT_NAME}] status    : ${application.status}`)
  console.log(`[${SCRIPT_NAME}] old token : expires ${application.booking_token_expires_at}, used ${application.booking_token_used_at ?? 'never'}`)

  if (!confirm) {
    console.log(`[${SCRIPT_NAME}] DRY RUN: would re-issue the interview booking link (invalidating the old one) and email the invite to ${candidate.email}. No email sent.`)
    console.log(`[${SCRIPT_NAME}] Re-run with --confirm (+ env guards) to send.`)
    return
  }

  if (!isTruthyEnv(process.env[RUN_MUTATION_ENV])) {
    throw new Error(`[${SCRIPT_NAME}] mutation blocked by safety guard. Set ${RUN_MUTATION_ENV}=true to enable.`)
  }
  assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: ALLOW_MUTATION_ENV })

  const booking = await issueRecruitmentBookingLink(APPLICATION_ID, 'interview', { actorUserId: ACTOR_USER_ID }, supabase)
  console.log(`[${SCRIPT_NAME}] new booking link issued, expires ${booking.expiresAt} (previous link is now dead)`)

  await sendRecruitmentTemplateEmail(APPLICATION_ID, 'interview_invite', {
    currentUserId: ACTOR_USER_ID,
    bookingLink: booking.bookingUrl,
  }, supabase)
  console.log(`[${SCRIPT_NAME}] interview invite emailed to ${candidate.email}`)

  // The UI action also writes a generic audit_logs row, but AuditService depends on
  // Next.js `headers()` and cannot run outside a request. The actor is still recorded
  // in the two trails that matter here: recruitment_application_status_events (via the
  // transition inside issueRecruitmentBookingLink) and recruitment_communications.sent_by.
  console.log(`[${SCRIPT_NAME}] done — actor recorded on the status event and the communications row`)
}

main().catch(error => {
  console.error(`[${SCRIPT_NAME}] fatal:`, describeError(error))
  process.exitCode = 1
})
