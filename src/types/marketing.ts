/**
 * B2B marketing email domain types.
 *
 * The status unions below mirror the CHECK constraints in
 * `supabase/migrations/20260813120000_marketing_email_core.sql` exactly. If a constraint
 * changes, change the union in the same commit: a value the database accepts but the union
 * does not is a runtime surprise that no test will catch, because the mappers never validate.
 *
 * This project has no `fromDb<T>()` helper. Every table gets one hand-written mapper, and
 * that mapper is the only place raw column names are read.
 */

/**
 * Supabase rows arrive untyped here. `database.generated.ts` is stale for the marketing
 * tables and regenerating it is out of scope for this changeset, so claiming a precise row
 * type would be a lie the compiler could not check. Confining the loose type to the mappers
 * keeps every raw column read in one auditable place.
 */
type DbRow = any

// ---------------------------------------------------------------------------
// Status unions
// ---------------------------------------------------------------------------

export type BusinessContactSource = 'csv_import' | 'manual' | 'invoice_vendor'

export type SubscriberType = 'corporate' | 'individual' | 'unknown'

export type MarketingBasis = 'legitimate_interest' | 'consent' | 'soft_opt_in'

export type EligibilityStatus = 'pending_review' | 'eligible' | 'excluded'

export type MarketingStatus = 'subscribed' | 'unsubscribed' | 'bounced' | 'complained'

/**
 * Which list a campaign sends to.
 *
 * Not a cosmetic label: business contacts rely on legitimate interest, guests on consent or a
 * prior booking, so the two have genuinely different eligibility rules at both preview and
 * send time. See `promote_due_marketing_campaigns()`.
 */
export type MarketingAudienceType = 'business' | 'customer'

export type MarketingCampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'paused'
  | 'completed'
  | 'cancelled'

export type MarketingRecipientStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'skipped'
  | 'needs_review'

export type MarketingSkipReason =
  | 'unsubscribed'
  | 'suppressed'
  | 'do_not_contact'
  | 'frequency_cap'
  | 'not_eligible'
  | 'campaign_cancelled'

export type MarketingFailureClass = 'retryable' | 'terminal' | 'unknown'

export type DoNotContactReason = 'unsubscribe' | 'complaint' | 'bounce' | 'manual' | 'erasure'

export type MarketingImportDecision =
  | 'imported'
  | 'updated'
  | 'skipped_duplicate'
  | 'skipped_do_not_contact'
  | 'skipped_invalid'

export const BUSINESS_CONTACT_SOURCES: readonly BusinessContactSource[] = [
  'csv_import',
  'manual',
  'invoice_vendor',
]

export const SUBSCRIBER_TYPES: readonly SubscriberType[] = ['corporate', 'individual', 'unknown']

export const MARKETING_BASES: readonly MarketingBasis[] = [
  'legitimate_interest',
  'consent',
  'soft_opt_in',
]

export const ELIGIBILITY_STATUSES: readonly EligibilityStatus[] = [
  'pending_review',
  'eligible',
  'excluded',
]

export const MARKETING_STATUSES: readonly MarketingStatus[] = [
  'subscribed',
  'unsubscribed',
  'bounced',
  'complained',
]

export const MARKETING_CAMPAIGN_STATUSES: readonly MarketingCampaignStatus[] = [
  'draft',
  'scheduled',
  'sending',
  'paused',
  'completed',
  'cancelled',
]

export const MARKETING_RECIPIENT_STATUSES: readonly MarketingRecipientStatus[] = [
  'pending',
  'sending',
  'sent',
  'failed',
  'skipped',
  'needs_review',
]

