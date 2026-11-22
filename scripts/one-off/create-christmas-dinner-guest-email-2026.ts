/**
 * Creates the Christmas dinner guest email as a DRAFT.
 *
 * The owner approved the wording, the guest list and the send time in chat on 22 November
 * 2026: Sunday 29 November 2026 at 9am. This script only makes the draft. Scheduling goes
 * through `scheduleMarketingCampaign`, so the banned-claim, frequency-cap and closure-copy
 * guards all run before anything is booked in.
 *
 * A script rather than the app's own create action, because that action has no audience
 * field and makes a business-list campaign. Guest campaigns are created here, the same way
 * the monthly round-ups are.
 *
 * NOT exempt from the frequency cap: only the monthly round-up is. If the slot collides with
 * another guest send, scheduling refuses, and that is the answer to take back to the owner.
 *
 * Every fact in the content JSON is from the website's `docs/SSOT.md` (sections 7 and 16).
 * The "from" price was read from the live Christmas page on 22 November 2026.
 *
 * Re-runnable: it updates the existing draft in place rather than adding a second one.
 *
 * Dry run by default. RUN_CHRISTMAS_DINNER_GUEST_EMAIL_MUTATION=true applies it.
 * CHRISTMAS_DINNER_GUEST_EMAIL_HTML_OUT=<path> also writes the rendered email to that file,
 * so it can be looked at before it is scheduled.
 */
import { readFileSync, writeFileSync } from 'node:fs'
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
  'src/lib/email/marketing/campaigns/christmas-dinner-2026-guests.json',
)
const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'
const CAMPAIGN_NAME = 'Christmas dinner - guests - 2026'
const UTM_CAMPAIGN = 'christmas-dinner-2026-guests'

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

  const htmlOut = process.env.CHRISTMAS_DINNER_GUEST_EMAIL_HTML_OUT
  if (htmlOut) {
    writeFileSync(htmlOut, html, 'utf8')
    console.warn(`  html      written to ${htmlOut}`)
  }

  // Run again after an edit and this updates the draft in place rather than leaving a second
  // one in the list. Once it is scheduled the content is frozen, so it is left alone.
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
    scriptName: 'create-christmas-dinner-guest-email-2026',
    envVar: 'RUN_CHRISTMAS_DINNER_GUEST_EMAIL_MUTATION',
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
