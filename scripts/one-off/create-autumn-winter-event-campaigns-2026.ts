/**
 * Creates the guest marketing emails for the autumn and winter events that had artwork but
 * no campaign, and optionally schedules them.
 *
 * Dry run by default: validates and renders every campaign, prints the tracked links and the
 * proposed send slot, and writes an HTML preview per campaign when CAMPAIGN_PREVIEW_DIR is set.
 *
 *   RUN_EVENT_CAMPAIGNS_MUTATION=true   creates each one as a draft
 *   SCHEDULE_EVENT_CAMPAIGNS=true       also schedules the drafts (needs the flag above)
 *
 * Send slots follow the cadence every other guest event email uses: seven days before the
 * event, on the same weekday, 09:00 London for a midweek event and 12:00 for a Friday or
 * Saturday one. Offsets are written out because British summer time ends on 25 October 2026.
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

interface CampaignPlan {
  file: string
  name: string
  utmCampaign: string
  /** London wall-clock time with an explicit offset. */
  scheduledFor: string
}

const PLANS: CampaignPlan[] = [
  {
    file: 'screams-and-soundtracks-music-bingo-2026-guests.json',
    name: 'Screams & Soundtracks Music Bingo - guests - 16 Oct 2026',
    utmCampaign: 'screams-and-soundtracks-music-bingo-2026-10-16',
    scheduledFor: '2026-10-09T12:00:00+01:00',
  },
  {
    file: 'house-of-horrors-halloween-party-2026-guests.json',
    name: 'House of Horrors Halloween Party - guests - 31 Oct 2026',
    utmCampaign: 'house-of-horrors-halloween-party-2026-10-31',
    scheduledFor: '2026-10-24T12:00:00+01:00',
  },
  {
    file: 'sparks-and-sparklers-quiz-night-2026-guests.json',
    name: 'Sparks & Sparklers Quiz Night - guests - 4 Nov 2026',
    utmCampaign: 'sparks-and-sparklers-quiz-night-2026-11-04',
    scheduledFor: '2026-10-28T09:00:00+00:00',
  },
  {
    file: 'sequins-and-showstoppers-music-bingo-2026-guests.json',
    name: 'Sequins & Showstoppers Music Bingo - guests - 13 Nov 2026',
    utmCampaign: 'sequins-and-showstoppers-music-bingo-2026-11-13',
    scheduledFor: '2026-11-06T12:00:00+00:00',
  },
  {
    file: 'snowball-showdown-cash-bingo-2026-guests.json',
    name: 'Snowball Showdown Cash Bingo - guests - 18 Nov 2026',
    utmCampaign: 'snowball-showdown-cash-bingo-2026-11-18',
    scheduledFor: '2026-11-11T09:00:00+00:00',
  },
  {
    file: 'tinsel-and-trivia-quiz-night-2026-guests.json',
    name: 'Tinsel & Trivia Quiz Night - guests - 2 Dec 2026',
    utmCampaign: 'tinsel-and-trivia-quiz-night-2026-12-02',
    scheduledFor: '2026-11-25T09:00:00+00:00',
  },
  {
    file: 'sleigh-my-name-festive-music-bingo-2026-guests.json',
    name: 'Sleigh My Name Festive Music Bingo - guests - 11 Dec 2026',
    utmCampaign: 'sleigh-my-name-festive-music-bingo-2026-12-11',
    scheduledFor: '2026-12-04T12:00:00+00:00',
  },
  {
    file: 'christmas-jackpot-cash-bingo-2026-guests.json',
    name: 'Christmas Jackpot Cash Bingo - guests - 16 Dec 2026',
    utmCampaign: 'christmas-jackpot-cash-bingo-2026-12-16',
    scheduledFor: '2026-12-09T09:00:00+00:00',
  },
]

const CAMPAIGN_DIR = path.join(process.cwd(), 'src/lib/email/marketing/campaigns')
const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'

const LONDON = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

async function main(): Promise<void> {
  const previewDir = process.env.CAMPAIGN_PREVIEW_DIR
  const preview = await previewAudience({ audienceType: 'customer' })
  console.warn(`Guest audience: ${preview.eligibleCount} eligible\n`)

  const prepared = PLANS.map((plan) => {
    const content = marketingContentSchema.parse(
      JSON.parse(readFileSync(path.join(CAMPAIGN_DIR, plan.file), 'utf8')),
    )

    const issues = validateMarketingContent(content)
    if (issues.length > 0) {
      throw new Error(
        `${plan.file} is invalid:\n${issues.map((i) => `  [${i.index}] ${i.type}: ${i.message}`).join('\n')}`,
      )
    }

    const html = renderCampaignHtml(content)
    const warnings = lintMarketingContent(content)
    const urls = collectDestinationUrls(content)

    if (previewDir) {
      writeFileSync(path.join(previewDir, plan.file.replace(/\.json$/, '.html')), html, 'utf8')
    }

    console.warn(plan.name)
    console.warn(`  subject   ${content.title}`)
    console.warn(`  preheader ${content.preheader.length} chars`)
    console.warn(`  blocks    ${content.blocks.length}, ${html.length} bytes, ${urls.length} links`)
    console.warn(`  sends     ${LONDON.format(new Date(plan.scheduledFor))} London`)
    console.warn(`  warnings  ${warnings.length === 0 ? 'none' : warnings.join(' | ')}`)

    return { plan, content }
  })

  assertScriptMutationAllowed({
    scriptName: 'create-autumn-winter-event-campaigns-2026',
    envVar: 'RUN_EVENT_CAMPAIGNS_MUTATION',
  })

  const shouldSchedule = process.env.SCHEDULE_EVENT_CAMPAIGNS === 'true'

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

    if (shouldSchedule) {
      const result = await scheduleCampaign(campaign.id, plan.scheduledFor, OWNER_USER_ID)
      console.warn(`  scheduled for ${result.campaign.scheduledFor}, ${result.approvedRecipientCount} recipients`)
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
