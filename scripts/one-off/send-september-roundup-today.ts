/**
 * Brings the September round-up forward to today, and moves the one email that blocks it.
 *
 * The frequency cap locks the contact row for two days, so a send today would silently skip
 * every recipient of tomorrow's quiz email, which would still finish as "completed" having
 * reached nobody. Nothing can slot between the quiz send and the karaoke send either: that gap
 * is 54 hours and two cap windows need 96.
 *
 * So the quiz email takes the round-up's old slot. That is not a downgrade for the quiz. The
 * round-up leads with the 16 September quiz as its first card, with its own booking link, so
 * the quiz gets a mention eight days out plus a dedicated reminder two days out, in place of a
 * single email seven days out.
 *
 * Order matters: the round-up is unscheduled first to free 14 September, then the quiz is moved
 * into it, then the round-up is scheduled for today. Scheduling checks the cap against every
 * neighbour, so doing this in any other order is refused.
 *
 * Resulting queue, with every gap clearing the 48 hour cap:
 *   today 16:00  September round-up      (was Mon 14 Sep 12:00)
 *   Fri 11 Sep   Karaoke, unchanged      71 hours later
 *   Mon 14 Sep   Quiz Night reminder     69 hours later  (was Wed 9 Sep 09:00)
 *   Fri 18 Sep   Lovely Jubbly, unchanged 96 hours later
 *
 * Dry run by default. RUN_SEND_ROUNDUP_TODAY_MUTATION=true applies it.
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'
import { scheduleCampaign } from '@/services/marketing-campaigns'

const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'
const ROUNDUP_UTM = 'welcome-to-september-2026'
const QUIZ_UTM = 'autumn-kick-off-quiz-night-2026-09-16'

/** London wall-clock with an explicit offset. British summer time is still in force. */
const ROUNDUP_SLOT = '2026-09-08T16:00:00+01:00'
const QUIZ_SLOT = '2026-09-14T12:00:00+01:00'

interface Row {
  id: string
  name: string
  status: string
  scheduled_for: string | null
}

async function fetchByUtm(utm: string): Promise<Row> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('marketing_campaigns')
    .select('id, name, status, scheduled_for')
    .eq('utm_campaign', utm)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error(`No campaign with utm_campaign "${utm}"`)
  return data as Row
}

async function unschedule(row: Row): Promise<void> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('marketing_campaigns')
    .update({ status: 'draft', scheduled_for: null, approved_recipient_count: null })
    .eq('id', row.id)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error(`${row.name} was not scheduled when we tried to unschedule it`)
}

async function main(): Promise<void> {
  const roundup = await fetchByUtm(ROUNDUP_UTM)
  const quiz = await fetchByUtm(QUIZ_UTM)

  console.warn(`${roundup.name}\n  ${roundup.scheduled_for} -> ${ROUNDUP_SLOT}`)
  console.warn(`${quiz.name}\n  ${quiz.scheduled_for} -> ${QUIZ_SLOT}`)

  if (roundup.status !== 'scheduled') throw new Error(`Round-up is ${roundup.status}, expected scheduled`)
  if (quiz.status !== 'scheduled') throw new Error(`Quiz is ${quiz.status}, expected scheduled`)

  const when = new Date(ROUNDUP_SLOT)
  if (when.getTime() < Date.now()) {
    throw new Error('The round-up slot is already in the past; pick a later time')
  }

  assertScriptMutationAllowed({
    scriptName: 'send-september-roundup-today',
    envVar: 'RUN_SEND_ROUNDUP_TODAY_MUTATION',
  })

  // Free 14 September before anything tries to claim it.
  await unschedule(roundup)
  await unschedule(quiz)

  const movedQuiz = await scheduleCampaign(quiz.id, QUIZ_SLOT, OWNER_USER_ID)
  console.warn(`quiz reminder now ${movedQuiz.campaign.scheduledFor}, ${movedQuiz.approvedRecipientCount} recipients`)

  const movedRoundup = await scheduleCampaign(roundup.id, ROUNDUP_SLOT, OWNER_USER_ID)
  console.warn(`round-up now ${movedRoundup.campaign.scheduledFor}, ${movedRoundup.approvedRecipientCount} recipients`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
