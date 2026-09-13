/**
 * Moves the business Christmas offer reminder from 1 October to 2 October.
 *
 * The owner's call, and it clears a collision worth naming: the monthly round-up now goes to
 * the business list as well as the guest list, and it sends on the first of the month, so a
 * business contact would have had the round-up and this reminder within half an hour of each
 * other on 1 October.
 *
 * Same time of day, 09:30, one day later. Scheduling freezes content, so this is the
 * unschedule-and-reschedule dance; the content is not touched, only the time. Reads the row
 * back afterwards, because a campaign left as a draft does not send and does not complain.
 *
 * Dry run by default. RUN_MOVE_OCTOBER_BUSINESS_EMAIL=true applies it.
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'
import { scheduleCampaign } from '@/services/marketing-campaigns'

const UTM = 'christmas-2026-business-october-offer'
const NEW_TIME = '2026-10-02T09:30:00+01:00'

function london(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h12',
  })
}

async function main(): Promise<void> {
  const supabase = createAdminClient()

  const { data: candidates, error } = await supabase
    .from('marketing_campaigns')
    .select('id,name,status,audience_type,scheduled_for,utm_campaign')
    .eq('audience_type', 'business')
    .eq('status', 'scheduled')
    .gte('scheduled_for', '2026-09-28')
    .lte('scheduled_for', '2026-10-05')
  if (error) throw new Error(error.message)

  if (!candidates || candidates.length !== 1) {
    throw new Error(
      `Expected exactly one scheduled business campaign in that window, found ${candidates?.length ?? 0}: ` +
        `${(candidates ?? []).map((c) => `${c.name} (${c.utm_campaign})`).join('; ')}`,
    )
  }

  const campaign = candidates[0]
  console.warn(`${campaign.name}`)
  console.warn(`  ${campaign.id}`)
  console.warn(`  from ${london(String(campaign.scheduled_for))}`)
  console.warn(`  to   ${london(NEW_TIME)}`)

  assertScriptMutationAllowed({
    scriptName: 'move-october-business-christmas-email',
    envVar: 'RUN_MOVE_OCTOBER_BUSINESS_EMAIL',
  })

  const { error: draftError } = await supabase
    .from('marketing_campaigns')
    .update({ status: 'draft', scheduled_for: null, approved_recipient_count: null })
    .eq('id', campaign.id)
    .eq('status', 'scheduled')
  if (draftError) throw new Error(`could not put back to draft: ${draftError.message}`)

  try {
    const result = await scheduleCampaign(campaign.id, NEW_TIME, 'b44dd268-7c66-4163-8ff3-cc962b2d528c')
    console.warn(`  rescheduled for ${result.campaign.scheduledFor}, ${result.approvedRecipientCount} recipients`)
  } catch (rescheduleError) {
    throw new Error(
      `${campaign.name} (${campaign.id}) IS NOW A DRAFT AND WILL NOT SEND. Reschedule it by ` +
        `hand for ${NEW_TIME}. Cause: ${(rescheduleError as Error).message}`,
    )
  }

  const { data: after, error: afterError } = await supabase
    .from('marketing_campaigns')
    .select('status,scheduled_for')
    .eq('id', campaign.id)
    .single()
  if (afterError) throw new Error(afterError.message)
  if (after.status !== 'scheduled') throw new Error(`It is ${after.status}, not scheduled.`)
  console.warn(`  verified: ${after.status}, ${london(String(after.scheduled_for))}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
