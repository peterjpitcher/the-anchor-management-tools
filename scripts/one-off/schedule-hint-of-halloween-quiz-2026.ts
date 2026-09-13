/**
 * Creates and schedules the guest marketing email for A Hint of Halloween Quiz Night
 * (Wednesday 7 October 2026).
 *
 * Dry run by default: it validates and renders the content and prints every link that will be
 * tracked. Set RUN_HALLOWEEN_QUIZ_CAMPAIGN_MUTATION=true to actually create the draft and
 * schedule it.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { config } from 'dotenv'

config({ path: '.env.local' })

import { collectDestinationUrls, renderCampaignHtml } from '@/lib/email/marketing/render'
import { lintMarketingContent, marketingContentSchema, validateMarketingContent } from '@/lib/email/marketing/registry'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createCampaign, scheduleCampaign } from '@/services/marketing-campaigns'
import { previewAudience } from '@/services/marketing-contacts'

const CONTENT_PATH = path.join(
  process.cwd(),
  'src/lib/email/marketing/campaigns/hint-of-halloween-quiz-night-2026-guests.json',
)
const CAMPAIGN_NAME = 'A Hint of Halloween Quiz Night - guests - 7 Oct 2026'
const UTM_CAMPAIGN = 'hint-of-halloween-quiz-night-2026-10-07'
// Seven days before the event, at 9am London, matching every other guest event email.
const SCHEDULED_FOR = '2026-09-30T09:00:00+01:00'
const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'

async function main(): Promise<void> {
  const raw = JSON.parse(readFileSync(CONTENT_PATH, 'utf8'))
  const content = marketingContentSchema.parse(raw)

  const issues = validateMarketingContent(content)
  if (issues.length > 0) {
    throw new Error(`Content is invalid:\n${issues.map((i) => `  [${i.index}] ${i.type}: ${i.message}`).join('\n')}`)
  }

  const warnings = lintMarketingContent(content)
  const html = renderCampaignHtml(content)
  const urls = collectDestinationUrls(content)
  const preview = await previewAudience({ audienceType: 'customer' })

  console.warn(`Subject:    ${content.title}`)
  console.warn(`Preheader:  ${content.preheader} (${content.preheader.length} chars)`)
  console.warn(`Blocks:     ${content.blocks.length} (${content.blocks.map((b) => b.type).join(', ')})`)
  console.warn(`Rendered:   ${html.length} bytes`)
  console.warn(`Links:      ${urls.length}\n${urls.map((u) => `  ${u}`).join('\n')}`)
  console.warn(`Audience:   ${preview.eligibleCount} eligible customers`)
  console.warn(`Warnings:   ${warnings.length === 0 ? 'none' : `\n${warnings.map((w) => `  ${w}`).join('\n')}`}`)
  console.warn(`Schedule:   ${SCHEDULED_FOR}`)

  const previewPath = process.env.CAMPAIGN_PREVIEW_HTML_PATH
  if (previewPath) {
    writeFileSync(previewPath, html, 'utf8')
    console.warn(`Preview:    ${previewPath}`)
  }

  assertScriptMutationAllowed({
    scriptName: 'schedule-hint-of-halloween-quiz-2026',
    envVar: 'RUN_HALLOWEEN_QUIZ_CAMPAIGN_MUTATION',
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
  console.warn(`Created draft ${campaign.id}`)

  const result = await scheduleCampaign(campaign.id, SCHEDULED_FOR, OWNER_USER_ID)
  console.warn(`Scheduled ${result.campaign.id} for ${result.campaign.scheduledFor} to ${result.approvedRecipientCount} recipients`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
