/**
 * Points every guest campaign at the JPEG artwork written by export-email-artwork-as-jpeg.
 *
 * Only the image src changes. No copy, no facts, no schedule. A scheduled campaign still has
 * to go back to draft to be edited, so each one is unscheduled, updated and scheduled again at
 * exactly the time it already had, which re-runs validation, the frequency cap check and link
 * provisioning.
 *
 * Dry run by default. RUN_JPEG_SWAP_MUTATION=true applies it.
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'
import { scheduleCampaign, updateCampaign } from '@/services/marketing-campaigns'

const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'
const PUBLIC_PREFIX = '/storage/v1/object/public/event-images/'

interface Row {
  id: string
  name: string
  status: string
  scheduled_for: string | null
  content: { blocks: Array<{ type: string; data: Record<string, unknown> }> }
}

/** Same rule the export script used, so the two cannot drift apart. */
function emailJpegUrl(url: string): string {
  return `${url.replace(/\.[a-z0-9]+$/i, '')}-email.jpg`
}

function swapImages(content: Row['content']): { content: Row['content']; swapped: string[] } {
  const clone = JSON.parse(JSON.stringify(content)) as Row['content']
  const swapped: string[] = []

  for (const block of clone.blocks) {
    const image = (block.data as { image?: { src?: string } }).image
    const src = image?.src
    if (!src || !src.includes(PUBLIC_PREFIX) || src.endsWith('-email.jpg')) continue
    image!.src = emailJpegUrl(src)
    swapped.push(`${block.type}: ${src.split('/').pop()}`)
  }

  return { content: clone, swapped }
}

async function main(): Promise<void> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('marketing_campaigns')
    .select('id, name, status, scheduled_for, content')
    .eq('audience_type', 'customer')
    .in('status', ['draft', 'scheduled'])
    .order('scheduled_for', { nullsFirst: false })

  if (error) throw new Error(error.message)

  const plan = ((data ?? []) as Row[])
    .map((row) => ({ row, ...swapImages(row.content) }))
    .filter((entry) => entry.swapped.length > 0)

  for (const entry of plan) {
    console.warn(`${entry.row.name} [${entry.row.status}]`)
    for (const swap of entry.swapped) console.warn(`    ${swap}`)
  }
  console.warn(`\n${plan.length} campaigns to update`)

  assertScriptMutationAllowed({
    scriptName: 'point-emails-at-jpeg-artwork',
    envVar: 'RUN_JPEG_SWAP_MUTATION',
  })

  for (const entry of plan) {
    const when = entry.row.status === 'scheduled' ? entry.row.scheduled_for : null

    if (when) {
      const { data: unscheduled, error: unscheduleError } = await supabase
        .from('marketing_campaigns')
        .update({ status: 'draft', scheduled_for: null, approved_recipient_count: null })
        .eq('id', entry.row.id)
        .eq('status', 'scheduled')
        .select('id')
        .maybeSingle()

      if (unscheduleError) throw new Error(unscheduleError.message)
      if (!unscheduled) throw new Error(`${entry.row.name} was not scheduled when we tried to unschedule it`)
    }

    await updateCampaign(entry.row.id, { content: entry.content as never }, OWNER_USER_ID)

    if (when) {
      const result = await scheduleCampaign(entry.row.id, when, OWNER_USER_ID)
      console.warn(`rescheduled ${entry.row.name} for ${result.campaign.scheduledFor}`)
    } else {
      console.warn(`updated ${entry.row.name}`)
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
