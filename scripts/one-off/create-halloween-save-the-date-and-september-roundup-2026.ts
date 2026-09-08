/**
 * Creates the Halloween save the date (scheduled) and the September round-up (draft only).
 *
 * The party now gets two emails under the owner's rule of 2026-09-08: a month before and a
 * week before. A month before 31 October is 1 October, which sits one day after the Halloween
 * quiz send and would be refused by the two-day frequency cap. It went out on Saturday 3 October
 * instead: 2 October clears the cap by only three hours, and 3 October clears it by three days,
 * which is worth more than the one day of extra notice. The week-before email is on 24 October.
 *
 * The September round-up is created as a DRAFT and deliberately not scheduled. The owner asked
 * for a draft, and the only slot the cap leaves this month is Monday 14 September at 12:00:
 * the karaoke send is 11 September 12:00 and the Lovely Jubbly send is 18 September 12:00, so
 * anything earlier or later collides.
 *
 * Dry run by default. RUN_HALLOWEEN_AND_ROUNDUP_MUTATION=true applies it.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { config } from 'dotenv'

config({ path: '.env.local' })

import { collectDestinationUrls, renderCampaignHtml } from '@/lib/email/marketing/render'
import { lintMarketingContent, marketingContentSchema, validateMarketingContent } from '@/lib/email/marketing/registry'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createCampaign, scheduleCampaign } from '@/services/marketing-campaigns'

const CAMPAIGN_DIR = path.join(process.cwd(), 'src/lib/email/marketing/campaigns')
const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'

interface Plan {
  file: string
  name: string
  utmCampaign: string
  /** London wall-clock time with an explicit offset, or null to leave it as a draft. */
  scheduledFor: string | null
}

const PLANS: Plan[] = [
  {
    file: 'house-of-horrors-halloween-party-save-the-date-2026-guests.json',
    name: 'House of Horrors Halloween Party save the date - guests - 31 Oct 2026',
    utmCampaign: 'house-of-horrors-halloween-party-save-the-date-2026-10-03',
    scheduledFor: '2026-10-03T12:00:00+01:00',
  },
  {
    file: 'september-2026-whats-on-guests.json',
    name: 'Welcome to September - guests - 2026',
    utmCampaign: 'welcome-to-september-2026',
    scheduledFor: null,
  },
]

async function main(): Promise<void> {
  const prepared = PLANS.map((plan) => {
    const content = marketingContentSchema.parse(
      JSON.parse(readFileSync(path.join(CAMPAIGN_DIR, plan.file), 'utf8')),
    )
    const issues = validateMarketingContent(content)
    if (issues.length > 0) {
      throw new Error(`${plan.file} invalid: ${issues.map((i) => i.message).join('; ')}`)
    }

    const html = renderCampaignHtml(content)
    const warnings = lintMarketingContent(content)
    const urls = collectDestinationUrls(content)

    console.warn(plan.name)
    console.warn(`  subject   ${content.title}`)
    console.warn(`  preheader ${content.preheader.length} chars`)
    console.warn(`  blocks    ${content.blocks.length}, ${html.length} bytes`)
    console.warn(`  links     ${urls.length}\n${urls.map((u) => `    ${u}`).join('\n')}`)
    console.warn(`  warnings  ${warnings.length === 0 ? 'none' : warnings.join(' | ')}`)
    console.warn(`  schedule  ${plan.scheduledFor ?? 'left as a draft'}`)

    return { plan, content }
  })

  assertScriptMutationAllowed({
    scriptName: 'create-halloween-save-the-date-and-september-roundup-2026',
    envVar: 'RUN_HALLOWEEN_AND_ROUNDUP_MUTATION',
  })

  for (const { plan, content } of prepared) {
    const campaign = await createCampaign(
      {
        name: plan.name,
        subject: content.title,
        preheader: content.preheader,
        content,
        audienceType: 'customer',
        utmCampaign: plan.utmCampaign,
      },
      OWNER_USER_ID,
    )
    console.warn(`\nDraft ${campaign.id}  ${plan.name}`)

    if (plan.scheduledFor) {
      const result = await scheduleCampaign(campaign.id, plan.scheduledFor, OWNER_USER_ID)
      console.warn(`  scheduled for ${result.campaign.scheduledFor}, ${result.approvedRecipientCount} recipients`)
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
