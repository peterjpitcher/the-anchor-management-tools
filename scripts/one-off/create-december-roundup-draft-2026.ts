/**
 * Creates the December guest round-up as a DRAFT, for the owner to read in the UI.
 *
 * Draft on purpose. The owner asked to review it before it goes anywhere, and a draft
 * cannot send: only `scheduleCampaign` freezes the content, provisions the short links and
 * puts it in front of the cron.
 *
 * It is created WITHOUT the frequency-cap exemption, because the column it lives in does not
 * exist until `20260909084500_marketing_monthly_roundup_cap_exempt.sql` is applied. Creating
 * it capped is the safe default: the flag can be set afterwards, and a draft that is capped
 * by mistake refuses to schedule, while one that is exempt by mistake reaches people twice.
 *
 * Every fact in the content JSON is read from a source rather than from last month's email:
 * events, times and prices from `events`; the week from the published `business_hours`
 * version; the 31 October row from `special_hours`; the roast and Christmas facts from the
 * website's `docs/SSOT.md`.
 *
 * Re-runnable: it updates the existing draft in place rather than adding a second one, so
 * a round of the owner's feedback is one edit to the JSON and one run of this.
 *
 * Dry run by default. RUN_DECEMBER_ROUNDUP_DRAFT_MUTATION=true applies it.
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
import { createCampaign, updateCampaign } from '@/services/marketing-campaigns'

const CAMPAIGN_FILE = path.join(
  process.cwd(),
  'src/lib/email/marketing/campaigns/december-2026-whats-on-guests.json',
)
const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'
const CAMPAIGN_NAME = 'Welcome to December - guests - 2026'
const UTM_CAMPAIGN = 'december-2026-roundup-guests'

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

  // Run again after an edit and this updates the draft in place rather than leaving a second
  // one in the list looking like a decision nobody made. The owner is reading this campaign
  // at a URL, so the URL has to keep meaning the same email.
  const supabase = createAdminClient()
  const { data: existing, error } = await supabase
    .from('marketing_campaigns')
    .select('id,status')
    .eq('utm_campaign', UTM_CAMPAIGN)
  if (error) throw new Error(error.message)

  const current = existing?.[0]
  if (current && current.status !== 'draft') {
    console.warn(
      `\n${current.id} is ${current.status}, not a draft, so its content is frozen. ` +
        'Put it back to draft first if it really needs editing.',
    )
    return
  }

  assertScriptMutationAllowed({
    scriptName: 'create-december-roundup-draft-2026',
    envVar: 'RUN_DECEMBER_ROUNDUP_DRAFT_MUTATION',
  })

  const campaign = current
    ? await updateCampaign(
        current.id,
        { subject: content.title, preheader: content.preheader, content },
        OWNER_USER_ID,
      )
    : await createCampaign(
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

  console.warn(`\nDraft ${current ? 'updated' : 'created'}: ${campaign.id} (${campaign.status})`)
  console.warn(`Review it at https://management.orangejelly.co.uk/marketing/campaigns/${campaign.id}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
