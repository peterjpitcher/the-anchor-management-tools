/**
 * Moves the September round-up onto the new `opening_times` block.
 *
 * The owner supplied the pub's printed opening-times sheet and asked for that layout: a day
 * against its bar hours and its kitchen hours, with lunch and dinner labelled separately where
 * a day has both. `hours_table` cannot express it, so `opening_times` was added rather than
 * bending the existing block, which is fidelity-tested against the designer's handover.
 *
 * Every value comes from the published business_hours version in force, not from the printed
 * sheet, with one exception noted to the owner: the sheet says lunch runs 1pm to 3pm Tuesday
 * to Friday, while business_hours says 12pm to 3pm. The database wins here because it is what
 * the booking system honours and what the website API serves.
 *
 * The "we may stay open until midnight" line on Friday and Saturday is the pub's own wording,
 * taken from that printed sheet, and is hedged there as it is here.
 *
 * Dry run by default. RUN_OPENING_TIMES_BLOCK_MUTATION=true applies it.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { config } from 'dotenv'

config({ path: '.env.local' })

import { marketingContentSchema, validateMarketingContent } from '@/lib/email/marketing/registry'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'
import { scheduleCampaign, updateCampaign } from '@/services/marketing-campaigns'

const UTM = 'welcome-to-september-2026'
const FILE = 'september-2026-whats-on-guests.json'
const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'

/** Widest string the 374px time cell takes in the 18px bold fallback, with margin. */
const TIME_CHAR_LIMIT = 36
/** The label column is 118px of usable width in 22px serif. */
const LABEL_CHAR_LIMIT = 8

async function main(): Promise<void> {
  const content = marketingContentSchema.parse(
    JSON.parse(readFileSync(path.join(process.cwd(), 'src/lib/email/marketing/campaigns', FILE), 'utf8')),
  )
  const issues = validateMarketingContent(content)
  if (issues.length > 0) throw new Error(issues.map((i) => i.message).join('; '))

  const panel = content.blocks.find((block) => block.type === 'opening_times')
  if (!panel) throw new Error('The round-up is not using the opening_times block')
  const panelData = panel.data as {
    rows: Array<{ day: string; bar: string; bar_note?: string; kitchen: unknown }>
    note: string
  }
  if (panelData.rows.length !== 7) throw new Error(`Expected all seven days, found ${panelData.rows.length}`)
  for (const row of panelData.rows) {
    const kitchen = Array.isArray(row.kitchen)
      ? (row.kitchen as Array<{ label: string; time: string }>).map((s) => `${s.label} ${s.time}`).join(', ')
      : String(row.kitchen)
    console.warn(`  ${row.day.padEnd(10)} bar ${row.bar.padEnd(13)} kitchen ${kitchen}`)
  }

  if (content.blocks.some((block) => block.type === 'hours_table')) {
    throw new Error('The old hours_table block is still present')
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('marketing_campaigns')
    .select('id, name, status, scheduled_for')
    .eq('utm_campaign', UTM)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error(`No campaign with utm_campaign "${UTM}"`)

  const row = data as { id: string; name: string; status: string; scheduled_for: string | null }
  console.warn(`\n${row.name} [${row.status}] sends ${row.scheduled_for}`)

  assertScriptMutationAllowed({
    scriptName: 'use-opening-times-block-september-roundup',
    envVar: 'RUN_OPENING_TIMES_BLOCK_MUTATION',
  })

  const when = row.status === 'scheduled' ? row.scheduled_for : null

  if (when) {
    const { data: unscheduled, error: unscheduleError } = await supabase
      .from('marketing_campaigns')
      .update({ status: 'draft', scheduled_for: null, approved_recipient_count: null })
      .eq('id', row.id)
      .eq('status', 'scheduled')
      .select('id')
      .maybeSingle()

    if (unscheduleError) throw new Error(unscheduleError.message)
    if (!unscheduled) throw new Error('Campaign was not scheduled when we tried to unschedule it')
  }

  await updateCampaign(row.id, { content: content as never }, OWNER_USER_ID)

  if (when) {
    const result = await scheduleCampaign(row.id, when, OWNER_USER_ID)
    console.warn(`rescheduled for ${result.campaign.scheduledFor}, ${result.approvedRecipientCount} recipients`)
  } else {
    console.warn('updated')
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
