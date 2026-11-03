import { createAdminClient } from '@/lib/supabase/admin'
import { houseStyleErrors } from '@/lib/copy/house-style'
import { lifecycleContentProblems, returnVisitFilterSchema } from '@/lib/email/marketing/lifecycle'
import { mergeCampaignContent, SAMPLE_MERGE_FIELDS, type RecipientMergeFields } from '@/lib/email/marketing/merge'
import { renderCampaignText, renderMarketingEmail } from '@/lib/email/marketing/render'
import { mapMarketingCampaign, type MarketingCampaign } from '@/types/marketing'

import {
  assertNoMisleadingClosureCopy,
  computeContentHash,
  countLifecycleAudience,
  parseCampaignContent,
  provisionLinkMap,
  requireCampaign,
} from './marketing-campaigns'

/**
 * Lifecycle campaigns: switching one on, the holdout share, and the measurement panel
 * (spec tasks/spec-2026-11-02-table-booking-return-visits.md, sections 7 and 9.2).
 *
 * A lifecycle campaign is never scheduled. Switching it on freezes its content exactly as
 * scheduling freezes a one-off (hash, link map, approval stamp) and puts it straight into
 * `sending`, where `promote_due_marketing_campaigns` adds that day's guests on each send day.
 * Pause, resume and cancel are the one-off ones.
 *
 * Functions throw on failure. The action layer turns a throw into `{ error }`.
 */

export interface ActivateLifecycleResult {
  campaign: MarketingCampaign
  /** Guests the rule selects today, before the holdout. Recorded as the approval count. */
  audienceToday: number
}

/** Everything that would make a send fail or mislead, checked before anything goes out. */
async function lifecycleProblems(campaign: MarketingCampaign): Promise<string[]> {
  const problems: string[] = []
  const filterResult = returnVisitFilterSchema.safeParse(campaign.audience.customerFilter)
  if (!filterResult.success) {
    return [`The rule that picks guests is invalid: ${filterResult.error.issues[0]?.message ?? 'unknown problem'}`]
  }
  const filter = filterResult.data
  const supabase = createAdminClient()

  const { data: voucherType, error: typeError } = await supabase
    .from('voucher_types')
    .select('id, active, discount_kind, percent_off, digital_only')
    .eq('id', filter.voucher_type_id)
    .maybeSingle()
  if (typeError) throw new Error(`Could not check the voucher type: ${typeError.message}`)
  if (!voucherType) {
    problems.push(`There is no voucher type called ${filter.voucher_type_id}`)
  } else if (!voucherType.active || voucherType.discount_kind !== 'percent' || !voucherType.digital_only) {
    problems.push(`${filter.voucher_type_id} is not an active, email-only percentage voucher`)
  }

  if (filter.touch === 2 && filter.previous_campaign_id) {
    const { data: previous, error: previousError } = await supabase
      .from('marketing_campaigns')
      .select('id, kind')
      .eq('id', filter.previous_campaign_id)
      .maybeSingle()
    if (previousError) throw new Error(`Could not check the touch 1 campaign: ${previousError.message}`)
    if (!previous || previous.kind !== 'lifecycle') {
      problems.push('Touch 2 must follow a return-visit campaign')
    }
  }

  if (!campaign.sendDays?.length || !campaign.promoteAtLocal || !campaign.cooldownDays) {
    problems.push('The campaign has no send days, send time or cooldown')
  }

  return problems
}

/**
 * The sample guest for a campaign's preview, test send and switch-on render check. A real send
 * takes the percentage from the campaign's own voucher type, so the sample does too: touch 2
 * must preview at 25%, not at the generic sample's 10%. A campaign without a return-visit rule
 * keeps the generic sample.
 */
export async function sampleMergeFieldsFor(campaign: MarketingCampaign): Promise<RecipientMergeFields> {
  const filter = returnVisitFilterSchema.safeParse(campaign.audience?.customerFilter)
  if (!filter.success) return SAMPLE_MERGE_FIELDS

  const { data, error } = await createAdminClient()
    .from('voucher_types')
    .select('percent_off')
    .eq('id', filter.data.voucher_type_id)
    .maybeSingle()
  if (error) throw new Error(`Could not read the voucher type: ${error.message}`)
  if (data?.percent_off == null) {
    throw new Error(`Voucher type ${filter.data.voucher_type_id} has no percentage to show`)
  }
  return { ...SAMPLE_MERGE_FIELDS, voucher_percent: data.percent_off }
}

/**
 * Switches a draft return-visit campaign on. Refuses anything that would fail at send time:
 * a bad rule, a voucher type that is not an email-only percentage, copy with an unknown
 * token or without the voucher, banned claims, or an email that does not render with sample
 * values. The owner reads the test send first; this is the machine half of that check.
 */
