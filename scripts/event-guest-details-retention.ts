#!/usr/bin/env tsx
/**
 * Dry run of the event guest details retention job (BK-017, owner decision D6: guest phone
 * numbers and answers are deleted 90 days after the event).
 *
 * Read-only by default: it lists how many bookings, answers and phone numbers the job would clear
 * today, and changes nothing. Counts only, never a name, answer or number.
 *
 *   npx tsx scripts/event-guest-details-retention.ts
 *
 * To clear them by hand (the weekly cron does the same once EVENT_GUEST_DETAILS_RETENTION=delete
 * is set in Vercel):
 *
 *   RUN_EVENT_GUEST_DETAILS_RETENTION_MUTATION=true npx tsx scripts/event-guest-details-retention.ts
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { runEventGuestDetailsRetention } from '@/lib/events/guest-details-retention'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'event-guest-details-retention'
const MUTATION_FLAG = 'RUN_EVENT_GUEST_DETAILS_RETENTION_MUTATION'

async function main() {
  const wantsDelete = (process.env[MUTATION_FLAG] ?? '').trim().toLowerCase() === 'true'
  if (wantsDelete) assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: MUTATION_FLAG })

  const result = await runEventGuestDetailsRetention(createAdminClient(), { mode: wantsDelete ? 'delete' : 'dry_run' })
  console.warn(`[${SCRIPT_NAME}] Mode: ${wantsDelete ? 'DELETE' : 'dry run, nothing changed'}`)
  console.warn(JSON.stringify(result, null, 2))
  if (result.bookingsFailed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] failed:`, error instanceof Error ? error.message : error)
  process.exitCode = 1
})
