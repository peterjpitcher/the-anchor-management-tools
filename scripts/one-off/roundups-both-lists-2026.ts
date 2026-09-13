/**
 * Brings the three monthly round-ups up to date, adds the business twin of each, marks all
 * six exempt from the frequency cap, and schedules them for the first of the month.
 *
 * Owner's rules, 9 September 2026: monthly emails go out on the FIRST, and they go to both
 * lists. A campaign carries one `audience_type`, so both lists means two campaigns a month
 * with the same content.
 *
 * THE FOOTER REASON DIFFERS AND MUST. Business contacts have never booked with us, so the
 * guest wording would be untrue for them. The runbook records this as a rule the owner set
 * after rejecting an earlier draft.
 *
 * ONLY OCTOBER ACTUALLY NEEDS THE CAP EXEMPTION. The quiz email lands 30 September, one day
 * before. 1 November and 1 December are already clear of their neighbours. All six carry the
 * flag anyway, because the rule is about what a monthly round-up IS, not about which months
 * happen to be awkward this year.
 *
 * Dry run by default. RUN_ROUNDUPS_BOTH_LISTS=true applies it.
 */
import { readFileSync } from 'node:fs'

import { config } from 'dotenv'

config({ path: '.env.local' })

import { marketingContentSchema, validateMarketingContent, type MarketingContent } from '@/lib/email/marketing/registry'
import { renderCampaignHtml } from '@/lib/email/marketing/render'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'
import { createCampaign, scheduleCampaign, updateCampaign } from '@/services/marketing-campaigns'

const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'

interface Plan {
  month: string
  audience: 'customer' | 'business'
  file: string
  utm: string
  name: string
  sendAt: string
}

const PLANS: Plan[] = [
  { month: 'october', audience: 'customer', file: 'october-2026-whats-on-guests', utm: 'october-2026-roundup-guests', name: 'Welcome to October - guests - 2026', sendAt: '2026-10-01T09:00:00+01:00' },
  { month: 'october', audience: 'business', file: 'october-2026-whats-on-business', utm: 'october-2026-roundup-business', name: 'Welcome to October - businesses - 2026', sendAt: '2026-10-01T09:00:00+01:00' },
  { month: 'november', audience: 'customer', file: 'november-2026-whats-on-guests', utm: 'november-2026-roundup-guests', name: 'Welcome to November - guests - 2026', sendAt: '2026-11-01T09:00:00+00:00' },
  { month: 'november', audience: 'business', file: 'november-2026-whats-on-business', utm: 'november-2026-roundup-business', name: 'Welcome to November - businesses - 2026', sendAt: '2026-11-01T09:00:00+00:00' },
  { month: 'december', audience: 'customer', file: 'december-2026-whats-on-guests', utm: 'december-2026-roundup-guests', name: 'Welcome to December - guests - 2026', sendAt: '2026-12-01T09:00:00+00:00' },
  { month: 'december', audience: 'business', file: 'december-2026-whats-on-business', utm: 'december-2026-roundup-business', name: 'Welcome to December - businesses - 2026', sendAt: '2026-12-01T09:00:00+00:00' },
]

function load(file: string): MarketingContent {
  const content = marketingContentSchema.parse(
    JSON.parse(readFileSync(`src/lib/email/marketing/campaigns/${file}.json`, 'utf8')),
  )
  const issues = validateMarketingContent(content)
  if (issues.length > 0) throw new Error(`${file}: ${issues.map((i) => i.message).join('; ')}`)
  return content
}

function london(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h12',
  })
}

async function main(): Promise<void> {
  const supabase = createAdminClient()
  const prepared = PLANS.map((plan) => ({ plan, content: load(plan.file) }))

  console.warn('Plan:\n')
  for (const { plan, content } of prepared) {
    const { data } = await supabase
      .from('marketing_campaigns').select('id,status').eq('utm_campaign', plan.utm).maybeSingle()
    console.warn(
      `  ${london(plan.sendAt).padEnd(24)} ${plan.audience.padEnd(8)} ` +
        `${(data ? `update ${data.status}` : 'create new').padEnd(15)} ` +
        `${String(renderCampaignHtml(content).length).padStart(6)}B  ${plan.name}`,
    )
  }

  assertScriptMutationAllowed({ scriptName: 'roundups-both-lists-2026', envVar: 'RUN_ROUNDUPS_BOTH_LISTS' })

  for (const { plan, content } of prepared) {
    console.warn(`\n${plan.name}`)

    const { data: existing } = await supabase
      .from('marketing_campaigns').select('id,status').eq('utm_campaign', plan.utm).maybeSingle()

    let id: string
    if (existing) {
      if (existing.status === 'scheduled') {
        const { error } = await supabase
          .from('marketing_campaigns')
          .update({ status: 'draft', scheduled_for: null, approved_recipient_count: null })
          .eq('id', existing.id).eq('status', 'scheduled')
        if (error) throw new Error(`could not unschedule: ${error.message}`)
      }
      await updateCampaign(
        existing.id,
        { subject: content.title, preheader: content.preheader, content, ignoresFrequencyCap: true },
        OWNER_USER_ID,
      )
      id = existing.id
      console.warn(`  updated ${id}`)
    } else {
      const created = await createCampaign(
        {
          name: plan.name, subject: content.title, preheader: content.preheader, content,
          audienceType: plan.audience, utmCampaign: plan.utm, ignoresFrequencyCap: true,
        },
        OWNER_USER_ID,
      )
      id = created.id
      console.warn(`  created ${id}`)
    }

    try {
      const result = await scheduleCampaign(id, plan.sendAt, OWNER_USER_ID)
      console.warn(`  scheduled ${london(result.campaign.scheduledFor!)}, ${result.approvedRecipientCount} recipients`)
    } catch (error) {
      throw new Error(
        `${plan.name} (${id}) IS A DRAFT AND WILL NOT SEND. Schedule it for ${plan.sendAt} by ` +
          `hand. Cause: ${(error as Error).message}`,
      )
    }

    const { data: after, error: readError } = await supabase
      .from('marketing_campaigns')
      .select('status,scheduled_for,ignores_frequency_cap,audience_type,approved_recipient_count')
      .eq('id', id).single()
    if (readError) throw new Error(readError.message)
    if (after.status !== 'scheduled') throw new Error(`It is ${after.status}, not scheduled.`)
    if (!after.ignores_frequency_cap) throw new Error('The cap exemption did not stick.')
    if (after.audience_type !== plan.audience) throw new Error(`Audience is ${after.audience_type}.`)
    console.warn(
      `  verified: ${after.status}, ${london(String(after.scheduled_for))}, ` +
        `${after.audience_type}, cap-exempt, ${after.approved_recipient_count} recipients`,
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
