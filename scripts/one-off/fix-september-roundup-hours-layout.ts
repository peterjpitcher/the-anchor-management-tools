/**
 * Reflows the opening-hours panel in the September round-up.
 *
 * The hours_table label column is a fixed 140px with 22px left padding, set in 22px serif,
 * so a label longer than about eight characters wraps. "Lunch, Tuesday to Friday" wrapped to
 * three lines while its time stayed vertically centred beside it, which read as broken. The
 * block markup is byte-fidelity-tested against the designer's handover, so the fix belongs in
 * the content: short day labels, with the qualifier moved into the time column.
 *
 * Dry run by default. RUN_HOURS_LAYOUT_FIX_MUTATION=true applies it.
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
    scriptName: 'fix-september-roundup-hours-layout',
    envVar: 'RUN_HOURS_LAYOUT_FIX_MUTATION',
  })

  await updateCampaign(row.id, { content: content as never }, OWNER_USER_ID)
  console.warn('updated')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