export const MARKETING_SKIP_REASONS: readonly MarketingSkipReason[] = [
  'unsubscribed',
  'suppressed',
  'do_not_contact',
  'frequency_cap',
  'not_eligible',
  'campaign_cancelled',
]

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface BusinessContact {
  id: string
  email: string
  contactName: string | null
  firstName: string | null
  companyName: string | null
  jobTitle: string | null
  invoiceVendorId: string | null

  source: BusinessContactSource
  sourceDetail: string | null
  collectedAt: string | null
  tags: string[]

  subscriberType: SubscriberType
  subscriberTypeVerifiedAt: string | null
  marketingBasis: MarketingBasis | null
  basisEvidence: string | null
  privacyNoticeSentAt: string | null
  eligibilityStatus: EligibilityStatus
  eligibilityReviewedBy: string | null
  eligibilityReviewedAt: string | null
  eligibilityNote: string | null
  /** Review hint only. A free-mail domain never gates a send on its own. */
  isFreemail: boolean

  // Researched context from the curated source list. Prose, not typed values: "Staff (est)"
  // holds things like "~2000 at LHR", so none of these are safe to coerce.
  distanceNote: string | null
  cluster: string | null
  staffEstimate: string | null
  roomFit: string | null
  roomFitNote: string | null
  angle: string | null
  openingLine: string | null
  sendTiming: string | null

  marketingStatus: MarketingStatus
  unsubscribedAt: string | null
  resubscribedAt: string | null
  resubscribeNote: string | null
  lastMarketingEmailAt: string | null
  lastMarketingCampaignId: string | null
  unsubscribeCampaignId: string | null
  marketingReservedUntil: string | null

  notes: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

/** Include tags match on ANY. Exclude tags remove on ANY match. Empty include means all. */
export interface MarketingAudience {
  includeTags: string[]
  excludeTags: string[]
}

export interface MarketingCampaign {
  id: string
  name: string
  subject: string
  preheader: string

  content: unknown
  contentSchemaVersion: number
  rendererVersion: string
  contentHash: string | null

  /** Which list this goes to. Decides eligibility rules, not just who is picked. */
  audienceType: MarketingAudienceType
  audience: MarketingAudience
  audienceVersion: number
  approvedRecipientCount: number | null

  linkMap: Record<string, string>
  utmCampaign: string | null

  status: MarketingCampaignStatus
  scheduledFor: string | null
  lockedAt: string | null
  startedAt: string | null
  completedAt: string | null
  cancelledAt: string | null
  cancelledBy: string | null
  pausedAt: string | null
  pausedBy: string | null

  createdBy: string | null
  scheduledBy: string | null
  createdAt: string
  updatedAt: string
}

export interface MarketingCampaignRecipient {
  id: string
  campaignId: string
  contactId: string
  /** Address snapshot taken when the audience was frozen, not the contact's current address. */
  email: string

  status: MarketingRecipientStatus
  skipReason: MarketingSkipReason | null

  emailMessageId: string | null
  providerMessageId: string | null

  attemptCount: number
  maxAttempts: number
  nextAttemptAt: string | null
  lastAttemptAt: string | null
  claimedAt: string | null
  leaseExpiresAt: string | null
  failureClass: MarketingFailureClass | null
  error: string | null

  sentAt: string | null
  createdAt: string
  updatedAt: string
}

/** Engagement pulled from the linked `email_messages` row, by timestamp not by status. */
export interface MarketingRecipientEngagement {
  deliveredAt: string | null
  openedAt: string | null
  clickedAt: string | null
  bouncedAt: string | null
  complainedAt: string | null
  failedAt: string | null
}

export interface MarketingCampaignRecipientWithEngagement extends MarketingCampaignRecipient {
  engagement: MarketingRecipientEngagement | null
  /**
   * Clicks on our own short links carrying this recipient's id in `utm_content`, bots removed.
   * Counts clicks rather than flagging one, so a contact who came back three times is visibly
   * more interested than one who glanced once.
   */
  clickCount: number
  lastClickedAt: string | null
}

export interface MarketingSettings {
  /** Ships OFF. Nothing sends until a human turns this on. */
  sendsEnabled: boolean
  sendWindowStartHour: number
  sendWindowEndHour: number
  /** ISO day numbers, Monday is 1. */
  sendDays: number[]
  frequencyCapDays: number
  batchSize: number
  updatedBy: string | null
  updatedAt: string
}

export interface MarketingDoNotContactEntry {
  emailNormalised: string
  emailHash: string
  reason: DoNotContactReason
  source: string | null
  campaignId: string | null
  createdAt: string
  createdBy: string | null
  removedAt: string | null
  removedBy: string | null
  removalNote: string | null
}

export interface MarketingImportBatch {
  id: string
  filename: string | null
  rowCount: number
  importedCount: number
  skippedCount: number
  createdBy: string | null
  createdAt: string
}

export interface MarketingImportRowResult {
  rowNumber: number
  email: string | null
  decision: MarketingImportDecision
  reason: string | null
  contactId: string | null
}

// ---------------------------------------------------------------------------
// Aggregates returned by the services
// ---------------------------------------------------------------------------

export interface MarketingTagCount {
  tag: string
  count: number
}

export interface AudiencePreview {
  eligibleCount: number
  excludedCounts: {
    notEligible: number
    unsubscribed: number
    doNotContact: number
    suppressed: number
  }
}

export interface MarketingCampaignSummary {
  recipients: number
  pending: number
  sending: number
  sent: number
  failed: number
  skipped: number
  needsReview: number
}

export interface MarketingCampaignWithSummary extends MarketingCampaign {
  summary: MarketingCampaignSummary
}

/**
 * What the campaign actually caused, measured first-party.
 *
 * Nothing here comes from the email provider. Clicks are cleaned rows in `short_link_clicks` on
 * links we minted ourselves, and conversions are bookings the brand website attributed back to
 * the campaign. Provider opens sit alongside these on `MarketingCampaignStats`; provider clicks
 * are deliberately not used because mail-security scanners inflate them.
 */
export interface MarketingCampaignEngagement {
  /** Human clicks on this campaign's short links after automated scan filtering. */
  clicks: number
  /** Distinct recipients of THIS campaign with a cleaned click, identified by `utm_content`. */
  uniqueClickers: number
  /** Raw click rows hidden because they were bots, scan bursts or pre-send tests. */
  filteredClicks: number
  /** What the campaign actually produced, split by kind so the two are never conflated. */
  conversions: MarketingCampaignConversions
  /**
   * Money attached to those bookings, or null when none of them carried an amount. Null is
   * not zero: it means we cannot say, and showing GBP 0.00 would be a claim we cannot support.
   *
   * Enquiries carry no amount and never contribute to this.
   */
  conversionValue: number | null
}

/**
 * Conversions split by source, because a booking and an enquiry are not the same result.
 *
 * A booking is confirmed business already on the diary and comes from `analytics_events`.
 * An enquiry is a business asking a question and comes from `marketing_conversions`. Adding
 * them into one number would let a campaign that produced twenty questions and no bookings
 * read exactly like one that filled twenty tables, so `total` is offered alongside the two
 * parts rather than instead of them.
 */
export interface MarketingCampaignConversions {
  /** Bookings still carrying this campaign's UTM value, from our own booking records. */
  bookings: number
  /** Enquiries recorded against this campaign, from the website's enquiry forms. */
  enquiries: number
  /** Convenience sum of the two above. */
  total: number
}

/** Per-destination click performance, so it is visible which call to action worked. */
export interface MarketingCampaignLinkPerformance {
  /** Where the link actually sends people, before short-linking. */
  originalUrl: string
  shortCode: string
  shortUrl: string
  clicks: number
  uniqueClickers: number
}

export interface MarketingCampaignStats {
  campaignId: string
  recipients: number
  sent: number
  failed: number
  needsReview: number
  pending: number
  sendingNow: number
  skipped: number
  skippedByReason: Record<string, number>

  delivered: number
  opened: number
  clicked: number
  bounced: number
  complained: number
  unsubscribed: number

  /**
   * Every rate uses `sent` as the denominator, not `recipients`. A skipped or failed row
   * never reached an inbox, so counting it would quietly depress every figure and make a
   * clean send look like a bad one. Zero sends yields zero rates rather than NaN.
   */
  rates: {
    deliveredRate: number
    openRate: number
    clickRate: number
    bounceRate: number
    complaintRate: number
    unsubscribeRate: number
  }

  engagement: MarketingCampaignEngagement
}

/**
 * Everything one contact has done across every campaign they have ever been sent.
 *
 * The counts are lifetime, not per campaign, because the question this answers is whether a
 * contact is worth keeping on the list at all.
 */
export interface BusinessContactEngagement {
  contactId: string
  /** Campaigns where an email actually went out to them, not campaigns they were queued for. */
  campaignsSent: number
  delivered: number
  bounced: number
  clicks: number
  lastClickedAt: string | null
  /** Split the same way as a campaign's, so a booking is never mistaken for a question. */
  conversions: MarketingCampaignConversions
  lastConversionAt: string | null
}

/** A contact plus the one engagement signal cheap enough to show on every row of a list. */
export interface BusinessContactWithClicks extends BusinessContact {
  clicks: number
}

export interface MarketingClusterCount {
  cluster: string
  count: number
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function mapBusinessContact(row: DbRow): BusinessContact {
  return {
    id: row.id,
    email: row.email,
    contactName: row.contact_name ?? null,
    firstName: row.first_name ?? null,
    companyName: row.company_name ?? null,
    jobTitle: row.job_title ?? null,
    invoiceVendorId: row.invoice_vendor_id ?? null,

    source: row.source,
    sourceDetail: row.source_detail ?? null,
    collectedAt: row.collected_at ?? null,
    tags: toStringArray(row.tags),

    subscriberType: row.subscriber_type,
    subscriberTypeVerifiedAt: row.subscriber_type_verified_at ?? null,
    marketingBasis: row.marketing_basis ?? null,
    basisEvidence: row.basis_evidence ?? null,
    privacyNoticeSentAt: row.privacy_notice_sent_at ?? null,
    eligibilityStatus: row.eligibility_status,
    eligibilityReviewedBy: row.eligibility_reviewed_by ?? null,
    eligibilityReviewedAt: row.eligibility_reviewed_at ?? null,
    eligibilityNote: row.eligibility_note ?? null,
    isFreemail: row.is_freemail === true,
    distanceNote: row.distance_note ?? null,
    cluster: row.cluster ?? null,
    staffEstimate: row.staff_estimate ?? null,
    roomFit: row.room_fit ?? null,
    roomFitNote: row.room_fit_note ?? null,
    angle: row.angle ?? null,
    openingLine: row.opening_line ?? null,
    sendTiming: row.send_timing ?? null,

    marketingStatus: row.marketing_status,
    unsubscribedAt: row.unsubscribed_at ?? null,
    resubscribedAt: row.resubscribed_at ?? null,
    resubscribeNote: row.resubscribe_note ?? null,
    lastMarketingEmailAt: row.last_marketing_email_at ?? null,
    lastMarketingCampaignId: row.last_marketing_campaign_id ?? null,
    unsubscribeCampaignId: row.unsubscribe_campaign_id ?? null,
    marketingReservedUntil: row.marketing_reserved_until ?? null,

    notes: row.notes ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapMarketingAudience(value: DbRow): MarketingAudience {
  return {
    includeTags: toStringArray(value?.include_tags),
    excludeTags: toStringArray(value?.exclude_tags),
  }
}

/** Back to the stored shape. The database and the RPCs read snake_case keys. */
export function audienceToDb(audience: MarketingAudience): { include_tags: string[]; exclude_tags: string[] } {
  return { include_tags: audience.includeTags, exclude_tags: audience.excludeTags }
}

export function mapMarketingCampaign(row: DbRow): MarketingCampaign {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    preheader: row.preheader,

    content: row.content,
    contentSchemaVersion: row.content_schema_version,
    rendererVersion: row.renderer_version,
    contentHash: row.content_hash ?? null,

    audienceType: row.audience_type === 'customer' ? 'customer' : 'business',
    audience: mapMarketingAudience(row.audience),
    audienceVersion: row.audience_version,
    approvedRecipientCount: row.approved_recipient_count ?? null,

    linkMap: (row.link_map ?? {}) as Record<string, string>,
    utmCampaign: row.utm_campaign ?? null,

    status: row.status,
    scheduledFor: row.scheduled_for ?? null,
    lockedAt: row.locked_at ?? null,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    cancelledBy: row.cancelled_by ?? null,
    pausedAt: row.paused_at ?? null,
    pausedBy: row.paused_by ?? null,

    createdBy: row.created_by ?? null,
    scheduledBy: row.scheduled_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapMarketingCampaignRecipient(row: DbRow): MarketingCampaignRecipient {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    contactId: row.contact_id,
    email: row.email,

    status: row.status,
    skipReason: row.skip_reason ?? null,

    emailMessageId: row.email_message_id ?? null,
    providerMessageId: row.provider_message_id ?? null,

    attemptCount: row.attempt_count ?? 0,
    maxAttempts: row.max_attempts ?? 3,
    nextAttemptAt: row.next_attempt_at ?? null,
    lastAttemptAt: row.last_attempt_at ?? null,
    claimedAt: row.claimed_at ?? null,
    leaseExpiresAt: row.lease_expires_at ?? null,
    failureClass: row.failure_class ?? null,
    error: row.error ?? null,

    sentAt: row.sent_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapMarketingSettings(row: DbRow): MarketingSettings {
  return {
    sendsEnabled: row.sends_enabled === true,
    sendWindowStartHour: row.send_window_start_hour,
    sendWindowEndHour: row.send_window_end_hour,
    sendDays: Array.isArray(row.send_days)
      ? row.send_days.map((day: unknown) => Number(day)).filter((day: number) => Number.isFinite(day))
      : [],
    frequencyCapDays: row.frequency_cap_days,
    batchSize: row.batch_size,
    updatedBy: row.updated_by ?? null,
    updatedAt: row.updated_at,
  }
}

export function mapMarketingDoNotContact(row: DbRow): MarketingDoNotContactEntry {
  return {
    emailNormalised: row.email_normalised,
    emailHash: row.email_hash,
    reason: row.reason,
    source: row.source ?? null,
    campaignId: row.campaign_id ?? null,
    createdAt: row.created_at,
    createdBy: row.created_by ?? null,
    removedAt: row.removed_at ?? null,
    removedBy: row.removed_by ?? null,
    removalNote: row.removal_note ?? null,
  }
}

export function mapMarketingImportBatch(row: DbRow): MarketingImportBatch {
  return {
    id: row.id,
    filename: row.filename ?? null,
    rowCount: row.row_count ?? 0,
    importedCount: row.imported_count ?? 0,
    skippedCount: row.skipped_count ?? 0,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
  }
}

export function mapMarketingRecipientEngagement(row: DbRow): MarketingRecipientEngagement {
  return {
    deliveredAt: row.delivered_at ?? null,
    openedAt: row.opened_at ?? null,
    clickedAt: row.clicked_at ?? null,
    bouncedAt: row.bounced_at ?? null,
    complainedAt: row.complained_at ?? null,
    failedAt: row.failed_at ?? null,
  }
}
