import { createHash } from 'crypto'

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import {
  fetchCampaignLinks,
  fetchClicksByRecipientIds,
  fetchClicksForLinks,
  fetchConversionsByUtmCampaign,
  fetchEnquiryConversionsByUtmCampaign,
  isHumanClick,
  summariseClicksByRecipient,
} from '@/lib/email/marketing/attribution'
import { provisionCampaignLinks } from '@/lib/email/marketing/links'
import { collectDestinationUrls } from '@/lib/email/marketing/render'
import { buildShortLinkUrl } from '@/lib/short-links/base-url'
import {
  marketingContentSchema,
  validateMarketingContent,
  type MarketingContent,
} from '@/lib/email/marketing/registry'
import {
  audienceToDb,
  mapMarketingCampaign,
  mapMarketingCampaignRecipient,
  mapMarketingRecipientEngagement,
  mapMarketingSettings,
  type MarketingAudience,
  type MarketingAudienceType,
  type MarketingCampaign,
  type MarketingCampaignEngagement,
  type MarketingCampaignLinkPerformance,
  type MarketingCampaignRecipientWithEngagement,
  type MarketingCampaignStats,
  type MarketingCampaignStatus,
  type MarketingCampaignSummary,
  type MarketingCampaignWithSummary,
  type MarketingRecipientStatus,
  type MarketingSettings,
} from '@/types/marketing'

import { previewAudience } from './marketing-contacts'

/**
 * Marketing campaigns: draft, schedule, monitor.
 *
 * Sending itself is not here. The cron claims and sends through the RPCs in
 * `20260813120100_marketing_email_rpcs.sql`, which is what keeps campaign state and recipient
 * state moving in one transaction. This file is the human-facing half.
 *
 * Functions throw on failure. The action layer turns a throw into `{ error }`.
 */

const FETCH_PAGE_SIZE = 1000
const FETCH_ROW_CAP = 100_000
const IN_CHUNK_SIZE = 200
const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 200

/** A schedule time a minute or two in the past is a clock skew, not an intent to backdate. */
const SCHEDULE_PAST_GRACE_MS = 60_000

type AdminClient = ReturnType<typeof createAdminClient>

interface PagedResult<T> {
  data: T[] | null
  error: { message: string } | null
}

async function fetchAllPages<T>(
  run: (from: number, to: number) => PromiseLike<PagedResult<T>>,
): Promise<T[]> {
  const out: T[] = []

  for (let from = 0; from < FETCH_ROW_CAP; from += FETCH_PAGE_SIZE) {
    const { data, error } = await run(from, from + FETCH_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)

    const batch = data ?? []
    out.push(...batch)
    if (batch.length < FETCH_PAGE_SIZE) return out
  }

  return out
}

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function cleanTags(tags: string[] | null | undefined): string[] {
  if (!tags) return []
  const seen = new Set<string>()
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase()
    if (tag.length > 0) seen.add(tag)
  }
  return [...seen]
}

/** Rates are meaningless without a denominator, and NaN is worse than zero on a dashboard. */
function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 10_000) / 10_000
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise)

  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) out[key] = canonicalise(source[key])
    return out
  }

  return value
}

/**
 * Fingerprint of what was approved.
 *
 * Taken over the PARSED content with keys sorted, so re-saving the same email with its JSON
 * keys in a different order does not read as a different campaign. The hash is what proves,
 * after the fact, that the bytes which went out are the bytes a human signed off.
 */
export function computeContentHash(content: MarketingContent): string {
  return createHash('sha256').update(JSON.stringify(canonicalise(content))).digest('hex')
}

/**
 * Parses and validates campaign content against the renderer's registry.
 *
 * Both stages matter: the outer schema proves the shape, and `validateMarketingContent`
 * proves every block type exists and its data fits that block's own schema. A code deploy can
 * change what is valid between saving and sending, which is why this runs on every write and
 * again at schedule time.
 */
export function parseCampaignContent(raw: unknown): MarketingContent {
  const parsed = marketingContentSchema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.errors[0]
    const path = first?.path?.length ? `${first.path.join('.')}: ` : ''
    throw new Error(`Campaign content is invalid. ${path}${first?.message ?? 'Unrecognised shape'}`)
  }

  const issues = validateMarketingContent(parsed.data)
  if (issues.length > 0) {
    const summary = issues
      .slice(0, 5)
      .map((issue) => `block ${issue.index ?? '?'} (${issue.type ?? 'unknown'}): ${issue.message}`)
      .join('; ')
    throw new Error(`Campaign content is invalid. ${summary}`)
  }

  return parsed.data
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const EMPTY_SUMMARY: MarketingCampaignSummary = {
  recipients: 0,
  pending: 0,
  sending: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
  needsReview: 0,
}

