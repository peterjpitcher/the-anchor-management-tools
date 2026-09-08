/**
 * Puts the kitchen times inline in the September round-up's opening-hours panel.
 *
 * Each row now carries both: the pub first, the kitchen second, with the note saying which is
 * which. The separate food strip underneath is removed, because it only repeated them.
 *
 * The `time` field caps at 40 characters and the cell is 374px wide (536 table, less the 140px
 * label column and 22px of padding). Measured in the 18px bold fallback the clients actually
 * use, the longest of these strings is 334px, so nothing wraps. That measurement was checked
 * against the panel that did wrap: "Lunch, Tuesday to Friday" comes out at 249px in a 118px
 * label column, which is exactly the three-line wrap that was reported.
 *
 * Dry run by default. RUN_INLINE_KITCHEN_TIMES_MUTATION=true applies it.
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

  for (const block of content.blocks) {
    if (block.type !== 'hours_table') continue
    const data = block.data as { rows: Array<{ label: string; time: string }>; note: string }
    for (const row of data.rows) {
      if (row.label.length > LABEL_CHAR_LIMIT) throw new Error(`Label "${row.label}" will wrap`)
      if (row.time.length > TIME_CHAR_LIMIT) throw new Error(`Time "${row.time}" will wrap`)
      console.warn(`  ${row.label.padEnd(4)} ${row.time}`)
    }
    console.warn(`  note: ${data.note}`)
  }

  if (content.blocks.some((block) => block.type === 'fact_strip')) {
    throw new Error('The food strip is still present; it should have been folded into the hours panel')
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
    scriptName: 'inline-kitchen-times-september-roundup',
    envVar: 'RUN_INLINE_KITCHEN_TIMES_MUTATION',
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
