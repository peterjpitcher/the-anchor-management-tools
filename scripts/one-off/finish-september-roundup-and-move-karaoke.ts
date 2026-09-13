/**
 * Applies the three answers the owner gave on 2026-09-08.
 *
 * 1. The September round-up gets a picture per event. `whats_on_list` is replaced by four
 *    `feature_card`s carrying the 16:9 landscape artwork at 536 x 302, which is the block's
 *    real aspect, so nothing is stretched. Each card keeps its own booking link, which is why
 *    `two_up_cards` was not used: its cards have no link slot.
 * 2. The round-up is scheduled for Monday 14 September at 12:00. That is the only slot the
 *    two-day cap leaves this month, between the karaoke send and the Lovely Jubbly send.
 * 3. The karaoke send moves from 11 September 12:00 to 15:00. It cleared the cap by three
 *    hours against the quiz send on the 9th, and a send takes tens of minutes to drain, so a
 *    stall would have silently skipped every recipient and still reported as completed.
 *
 * Dry run by default. RUN_SEPTEMBER_FINISH_MUTATION=true applies it.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { config } from 'dotenv'

config({ path: '.env.local' })

import { collectDestinationUrls, renderCampaignHtml } from '@/lib/email/marketing/render'
import { lintMarketingContent, marketingContentSchema, validateMarketingContent } from '@/lib/email/marketing/registry'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'
import { scheduleCampaign, updateCampaign } from '@/services/marketing-campaigns'

const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'
const ROUNDUP_UTM = 'welcome-to-september-2026'
const ROUNDUP_FILE = 'september-2026-whats-on-guests.json'
const ROUNDUP_SLOT = '2026-09-14T12:00:00+01:00'
const KARAOKE_UTM = 'big-sing-friday-karaoke-night-2026-09-18'
const KARAOKE_SLOT = '2026-09-11T15:00:00+01:00'

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

async function unschedule(id: string, name: string): Promise<void> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('marketing_campaigns')
    .update({ status: 'draft', scheduled_for: null, approved_recipient_count: null })
    .eq('id', id)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error(`${name} was not scheduled when we tried to unschedule it`)
}

async function main(): Promise<void> {
  const content = marketingContentSchema.parse(
    JSON.parse(readFileSync(path.join(process.cwd(), 'src/lib/email/marketing/campaigns', ROUNDUP_FILE), 'utf8')),
  )
  const issues = validateMarketingContent(content)
  if (issues.length > 0) throw new Error(issues.map((i) => i.message).join('; '))

  const html = renderCampaignHtml(content)
  const warnings = lintMarketingContent(content)
  const urls = collectDestinationUrls(content)

  const roundup = await fetchByUtm(ROUNDUP_UTM)
  const karaoke = await fetchByUtm(KARAOKE_UTM)

  console.warn(`${roundup.name} [${roundup.status}]`)
  console.warn(`  blocks   ${content.blocks.length}, ${html.length} bytes, ${urls.length} links`)
  console.warn(`  warnings ${warnings.length === 0 ? 'none' : warnings.join(' | ')}`)
  console.warn(`  schedule ${ROUNDUP_SLOT}`)
  console.warn(`${karaoke.name} [${karaoke.status}]`)
  console.warn(`  moves from ${karaoke.scheduled_for} to ${KARAOKE_SLOT}`)

  if (roundup.status !== 'draft') throw new Error(`Expected the round-up to be a draft, found ${roundup.status}`)
  if (karaoke.status !== 'scheduled') throw new Error(`Expected karaoke to be scheduled, found ${karaoke.status}`)

  assertScriptMutationAllowed({
    scriptName: 'finish-september-roundup-and-move-karaoke',
    envVar: 'RUN_SEPTEMBER_FINISH_MUTATION',
  })

  await updateCampaign(roundup.id, { content: content as never }, OWNER_USER_ID)
  const scheduled = await scheduleCampaign(roundup.id, ROUNDUP_SLOT, OWNER_USER_ID)
  console.warn(
    `\nround-up scheduled for ${scheduled.campaign.scheduledFor}, ${scheduled.approvedRecipientCount} recipients`,
  )

  await unschedule(karaoke.id, karaoke.name)
  const moved = await scheduleCampaign(karaoke.id, KARAOKE_SLOT, OWNER_USER_ID)
  console.warn(`karaoke moved to ${moved.campaign.scheduledFor}, ${moved.approvedRecipientCount} recipients`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