/**
 * Per-campaign recipient counts for a page of campaigns.
 *
 * PostgREST has no group-by, and adding an aggregate RPC is outside this changeset, so the
 * status column is read and counted here. It is bounded by the page of campaigns on screen
 * rather than the whole table, which keeps it proportionate to a venue-sized list.
 */
async function fetchSummaries(
  supabase: AdminClient,
  campaignIds: string[],
): Promise<Map<string, MarketingCampaignSummary>> {
  const summaries = new Map<string, MarketingCampaignSummary>()
  if (campaignIds.length === 0) return summaries

  for (const part of chunk(campaignIds, IN_CHUNK_SIZE)) {
    const rows = await fetchAllPages<{ campaign_id: string; status: MarketingRecipientStatus }>(
      (from, to) =>
        supabase
          .from('marketing_campaign_recipients')
          .select('campaign_id, status')
          .in('campaign_id', part)
          .range(from, to),
    )

    for (const row of rows) {
      const current = summaries.get(row.campaign_id) ?? { ...EMPTY_SUMMARY }
      current.recipients += 1

      if (row.status === 'pending') current.pending += 1
      else if (row.status === 'sending') current.sending += 1
      else if (row.status === 'sent') current.sent += 1
      else if (row.status === 'failed') current.failed += 1
      else if (row.status === 'skipped') current.skipped += 1
      else if (row.status === 'needs_review') current.needsReview += 1

      summaries.set(row.campaign_id, current)
    }
  }

  return summaries
}

export interface ListCampaignsOptions {
  status?: MarketingCampaignStatus
  page?: number
  pageSize?: number
}

export interface ListCampaignsResult {
  campaigns: MarketingCampaignWithSummary[]
  total: number
}

export async function listCampaigns(
  options: ListCampaignsOptions = {},
): Promise<ListCampaignsResult> {
  const supabase = createAdminClient()

  const page = Math.max(1, options.page ?? 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE))
  const from = (page - 1) * pageSize

  let query = supabase.from('marketing_campaigns').select('*', { count: 'exact' })
  if (options.status) query = query.eq('status', options.status)

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1)

  if (error) throw new Error(error.message)

  const campaigns = (data ?? []).map(mapMarketingCampaign)
  const summaries = await fetchSummaries(
    supabase,
    campaigns.map((campaign) => campaign.id),
  )

  return {
    campaigns: campaigns.map((campaign) => ({
      ...campaign,
      summary: summaries.get(campaign.id) ?? { ...EMPTY_SUMMARY },
    })),
    total: count ?? 0,
  }
}

export async function getCampaign(id: string): Promise<MarketingCampaign | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('marketing_campaigns')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data ? mapMarketingCampaign(data) : null
}

