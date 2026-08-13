import { createHash } from 'crypto'

import { createAdminClient } from '@/lib/supabase/admin'
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
  type MarketingCampaign,
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
 * Freezes a draft and books it in.
 *
 * Three things are locked at this moment and none of them can be re-derived later: the
 * content hash, the recipient count a human approved, and the send time. Short-link
 * provisioning fills `link_map` in a separate step, so it is left empty here rather than
 * guessed at.
 */
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
    includeTags: existing.audience.includeTags,
    excludeTags: existing.audience.excludeTags,
  })

  if (preview.eligibleCount === 0) {
    throw new Error('This audience matches nobody, so there is nothing to schedule')
  }

  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('marketing_campaigns')
    .update({
      status: 'scheduled',
      scheduled_for: when.toISOString(),
      locked_at: now,
      scheduled_by: userId,
      approved_recipient_count: preview.eligibleCount,
      content_hash: computeContentHash(content),
      // Short links are provisioned separately. An empty map renders the original URLs, which
      // is correct but untracked, never broken.
      link_map: {},
    })
    .eq('id', id)
    .eq('status', 'draft')
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Campaign was no longer a draft when it was scheduled')

  return { campaign: mapMarketingCampaign(data), approvedRecipientCount: preview.eligibleCount }
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
 * Campaign results.
 *
 * Every engagement metric is counted from a TIMESTAMP column, never from `email_messages
 * .status`. The webhook promotes that status forwards (delivered, then opened, then clicked),
 * so counting statuses would report a campaign where everyone clicked as having zero
 * deliveries and zero opens.
 *
 * Rates use `sent` as the denominator throughout: a skipped or failed row never reached an
 * inbox, so including it would depress every figure and make a clean send look like a poor
 * one.
 */
export async function getCampaignStats(id: string): Promise<MarketingCampaignStats> {
  const supabase = createAdminClient()

  const recipients = await fetchAllPages<{
    status: MarketingRecipientStatus
    skip_reason: string | null
    email_message_id: string | null
  }>((from, to) =>
    supabase
      .from('marketing_campaign_recipients')
      .select('status, skip_reason, email_message_id')
      .eq('campaign_id', id)
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

  const engagement = await fetchEngagement(supabase, messageIds)

  let delivered = 0
  let opened = 0
  let clicked = 0
  let bounced = 0
  let complained = 0

  for (const row of engagement.values()) {
    if (row.delivered_at) delivered += 1
    if (row.opened_at) opened += 1
    if (row.clicked_at) clicked += 1
    if (row.bounced_at) bounced += 1
    if (row.complained_at) complained += 1
  }

  const { count: unsubscribeCount, error: unsubscribeError } = await supabase
    .from('business_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('unsubscribe_campaign_id', id)

  if (unsubscribeError) throw new Error(unsubscribeError.message)
  const unsubscribed = unsubscribeCount ?? 0

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
  }
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

  return {
    recipients: recipients.map((recipient) => {
      const row = recipient.emailMessageId ? engagement.get(recipient.emailMessageId) : undefined
      return { ...recipient, engagement: row ? mapMarketingRecipientEngagement(row) : null }
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
