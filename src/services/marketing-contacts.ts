import { createHash } from 'crypto'

import {
  fetchClicksByRecipientIds,
  fetchConversionsByRecipientIds,
  fetchEnquiryConversionsByRecipientIds,
  summariseClicksByRecipient,
} from '@/lib/email/marketing/attribution'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  mapBusinessContact,
  type AudiencePreview,
  type BusinessContact,
  type BusinessContactEngagement,
  type BusinessContactWithClicks,
  type DoNotContactReason,
  type EligibilityStatus,
  type MarketingAudienceType,
  type MarketingBasis,
  type MarketingClusterCount,
  type MarketingImportDecision,
  type MarketingImportRowResult,
  type MarketingRecipientStatus,
  type MarketingStatus,
  type MarketingTagCount,
  type SubscriberType,
} from '@/types/marketing'

/**
 * Business contacts: the people a marketing campaign is allowed to reach.
 *
 * These tables are service-role only, so every function here uses the admin client and the
 * caller is responsible for the RBAC check. That is why nothing in this file is exported to
 * a client component: the server actions in `src/app/actions/marketing-contacts.ts` are the
 * only sanctioned entry point.
 *
 * Functions throw on failure. The action layer turns a throw into `{ error }`.
 */

/** Supabase caps a single response, so anything unbounded is read in pages. */
const FETCH_PAGE_SIZE = 1000

/** A runaway query is a bug, not a big list. Stop rather than exhaust memory. */
const FETCH_ROW_CAP = 100_000

/** PostgREST `in` filters go into the URL, so long lists are chunked. */
const IN_CHUNK_SIZE = 200

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

/**
 * Free-mail providers, matched on the first label of the domain so the country variants
 * (yahoo.co.uk, live.co.uk) are caught without a suffix list.
 *
 * This only ever raises a review flag. A free-mail address does not prove a sole trader any
 * more than a company domain proves a limited company, so it never decides eligibility.
 */
const FREEMAIL_LABELS = new Set([
  'gmail',
  'googlemail',
  'hotmail',
  'outlook',
  'live',
  'yahoo',
  'ymail',
  'icloud',
  'me',
  'aol',
  'btinternet',
  'sky',
  'talktalk',
  'virginmedia',
  'msn',
])

/** Deliberately loose. Real deliverability is proved by a bounce, not by a regex. */
const EMAIL_PATTERN = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

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

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function hashEmail(email: string): string {
  return createHash('sha256').update(normaliseEmail(email)).digest('hex')
}

export function isFreemailAddress(email: string): boolean {
  const domain = normaliseEmail(email).split('@')[1]
  if (!domain) return false
  return FREEMAIL_LABELS.has(domain.split('.')[0] ?? '')
}

/**
 * PostgREST parses `or=(...)` and `in.(...)` by splitting on commas, so a search term
 * carrying punctuation can break out of its own filter. Strip the structural characters
 * rather than escaping them: a comma in a company-name search is worth nothing.
 */