async function requireCampaign(id: string): Promise<MarketingCampaign> {
  const campaign = await getCampaign(id)
  if (!campaign) throw new Error('Campaign not found')
  return campaign
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CampaignInput {
  name: string
  subject: string
  preheader: string
  content: unknown
  /** Which list this goes to. Defaults to business, which is what the column has always done. */
  audienceType?: MarketingAudienceType
  audience?: MarketingAudience
  utmCampaign?: string | null
}

export async function createCampaign(
  input: CampaignInput,
  userId: string,
): Promise<MarketingCampaign> {
  const supabase = createAdminClient()
  const content = parseCampaignContent(input.content)

  const audience: MarketingAudience = {
    includeTags: cleanTags(input.audience?.includeTags),
    excludeTags: cleanTags(input.audience?.excludeTags),
  }

  const { data, error } = await supabase
    .from('marketing_campaigns')
    .insert({
      name: input.name.trim(),
      subject: input.subject.trim(),
      preheader: input.preheader.trim(),
      content,
      audience_type: input.audienceType ?? 'business',
      audience: audienceToDb(audience),
      utm_campaign: emptyToNull(input.utmCampaign),
      status: 'draft',
      created_by: userId,
    })
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return mapMarketingCampaign(data)
}

/**
 * Edits a campaign.
 *
 * Only drafts are editable. Once a campaign is scheduled its content is frozen and hashed,
 * and the audience snapshot is taken from it, so an edit after that point would change what
 * goes out from what a human approved without leaving a trace.
 */
export async function updateCampaign(
  id: string,
  input: Partial<CampaignInput>,
  userId: string,
): Promise<MarketingCampaign> {
  const supabase = createAdminClient()
  const existing = await requireCampaign(id)

  if (existing.status !== 'draft') {
    throw new Error(`Only draft campaigns can be edited. This one is ${existing.status}.`)
  }

  const payload: Record<string, unknown> = {}
  if (input.name !== undefined) payload.name = input.name.trim()
  if (input.subject !== undefined) payload.subject = input.subject.trim()
  if (input.preheader !== undefined) payload.preheader = input.preheader.trim()
  if (input.content !== undefined) payload.content = parseCampaignContent(input.content)
  if (input.utmCampaign !== undefined) payload.utm_campaign = emptyToNull(input.utmCampaign)

  if (input.audience !== undefined) {
    payload.audience = audienceToDb({
      includeTags: cleanTags(input.audience.includeTags),
      excludeTags: cleanTags(input.audience.excludeTags),
    })
  }

  if (Object.keys(payload).length === 0) return existing

  // Not a column on the row; recorded by the caller's audit entry.
  void userId

  const { data, error } = await supabase
    .from('marketing_campaigns')
    .update(payload)
    .eq('id', id)
    .eq('status', 'draft')
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Campaign was no longer a draft when the edit was applied')
  return mapMarketingCampaign(data)
}

export interface ScheduleCampaignResult {
  campaign: MarketingCampaign
  approvedRecipientCount: number
}

/**
 * Short links for everything this campaign points at, or an empty map.
 *
 * Never throws. Click tracking is a reporting nicety and scheduling a send is not: an empty
 * or partial map renders the original URLs with plain UTM tagging, which still lands the
 * visitor on the right page and still shows up in site analytics, just without per-recipient
 * click attribution. Refusing to schedule over a redirector problem would trade a real send
 * for a report.
 */
async function provisionLinkMap(
  campaignId: string,
  utmCampaign: string,
  content: MarketingContent,
): Promise<Record<string, string>> {
  try {
    const { linkMap, failures } = await provisionCampaignLinks({
      campaignId,
      utmCampaign,
      destinations: collectDestinationUrls(content),
    })

    if (failures.length > 0) {
      logger.error('Some campaign links could not be shortened, so they send untracked', {
        metadata: { campaignId, failures },
      })
    }

    return linkMap
  } catch (error) {
    logger.error('Campaign short link provisioning failed, scheduling with plain UTM tagging', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { campaignId },
    })
    return {}
  }
}

/**
 * Freezes a draft and books it in.
 *
 * Four things are locked at this moment and none of them can be re-derived later: the content
 * hash, the recipient count a human approved, the send time, and the short links every
 * click will be counted through.
 */
/**
 * Refuses a send time that the frequency cap would quietly eat.
 *
 * The cap lives on the contact row, not the recipient row, so it works ACROSS campaigns: if
 * the same list was emailed inside the cap window, every recipient of the second campaign is
 * skipped with `frequency_cap` and that campaign finishes as `completed` having reached
 * nobody. There is no error, no failure, and the only clue is a skip count you have to go
 * looking for.
 *
 * This nearly happened for real. A guest campaign was scheduled, then a second guest campaign
 * was scheduled six days earlier, which would have silently emptied the first. Catching it at
 * schedule time costs one query; catching it afterwards is not possible, because by then the
 * send has been marked complete and the moment has passed.
 *
 * Only same-audience campaigns collide, because the two lists keep their own timestamps.
 */
