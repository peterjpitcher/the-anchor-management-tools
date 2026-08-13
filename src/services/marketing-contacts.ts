import { createHash } from 'crypto'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  mapBusinessContact,
  type AudiencePreview,
  type BusinessContact,
  type DoNotContactReason,
  type EligibilityStatus,
  type MarketingBasis,
  type MarketingImportDecision,
  type MarketingImportRowResult,
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
  page?: number
  pageSize?: number
}

export interface ListContactsResult {
  contacts: BusinessContact[]
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

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1)

  if (error) throw new Error(error.message)

  return { contacts: (data ?? []).map(mapBusinessContact), total: count ?? 0 }
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
}

export interface ImportContactsInput {
  rows: ImportContactRow[]
  filename?: string | null
}

export interface ImportContactsResult {
  batchId: string
  imported: number
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
  for (const item of pending) {
    const existingId = existingByEmail.get(item.email)
    if (existingId) {
      record(item.row.rowNumber, item.email, 'skipped_duplicate', 'Already in the contact list', existingId)
      continue
    }

    if (doNotContact.has(item.email)) {
      record(item.row.rowNumber, item.email, 'skipped_do_not_contact', 'On the do-not-contact list')
      continue
    }

    toInsert.push(item)
  }

  let flaggedFreemail = 0
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

  return { batchId, imported, skipped, flaggedFreemail, rows: results }
}
