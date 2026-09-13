/**
 * Puts the seasonal masthead on every scheduled campaign.
 *
 * THE MONTH IS THE SEND MONTH, not the event's month. The masthead is the pub's seasonal
 * dressing at the moment somebody opens the email, so an email that lands on 28 October
 * wears October even though its quiz is on 4 November. Three campaigns are in that position
 * and they are called out in the plan below; flip any of them by hand if the owner prefers
 * the event's month.
 *
 * SCHEDULING FREEZES CONTENT, so each campaign has to go back to draft, be edited, and be
 * scheduled again at exactly the same time. That is the documented dance in
 * `tasks/marketing-email-runbook.md` and it re-runs every check: the frequency cap, the
 * recipient count and the short-link provisioning.
 *
 * THE DANGER IS A CAMPAIGN LEFT AS A DRAFT. A draft does not send, silently, and these are
 * real sends to real customers. So this works one campaign at a time and reads the row back
 * after each one, asserting it is `scheduled` again at the same instant. Anything unexpected
 * stops the run immediately and names what state the campaign is in, rather than carrying on
 * and leaving a trail of them.
 *
 * Dry run by default. RUN_SEASONAL_MASTHEAD_ROLLOUT=true applies it.
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { toLocalIsoDate } from '@/lib/dateUtils'
import { marketingContentSchema, validateMarketingContent } from '@/lib/email/marketing/registry'
import { renderCampaignHtml } from '@/lib/email/marketing/render'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'
import { scheduleCampaign, updateCampaign } from '@/services/marketing-campaigns'

const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'
const BASE =
  'https://tfcasgxopxegwrabvwat.supabase.co/storage/v1/object/public/event-images/marketing/seasonal-masthead'

/** The alt text carries the whole header, because the artwork bakes in every word of it. */
const IDENTITY = 'The Anchor, Stanwell Moor Village, since 1751.'

const MONTHS: ReadonlyArray<{ slug: string; describes: string }> = [
  { slug: '01-january', describes: 'Frosted pine and winter greenery around the wordmark.' },
  { slug: '02-february', describes: 'Hellebores and late winter blooms around the wordmark.' },
  { slug: '03-march', describes: 'Daffodils, snowdrops and crocuses around the wordmark.' },
  { slug: '04-april', describes: 'Tulips and spring blossom around the wordmark.' },
  { slug: '05-may', describes: 'Hawthorn blossom and roses around the wordmark.' },
  { slug: '06-june', describes: 'Summer roses and trailing greenery around the wordmark.' },
  { slug: '07-july', describes: 'Meadow poppies, daisies and cornflowers around the wordmark.' },
  { slug: '08-august', describes: 'Sunflowers and late summer dahlias around the wordmark.' },
  { slug: '09-september', describes: 'Hops and turning vine leaves around the wordmark.' },
  { slug: '10-october', describes: 'Autumn leaves and berries around the wordmark.' },
  { slug: '11-november', describes: 'Poppies and winter greenery around the wordmark.' },
  { slug: '12-december', describes: 'Holly, pine cones and Christmas greenery around the wordmark.' },
]

function londonMonthIndex(iso: string): number {
  return Number(toLocalIsoDate(new Date(iso)).slice(5, 7)) - 1
}

function londonLabel(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h12',
  })
}

async function main(): Promise<void> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('marketing_campaigns')
    .select('id,name,status,audience_type,scheduled_for,content')
    .in('status', ['scheduled'])
    .order('scheduled_for')
  if (error) throw new Error(error.message)

  const plan = (data ?? []).map((row) => {
    const content = marketingContentSchema.parse(row.content)
    const first = content.blocks[0]
    const month = MONTHS[londonMonthIndex(String(row.scheduled_for))]

    const next = {
      ...content,
      blocks: [
        {
          type: 'masthead_seasonal',
          data: { image_url: `${BASE}/${month.slug}.jpg`, alt: `${IDENTITY} ${month.describes}` },
        },
        ...content.blocks.slice(1),
      ],
    }

    const issues = validateMarketingContent(next)
    if (issues.length > 0) {
      throw new Error(`${row.name}: ${issues.map((issue) => issue.message).join('; ')}`)
    }

    return {
      id: String(row.id),
      name: String(row.name),
      scheduledFor: String(row.scheduled_for),
      audienceType: String(row.audience_type),
      from: first.type,
      month: month.slug,
      content: next,
      bytes: renderCampaignHtml(next).length,
    }
  })

  console.warn(`${plan.length} scheduled campaign(s)\n`)
  for (const item of plan) {
    const skip = item.from === 'masthead_seasonal' ? '  (already seasonal, will be left alone)' : ''
    console.warn(
      `${londonLabel(item.scheduledFor).padEnd(24)} ${item.audienceType.padEnd(8)} ${item.from.padEnd(17)} -> ${item.month.padEnd(12)} ${String(item.bytes).padStart(6)}B  ${item.name.slice(0, 44)}${skip}`,
    )
  }

  const work = plan.filter((item) => item.from !== 'masthead_seasonal')
  console.warn(`\n${work.length} to change, ${plan.length - work.length} already done.`)

  assertScriptMutationAllowed({
    scriptName: 'seasonal-masthead-scheduled-campaigns',
    envVar: 'RUN_SEASONAL_MASTHEAD_ROLLOUT',
  })

  for (const item of work) {
    console.warn(`\n${item.name}`)

    const { error: draftError } = await supabase
      .from('marketing_campaigns')
      .update({ status: 'draft', scheduled_for: null, approved_recipient_count: null })
      .eq('id', item.id)
      .eq('status', 'scheduled')
    if (draftError) throw new Error(`${item.name}: could not put back to draft: ${draftError.message}`)

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

    // Read it back rather than trusting the call, because a draft left behind sends nothing.
    const { data: after, error: afterError } = await supabase
      .from('marketing_campaigns')
      .select('status,scheduled_for,content')
      .eq('id', item.id)
      .single()
    if (afterError) throw new Error(`${item.name}: could not read back: ${afterError.message}`)
    if (after.status !== 'scheduled') {
      throw new Error(`${item.name} is ${after.status}, not scheduled. Stopping.`)
    }
    if (new Date(String(after.scheduled_for)).getTime() !== new Date(item.scheduledFor).getTime()) {
      throw new Error(
        `${item.name} moved from ${item.scheduledFor} to ${after.scheduled_for}. Stopping.`,
      )
    }
    const storedFirst = marketingContentSchema.parse(after.content).blocks[0]
    if (storedFirst.type !== 'masthead_seasonal') {
      throw new Error(`${item.name} still starts with ${storedFirst.type}. Stopping.`)
    }
    console.warn(`  verified: scheduled, ${after.scheduled_for}, ${storedFirst.type}`)
  }

  console.warn(`\nDone. ${work.length} campaign(s) updated and verified.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