export interface NeighbouringCampaign {
  name: string
  scheduledFor: string
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The judgement half, kept pure so it can be tested without a database.
 *
 * Returns the message to refuse with, or null if the slot is safe. `hourCycle` rather than
 * `hour12`, because en-GB with `hour12` renders noon as "0pm" on Node 20.
 */
export function describeFrequencyCapCollision(
  capDays: number,
  when: Date,
  neighbours: NeighbouringCampaign[],
): string | null {
  if (capDays <= 0 || neighbours.length === 0) return null

  const capMs = capDays * DAY_MS
  const inWindow = neighbours
    .map((n) => ({ ...n, at: new Date(n.scheduledFor) }))
    .filter((n) => !Number.isNaN(n.at.getTime()))
    .filter((n) => Math.abs(when.getTime() - n.at.getTime()) < capMs)
    .sort((a, b) => a.at.getTime() - b.at.getTime())

  const clash = inWindow[0]
  if (!clash) return null

  const fmt = (date: Date) =>
    date.toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h12',
    })

  const gapDays = Math.abs(when.getTime() - clash.at.getTime()) / DAY_MS

  return (
    `That send would be swallowed by the ${capDays}-day frequency cap. ` +
    `"${clash.name}" goes to the same list at ${fmt(clash.at)}, which is ${gapDays.toFixed(1)} days away, ` +
    `so whichever lands second would skip every recipient and finish having reached nobody. ` +
    `Schedule this from ${fmt(new Date(clash.at.getTime() + capMs))} onwards, or move the other campaign.`
  )
}

async function assertNoFrequencyCapCollision(
  supabase: AdminClient,
  campaign: MarketingCampaign,
  when: Date,
): Promise<void> {
  const { data: settingsRow, error: settingsError } = await supabase
    .from('marketing_settings')
    .select('frequency_cap_days')
    .limit(1)
    .maybeSingle()

  if (settingsError) throw new Error(settingsError.message)

  const capDays = settingsRow?.frequency_cap_days ?? 0
  if (capDays <= 0) return

  const capMs = capDays * DAY_MS

  const { data: neighbours, error } = await supabase
    .from('marketing_campaigns')
    .select('id, name, scheduled_for')
    .eq('audience_type', campaign.audienceType)
    .neq('id', campaign.id)
    .in('status', ['scheduled', 'sending', 'completed'])
    .not('scheduled_for', 'is', null)
    .gte('scheduled_for', new Date(when.getTime() - capMs).toISOString())
    .lte('scheduled_for', new Date(when.getTime() + capMs).toISOString())
    .order('scheduled_for')

  if (error) throw new Error(error.message)

  const message = describeFrequencyCapCollision(
    capDays,
    when,
    (neighbours ?? []).map((row) => ({
      name: String((row as { name: string }).name),
      scheduledFor: String((row as { scheduled_for: string }).scheduled_for),
    })),
  )

  if (message) throw new Error(message)
}

export async function scheduleCampaign(
  id: string,
  scheduledFor: string,
  userId: string,
): Promise<ScheduleCampaignResult> {
  const supabase = createAdminClient()
  const existing = await requireCampaign(id)

  if (existing.status !== 'draft') {
    throw new Error(`Only draft campaigns can be scheduled. This one is ${existing.status}.`)
  }

  const when = new Date(scheduledFor)
  if (Number.isNaN(when.getTime())) {
    throw new Error('The scheduled time is not a valid date')
  }
  if (when.getTime() < Date.now() - SCHEDULE_PAST_GRACE_MS) {
    throw new Error('The scheduled time is in the past')
  }

  const content = parseCampaignContent(existing.content)

  const preview = await previewAudience({
    audienceType: existing.audienceType,
    includeTags: existing.audience.includeTags,
    excludeTags: existing.audience.excludeTags,
  })

  if (preview.eligibleCount === 0) {
    throw new Error('This audience matches nobody, so there is nothing to schedule')
  }

  await assertNoFrequencyCapCollision(supabase, existing, when)

  const now = new Date().toISOString()
  const linkMap = await provisionLinkMap(id, existing.utmCampaign ?? id, content)

  const { data, error } = await supabase
    .from('marketing_campaigns')
    .update({
      status: 'scheduled',
      scheduled_for: when.toISOString(),
      locked_at: now,
      scheduled_by: userId,
      approved_recipient_count: preview.eligibleCount,
      content_hash: computeContentHash(content),
      link_map: linkMap,
    })
    .eq('id', id)
    .eq('status', 'draft')
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Campaign was no longer a draft when it was scheduled')

  return { campaign: mapMarketingCampaign(data), approvedRecipientCount: preview.eligibleCount }
}

export interface CampaignAudienceDrift {
  /** What a human signed off when the campaign was scheduled. */
  approved: number | null
  /** What the same rules select right now, which is what the send will actually use. */
  live: number
  /** live minus approved, so positive means more people than were approved. */
  delta: number
}