export async function activateLifecycleCampaign(id: string, userId: string): Promise<ActivateLifecycleResult> {
  const existing = await requireCampaign(id)
  if (existing.kind !== 'lifecycle') {
    throw new Error('Only a return-visit campaign can be switched on. Schedule a one-off campaign instead.')
  }
  if (existing.status !== 'draft') {
    throw new Error(`Only a draft can be switched on. This one is ${existing.status}.`)
  }

  const content = parseCampaignContent(existing.content)
  const filter = existing.audience.customerFilter
  if (!filter) throw new Error('This return-visit campaign has no rule to select guests by')

  const problems = [...(await lifecycleProblems(existing)), ...lifecycleContentProblems(content, filter)]
  if (problems.length > 0) {
    throw new Error(problems.join('. '))
  }

  // Render once with sample values: a template that cannot merge or render fails here, in
  // front of a person, rather than per guest at 4pm on a Thursday.
  const sample = mergeCampaignContent(content, await sampleMergeFieldsFor(existing))
  renderMarketingEmail(sample, { unsubscribeUrl: 'https://example.invalid/unsubscribe' })

  const bannedClaims = houseStyleErrors(renderCampaignText(sample))
  if (bannedClaims.length > 0) {
    throw new Error(
      `This copy carries a claim the brand rules ban. "${bannedClaims[0].matched}": ${bannedClaims[0].message}`,
    )
  }
  await assertNoMisleadingClosureCopy(content, new Date())

  const audienceToday = await countLifecycleAudience(filter)
  const linkMap = await provisionLinkMap(id, existing.utmCampaign ?? id, content)
  const now = new Date().toISOString()

  const { data, error } = await createAdminClient()
    .from('marketing_campaigns')
    .update({
      status: 'sending',
      scheduled_for: now,
      locked_at: now,
      scheduled_by: userId,
      approved_recipient_count: audienceToday,
      content_hash: computeContentHash(content),
      link_map: linkMap,
    })
    .eq('id', id)
    .eq('status', 'draft')
    .eq('kind', 'lifecycle')
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Campaign was no longer a draft when it was switched on')

  return { campaign: mapMarketingCampaign(data), audienceToday }
}

/**
 * Changes the control-group share of a return-visit campaign, including one that is running.
 * The owner sets it to zero once the lift is known (spec section 7). Guests already selected
 * keep the group they were put in.
 */
export async function setLifecycleHoldout(id: string, holdoutPercent: number): Promise<MarketingCampaign> {
  if (!Number.isInteger(holdoutPercent) || holdoutPercent < 0 || holdoutPercent > 50) {
    throw new Error('The control group share must be a whole number from 0 to 50')
  }
  const existing = await requireCampaign(id)
  if (existing.kind !== 'lifecycle') throw new Error('Only a return-visit campaign has a control group')
  if (existing.status === 'cancelled' || existing.status === 'completed') {
    throw new Error(`This campaign is ${existing.status}`)
  }

  const { data, error } = await createAdminClient()
    .from('marketing_campaigns')
    .update({ holdout_percent: holdoutPercent })
    .eq('id', id)
    .eq('kind', 'lifecycle')
    .in('status', ['draft', 'sending', 'paused'])
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('The campaign changed while the share was being saved. Reload and try again.')
  return mapMarketingCampaign(data)
}

export interface LifecycleGroupOutcome {
  /** Guests whose email (or, for the control group, selection) is at least 30 or 90 days old. */
  matured30: number
  matured90: number
  /** Of those, how many booked a table within 30 or 90 days. */
  booked30: number
  booked90: number
}

export interface LifecycleCampaignStats {
  selected: number
  sent: number
  holdout: number
  bookedSinceSelection: number
  vouchersIssued: number
  vouchersRedeemed: number
  /** The discount recorded at the till on redeemed vouchers, in pence. */
  discountGivenPence: number
  /** Bookings made through this campaign's own links. */
  attributedBookings: number
  sentGroup: LifecycleGroupOutcome
  holdoutGroup: LifecycleGroupOutcome
}

function toGroup(row: Record<string, unknown>, prefix: 'sent' | 'holdout'): LifecycleGroupOutcome {
  return {
    matured30: Number(row[`${prefix}_matured_30`] ?? 0),
    matured90: Number(row[`${prefix}_matured_90`] ?? 0),
    booked30: Number(row[`${prefix}_booked_30`] ?? 0),
    booked90: Number(row[`${prefix}_booked_90`] ?? 0),
  }
}

export async function getLifecycleCampaignStats(id: string): Promise<LifecycleCampaignStats> {
  const { data, error } = await createAdminClient().rpc('get_lifecycle_campaign_stats', { p_campaign_id: id })
  if (error) throw new Error(`Could not load the return-visit results: ${error.message}`)

  const row = (data ?? {}) as Record<string, unknown>
  return {
    selected: Number(row.selected ?? 0),
    sent: Number(row.sent ?? 0),
    holdout: Number(row.holdout ?? 0),
    bookedSinceSelection: Number(row.booked_since_selection ?? 0),
    vouchersIssued: Number(row.vouchers_issued ?? 0),
    vouchersRedeemed: Number(row.vouchers_redeemed ?? 0),
    discountGivenPence: Number(row.discount_given_pence ?? 0),
    attributedBookings: Number(row.attributed_bookings ?? 0),
    sentGroup: toGroup(row, 'sent'),
    holdoutGroup: toGroup(row, 'holdout'),
  }
}