function sanitiseSearchTerm(term: string): string {
  return term.replace(/[,()"\\%*]/g, ' ').trim()
}

/** Postgres array literal, used where supabase-js has no typed helper (NOT overlaps). */
function toPgArrayLiteral(values: string[]): string {
  const escaped = values.map((value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
  return `{${escaped.join(',')}}`
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
  return [...seen].slice(0, 40)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ListContactsOptions {
  search?: string
  tags?: string[]
  status?: MarketingStatus
  eligibility?: EligibilityStatus
  /** Walkable grouping from the curated list, used to plan a morning of visits. */
  cluster?: string
  page?: number
  pageSize?: number
}

export interface ListContactsResult {
  contacts: BusinessContact[]
  total: number
}

export interface ListContactsWithClicksResult {
  contacts: BusinessContactWithClicks[]
  total: number
}

export async function listContacts(options: ListContactsOptions = {}): Promise<ListContactsResult> {
  const supabase = createAdminClient()

  const page = Math.max(1, options.page ?? 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE))
  const from = (page - 1) * pageSize

  let query = supabase.from('business_contacts').select('*', { count: 'exact' })

  const search = sanitiseSearchTerm(options.search ?? '')
  if (search.length > 0) {
    query = query.or(
      `email.ilike.%${search}%,company_name.ilike.%${search}%,contact_name.ilike.%${search}%`,
    )
  }

  const tags = cleanTags(options.tags)
  if (tags.length > 0) query = query.overlaps('tags', tags)
  if (options.status) query = query.eq('marketing_status', options.status)
  if (options.eligibility) query = query.eq('eligibility_status', options.eligibility)

  // Matched exactly rather than fuzzily. Clusters come from the curated spreadsheet as a
  // closed set of labels, so an exact match is what the filter dropdown offers.
  const cluster = emptyToNull(options.cluster)
  if (cluster) query = query.eq('cluster', cluster)

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1)

  if (error) throw new Error(error.message)

  return { contacts: (data ?? []).map(mapBusinessContact), total: count ?? 0 }
}

/**
 * The same list, plus a lifetime click count on every row.
 *
 * Two extra queries for the whole page, never one per contact: the recipient rows for these
 * contacts, then the clicks carrying those recipient ids. Clicks are keyed on the recipient id
 * rather than the contact id, because that is what the email put in the URL, so the hop through
 * `marketing_campaign_recipients` is unavoidable.
 */
export async function listContactsWithEngagement(
  options: ListContactsOptions = {},
): Promise<ListContactsWithClicksResult> {
  const supabase = createAdminClient()
  const { contacts, total } = await listContacts(options)

  if (contacts.length === 0) return { contacts: [], total }

  const recipients = await fetchRecipientsForContacts(
    supabase,
    contacts.map((contact) => contact.id),
  )

  const clickCountByRecipient = summariseClicksByRecipient(
    await fetchClicksByRecipientIds(
      supabase,
      recipients.map((recipient) => recipient.id),
    ),
  )

  const clicksByContact = new Map<string, number>()
  for (const recipient of recipients) {
    const clicks = clickCountByRecipient.get(recipient.id)?.clickCount ?? 0
    if (clicks === 0) continue
    clicksByContact.set(recipient.contact_id, (clicksByContact.get(recipient.contact_id) ?? 0) + clicks)
  }

  return {
    contacts: contacts.map((contact) => ({
      ...contact,
      clicks: clicksByContact.get(contact.id) ?? 0,
    })),
    total,
  }
}

/**
 * Clusters that actually exist, with how many contacts are in each.
 *
 * Only a quarter of the list has one, so offering every conceivable label would be a dropdown
 * of dead ends. Reading the column and counting here matches how `listTags` works, and keeps
 * both filters honest about what they will actually return.
 */
export async function listClusters(): Promise<MarketingClusterCount[]> {
  const supabase = createAdminClient()

  const rows = await fetchAllPages<{ cluster: string | null }>((from, to) =>
    supabase.from('business_contacts').select('cluster').not('cluster', 'is', null).range(from, to),
  )

  const counts = new Map<string, number>()
  for (const row of rows) {
    const cluster = row.cluster?.trim()
    if (!cluster) continue
    counts.set(cluster, (counts.get(cluster) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([cluster, count]) => ({ cluster, count }))
    .sort((a, b) => b.count - a.count || a.cluster.localeCompare(b.cluster))
}

/**
 * Everything one contact has done, across every campaign they have ever been sent.
 *
 * Denominators, stated once:
 *   - `campaignsSent` counts recipient rows with status 'sent'. A contact queued for a campaign
 *     that has not gone out yet, or skipped by the frequency cap, is not counted: the question
 *     is what they have been shown, not what was planned.
 *   - `delivered` and `bounced` are counted from TIMESTAMP columns on the linked
 *     `email_messages` rows, never from that table's status, because the webhook promotes the
 *     status forwards and a delivered-then-clicked message would otherwise vanish from the
 *     delivered count.
 *   - `clicks` counts click rows, bots removed, so one person clicking three links gives three.
 *   - `conversions` counts analytics events carrying one of this contact's recipient ids in
 *     `utm_content`, which is bookings rather than people.
 *
 * Opens are left out deliberately. Apple Mail and Gmail prefetch tracking pixels, so an open
 * is a weak signal at the best of times and a badly misleading one when it is the headline
 * number on a single contact. Clicks are what this summary leads with.
 */
export async function getContactEngagement(contactId: string): Promise<BusinessContactEngagement> {
  const supabase = createAdminClient()

  const recipients = await fetchRecipientsForContacts(supabase, [contactId])
  const recipientIds = recipients.map((recipient) => recipient.id)

  const empty: BusinessContactEngagement = {
    contactId,
    campaignsSent: 0,
    delivered: 0,
    bounced: 0,
    clicks: 0,
    lastClickedAt: null,
    conversions: { bookings: 0, enquiries: 0, total: 0 },
    lastConversionAt: null,
  }

  if (recipientIds.length === 0) return empty

  const messageIds = recipients
    .map((recipient) => recipient.email_message_id)
    .filter((messageId): messageId is string => messageId != null)

  let delivered = 0
  let bounced = 0

  for (const part of chunk(messageIds, IN_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('email_messages')
      .select('delivered_at, bounced_at')
      .in('id', part)

    if (error) throw new Error(error.message)

    for (const row of (data ?? []) as Array<{ delivered_at: string | null; bounced_at: string | null }>) {
      if (row.delivered_at) delivered += 1
      if (row.bounced_at) bounced += 1
    }
  }

  const clickRows = await fetchClicksByRecipientIds(supabase, recipientIds)
  const clickSummary = summariseClicksByRecipient(clickRows)

  let clicks = 0
  let lastClickedAt: string | null = null
  for (const summary of clickSummary.values()) {
    clicks += summary.clickCount
    if (summary.lastClickedAt && (!lastClickedAt || summary.lastClickedAt > lastClickedAt)) {
      lastClickedAt = summary.lastClickedAt
    }
  }

  // Bookings and enquiries live in different tables and are counted separately, because a
  // business that asked about Christmas has not booked anything yet and should not read as
  // though it has.
  const [bookings, enquiries] = await Promise.all([
    fetchConversionsByRecipientIds(supabase, recipientIds),
    fetchEnquiryConversionsByRecipientIds(supabase, recipientIds),
  ])

  const lastConversionAt =
    [bookings.lastAt, enquiries.lastAt]
      .filter((value): value is string => value != null)
      .sort()
      .pop() ?? null

  return {
    contactId,
    campaignsSent: recipients.filter((recipient) => recipient.status === 'sent').length,
    delivered,
    bounced,
    clicks,
    lastClickedAt,
    conversions: {
      bookings: bookings.count,
      enquiries: enquiries.count,
      total: bookings.count + enquiries.count,
    },
    lastConversionAt,
  }
}

interface ContactRecipientRow {
  id: string
  contact_id: string
  status: MarketingRecipientStatus
  email_message_id: string | null
}

/**
 * Recipient rows for a set of contacts.
 *
 * Fetched on its own rather than embedded from `email_messages`. There are now two foreign
 * keys between those two tables, so a PostgREST embed is ambiguous and would break the moment
 * someone touched either side. Two queries and a join in memory cannot.
 */
async function fetchRecipientsForContacts(
  supabase: AdminClient,
  contactIds: string[],
): Promise<ContactRecipientRow[]> {
  if (contactIds.length === 0) return []

  const out: ContactRecipientRow[] = []
  for (const part of chunk(contactIds, IN_CHUNK_SIZE)) {
    const rows = await fetchAllPages<ContactRecipientRow>((from, to) =>
      supabase
        .from('marketing_campaign_recipients')
        .select('id, contact_id, status, email_message_id')
        .in('contact_id', part)
        .order('id', { ascending: true })
        .range(from, to),
    )
    out.push(...rows)
  }

  return out
}

export async function getContact(id: string): Promise<BusinessContact | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('business_contacts')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data ? mapBusinessContact(data) : null
}

export async function listTags(): Promise<MarketingTagCount[]> {
  const supabase = createAdminClient()

  const rows = await fetchAllPages<{ tags: string[] | null }>((from, to) =>
    supabase.from('business_contacts').select('tags').range(from, to),
  )

  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const tag of row.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

export async function isDoNotContact(email: string): Promise<boolean> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('marketing_do_not_contact')
    .select('email_normalised')
    .eq('email_normalised', normaliseEmail(email))
    .is('removed_at', null)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data != null
}

// ---------------------------------------------------------------------------
// Audience preview
// ---------------------------------------------------------------------------

/**
 * Active do-not-contact entries for the given addresses. Chunked because the list goes into
 * the request URL.
 */
async function fetchActiveDoNotContact(
  supabase: AdminClient,
  emails: string[],
): Promise<Set<string>> {
  const found = new Set<string>()

  for (const part of chunk(emails, IN_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('marketing_do_not_contact')
      .select('email_normalised')
      .in('email_normalised', part)
      .is('removed_at', null)

    if (error) throw new Error(error.message)
    for (const row of data ?? []) found.add(row.email_normalised)
  }

  return found
}

/**
 * The whole suppression list, lowercased.
 *
 * `email_suppressions.email` is not guaranteed to be stored lowercase, and the SQL compares
 * `lower(es.email)`. Filtering by `in` would therefore miss a mixed-case row, so the list is
 * read in full and lowercased here to match the database predicate exactly.
 */
async function fetchSuppressedEmails(supabase: AdminClient): Promise<Set<string>> {
  const rows = await fetchAllPages<{ email: string }>((from, to) =>
    supabase.from('email_suppressions').select('email').range(from, to),
  )

  return new Set(rows.map((row) => row.email.trim().toLowerCase()))
}

export interface PreviewAudienceOptions {
  includeTags?: string[]
  excludeTags?: string[]
  /** Which list to count. Tags only apply to business contacts; guests have no tags. */
  audienceType?: MarketingAudienceType
}

/**
 * What a campaign with this audience would actually reach.
 *
 * The predicates mirror `promote_due_marketing_campaigns()` exactly: eligible, subscribed,
 * include tags on ANY overlap (empty include means everyone), exclude tags remove on any
 * match, then not on the do-not-contact list and not suppressed. If that SQL changes, change
 * this together with it, because a preview that disagrees with the promotion query is worse
 * than no preview: it is the number a human approves before a send.
 *
 * The exclusion buckets are counted in the same precedence order the send-time re-check uses,
 * so a contact appears in exactly one bucket and the buckets add up.
 */
export async function previewAudience(options: PreviewAudienceOptions = {}): Promise<AudiencePreview> {
  const supabase = createAdminClient()

  // Guests are counted in the database, by a function that copies the promote RPC's own
  // predicates. Counting them here instead would mean fetching every customer and every
  // booking just to answer "how many", and would give the preview a second, drifting
  // definition of who is eligible.
  if (options.audienceType === 'customer') {
    const { data, error } = await supabase.rpc('preview_customer_marketing_audience').single()
    if (error) throw error

    const row = data as {
      eligible_count: number
      not_eligible_count: number
      unsubscribed_count: number
      do_not_contact_count: number
      suppressed_count: number
    }

    return {
      eligibleCount: row.eligible_count,
      excludedCounts: {
        notEligible: row.not_eligible_count,
        unsubscribed: row.unsubscribed_count,
        doNotContact: row.do_not_contact_count,
        suppressed: row.suppressed_count,
      },
    }
  }

  const includeTags = cleanTags(options.includeTags)
  const excludeTags = cleanTags(options.excludeTags)

  const pool = await fetchAllPages<{
    email: string
    eligibility_status: string
    marketing_status: string
  }>((from, to) => {
    let query = supabase
      .from('business_contacts')
      .select('email, eligibility_status, marketing_status')

    if (includeTags.length > 0) query = query.overlaps('tags', includeTags)
    if (excludeTags.length > 0) query = query.not('tags', 'ov', toPgArrayLiteral(excludeTags))

    return query.order('created_at', { ascending: true }).range(from, to)
  })

  const emails = pool.map((row) => row.email)
  const doNotContact = emails.length > 0 ? await fetchActiveDoNotContact(supabase, emails) : new Set<string>()
  const suppressed = emails.length > 0 ? await fetchSuppressedEmails(supabase) : new Set<string>()

  const excludedCounts = { notEligible: 0, unsubscribed: 0, doNotContact: 0, suppressed: 0 }
  let eligibleCount = 0

  for (const row of pool) {
    if (row.eligibility_status !== 'eligible') {
      excludedCounts.notEligible += 1
    } else if (row.marketing_status !== 'subscribed') {
      excludedCounts.unsubscribed += 1
    } else if (doNotContact.has(row.email)) {
      excludedCounts.doNotContact += 1
    } else if (suppressed.has(row.email)) {
      excludedCounts.suppressed += 1
    } else {
      eligibleCount += 1
    }
  }

  return { eligibleCount, excludedCounts }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface ContactInput {
  email: string
  contactName?: string | null
  firstName?: string | null
  companyName?: string | null
  jobTitle?: string | null
  tags?: string[]
  sourceDetail?: string | null
  collectedAt?: string | null
  notes?: string | null
}

export async function createContact(input: ContactInput, userId: string): Promise<BusinessContact> {
  const supabase = createAdminClient()
  const email = normaliseEmail(input.email)

  if (!EMAIL_PATTERN.test(email)) {
    throw new Error(`"${input.email}" is not a valid email address`)
  }

  // Blocking here rather than relying on the send-time skip keeps an objection visible at the
  // moment someone tries to undo it, instead of silently swallowing every send later.
  if (await isDoNotContact(email)) {
    throw new Error('That address is on the do-not-contact list and cannot be re-added')
  }

  const { data, error } = await supabase
    .from('business_contacts')
    .insert({
      email,
      contact_name: emptyToNull(input.contactName),
      first_name: emptyToNull(input.firstName),
      company_name: emptyToNull(input.companyName),
      job_title: emptyToNull(input.jobTitle),
      tags: cleanTags(input.tags),
      source: 'manual',
      source_detail: emptyToNull(input.sourceDetail),
      collected_at: input.collectedAt ?? null,
      notes: emptyToNull(input.notes),
      is_freemail: isFreemailAddress(email),
      created_by: userId,
    })
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return mapBusinessContact(data)
}

export async function updateContact(
  id: string,
  input: Partial<ContactInput>,
  userId: string,
): Promise<BusinessContact> {
  const supabase = createAdminClient()
  const payload: Record<string, unknown> = {}

  if (input.email !== undefined) {
    const email = normaliseEmail(input.email)
    if (!EMAIL_PATTERN.test(email)) {
      throw new Error(`"${input.email}" is not a valid email address`)
    }
    if (await isDoNotContact(email)) {
      throw new Error('That address is on the do-not-contact list and cannot be used')
    }
    payload.email = email
    payload.is_freemail = isFreemailAddress(email)
  }

  if (input.contactName !== undefined) payload.contact_name = emptyToNull(input.contactName)
  if (input.firstName !== undefined) payload.first_name = emptyToNull(input.firstName)
  if (input.companyName !== undefined) payload.company_name = emptyToNull(input.companyName)
  if (input.jobTitle !== undefined) payload.job_title = emptyToNull(input.jobTitle)
  if (input.tags !== undefined) payload.tags = cleanTags(input.tags)
  if (input.sourceDetail !== undefined) payload.source_detail = emptyToNull(input.sourceDetail)
  if (input.collectedAt !== undefined) payload.collected_at = input.collectedAt
  if (input.notes !== undefined) payload.notes = emptyToNull(input.notes)

  if (Object.keys(payload).length === 0) {
    const existing = await getContact(id)
    if (!existing) throw new Error('Contact not found')
    return existing
  }

  // Not a column on the row; recorded by the caller's audit entry. Kept in the signature so
  // every write in this file names the human behind it.
  void userId

  const { data, error } = await supabase
    .from('business_contacts')
    .update(payload)
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Contact not found')
  return mapBusinessContact(data)
}

export interface EligibilityInput {
  eligibilityStatus: EligibilityStatus
  subscriberType?: SubscriberType
  marketingBasis?: MarketingBasis | null
  basisEvidence?: string | null
  note?: string | null
}

/**
 * Records a human's eligibility decision.
 *
 * The 'eligible' guard is checked here as well as by the database constraint so the person
 * gets a sentence explaining what is missing rather than a raw constraint violation.
 */
export async function setEligibility(
  id: string,
  input: EligibilityInput,
  userId: string,
): Promise<BusinessContact> {
  const supabase = createAdminClient()

  const existing = await getContact(id)
  if (!existing) throw new Error('Contact not found')

  const marketingBasis =
    input.marketingBasis !== undefined ? input.marketingBasis : existing.marketingBasis
  const basisEvidence =
    input.basisEvidence !== undefined ? emptyToNull(input.basisEvidence) : existing.basisEvidence

  if (input.eligibilityStatus === 'eligible') {
    if (!marketingBasis) {
      throw new Error('Marking a contact eligible needs a lawful basis')
    }
    if (!basisEvidence) {
      throw new Error('Marking a contact eligible needs evidence for the lawful basis')
    }
  }

  const subscriberType = input.subscriberType ?? existing.subscriberType
  const now = new Date().toISOString()

  const payload: Record<string, unknown> = {
    eligibility_status: input.eligibilityStatus,
    subscriber_type: subscriberType,
    marketing_basis: marketingBasis,
    basis_evidence: basisEvidence,
    eligibility_note: input.note !== undefined ? emptyToNull(input.note) : existing.eligibilityNote,
    eligibility_reviewed_by: userId,
    eligibility_reviewed_at: now,
  }

  // Only stamp the verification time when the type actually moved off 'unknown'.
  if (subscriberType !== 'unknown' && subscriberType !== existing.subscriberType) {
    payload.subscriber_type_verified_at = now
  }

  const { data, error } = await supabase
    .from('business_contacts')
    .update(payload)
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Contact not found')
  return mapBusinessContact(data)
}

/**
 * Applies one eligibility decision to many contacts at once.
 *
 * The list was imported in one go and is reviewed the same way: a segment of freight firms is
 * one judgement about corporate subscribers, not forty identical ones. Reviewing them
 * individually is the thing most likely to stall a launch, and a stalled review is what leads
 * to somebody marking the whole list eligible without reading it.
 *
 * Each contact still goes through setEligibility, so the same evidence rules apply to every
 * row and each keeps its own reviewer and timestamp. Failures are collected rather than
 * thrown, so one bad row cannot silently discard the rest of the batch.
 */
export async function setEligibilityBulk(
  ids: string[],
  input: EligibilityInput,
  userId: string,
): Promise<{ updated: number; failures: Array<{ id: string; error: string }> }> {
  const failures: Array<{ id: string; error: string }> = []
  let updated = 0

  for (const id of ids) {
    try {
      await setEligibility(id, input, userId)
      updated++
    } catch (error) {
      failures.push({ id, error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }

  return { updated, failures }
}

export interface UnsubscribeInput {
  reason: DoNotContactReason
  campaignId?: string | null
  source: string
}

/**
 * Stops marketing to a contact and records the objection so a re-import cannot resurrect it.
 *
 * The do-not-contact row is written as well as the status change because the status lives on
 * a record that erasure will empty. The objection has to outlive the contact, which is the
 * whole reason that table exists.
 */
export async function unsubscribeContact(
  id: string,
  input: UnsubscribeInput,
): Promise<BusinessContact> {
  const supabase = createAdminClient()

  const existing = await getContact(id)
  if (!existing) throw new Error('Contact not found')

  const email = normaliseEmail(existing.email)
  const now = new Date().toISOString()

  const marketingStatus: MarketingStatus =
    input.reason === 'bounce' ? 'bounced' : input.reason === 'complaint' ? 'complained' : 'unsubscribed'

  const { data, error } = await supabase
    .from('business_contacts')
    .update({
      marketing_status: marketingStatus,
      // The constraint demands this timestamp whenever the status is 'unsubscribed', and it
      // is the proof of when the objection landed, so it is always stamped.
      unsubscribed_at: existing.unsubscribedAt ?? now,
      unsubscribe_campaign_id: input.campaignId ?? existing.unsubscribeCampaignId,
    })
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Contact not found')

  // Upserting clears any previous removal: a fresh objection outranks an old re-consent.
  const { error: dncError } = await supabase.from('marketing_do_not_contact').upsert(
    {
      email_normalised: email,
      email_hash: hashEmail(email),
      reason: input.reason,
      source: input.source,
      campaign_id: input.campaignId ?? null,
      removed_at: null,
      removed_by: null,
      removal_note: null,
    },
    { onConflict: 'email_normalised' },
  )

  if (dncError) throw new Error(dncError.message)

  return mapBusinessContact(data)
}

/**
 * Puts a contact back on the list.
 *
 * The note is mandatory and is not paperwork: re-consent is the one thing that can undo a
 * recorded objection, so there has to be a written reason attached to whoever did it.
 */
export async function resubscribeContact(
  id: string,
  note: string,
  userId: string,
): Promise<BusinessContact> {
  const supabase = createAdminClient()

  const trimmedNote = note.trim()
  if (trimmedNote.length === 0) {
    throw new Error('Resubscribing needs a note recording where the consent came from')
  }

  const existing = await getContact(id)
  if (!existing) throw new Error('Contact not found')

  const email = normaliseEmail(existing.email)
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('business_contacts')
    .update({
      marketing_status: 'subscribed',
      resubscribed_at: now,
      resubscribe_note: trimmedNote,
    })
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Contact not found')

  const { error: dncError } = await supabase
    .from('marketing_do_not_contact')
    .update({ removed_at: now, removed_by: userId, removal_note: trimmedNote })
    .eq('email_normalised', email)
    .is('removed_at', null)

  if (dncError) throw new Error(dncError.message)

  return mapBusinessContact(data)
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportContactRow {
  rowNumber: number
  email: string
  contactName?: string | null
  firstName?: string | null
  companyName?: string | null
  jobTitle?: string | null
  tags?: string[]
  sourceDetail?: string | null
  notes?: string | null
  /** Researched context from the curated list. Prose, not typed values. */
  distanceNote?: string | null
  cluster?: string | null
  staffEstimate?: string | null
  roomFit?: string | null
  roomFitNote?: string | null
  angle?: string | null
  openingLine?: string | null
  sendTiming?: string | null
}

export interface ImportContactsInput {
  rows: ImportContactRow[]
  filename?: string | null
  /**
   * Refresh the researched context on contacts that are already in the list.
   *
   * Only descriptive fields move: company, name, tags and the enrichment. Eligibility,
   * marketing status and consent are never touched, so re-importing a corrected spreadsheet
   * cannot resurrect somebody who unsubscribed or undo a reviewer's decision.
   */
  updateExisting?: boolean
}

export interface ImportContactsResult {
  batchId: string
  imported: number
  /** Existing contacts whose researched context was refreshed. */
  updated: number
  skipped: number
  flaggedFreemail: number
  rows: MarketingImportRowResult[]
}

interface PendingImport {
  row: ImportContactRow
  email: string
}

/**
 * Imports a parsed contact list.
 *
 * Everything lands as `pending_review` (the column default), never as eligible. An email
 * domain cannot tell you whether the subscriber is a limited company or a sole trader, so an
 * import is never allowed to decide that on its own: a human sets eligibility afterwards.
 *
 * Every input row gets an audit row recording its decision, so a bad import can be explained
 * and reversed instead of guessed at.
 */
export async function importContacts(
  input: ImportContactsInput,
  userId: string,
): Promise<ImportContactsResult> {
  const supabase = createAdminClient()

  const { data: batch, error: batchError } = await supabase
    .from('marketing_import_batches')
    .insert({
      filename: emptyToNull(input.filename ?? null),
      row_count: input.rows.length,
      created_by: userId,
    })
    .select('id')
    .single()

  if (batchError) throw new Error(batchError.message)
  const batchId: string = batch.id

  const results: MarketingImportRowResult[] = []
  const pending: PendingImport[] = []
  const seen = new Map<string, number>()

  const record = (
    rowNumber: number,
    email: string | null,
    decision: MarketingImportDecision,
    reason: string | null,
    contactId: string | null = null,
  ) => {
    results.push({ rowNumber, email, decision, reason, contactId })
  }

  for (const row of input.rows) {
    const email = normaliseEmail(row.email ?? '')

    if (email.length < 3 || email.length > 320 || !EMAIL_PATTERN.test(email)) {
      record(row.rowNumber, email.length > 0 ? email : null, 'skipped_invalid', 'Not a valid email address')
      continue
    }

    const firstSeenAt = seen.get(email)
    if (firstSeenAt !== undefined) {
      record(row.rowNumber, email, 'skipped_duplicate', `Duplicate of row ${firstSeenAt} in this file`)
      continue
    }

    seen.set(email, row.rowNumber)
    pending.push({ row, email })
  }

  // Existing contacts win: an import must never overwrite a record a human has already
  // reviewed, because that would quietly reset an eligibility decision.
  const existingByEmail = new Map<string, string>()
  for (const part of chunk(
    pending.map((item) => item.email),
    IN_CHUNK_SIZE,
  )) {
    const { data, error } = await supabase
      .from('business_contacts')
      .select('id, email')
      .in('email', part)

    if (error) throw new Error(error.message)
    for (const contact of data ?? []) existingByEmail.set(contact.email, contact.id)
  }

  const doNotContact =
    pending.length > 0
      ? await fetchActiveDoNotContact(
          supabase,
          pending.map((item) => item.email),
        )
      : new Set<string>()

  const toInsert: PendingImport[] = []
  const toUpdate: Array<{ id: string; item: PendingImport }> = []
  for (const item of pending) {
    const existingId = existingByEmail.get(item.email)
    if (existingId) {
      if (input.updateExisting) {
        toUpdate.push({ id: existingId, item })
      } else {
        record(item.row.rowNumber, item.email, 'skipped_duplicate', 'Already in the contact list', existingId)
      }
      continue
    }

    if (doNotContact.has(item.email)) {
      record(item.row.rowNumber, item.email, 'skipped_do_not_contact', 'On the do-not-contact list')
      continue
    }

    toInsert.push(item)
  }

  let flaggedFreemail = 0
  let updatedCount = 0
  for (const { id, item } of toUpdate) {
    const { error } = await supabase
      .from('business_contacts')
      .update({
        contact_name: emptyToNull(item.row.contactName),
        first_name: emptyToNull(item.row.firstName),
        company_name: emptyToNull(item.row.companyName),
        job_title: emptyToNull(item.row.jobTitle),
        tags: cleanTags(item.row.tags),
        source_detail: emptyToNull(item.row.sourceDetail ?? input.filename ?? null),
        notes: emptyToNull(item.row.notes),
        distance_note: emptyToNull(item.row.distanceNote),
        cluster: emptyToNull(item.row.cluster),
        staff_estimate: emptyToNull(item.row.staffEstimate),
        room_fit: emptyToNull(item.row.roomFit),
        room_fit_note: emptyToNull(item.row.roomFitNote),
        angle: emptyToNull(item.row.angle),
        opening_line: emptyToNull(item.row.openingLine),
        send_timing: emptyToNull(item.row.sendTiming),
        is_freemail: isFreemailAddress(item.email),
      })
      .eq('id', id)

    if (error) {
      record(item.row.rowNumber, item.email, 'skipped_invalid', `Could not update: ${error.message}`, id)
      continue
    }

    updatedCount += 1
    record(item.row.rowNumber, item.email, 'updated', 'Refreshed from the source list', id)
  }

  const rowNumberByEmail = new Map(toInsert.map((item) => [item.email, item.row.rowNumber]))

  if (toInsert.length > 0) {
    const payload = toInsert.map((item) => {
      const freemail = isFreemailAddress(item.email)
      if (freemail) flaggedFreemail += 1

      return {
        email: item.email,
        contact_name: emptyToNull(item.row.contactName),
        first_name: emptyToNull(item.row.firstName),
        company_name: emptyToNull(item.row.companyName),
        job_title: emptyToNull(item.row.jobTitle),
        tags: cleanTags(item.row.tags),
        source: 'csv_import',
        source_detail: emptyToNull(item.row.sourceDetail ?? input.filename ?? null),
        notes: emptyToNull(item.row.notes),
        distance_note: emptyToNull(item.row.distanceNote),
        cluster: emptyToNull(item.row.cluster),
        staff_estimate: emptyToNull(item.row.staffEstimate),
        room_fit: emptyToNull(item.row.roomFit),
        room_fit_note: emptyToNull(item.row.roomFitNote),
        angle: emptyToNull(item.row.angle),
        opening_line: emptyToNull(item.row.openingLine),
        send_timing: emptyToNull(item.row.sendTiming),
        is_freemail: freemail,
        created_by: userId,
      }
    })

    for (const part of chunk(payload, IN_CHUNK_SIZE)) {
      const { data, error } = await supabase.from('business_contacts').insert(part).select('id, email')
      if (error) throw new Error(error.message)

      const insertedByEmail = new Map<string, string>()
      for (const contact of data ?? []) insertedByEmail.set(contact.email, contact.id)

      for (const item of part) {
        const insertedId = insertedByEmail.get(item.email) ?? null
        const rowNumber = rowNumberByEmail.get(item.email)
        if (rowNumber === undefined) continue
        record(rowNumber, item.email, 'imported', null, insertedId)
      }
    }
  }

  results.sort((a, b) => a.rowNumber - b.rowNumber)

  const imported = results.filter((result) => result.decision === 'imported').length
  const skipped = results.length - imported

  const auditRows = results.map((result) => ({
    batch_id: batchId,
    row_number: result.rowNumber,
    email: result.email,
    decision: result.decision,
    reason: result.reason,
    contact_id: result.contactId,
  }))

  for (const part of chunk(auditRows, IN_CHUNK_SIZE)) {
    const { error } = await supabase.from('marketing_import_rows').insert(part)
    if (error) throw new Error(error.message)
  }

  const { error: countError } = await supabase
    .from('marketing_import_batches')
    .update({ imported_count: imported, skipped_count: skipped })
    .eq('id', batchId)

  if (countError) throw new Error(countError.message)

  return { batchId, imported, updated: updatedCount, skipped, flaggedFreemail, rows: results }
}
