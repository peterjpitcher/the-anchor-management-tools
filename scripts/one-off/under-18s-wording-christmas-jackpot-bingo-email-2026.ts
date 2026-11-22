/**
 * Brings the Christmas Jackpot Cash Bingo guest email into line with the under-18s rule.
 *
 * The owner changed the rule on 22 November 2026 ("Under-18s can stay after 9 pm as long as
 * they're accompanied by their parents", live in #395) and approved this one sentence for the
 * scheduled email the same day ("Yes, change it").
 *
 * ONE SENTENCE CHANGES. The stored row is what sends, so this edits the stored content and
 * nothing else. Exactly one occurrence of the old sentence must be present, or it stops.
 *
 * SCHEDULING FREEZES CONTENT, so the campaign goes back to draft, is edited and is scheduled
 * again at exactly the same time. A draft left behind sends nothing, silently, so the row is
 * read back and asserted `scheduled` at the same instant.
 *
 * Dry run by default. RUN_UNDER_18S_WORDING_CHRISTMAS_JACKPOT_BINGO=true applies it.
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { marketingContentSchema, validateMarketingContent } from '@/lib/email/marketing/registry'
import { renderCampaignHtml } from '@/lib/email/marketing/render'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'
import { scheduleCampaign, updateCampaign } from '@/services/marketing-campaigns'

const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'

/** Christmas Jackpot Cash Bingo, guests, sends Wednesday 9 December 2026 at 09:00. */
const CAMPAIGN_ID = 'a2e196dc-7908-46b0-bd69-8881e86a9e78'

const OLD_SENTENCE =
  '18+ to play. Supervised under-18s are welcome to attend until 9pm but may not play. Include everyone attending in your booking.'
const NEW_SENTENCE =
  '18+ to play. Supervised under-18s are welcome to attend but may not play. After 9pm they need their parents with them. Include everyone attending in your booking.'

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

async function main(): Promise<void> {
  const supabase = createAdminClient()
  const { data: row, error } = await supabase
    .from('marketing_campaigns')
    .select('id,name,status,scheduled_for,ignores_frequency_cap,subject,preheader,content')
    .eq('id', CAMPAIGN_ID)
    .single()
  if (error) throw new Error(error.message)
  if (row.status !== 'scheduled') throw new Error(`${row.name} is ${row.status}, not scheduled. Stopping.`)

  const before = JSON.stringify(row.content)
  if (count(before, NEW_SENTENCE) === 1 && count(before, OLD_SENTENCE) === 0) {
    console.warn(`${row.name} already carries the new sentence. Nothing to do.`)
    return
  }
  if (count(before, OLD_SENTENCE) !== 1) {
    throw new Error(`${row.name}: expected the old sentence once, found ${count(before, OLD_SENTENCE)}. Stopping.`)
  }
  if (`${row.subject} ${row.preheader}`.includes('until 9pm')) {
    throw new Error(`${row.name}: the subject or preheader also mentions the old rule. Stopping.`)
  }

  const next = marketingContentSchema.parse(JSON.parse(before.replace(OLD_SENTENCE, NEW_SENTENCE)))
  const issues = validateMarketingContent(next)
  if (issues.length > 0) throw new Error(issues.map((issue) => issue.message).join('; '))
  const html = renderCampaignHtml(next)
  if (html.includes('until 9pm')) throw new Error('The rendered email still says "until 9pm". Stopping.')

  const scheduledFor = String(row.scheduled_for)
  const exempt = Boolean(row.ignores_frequency_cap)
  console.warn(`${row.name}: ${scheduledFor}, cap exempt ${exempt}, ${html.length}B, 1 sentence to change.`)

  assertScriptMutationAllowed({
    scriptName: 'under-18s-wording-christmas-jackpot-bingo-email-2026',
    envVar: 'RUN_UNDER_18S_WORDING_CHRISTMAS_JACKPOT_BINGO',
  })

  const { data: drafted, error: draftError } = await supabase
    .from('marketing_campaigns')
    .update({ status: 'draft', scheduled_for: null, approved_recipient_count: null })
    .eq('id', CAMPAIGN_ID)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle()
  if (draftError) throw new Error(`Could not put back to draft: ${draftError.message}`)
  if (!drafted) throw new Error('It was no longer scheduled. Nothing changed. Stopping.')

  try {
    await updateCampaign(CAMPAIGN_ID, { content: next }, OWNER_USER_ID)
    const result = await scheduleCampaign(CAMPAIGN_ID, scheduledFor, OWNER_USER_ID)
    console.warn(`  rescheduled for ${result.campaign.scheduledFor}, ${result.approvedRecipientCount} recipients`)
  } catch (rescheduleError) {
    throw new Error(
      `${row.name} (${CAMPAIGN_ID}) IS NOW A DRAFT AND WILL NOT SEND. Reschedule it for ` +
        `${scheduledFor} by hand. Cause: ${(rescheduleError as Error).message}`,
    )
  }

  const { data: after, error: afterError } = await supabase
    .from('marketing_campaigns')
    .select('status,scheduled_for,ignores_frequency_cap,content')
    .eq('id', CAMPAIGN_ID)
    .single()
  if (afterError) throw new Error(`Could not read back: ${afterError.message}`)
  if (after.status !== 'scheduled') throw new Error(`It is ${after.status}, not scheduled. Stopping.`)
  if (new Date(String(after.scheduled_for)).getTime() !== new Date(scheduledFor).getTime()) {
    throw new Error(`It moved from ${scheduledFor} to ${after.scheduled_for}. Stopping.`)
  }
  if (Boolean(after.ignores_frequency_cap) !== exempt) throw new Error('Its frequency-cap exemption changed. Stopping.')
  const stored = JSON.stringify(after.content)
  if (count(stored, NEW_SENTENCE) !== 1 || count(stored, OLD_SENTENCE) !== 0) {
    throw new Error('The stored content does not carry the new sentence exactly once. Stopping.')
  }
  if (stored.length - before.length !== NEW_SENTENCE.length - OLD_SENTENCE.length) {
    throw new Error('More than the one sentence changed. Check the stored content.')
  }
  console.warn(`  verified: scheduled, ${after.scheduled_for}, new sentence stored, cap exempt ${after.ignores_frequency_cap}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