/**
 * How far the audience has moved since somebody approved it.
 *
 * `approved_recipient_count` reads like a control but is only a record: recipients are chosen
 * by `promote_due_marketing_campaigns()` at the moment the campaign falls due, against live
 * eligibility, so anybody added or unsubscribed in between changes who actually receives it.
 * A contact added the night before a send goes out without passing back through approval, and
 * nothing on screen says so.
 *
 * Freezing the audience instead would be the wrong fix here: a contact added on Saturday
 * getting Monday's email is the behaviour the owner wants. What was missing was being able to
 * see it, so this reports the gap rather than closing it.
 */
export async function getCampaignAudienceDrift(id: string): Promise<CampaignAudienceDrift> {
  const campaign = await requireCampaign(id)

  const preview = await previewAudience({
    audienceType: campaign.audienceType,
    includeTags: campaign.audience.includeTags,
    excludeTags: campaign.audience.excludeTags,
  })

  const approved = campaign.approvedRecipientCount
  return {
    approved,
    live: preview.eligibleCount,
    delta: approved === null ? 0 : preview.eligibleCount - approved,
  }
}

export async function pauseCampaign(id: string, userId: string): Promise<MarketingCampaign> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('marketing_campaigns')
    .update({ status: 'paused', paused_at: new Date().toISOString(), paused_by: userId })
    .eq('id', id)
    .eq('status', 'sending')
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) {
    const existing = await requireCampaign(id)
    throw new Error(`Only a sending campaign can be paused. This one is ${existing.status}.`)
  }

  return mapMarketingCampaign(data)
}

/**
 * Puts a paused campaign back into the queue.
 *
 * The pause stamps are cleared because they describe the current state, and a campaign that
 * is sending is not paused. The history of who paused it lives in the audit log.
 */
export async function resumeCampaign(id: string, userId: string): Promise<MarketingCampaign> {
  const supabase = createAdminClient()

  // Not a column on the row; recorded by the caller's audit entry.
  void userId

  const { data, error } = await supabase
    .from('marketing_campaigns')
    .update({ status: 'sending', paused_at: null, paused_by: null })
    .eq('id', id)
    .eq('status', 'paused')
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) {
    const existing = await requireCampaign(id)
    throw new Error(`Only a paused campaign can be resumed. This one is ${existing.status}.`)
  }

  return mapMarketingCampaign(data)
}

export interface CancelCampaignResult {
  campaign: MarketingCampaign
  cancelledRecipients: number
}

/**
 * Cancels a campaign and its unstarted queue in one transaction.
 *
 * The RPC does both together. Doing it here in two statements is what would leave a cancelled
 * campaign with live pending rows if the process died between them.
 */
