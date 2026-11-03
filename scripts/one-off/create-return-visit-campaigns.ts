/**
 * Creates the two table-booking return-visit campaigns as DRAFTS
 * (spec tasks/spec-2026-11-02-table-booking-return-visits.md, section 7).
 *
 * Draft on purpose. Nothing sends until the owner reads each email (test send to a real
 * phone) and presses Switch On in the campaign page, which runs every check again and
 * freezes the content.
 *
 *   Touch 1: guests whose last table visit (or no-show) was 45 to 180 days ago, 10% off food,
 *            voucher valid 30 days, once per 365 days, one in five held back as the control.
 *   Touch 2: 45 days after touch 1, voucher expired unused, still no booking: 25% off food.
 *            Switched on 45 days after touch 1 first sends; nothing qualifies before then.
 *
 * Both go out on Thursdays from 4pm London (owner decision 2, 2 November 2026), under the
 * usual guest frequency cap.
 *
 * Re-runnable: an existing draft (matched on its UTM campaign) is updated in place, so a round
 * of copy feedback is one edit to the JSON and one run of this. A campaign that is no longer a
 * draft is left alone.
 *
 * Dry run by default. RUN_RETURN_VISIT_CAMPAIGNS_MUTATION=true applies it.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { config } from 'dotenv'

config({ path: '.env.local' })

import { lifecycleContentProblems, type LifecycleSettings } from '@/lib/email/marketing/lifecycle'
import { mergeCampaignContent, SAMPLE_MERGE_FIELDS } from '@/lib/email/marketing/merge'
import {
  lintMarketingContent,
  marketingContentSchema,
  validateMarketingContent,
  type MarketingContent,
} from '@/lib/email/marketing/registry'
import { collectDestinationUrls, renderCampaignHtml, renderCampaignText } from '@/lib/email/marketing/render'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'
import { createCampaign, updateCampaign } from '@/services/marketing-campaigns'

const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'
const CAMPAIGN_DIR = path.join(process.cwd(), 'src/lib/email/marketing/campaigns')

const THURSDAY = 4

interface Touch {
  file: string
  name: string
  utmCampaign: string
  settings: (previousCampaignId: string | null) => LifecycleSettings
}

const TOUCH_1: Touch = {
  file: 'return-visit-touch-1-10.json',
  name: 'Return visit - touch 1 - 10% off food',
  utmCampaign: 'return-visit-touch-1',
  settings: () => ({
    customerFilter: {
      rule: 'table_return_visit',
      touch: 1,
      days_since_anchor_min: 45,
      days_since_anchor_max: 180,
      include_no_shows: true,
      voucher_type_id: 'return-10',
      voucher_valid_days: 30,
    },
    cooldownDays: 365,
    sendDays: [THURSDAY],
    promoteAtLocal: '16:00',
    holdoutPercent: 20,
  }),
}

const TOUCH_2: Touch = {
  file: 'return-visit-touch-2-25.json',
  name: 'Return visit - touch 2 - 25% off food',
  utmCampaign: 'return-visit-touch-2',
  settings: (previousCampaignId) => ({
    customerFilter: {
      rule: 'table_return_visit',
      touch: 2,
      days_since_previous_touch_min: 45,
      previous_campaign_id: previousCampaignId,
      include_no_shows: true,
      voucher_type_id: 'return-25',
      voucher_valid_days: 30,
    },
    cooldownDays: 365,
    sendDays: [THURSDAY],
    promoteAtLocal: '16:00',
    // The control group is chosen at touch 1 and never gets touch 2 either, so none here.
    holdoutPercent: 0,
  }),
}

function loadContent(file: string): MarketingContent {
  const content = marketingContentSchema.parse(JSON.parse(readFileSync(path.join(CAMPAIGN_DIR, file), 'utf8')))
  const issues = validateMarketingContent(content)
  if (issues.length > 0) {
    throw new Error(`${file} is invalid: ${issues.map((issue) => issue.message).join('; ')}`)
  }
  return content
}

function report(touch: Touch, content: MarketingContent, settings: LifecycleSettings): void {
  const problems = lifecycleContentProblems(content, settings.customerFilter)
  if (problems.length > 0) throw new Error(`${touch.file}: ${problems.join('; ')}`)

  // Rendered with the sample guest, as the owner's test send will be.
  const sample = mergeCampaignContent(content, SAMPLE_MERGE_FIELDS)
  const html = renderCampaignHtml(sample)
  const text = renderCampaignText(sample)
  const urls = collectDestinationUrls(sample)
  const warnings = lintMarketingContent(content)

  console.warn(touch.name)
  console.warn(`  subject   ${content.title}`)
  console.warn(`  preheader ${content.preheader.length} chars`)
  console.warn(`  blocks    ${content.blocks.map((block) => block.type).join(', ')}`)
  console.warn(`  rendered  ${html.length} bytes html, ${text.length} bytes text`)
  console.warn(`  links     ${urls.length}\n${urls.map((url) => `    ${url}`).join('\n')}`)
  console.warn(`  warnings  ${warnings.length === 0 ? 'none' : warnings.join(' | ')}`)
}

async function findExisting(utmCampaign: string): Promise<{ id: string; status: string } | null> {
  const { data, error } = await createAdminClient()
    .from('marketing_campaigns')
    .select('id,status')
    .eq('utm_campaign', utmCampaign)
  if (error) throw new Error(error.message)
  return data?.[0] ?? null
}

async function upsertDraft(touch: Touch, content: MarketingContent, settings: LifecycleSettings): Promise<string | null> {
  const current = await findExisting(touch.utmCampaign)
  if (current && current.status !== 'draft') {
    console.warn(`  ${current.id} is ${current.status}, not a draft, so it is left as it is.`)
    return current.id
  }

  if (process.env.RUN_RETURN_VISIT_CAMPAIGNS_MUTATION !== 'true') {
    console.warn(`  dry run: would ${current ? `update ${current.id}` : 'create a draft'}`)
    return current?.id ?? null
  }

  assertScriptMutationAllowed({
    scriptName: 'create-return-visit-campaigns',
    envVar: 'RUN_RETURN_VISIT_CAMPAIGNS_MUTATION',
  })

  const campaign = current
    ? await updateCampaign(
        current.id,
        { subject: content.title, preheader: content.preheader, content, lifecycle: settings },
        OWNER_USER_ID,
      )
    : await createCampaign(
        {
          name: touch.name,
          subject: content.title,
          preheader: content.preheader,
          content,
          utmCampaign: touch.utmCampaign,
          lifecycle: settings,
        },
        OWNER_USER_ID,
      )

  console.warn(`  draft ${current ? 'updated' : 'created'}: ${campaign.id}`)
  console.warn(`  review it at https://management.orangejelly.co.uk/marketing/campaigns/${campaign.id}`)
  return campaign.id
}

async function main(): Promise<void> {
  const touch1Content = loadContent(TOUCH_1.file)
  const touch1Settings = TOUCH_1.settings(null)
  report(TOUCH_1, touch1Content, touch1Settings)
  const touch1Id = await upsertDraft(TOUCH_1, touch1Content, touch1Settings)
  console.warn('')

  const touch2Content = loadContent(TOUCH_2.file)
  // Touch 2 names the touch 1 campaign it follows. On a dry run with no touch 1 yet, a stand-in
  // id lets the settings be checked; nothing is written.
  const touch2Settings = TOUCH_2.settings(touch1Id ?? '00000000-0000-4000-8000-000000000000')
  report(TOUCH_2, touch2Content, touch2Settings)
  if (!touch1Id) {
    console.warn('  dry run: touch 2 is created once touch 1 exists')
    return
  }
  await upsertDraft(TOUCH_2, touch2Content, touch2Settings)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
