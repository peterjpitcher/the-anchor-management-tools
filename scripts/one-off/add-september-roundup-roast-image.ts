/**
 * Gives the Sunday roast a photograph in the September round-up.
 *
 * feature_card is the block for this: its own documentation says it is for one thing that
 * deserves a picture, and its sample is the Sunday roast. The image slot is drawn at
 * 536 x 230, and the site's roast hero is 1916 x 821, the same 2.33 aspect at better than
 * twice the render size, so it fits the designer's slot exactly with no distortion.
 *
 * The events stay in whats_on_list, which is the design system's own monthly round-up block
 * and is deliberately text-only: a date badge, a line and a booking link per event. Their
 * artwork is poster PNGs of 3 to 5MB each, and resizing barely helps because PNG ignores the
 * quality setting, so four of them would turn a 22KB email into several megabytes.
 *
 * Dry run by default. RUN_ROAST_IMAGE_MUTATION=true applies it.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { config } from 'dotenv'

config({ path: '.env.local' })

import { marketingContentSchema, validateMarketingContent } from '@/lib/email/marketing/registry'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'
import { updateCampaign } from '@/services/marketing-campaigns'

const UTM = 'welcome-to-september-2026'
const FILE = 'september-2026-whats-on-guests.json'
const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'

/** Longest label proven to render on one line in the live preview. */
const LABEL_LIMIT = 8

async function main(): Promise<void> {
  const content = marketingContentSchema.parse(
    JSON.parse(readFileSync(path.join(process.cwd(), 'src/lib/email/marketing/campaigns', FILE), 'utf8')),
  )
  const issues = validateMarketingContent(content)
  if (issues.length > 0) throw new Error(issues.map((i) => i.message).join('; '))

  for (const block of content.blocks) {
    if (block.type !== 'hours_table') continue
    const rows = (block.data as { rows: Array<{ label: string; time: string }> }).rows
    for (const row of rows) {
      if (row.label.length > LABEL_LIMIT) {
        throw new Error(`Label "${row.label}" is ${row.label.length} characters and will wrap`)
      }
      console.warn(`  ${row.label.padEnd(9)} ${row.time}`)
    }
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('marketing_campaigns')
    .select('id, name, status')
    .eq('utm_campaign', UTM)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error(`No campaign with utm_campaign "${UTM}"`)

  const row = data as { id: string; name: string; status: string }
  console.warn(`${row.name} [${row.status}]`)
  if (row.status !== 'draft') {
    throw new Error(`Expected a draft, found ${row.status}. A scheduled campaign needs the unschedule dance.`)
  }

  assertScriptMutationAllowed({
    scriptName: 'add-september-roundup-roast-image',
    envVar: 'RUN_ROAST_IMAGE_MUTATION',
  })

  await updateCampaign(row.id, { content: content as never }, OWNER_USER_ID)
  console.warn('updated')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
