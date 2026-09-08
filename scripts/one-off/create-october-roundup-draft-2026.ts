/**
 * Creates the October guest round-up as a DRAFT, for the owner to read in the UI.
 *
 * Draft on purpose. The owner asked to review it before it goes anywhere, and a draft
 * cannot send: only `scheduleCampaign` freezes the content, provisions the short links and
 * puts it in front of the cron. Scheduling it is a separate decision with a separate
 * problem, which is that the two-day frequency cap leaves no slot in the first days of
 * October without moving the Halloween save the date. That is the owner's call, not this
 * script's.
 *
 * Every fact in the content JSON is read from a source rather than from last month's email:
 * events, times and prices from `events`; the week from the published `business_hours`
 * version; the 31 October row from `special_hours`; the roast and Christmas facts from the
 * website's `docs/SSOT.md`.
 *
 * Dry run by default. RUN_OCTOBER_ROUNDUP_DRAFT_MUTATION=true creates it.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { config } from 'dotenv'

config({ path: '.env.local' })

import {
  lintMarketingContent,
  marketingContentSchema,
  validateMarketingContent,
} from '@/lib/email/marketing/registry'
import { collectDestinationUrls, renderCampaignHtml, renderCampaignText } from '@/lib/email/marketing/render'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'
import { createCampaign } from '@/services/marketing-campaigns'

const CAMPAIGN_FILE = path.join(
  process.cwd(),
  'src/lib/email/marketing/campaigns/october-2026-whats-on-guests.json',
)
const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'
const CAMPAIGN_NAME = 'Welcome to October - guests - 2026'
const UTM_CAMPAIGN = 'october-2026-roundup-guests'

async function main(): Promise<void> {
  const content = marketingContentSchema.parse(JSON.parse(readFileSync(CAMPAIGN_FILE, 'utf8')))

  const issues = validateMarketingContent(content)
  if (issues.length > 0) {
    throw new Error(`Content invalid: ${issues.map((issue) => issue.message).join('; ')}`)
  }

  const html = renderCampaignHtml(content)
  const text = renderCampaignText(content)
  const urls = collectDestinationUrls(content)
  const warnings = lintMarketingContent(content)

  console.warn(CAMPAIGN_NAME)
  console.warn(`  subject   ${content.title}`)
  console.warn(`  preheader ${content.preheader.length} chars`)
  console.warn(`  blocks    ${content.blocks.length} (${content.blocks.map((b) => b.type).join(', ')})`)
  console.warn(`  rendered  ${html.length} bytes html, ${text.length} bytes text`)
  console.warn(`  links     ${urls.length}\n${urls.map((u) => `    ${u}`).join('\n')}`)
  console.warn(`  warnings  ${warnings.length === 0 ? 'none' : warnings.join(' | ')}`)

  // A second draft of the same email would sit in the list looking like a decision nobody
  // made, and the owner would have to work out which one to read.
  const supabase = createAdminClient()
  const { data: existing, error } = await supabase
    .from('marketing_campaigns')
    .select('id,status')
    .eq('utm_campaign', UTM_CAMPAIGN)
  if (error) throw new Error(error.message)
  if (existing && existing.length > 0) {
    console.warn(`\nAlready exists: ${existing.map((c) => `${c.id} (${c.status})`).join(', ')}. Nothing to do.`)
    return
  }

  assertScriptMutationAllowed({
    scriptName: 'create-october-roundup-draft-2026',
    envVar: 'RUN_OCTOBER_ROUNDUP_DRAFT_MUTATION',
  })

  const campaign = await createCampaign(
    {
      name: CAMPAIGN_NAME,
      subject: content.title,
      preheader: content.preheader,
      content,
      audienceType: 'customer',
      utmCampaign: UTM_CAMPAIGN,
    },
    OWNER_USER_ID,
  )

  console.warn(`\nDraft created: ${campaign.id} (${campaign.status})`)
  console.warn(`Review it at https://management.orangejelly.co.uk/marketing/campaigns/${campaign.id}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
