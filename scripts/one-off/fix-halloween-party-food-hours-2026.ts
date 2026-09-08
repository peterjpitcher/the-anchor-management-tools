/**
 * Corrects the food hours in the Halloween party email and puts it back on its slot.
 *
 * The email quoted the ordinary Saturday kitchen hours (12pm to 7pm). 31 October has a
 * special_hours row that overrides the weekday row: full menu 12pm to 6pm, kitchen closed
 * 6pm to 9pm, pizza only from 9pm to midnight. A guest following the original copy would
 * have arrived at 6:30pm to eat and found the kitchen shut.
 *
 * Dry run by default. RUN_HALLOWEEN_FOOD_FIX_MUTATION=true applies it.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { config } from 'dotenv'

config({ path: '.env.local' })

import { marketingContentSchema, validateMarketingContent } from '@/lib/email/marketing/registry'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'
import { scheduleCampaign, updateCampaign } from '@/services/marketing-campaigns'

const UTM = 'house-of-horrors-halloween-party-2026-10-31'
const FILE = 'house-of-horrors-halloween-party-2026-guests.json'
const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'

async function main(): Promise<void> {
  const content = marketingContentSchema.parse(
    JSON.parse(readFileSync(path.join(process.cwd(), 'src/lib/email/marketing/campaigns', FILE), 'utf8')),
  )
  const issues = validateMarketingContent(content)
  if (issues.length > 0) throw new Error(issues.map((i) => i.message).join('; '))

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('marketing_campaigns')
    .select('id, name, status, scheduled_for')
    .eq('utm_campaign', UTM)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error(`No campaign with utm_campaign "${UTM}"`)

  const row = data as { id: string; name: string; status: string; scheduled_for: string | null }
  if (row.status !== 'scheduled' || !row.scheduled_for) {
    throw new Error(`Expected a scheduled campaign, found ${row.status}`)
  }

  console.warn(`${row.name} [${row.status}] sends ${row.scheduled_for}`)

  assertScriptMutationAllowed({
    scriptName: 'fix-halloween-party-food-hours-2026',
    envVar: 'RUN_HALLOWEEN_FOOD_FIX_MUTATION',
  })

  const { data: unscheduled, error: unscheduleError } = await supabase
    .from('marketing_campaigns')
    .update({ status: 'draft', scheduled_for: null, approved_recipient_count: null })
    .eq('id', row.id)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle()

  if (unscheduleError) throw new Error(unscheduleError.message)
  if (!unscheduled) throw new Error('Campaign was not scheduled when we tried to unschedule it')

  await updateCampaign(row.id, { content: content as never }, OWNER_USER_ID)
  const result = await scheduleCampaign(row.id, row.scheduled_for, OWNER_USER_ID)
  console.warn(`rescheduled for ${result.campaign.scheduledFor}, ${result.approvedRecipientCount} recipients`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
