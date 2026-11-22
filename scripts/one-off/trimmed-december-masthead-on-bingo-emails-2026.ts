/**
 * Points the two December bingo emails at the trimmed December masthead.
 *
 * The December masthead has a white band above and below the green. The owner had it trimmed
 * for the Christmas dinner email and the two 1 December round-ups on 22 November 2026, then
 * said "Yes, switch both" for these two, the last scheduled emails on the untrimmed file.
 *
 * ONLY THE IMAGE URL CHANGES. The stored row is what sends, so this edits the stored content
 * and nothing else: same alt text, same blocks, same wording. The repo JSON for these two
 * still shows the plain green masthead they were first written with and is left as it is.
 *
 * SCHEDULING FREEZES CONTENT, so each one goes back to draft, is edited and is scheduled
 * again at exactly the same time, as `trimmed-december-masthead-on-roundups-2026.ts` does.
 * A draft left behind sends nothing, silently, so each row is read back and asserted
 * `scheduled` at the same instant before the next is touched.
 *
 * Any other scheduled campaign still on the untrimmed file is listed, not changed.
 *
 * Dry run by default. RUN_TRIMMED_DECEMBER_MASTHEAD_BINGO=true applies it.
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { marketingContentSchema, validateMarketingContent } from '@/lib/email/marketing/registry'
import { renderCampaignHtml } from '@/lib/email/marketing/render'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'
import { scheduleCampaign, updateCampaign } from '@/services/marketing-campaigns'

const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'
const BASE =
  'https://tfcasgxopxegwrabvwat.supabase.co/storage/v1/object/public/event-images/marketing/seasonal-masthead'
const OLD_URL = `${BASE}/12-december.jpg`
const NEW_URL = `${BASE}/12-december-trimmed.jpg`

/**
 * Sleigh My Name Festive Music Bingo (sends Friday 4 December 2026 at 12:00) and
 * Christmas Jackpot Cash Bingo (sends Wednesday 9 December 2026 at 09:00).
 */
const TARGET_IDS = ['c9a5618c-008e-4e7b-b624-d49141cc9f91', 'a2e196dc-7908-46b0-bd69-8881e86a9e78']

async function main(): Promise<void> {
  const probe = await fetch(NEW_URL, { method: 'HEAD' })
  if (!probe.ok) throw new Error(`The trimmed masthead is not published: ${probe.status}`)

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('marketing_campaigns')
    .select('id,name,status,audience_type,scheduled_for,ignores_frequency_cap,content')
    .in('status', ['scheduled', 'draft'])
    .order('scheduled_for')
  if (error) throw new Error(error.message)

  const usingOld = (data ?? []).filter((row) => JSON.stringify(row.content).includes(OLD_URL))
  const others = usingOld.filter((row) => !TARGET_IDS.includes(String(row.id)))
  for (const row of others) {
    console.warn(`left alone, still on the untrimmed file: ${row.name} (${row.status})`)
  }

  const plan = TARGET_IDS.map((id) => {
    const row = (data ?? []).find((candidate) => String(candidate.id) === id)
    if (!row) throw new Error(`${id} is not scheduled or a draft. Stopping before anything changes.`)
    if (row.status !== 'scheduled') throw new Error(`${row.name} is ${row.status}, not scheduled. Stopping.`)

    const content = marketingContentSchema.parse(row.content)
    const first = content.blocks[0]
    if (first.type !== 'masthead_seasonal') throw new Error(`${row.name} starts with ${first.type}. Stopping.`)
    const current = (first.data as { image_url: string; alt: string }).image_url
    const next = {
      ...content,
      blocks: [{ type: first.type, data: { ...first.data, image_url: NEW_URL } }, ...content.blocks.slice(1)],
    }
    const issues = validateMarketingContent(next)
    if (issues.length > 0) throw new Error(`${row.name}: ${issues.map((issue) => issue.message).join('; ')}`)

    return {
      id,
      name: String(row.name),
      scheduledFor: String(row.scheduled_for),
      exempt: Boolean(row.ignores_frequency_cap),
      done: current === NEW_URL,
      wrong: current !== NEW_URL && current !== OLD_URL ? current : null,
      content: next,
      bytes: renderCampaignHtml(next).length,
    }
  })

  for (const item of plan) {
    if (item.wrong) throw new Error(`${item.name} has an unexpected masthead: ${item.wrong}. Stopping.`)
    console.warn(
      `${item.name}: ${item.scheduledFor}, cap exempt ${item.exempt}, ${item.bytes}B` +
        (item.done ? '  (already trimmed, will be left alone)' : ''),
    )
  }

  const work = plan.filter((item) => !item.done)
  console.warn(`\n${work.length} to change.`)

  assertScriptMutationAllowed({
    scriptName: 'trimmed-december-masthead-on-bingo-emails-2026',
    envVar: 'RUN_TRIMMED_DECEMBER_MASTHEAD_BINGO',
  })

  for (const item of work) {
    console.warn(`\n${item.name}`)

    const { data: drafted, error: draftError } = await supabase
      .from('marketing_campaigns')
      .update({ status: 'draft', scheduled_for: null, approved_recipient_count: null })
      .eq('id', item.id)
      .eq('status', 'scheduled')
      .select('id')
      .maybeSingle()
    if (draftError) throw new Error(`${item.name}: could not put back to draft: ${draftError.message}`)
    if (!drafted) throw new Error(`${item.name} was no longer scheduled. Nothing changed. Stopping.`)

    try {
      await updateCampaign(item.id, { content: item.content }, OWNER_USER_ID)
      const result = await scheduleCampaign(item.id, item.scheduledFor, OWNER_USER_ID)
      console.warn(`  rescheduled for ${result.campaign.scheduledFor}, ${result.approvedRecipientCount} recipients`)
    } catch (rescheduleError) {
      throw new Error(
        `${item.name} (${item.id}) IS NOW A DRAFT AND WILL NOT SEND. Reschedule it for ` +
          `${item.scheduledFor} by hand. Cause: ${(rescheduleError as Error).message}`,
      )
    }

    const { data: after, error: afterError } = await supabase
      .from('marketing_campaigns')
      .select('status,scheduled_for,ignores_frequency_cap,content')
      .eq('id', item.id)
      .single()
    if (afterError) throw new Error(`${item.name}: could not read back: ${afterError.message}`)
    if (after.status !== 'scheduled') throw new Error(`${item.name} is ${after.status}, not scheduled. Stopping.`)
    if (new Date(String(after.scheduled_for)).getTime() !== new Date(item.scheduledFor).getTime()) {
      throw new Error(`${item.name} moved from ${item.scheduledFor} to ${after.scheduled_for}. Stopping.`)
    }
    if (Boolean(after.ignores_frequency_cap) !== item.exempt) {
      throw new Error(`${item.name} changed its frequency-cap exemption. Stopping.`)
    }
    const stored = JSON.stringify(after.content)
    if (!stored.includes(NEW_URL) || stored.includes(OLD_URL)) {
      throw new Error(`${item.name} does not carry the trimmed masthead. Stopping.`)
    }
    console.warn(`  verified: scheduled, ${after.scheduled_for}, trimmed masthead, cap exempt ${after.ignores_frequency_cap}`)
  }

  console.warn(`\nDone. ${work.length} campaign(s) updated and verified.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