export async function cancelCampaign(id: string, userId: string): Promise<CancelCampaignResult> {
  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('cancel_marketing_campaign', {
    p_campaign_id: id,
    p_user_id: userId,
  })

  if (error) throw new Error(error.message)

  const campaign = await requireCampaign(id)
  return { campaign, cancelledRecipients: typeof data === 'number' ? data : 0 }
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

interface EngagementRow {
  id: string
  delivered_at: string | null
  opened_at: string | null
  clicked_at: string | null
  bounced_at: string | null
  complained_at: string | null
  failed_at: string | null
}

/**
 * Engagement rows for the given message ids.
 *
 * Fetched separately rather than embedded. `email_messages` now carries its own foreign key
 * back to `marketing_campaign_recipients`, so there are two relationships between the tables
 * and a PostgREST embed would be ambiguous. Two queries and a join in memory cannot be
 * broken by a future column.
 */
async function fetchEngagement(
  supabase: AdminClient,
  messageIds: string[],
): Promise<Map<string, EngagementRow>> {
  const byId = new Map<string, EngagementRow>()
  if (messageIds.length === 0) return byId

  for (const part of chunk(messageIds, IN_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('email_messages')
      .select('id, delivered_at, opened_at, clicked_at, bounced_at, complained_at, failed_at')
      .in('id', part)

    if (error) throw new Error(error.message)
    for (const row of (data ?? []) as EngagementRow[]) byId.set(row.id, row)
  }

  return byId
}

/**
 * The UTM campaign value that actually lands on every link in this email.
 *
 * `provisionLinkMap` is called with `existing.utmCampaign ?? id`, so a campaign nobody gave a
 * UTM name to is tagged with its own id. Reporting has to read the same fallback, otherwise
 * those campaigns would report zero conversions while producing them.
 */
export function campaignUtmValue(campaign: Pick<MarketingCampaign, 'id' | 'utmCampaign'>): string {
  return campaign.utmCampaign ?? campaign.id
}

/**
 * Clicks and conversions for a campaign, measured through our own redirector and our own
 * analytics.
 *
 * Denominators, stated once:
 *   - `clicks` counts CLICK ROWS, not people. Bots are excluded; a click we could not classify
 *     still counts. One person clicking three links produces three.
 *   - `uniqueClickers` counts DISTINCT RECIPIENTS OF THIS CAMPAIGN. A click is only counted if
 *     its `utm_content` matches a recipient row on this campaign, so a stray click on a shared
 *     link cannot inflate it. Compare it against `sent`, not against `recipients`.
 *   - `conversions.bookings` counts ANALYTICS EVENTS, which is bookings rather than people,
 *     matched on the campaign's UTM value. Attribution is last-touch and as generous as the
 *     website's own: any booking still carrying our campaign tag counts, whenever it happened.
 *   - `conversions.enquiries` counts MARKETING CONVERSION ROWS on the same UTM value, which is
 *     the enquiry forms the website cannot turn into a booking. Kept separate from bookings
 *     because a campaign that produced twenty questions did not fill twenty tables, and the
 *     first B2B campaign's main call to action is an enquiry form rather than a booking one.
 */
async function fetchCampaignEngagement(
  supabase: AdminClient,
  campaign: MarketingCampaign,
  recipientIds: Set<string>,
): Promise<MarketingCampaignEngagement> {
  const links = await fetchCampaignLinks(supabase, campaign.id)
  const clickRows = await fetchClicksForLinks(
    supabase,
    links.map((link) => link.id),
  )

  let clicks = 0
  const clickers = new Set<string>()

  for (const row of clickRows) {
    if (!isHumanClick(row.device_type)) continue
    clicks += 1
    if (row.utm_content && recipientIds.has(row.utm_content)) clickers.add(row.utm_content)
  }

  const utmCampaign = campaignUtmValue(campaign)
  const [bookings, enquiries] = await Promise.all([
    fetchConversionsByUtmCampaign(supabase, utmCampaign),
    fetchEnquiryConversionsByUtmCampaign(supabase, utmCampaign),
  ])

  return {
    clicks,
    uniqueClickers: clickers.size,
    conversions: {
      bookings: bookings.count,
      enquiries: enquiries.count,
      total: bookings.count + enquiries.count,
    },
    // Only bookings carry an amount, so the enquiry side never feeds this.
    conversionValue: bookings.value,
  }
}

/**
 * Campaign results.
 *
 * Every provider-side metric is counted from a TIMESTAMP column, never from `email_messages
 * .status`. The webhook promotes that status forwards (delivered, then opened, then clicked),
 * so counting statuses would report a campaign where everyone clicked as having zero
 * deliveries and zero opens.
 *
 * Rates use `sent` as the denominator throughout: a skipped or failed row never reached an
 * inbox, so including it would depress every figure and make a clean send look like a poor
 * one.
 *
 * `engagement` is the separate, first-party half of the picture and does not feed the rates.
 * Its own denominators are documented on `fetchCampaignEngagement`.
 */
export async function getCampaignStats(id: string): Promise<MarketingCampaignStats> {
  const supabase = createAdminClient()
  const campaign = await requireCampaign(id)

  const recipients = await fetchAllPages<{
    id: string
    status: MarketingRecipientStatus
    skip_reason: string | null
    email_message_id: string | null
  }>((from, to) =>
    supabase
      .from('marketing_campaign_recipients')
      .select('id, status, skip_reason, email_message_id')
      .eq('campaign_id', id)
      .order('id', { ascending: true })
      .range(from, to),
  )

  let sent = 0
  let failed = 0
  let needsReview = 0
  let pending = 0
  let sendingNow = 0
  let skipped = 0
  const skippedByReason: Record<string, number> = {}
  const messageIds: string[] = []

  for (const row of recipients) {
    if (row.status === 'sent') sent += 1
    else if (row.status === 'failed') failed += 1
    else if (row.status === 'needs_review') needsReview += 1
    else if (row.status === 'pending') pending += 1
    else if (row.status === 'sending') sendingNow += 1
    else if (row.status === 'skipped') {
      skipped += 1
      const reason = row.skip_reason ?? 'unknown'
      skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1
    }

    if (row.email_message_id) messageIds.push(row.email_message_id)
  }

  const messageEngagement = await fetchEngagement(supabase, messageIds)

  let delivered = 0
  let opened = 0
  let clicked = 0
  let bounced = 0
  let complained = 0

  for (const row of messageEngagement.values()) {
    if (row.delivered_at) delivered += 1
    if (row.opened_at) opened += 1
    if (row.clicked_at) clicked += 1
    if (row.bounced_at) bounced += 1
    if (row.complained_at) complained += 1
  }

  // Counted from whichever list this campaign went to. Reading only business_contacts, as
  // this did, pinned every guest campaign's unsubscribe rate to 0.0% however many people
  // actually opted out, which reads as evidence that nobody minded.
  const unsubscribeSource =
    campaign.audienceType === 'customer'
      ? { table: 'customers' as const, column: 'marketing_unsubscribe_campaign_id' }
      : { table: 'business_contacts' as const, column: 'unsubscribe_campaign_id' }

  const { count: unsubscribeCount, error: unsubscribeError } = await supabase
    .from(unsubscribeSource.table)
    .select('id', { count: 'exact', head: true })
    .eq(unsubscribeSource.column, id)

  if (unsubscribeError) throw new Error(unsubscribeError.message)
  const unsubscribed = unsubscribeCount ?? 0

  const engagement = await fetchCampaignEngagement(
    supabase,
    campaign,
    new Set(recipients.map((row) => row.id)),
  )

  return {
    campaignId: id,
    recipients: recipients.length,
    sent,
    failed,
    needsReview,
    pending,
    sendingNow,
    skipped,
    skippedByReason,

    delivered,
    opened,
    clicked,
    bounced,
    complained,
    unsubscribed,

    rates: {
      deliveredRate: rate(delivered, sent),
      openRate: rate(opened, sent),
      clickRate: rate(clicked, sent),
      bounceRate: rate(bounced, sent),
      complaintRate: rate(complained, sent),
      unsubscribeRate: rate(unsubscribed, sent),
    },

    engagement,
  }
}

/**
 * Which call to action actually worked.
 *
 * One row per destination the campaign points at. `clicks` counts click rows on that link with
 * bots removed; `uniqueClickers` counts distinct recipients of this campaign who clicked that
 * particular link, so the two columns answer "how much traffic" and "how many people" without
 * pretending to be the same number.
 *
 * `originalUrl` is what the person writing the email typed, taken from the link's metadata.
 * The stored destination has the UTM parameters baked in, which is noise on a results table.
 */
export async function getCampaignLinkPerformance(
  campaignId: string,
): Promise<MarketingCampaignLinkPerformance[]> {
  const supabase = createAdminClient()

  const links = await fetchCampaignLinks(supabase, campaignId)
  if (links.length === 0) return []

  const recipientIds = new Set(
    (
      await fetchAllPages<{ id: string }>((from, to) =>
        supabase
          .from('marketing_campaign_recipients')
          .select('id')
          .eq('campaign_id', campaignId)
          .order('id', { ascending: true })
          .range(from, to),
      )
    ).map((row) => row.id),
  )

  const clickRows = await fetchClicksForLinks(
    supabase,
    links.map((link) => link.id),
  )

  const clicksByLink = new Map<string, { clicks: number; clickers: Set<string> }>()
  for (const row of clickRows) {
    if (!row.short_link_id || !isHumanClick(row.device_type)) continue

    const current = clicksByLink.get(row.short_link_id) ?? { clicks: 0, clickers: new Set<string>() }
    current.clicks += 1
    if (row.utm_content && recipientIds.has(row.utm_content)) current.clickers.add(row.utm_content)
    clicksByLink.set(row.short_link_id, current)
  }

  return links
    .map((link) => {
      const counts = clicksByLink.get(link.id)
      const originalUrl =
        typeof link.metadata?.original_url === 'string'
          ? link.metadata.original_url
          : link.destination_url ?? ''

      return {
        originalUrl,
        shortCode: link.short_code,
        shortUrl: buildShortLinkUrl(link.short_code),
        clicks: counts?.clicks ?? 0,
        uniqueClickers: counts?.clickers.size ?? 0,
      }
    })
    .sort((a, b) => b.clicks - a.clicks || a.originalUrl.localeCompare(b.originalUrl))
}

export interface ListRecipientsOptions {
  status?: MarketingRecipientStatus
  page?: number
  pageSize?: number
}

export interface ListRecipientsResult {
  recipients: MarketingCampaignRecipientWithEngagement[]
  total: number
}

export async function listRecipients(
  campaignId: string,
  options: ListRecipientsOptions = {},
): Promise<ListRecipientsResult> {
  const supabase = createAdminClient()

  const page = Math.max(1, options.page ?? 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE))
  const from = (page - 1) * pageSize

  let query = supabase
    .from('marketing_campaign_recipients')
    .select('*', { count: 'exact' })
    .eq('campaign_id', campaignId)

  if (options.status) query = query.eq('status', options.status)

  const { data, error, count } = await query
    .order('created_at', { ascending: true })
    .range(from, from + pageSize - 1)

  if (error) throw new Error(error.message)

  const recipients = (data ?? []).map(mapMarketingCampaignRecipient)
  const engagement = await fetchEngagement(
    supabase,
    recipients
      .map((recipient) => recipient.emailMessageId)
      .filter((messageId): messageId is string => messageId != null),
  )

  // One extra query for the whole page, keyed on the recipient ids the email carried in
  // `utm_content`. Asking per row would be up to 200 round trips for one table.
  const clicksByRecipient = summariseClicksByRecipient(
    await fetchClicksByRecipientIds(
      supabase,
      recipients.map((recipient) => recipient.id),
    ),
  )

  return {
    recipients: recipients.map((recipient) => {
      const row = recipient.emailMessageId ? engagement.get(recipient.emailMessageId) : undefined
      const clicks = clicksByRecipient.get(recipient.id)

      return {
        ...recipient,
        engagement: row ? mapMarketingRecipientEngagement(row) : null,
        clickCount: clicks?.clickCount ?? 0,
        lastClickedAt: clicks?.lastClickedAt ?? null,
      }
    }),
    total: count ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettings(): Promise<MarketingSettings> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('marketing_settings')
    .select('*')
    .eq('id', true)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Marketing settings row is missing')
  return mapMarketingSettings(data)
}

export interface MarketingSettingsPatch {
  sendsEnabled?: boolean
  sendWindowStartHour?: number
  sendWindowEndHour?: number
  sendDays?: number[]
  frequencyCapDays?: number
  batchSize?: number
}

export async function updateSettings(
  patch: MarketingSettingsPatch,
  userId: string,
): Promise<MarketingSettings> {
  const supabase = createAdminClient()
  const existing = await getSettings()

  const startHour = patch.sendWindowStartHour ?? existing.sendWindowStartHour
  const endHour = patch.sendWindowEndHour ?? existing.sendWindowEndHour

  // Checked here as well as by the constraint so the person gets a sentence rather than a
  // raw constraint violation.
  if (endHour <= startHour) {
    throw new Error('The send window must end after it starts')
  }

  const payload: Record<string, unknown> = {
    updated_by: userId,
    updated_at: new Date().toISOString(),
  }

  if (patch.sendsEnabled !== undefined) payload.sends_enabled = patch.sendsEnabled
  if (patch.sendWindowStartHour !== undefined) payload.send_window_start_hour = startHour
  if (patch.sendWindowEndHour !== undefined) payload.send_window_end_hour = endHour
  if (patch.frequencyCapDays !== undefined) payload.frequency_cap_days = patch.frequencyCapDays
  if (patch.batchSize !== undefined) payload.batch_size = patch.batchSize

  if (patch.sendDays !== undefined) {
    const days = [...new Set(patch.sendDays)].sort((a, b) => a - b)
    if (days.length === 0) {
      throw new Error('At least one send day is needed, otherwise nothing will ever send')
    }
    if (days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
      throw new Error('Send days must be ISO day numbers from 1 (Monday) to 7 (Sunday)')
    }
    payload.send_days = days
  }

  const { data, error } = await supabase
    .from('marketing_settings')
    .update(payload)
    .eq('id', true)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Marketing settings row is missing')
  return mapMarketingSettings(data)
}
