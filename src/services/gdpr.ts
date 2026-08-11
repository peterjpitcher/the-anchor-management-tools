import { createAdminClient } from '@/lib/supabase/admin'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { logger } from '@/lib/logger'
import { generatePhoneVariants } from '@/lib/utils'

const COMMUNICATION_ATTACHMENT_BUCKET = 'communication-attachments'
const COMMUNICATION_RETENTION_MONTHS = 24
const GDPR_BATCH_SIZE = 1000
const GDPR_UPDATE_BATCH_SIZE = 500

/**
 * Placeholder mobile number written when a customer is erased.
 *
 * customers.mobile_number is NOT NULL and carries chk_customer_phone_format,
 * which accepts only a valid UK or E.164 number. Erasure used to write
 * `erased-<uuid>`, which the constraint rejected, so the update threw after the
 * message, email and consent rows had already been destructively rewritten and
 * the customer was left half-erased.
 *
 * 07700 900000 is inside the Ofcom range reserved for drama and fiction, so it
 * satisfies the constraint while routing to nobody. mobile_e164 is set to NULL
 * alongside it, which is where the unique index lives, so many erased customers
 * can share this value.
 */
const ERASED_CUSTOMER_MOBILE = '07700900000'

/**
 * Placeholders for the other NOT NULL columns erasure has to overwrite rather
 * than clear: parking_bookings.customer_first_name / customer_mobile /
 * vehicle_registration, private_bookings.customer_name, email_messages
 * .to_address, pending_bookings.mobile_number, sms_promo_context.phone_number
 * and private_booking_sms_queue.customer_phone / customer_name.
 *
 * Each one is obviously synthetic, so a row that still carries it reads as
 * erased rather than as real data. The email placeholder sits in .invalid,
 * which RFC 2606 reserves and which can never resolve, so nothing can be
 * delivered to it if a stale row is ever fed back into an email send.
 */
const ERASED_FIRST_NAME = 'Erased'
const ERASED_LAST_NAME = 'Customer'
const ERASED_FULL_NAME = `${ERASED_FIRST_NAME} ${ERASED_LAST_NAME}`
const ERASED_EMAIL_ADDRESS = 'erased@gdpr.invalid'
const ERASED_VEHICLE_REGISTRATION = 'ERASED'

/** Columns on customers that hold a phone number in one spelling or another. */
const CUSTOMER_PHONE_COLUMNS = ['mobile_e164', 'mobile_number', 'mobile_number_raw']
const CUSTOMER_IDENTITY_COLUMNS = 'id, email, mobile_number, mobile_e164, mobile_number_raw'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Every spelling of the subject that other tables might be keyed on. */
interface CommunicationIdentity {
  customerIds: string[]
  emails: string[]
  phones: string[]
}

/**
 * The records an erasure request resolves to.
 *
 * profileId is the staff login, when the subject has one. customerIds is the
 * part that matters: those are the guest records the pub actually holds
 * personal data against.
 */
export interface ErasureSubject {
  profileId: string | null
  profileEmail: string | null
  customerIds: string[]
  emails: string[]
  phones: string[]
}

interface ExportData {
  profile: any
  customers: any[]
  bookings: any[]
  tableBookings: any[]
  privateBookings: any[]
  parkingBookings: any[]
  messages: any[]
  emailMessages: any[]
  customerConsents: any[]
  unmatchedCommunications: any[]
  webhookLogs: any[]
  storageAttachmentRefs: string[]
  employees: any[]
  auditLogs: any[]
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date)
  next.setMonth(next.getMonth() + months)
  return next
}

function normalizeEmail(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(
    values
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim())
  ))
}

function collectPhoneIdentity(values: unknown[]): string[] {
  const variants = new Set<string>()

  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue

    for (const variant of generatePhoneVariants(value)) {
      const normalized = variant.trim()
      if (/^[+\d]+$/.test(normalized)) {
        variants.add(normalized)
      }
    }
  }

  return Array.from(variants)
}

function buildCommunicationIdentity(profile: any, customers: any[]): CommunicationIdentity {
  const emails = uniqueStrings([
    normalizeEmail(profile?.email),
    ...customers.map((customer) => normalizeEmail(customer?.email)),
  ])

  const phones = collectPhoneIdentity(
    customers.flatMap((customer) => [
      customer?.mobile_e164,
      customer?.mobile_number,
      customer?.mobile_number_raw,
    ])
  )

  return {
    customerIds: uniqueStrings(customers.map((customer) => customer?.id)),
    emails,
    phones,
  }
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

function safePostgrestValues(values: string[]): string[] {
  return values.filter((value) => !/[,\n\r()]/.test(value))
}

function equalityClauses(columns: string[], values: string[]): string[] {
  return columns.flatMap((column) =>
    safePostgrestValues(values).map((value) => `${column}.eq.${value}`)
  )
}

function ilikeClauses(columns: string[], values: string[]): string[] {
  return columns.flatMap((column) =>
    safePostgrestValues(values).map((value) => `${column}.ilike.%${value}%`)
  )
}

async function fetchAllRows<T>(buildQuery: () => any): Promise<T[]> {
  const rows: T[] = []
  let from = 0

  while (true) {
    const { data, error } = await buildQuery().range(from, from + GDPR_BATCH_SIZE - 1)

    if (error) {
      throw new Error(error.message)
    }

    const batch = (data || []) as T[]
    rows.push(...batch)

    if (batch.length < GDPR_BATCH_SIZE) {
      break
    }

    from += GDPR_BATCH_SIZE
  }

  return rows
}

function mergeRowsById<T extends { id?: string | null }>(rows: T[][]): T[] {
  const seen = new Set<string>()
  const merged: T[] = []

  for (const group of rows) {
    for (const row of group) {
      const id = row?.id
      if (id && seen.has(id)) continue
      if (id) seen.add(id)
      merged.push(row)
    }
  }

  return merged
}

async function fetchUnmatchedCommunicationRows(
  adminClient: any,
  identity: CommunicationIdentity,
  select = '*'
) {
  const queries: Array<Promise<any[]>> = []

  if (identity.customerIds.length > 0) {
    queries.push(fetchAllRows(() =>
      (adminClient.from('unmatched_communications') as any)
        .select(select)
        .in('linked_customer_id', identity.customerIds)
    ))
    queries.push(fetchAllRows(() =>
      (adminClient.from('unmatched_communications') as any)
        .select(select)
        .overlaps('candidate_customer_ids', identity.customerIds)
    ))
  }

  const addressClauses = [
    ...equalityClauses(['from_address', 'to_address'], identity.emails),
    ...equalityClauses(['from_address', 'to_address'], identity.phones),
  ]

  if (addressClauses.length > 0) {
    queries.push(fetchAllRows(() =>
      (adminClient.from('unmatched_communications') as any)
        .select(select)
        .or(addressClauses.join(','))
    ))
  }

  return mergeRowsById(await Promise.all(queries))
}

async function fetchWebhookLogRows(
  adminClient: any,
  identity: CommunicationIdentity,
  select = '*'
) {
  const queries: Array<Promise<any[]>> = []

  if (identity.customerIds.length > 0) {
    queries.push(fetchAllRows(() =>
      (adminClient.from('webhook_logs') as any)
        .select(select)
        .in('customer_id', identity.customerIds)
    ))
  }

  const webhookClauses = [
    ...equalityClauses(['from_number', 'to_number'], identity.phones),
    ...ilikeClauses(['body', 'message_body'], [...identity.emails, ...identity.phones]),
  ]

  if (webhookClauses.length > 0) {
    queries.push(fetchAllRows(() =>
      (adminClient.from('webhook_logs') as any)
        .select(select)
        .or(webhookClauses.join(','))
    ))
  }

  return mergeRowsById(await Promise.all(queries))
}

interface IdentityMatch {
  /**
   * Column holding either a customers.id or a parent booking id. When `ids` is
   * omitted the identity's customer ids are used.
   */
  idColumn?: string
  ids?: string[]
  emailColumns?: string[]
  phoneColumns?: string[]
}

/**
 * Find the rows in `table` that belong to the subject, by foreign key and by
 * any email or phone column the table denormalises the contact details into.
 * Erasure has to cover both: parking_bookings, private_bookings and
 * pending_bookings all keep their own copy of the name, mobile and email, and
 * some of those rows have no customer_id at all.
 */
async function fetchRowsByIdentity(
  adminClient: any,
  table: string,
  identity: CommunicationIdentity,
  match: IdentityMatch,
  select = 'id',
): Promise<any[]> {
  const queries: Array<Promise<any[]>> = []
  const ids = match.ids ?? identity.customerIds

  if (match.idColumn && ids.length > 0) {
    const idColumn = match.idColumn
    queries.push(fetchAllRows(() =>
      (adminClient.from(table) as any).select(select).in(idColumn, ids)
    ))
  }

  const clauses = [
    ...equalityClauses(match.emailColumns ?? [], identity.emails),
    ...equalityClauses(match.phoneColumns ?? [], identity.phones),
  ]

  if (clauses.length > 0) {
    queries.push(fetchAllRows(() =>
      (adminClient.from(table) as any).select(select).or(clauses.join(','))
    ))
  }

  if (queries.length === 0) return []

  return mergeRowsById(await Promise.all(queries))
}

function rowIds(rows: any[]): string[] {
  return uniqueStrings(rows.map((row) => row?.id))
}

/*
 * Email lookups pull every row that has an address and compare in JavaScript
 * rather than filtering in PostgREST. Neither customers.email nor
 * profiles.email is stored lower cased, and PostgREST offers no escape for the
 * _ and % wildcards that appear in real addresses, so an ilike filter would
 * both miss rows and over-match. Only a few hundred customers carry an email at
 * all, and erasure is a rare manual operation, so the scan is affordable.
 */
async function loadCustomersWithEmail(adminClient: any): Promise<any[]> {
  return fetchAllRows<any>(() =>
    (adminClient.from('customers') as any).select(CUSTOMER_IDENTITY_COLUMNS).not('email', 'is', null)
  )
}

async function loadProfilesWithEmail(adminClient: any): Promise<any[]> {
  return fetchAllRows<any>(() =>
    (adminClient.from('profiles') as any).select('id, email').not('email', 'is', null)
  )
}

function collectAttachmentPaths(rows: any[]): string[] {
  const paths = new Set<string>()

  for (const row of rows) {
    const attachments = Array.isArray(row?.attachments) ? row.attachments : []
    for (const attachment of attachments) {
      const path =
        typeof attachment?.path === 'string'
          ? attachment.path
          : typeof attachment?.storage_path === 'string'
            ? attachment.storage_path
            : typeof attachment?.objectPath === 'string'
              ? attachment.objectPath
              : null
      if (path) paths.add(path)
    }
  }

  return Array.from(paths)
}

async function removeCommunicationStorageObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return

  const adminClient = createAdminClient()
  const { error } = await adminClient.storage
    .from(COMMUNICATION_ATTACHMENT_BUCKET)
    .remove(paths)

  if (error) {
    logger.warn('Failed to remove communication attachment storage objects', {
      metadata: { count: paths.length, error: error.message },
    })
  }
}

async function updateRows(table: string, values: Record<string, unknown>, column: string, ids: string[]) {
  if (ids.length === 0) return 0
  const adminClient = createAdminClient()
  let total = 0

  for (const batch of chunkArray(ids, GDPR_UPDATE_BATCH_SIZE)) {
    const { error, count } = await (adminClient.from(table) as any)
      .update(values, { count: 'exact' })
      .in(column, batch)

    if (error) {
      throw new Error(`Failed to update ${table}: ${error.message}`)
    }

    total += count ?? 0
  }

  return total
}

/**
 * Same as updateRows, but a rejected row is logged and counted instead of
 * aborting the erasure.
 *
 * Erasure has to touch seventeen tables and cannot do it in one transaction,
 * so a single row the database refuses would otherwise leave the subject half
 * erased with no way to tell how far it got. Plenty of rows can be refused:
 * every CHECK constraint on a table is re-validated on UPDATE, so a legacy row
 * that predates a constraint rejects any write at all; booking_reminders has a
 * BEFORE trigger that raises when another row already holds the same event,
 * reminder type and phone, which erased customers all end up sharing; and
 * table_bookings and bookings both carry guard triggers that can raise on
 * historical rows. Scrubbing everything that can be scrubbed and reporting the
 * remainder beats stopping half way.
 */
async function updateRowsTolerant(
  table: string,
  values: Record<string, unknown>,
  column: string,
  ids: string[],
): Promise<{ updated: number; failed: number }> {
  if (ids.length === 0) return { updated: 0, failed: 0 }
  const adminClient = createAdminClient()
  let updated = 0
  let failed = 0

  for (const batch of chunkArray(ids, GDPR_UPDATE_BATCH_SIZE)) {
    const { error, count } = await (adminClient.from(table) as any)
      .update(values, { count: 'exact' })
      .in(column, batch)

    if (!error) {
      updated += count ?? 0
      continue
    }

    // One bad row poisons the whole batch, so retry the batch a row at a time
    // to salvage everything that can be scrubbed.
    for (const id of batch) {
      const { error: rowError, count: rowCount } = await (adminClient.from(table) as any)
        .update(values, { count: 'exact' })
        .eq(column, id)

      if (rowError) {
        failed += 1
        logger.warn('GDPR erasure could not scrub a row', {
          metadata: { table, column, id, error: rowError.message },
        })
      } else {
        updated += rowCount ?? 0
      }
    }
  }

  return { updated, failed }
}

export class GdprService {
  static async exportUserData(targetUserId: string, currentUserId?: string) {
    const adminClient = createAdminClient()

    const exportData: ExportData = {
      profile: null,
      customers: [],
      bookings: [],
      tableBookings: [],
      privateBookings: [],
      parkingBookings: [],
      messages: [],
      emailMessages: [],
      customerConsents: [],
      unmatchedCommunications: [],
      webhookLogs: [],
      storageAttachmentRefs: [],
      employees: [],
      auditLogs: [],
    }

    const { data: profileData } = await adminClient
      .from('profiles')
      .select('*')
      .eq('id', targetUserId)
      .maybeSingle()

    exportData.profile = profileData
    const email = normalizeEmail(profileData?.email)

    const { data: customers } = email
      ? await adminClient
          .from('customers')
          .select('*')
          .eq('email', email)
      : { data: [] as any[] }

    exportData.customers = customers || []
    const identity = buildCommunicationIdentity(profileData, exportData.customers)
    const customerIds = identity.customerIds

    if (customerIds.length > 0) {
      const [
        bookings,
        tableBookings,
        privateBookings,
        parkingBookings,
        messages,
        emailMessages,
        customerConsents,
        unmatchedCommunications,
      ] = await Promise.all([
        adminClient
          .from('bookings')
          .select('*, event:events(*)')
          .in('customer_id', customerIds),
        (adminClient.from('table_bookings') as any)
          .select('*')
          .in('customer_id', customerIds),
        (adminClient.from('private_bookings') as any)
          .select('*')
          .in('customer_id', customerIds),
        (adminClient.from('parking_bookings') as any)
          .select('*')
          .in('customer_id', customerIds),
        adminClient
          .from('messages')
          .select('*')
          .in('customer_id', customerIds),
        (adminClient.from('email_messages') as any)
          .select('*')
          .in('customer_id', customerIds),
        (adminClient.from('customer_consents') as any)
          .select('*')
          .in('customer_id', customerIds),
        fetchUnmatchedCommunicationRows(adminClient, identity),
      ])

      exportData.bookings = bookings.data || []
      exportData.tableBookings = tableBookings.data || []
      exportData.privateBookings = privateBookings.data || []
      exportData.parkingBookings = parkingBookings.data || []
      exportData.messages = messages.data || []
      exportData.emailMessages = emailMessages.data || []
      exportData.customerConsents = customerConsents.data || []
      exportData.unmatchedCommunications = unmatchedCommunications || []
    }

    if (identity.emails.length > 0 || identity.phones.length > 0 || identity.customerIds.length > 0) {
      const [employeeRows, webhookRows, unmatchedRowsByIdentity] = await Promise.all([
        adminClient
          .from('employees')
          .select('*')
          .in('email_address', identity.emails.length ? identity.emails : ['__no_email__']),
        fetchWebhookLogRows(adminClient, identity),
        fetchUnmatchedCommunicationRows(adminClient, identity),
      ])

      exportData.employees = employeeRows.data || []
      exportData.webhookLogs = webhookRows || []
      exportData.unmatchedCommunications = mergeRowsById([
        exportData.unmatchedCommunications,
        unmatchedRowsByIdentity,
      ])
    }

    const { data: auditLogs } = await adminClient
      .from('audit_logs')
      .select('*')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false })
      .limit(1000)

    exportData.auditLogs = auditLogs || []
    exportData.storageAttachmentRefs = collectAttachmentPaths([
      ...exportData.messages,
      ...exportData.emailMessages,
      ...exportData.unmatchedCommunications,
    ])

    const jsonData = JSON.stringify(exportData, null, 2)
    const fileName = `gdpr-export-${targetUserId}-${getTodayIsoDate()}.json`

    return {
      data: jsonData,
      fileName,
      mimeType: 'application/json',
      requestedBy: currentUserId ?? null,
    }
  }

  /**
   * Resolve an erasure request to the records it is actually about.
   *
   * Erasure used to take a profiles.id and then look for customers whose email
   * matched that staff profile's email. profiles holds the twenty staff logins,
   * customers holds a thousand pub guests, and no row in either table shares an
   * email with the other, so every request resolved to zero customers and
   * silently anonymised nothing. Erasure is a legal obligation, and virtually
   * every request comes from a guest rather than a staff member, so the
   * identifier is matched against customers directly, and by phone as well as
   * email because roughly three quarters of customers have no email on file.
   *
   * A UUID is accepted too. Erasure is not transactional, so a run that fails
   * part way has already cleared the email and mobile, and the record id is the
   * only handle left to retry with.
   */
  static async resolveErasureSubject(identifier: string): Promise<ErasureSubject | null> {
    const adminClient = createAdminClient()
    const trimmed = typeof identifier === 'string' ? identifier.trim() : ''
    if (!trimmed) return null

    let profile: any = null
    let customers: any[] = []

    if (UUID_PATTERN.test(trimmed)) {
      const [profileResult, customerResult] = await Promise.all([
        adminClient.from('profiles').select('id, email').eq('id', trimmed).maybeSingle(),
        (adminClient.from('customers') as any).select(CUSTOMER_IDENTITY_COLUMNS).eq('id', trimmed).maybeSingle(),
      ])

      profile = profileResult.data ?? null
      customers = customerResult.data ? [customerResult.data] : []
    } else if (trimmed.includes('@')) {
      const email = normalizeEmail(trimmed)
      if (!email) return null

      const [profileRows, customerRows] = await Promise.all([
        loadProfilesWithEmail(adminClient),
        loadCustomersWithEmail(adminClient),
      ])

      profile = profileRows.find((row) => normalizeEmail(row?.email) === email) ?? null
      customers = customerRows.filter((row) => normalizeEmail(row?.email) === email)
    } else {
      const clauses = equalityClauses(CUSTOMER_PHONE_COLUMNS, collectPhoneIdentity([trimmed]))
      if (clauses.length === 0) return null

      customers = await fetchAllRows<any>(() =>
        (adminClient.from('customers') as any).select(CUSTOMER_IDENTITY_COLUMNS).or(clauses.join(','))
      )
    }

    // A staff member erasing their own record may also have guest records under
    // the same address, so keep the original profile-to-customer link too.
    if (profile && customers.length === 0) {
      const profileEmail = normalizeEmail(profile.email)
      if (profileEmail) {
        const customerRows = await loadCustomersWithEmail(adminClient)
        customers = customerRows.filter((row) => normalizeEmail(row?.email) === profileEmail)
      }
    }

    if (!profile && customers.length === 0) return null

    const identity = buildCommunicationIdentity(profile, customers)

    // Every erased customer shares the placeholder mobile, so it is not an
    // identity. Without this a retry by id would fan out across every other
    // erased customer's rows.
    const placeholderPhones = new Set(collectPhoneIdentity([ERASED_CUSTOMER_MOBILE]))

    return {
      profileId: profile?.id ?? null,
      profileEmail: normalizeEmail(profile?.email),
      customerIds: identity.customerIds,
      emails: identity.emails.filter((email) => email !== ERASED_EMAIL_ADDRESS),
      phones: identity.phones.filter((phone) => !placeholderPhones.has(phone)),
    }
  }

  /**
   * Erase everything that identifies the subject.
   *
   * Every target row is read before the first write, and the customers row is
   * rewritten before anything else, for two reasons. It carries the only NOT
   * NULL and CHECK constrained columns in the sequence, so if the erasure is
   * going to fail on a constraint it fails before anything has been destroyed.
   * And private_bookings and parking_bookings each have a BEFORE UPDATE trigger
   * that copies first_name and last_name straight back out of customers, so
   * scrubbing those tables first would only restore the real name.
   *
   * It is still not atomic: supabase-js cannot open a transaction, so a failure
   * part way through leaves the subject partly erased. Any error therefore
   * names the customer ids, and resolveErasureSubject accepts a UUID, so the
   * run can be retried by id once the cause is fixed.
   */
  static async deleteUserData(subject: ErasureSubject) {
    const adminClient = createAdminClient()
    const identity: CommunicationIdentity = {
      customerIds: subject.customerIds,
      emails: subject.emails,
      phones: subject.phones,
    }
    const customerIds = identity.customerIds

    // Read phase. Nothing is written until every target id is known, because
    // once the customer row is rewritten the email and phone are gone and no
    // further row could be matched by identity.
    const [
      messageRows,
      emailRows,
      unmatchedRows,
      webhookRows,
      eventBookingRows,
      tableBookingRows,
      privateBookingRows,
      parkingRows,
      pendingRows,
      promoContextRows,
      reviewRows,
    ] = await Promise.all([
      fetchRowsByIdentity(adminClient, 'messages', identity, {
        idColumn: 'customer_id',
        phoneColumns: ['from_number', 'to_number'],
      }, 'id, attachments'),
      fetchRowsByIdentity(adminClient, 'email_messages', identity, {
        idColumn: 'customer_id',
        emailColumns: ['to_address', 'from_address'],
      }, 'id, attachments'),
      fetchUnmatchedCommunicationRows(adminClient, identity, 'id, attachments'),
      fetchWebhookLogRows(adminClient, identity, 'id'),
      fetchRowsByIdentity(adminClient, 'bookings', identity, { idColumn: 'customer_id' }),
      fetchRowsByIdentity(adminClient, 'table_bookings', identity, { idColumn: 'customer_id' }),
      fetchRowsByIdentity(adminClient, 'private_bookings', identity, {
        idColumn: 'customer_id',
        emailColumns: ['contact_email'],
        phoneColumns: ['contact_phone'],
      }),
      fetchRowsByIdentity(adminClient, 'parking_bookings', identity, {
        idColumn: 'customer_id',
        emailColumns: ['customer_email'],
        phoneColumns: ['customer_mobile'],
      }),
      fetchRowsByIdentity(adminClient, 'pending_bookings', identity, {
        idColumn: 'customer_id',
        phoneColumns: ['mobile_number'],
      }),
      fetchRowsByIdentity(adminClient, 'sms_promo_context', identity, {
        idColumn: 'customer_id',
        phoneColumns: ['phone_number'],
      }),
      // review_feedback has no customer_id at all, so name, email and phone are
      // the only way in.
      fetchRowsByIdentity(adminClient, 'review_feedback', identity, {
        emailColumns: ['customer_email'],
        phoneColumns: ['customer_phone'],
      }),
    ])

    const eventBookingIds = rowIds(eventBookingRows)
    const tableBookingIds = rowIds(tableBookingRows)
    const privateBookingIds = rowIds(privateBookingRows)

    const [reminderRows, privateSmsRows, tableItemRows, preorderCoverRows] = await Promise.all([
      fetchRowsByIdentity(adminClient, 'booking_reminders', identity, {
        idColumn: 'booking_id',
        ids: eventBookingIds,
        phoneColumns: ['target_phone'],
      }),
      fetchRowsByIdentity(adminClient, 'private_booking_sms_queue', identity, {
        idColumn: 'booking_id',
        ids: privateBookingIds,
        phoneColumns: ['customer_phone', 'recipient_phone'],
      }),
      fetchRowsByIdentity(adminClient, 'table_booking_items', identity, {
        idColumn: 'booking_id',
        ids: tableBookingIds,
      }),
      fetchRowsByIdentity(adminClient, 'booking_preorder_covers', identity, {
        idColumn: 'table_booking_id',
        ids: tableBookingIds,
      }),
    ])

    const storagePaths = collectAttachmentPaths([
      ...messageRows,
      ...emailRows,
      ...unmatchedRows,
    ])

    const anonymizedAt = new Date().toISOString()
    const anonymizedText = '[erased under GDPR request]'
    const erasureMarker = { erased: true, reason: 'gdpr_erasure', erased_at: anonymizedAt }

    const counts = {
      customers: 0,
      messages: 0,
      emailMessages: 0,
      customerConsents: 0,
      smsPromoContext: 0,
      bookingReminders: 0,
      eventBookings: 0,
      tableBookings: 0,
      tableBookingItems: 0,
      preorderCovers: 0,
      privateBookings: 0,
      privateBookingSms: 0,
      parkingBookings: 0,
      pendingBookings: 0,
      reviewFeedback: 0,
      unmatchedCommunications: 0,
      webhookLogs: 0,
      storageObjects: storagePaths.length,
    }
    let unscrubbedRows = 0

    // Write phase, customers first. See the note above for why the order matters.
    for (const customerId of customerIds) {
      const { error } = await (adminClient.from('customers') as any)
        .update({
          first_name: ERASED_FIRST_NAME,
          last_name: ERASED_LAST_NAME,
          email: null,
          mobile_number: ERASED_CUSTOMER_MOBILE,
          mobile_e164: null,
          mobile_number_raw: null,
          internal_notes: null,
          // A processor-side identifier is still an identifier. Deleting the
          // Stripe customer itself is a separate manual step.
          stripe_customer_id: null,
          // Free text failure reasons quote the number or address that failed.
          last_sms_failure_reason: null,
          sms_deactivation_reason: null,
          last_email_failure_reason: null,
          last_whatsapp_failure_reason: null,
          whatsapp_deactivation_reason: null,
          sms_opt_in_source: null,
          whatsapp_opt_in_source: null,
          sms_opt_in: false,
          marketing_sms_opt_in: false,
          sms_status: 'opted_out',
          marketing_email_opt_in: false,
          marketing_email_opted_out_at: anonymizedAt,
          whatsapp_opt_in: false,
          marketing_whatsapp_opt_in: false,
          whatsapp_status: 'opted_out',
          whatsapp_opted_out_at: anonymizedAt,
        })
        .eq('id', customerId)

      if (error) {
        throw new Error(
          `Failed to anonymize customer ${customerId}: ${error.message}. Nothing else has been changed, so fix the cause and run the erasure again.`
        )
      }
      counts.customers += 1
    }

    // Every write after the customer row goes through this, so a row the
    // database refuses is counted and logged rather than aborting the rest.
    const scrub = async (
      key: keyof typeof counts,
      table: string,
      values: Record<string, unknown>,
      column: string,
      ids: string[],
    ): Promise<void> => {
      const result = await updateRowsTolerant(table, values, column, ids)
      counts[key] = result.updated
      unscrubbedRows += result.failed
    }

    /**
     * Removes rows outright, for tables where a placeholder cannot be written.
     *
     * Used where a scrubbed column sits in a unique index, so every erased
     * customer would be trying to write the same value. Batched to stay inside
     * PostgREST's URL limits, and counted the same way as a scrub so the caller's
     * report stays truthful about what could not be cleared.
     */
    const deleteRows = async (
      key: keyof typeof counts,
      table: string,
      ids: string[],
    ): Promise<void> => {
      if (ids.length === 0) return
      let deleted = 0
      for (let i = 0; i < ids.length; i += GDPR_UPDATE_BATCH_SIZE) {
        const batch = ids.slice(i, i + GDPR_UPDATE_BATCH_SIZE)
        const { error } = await (adminClient.from(table) as any).delete().in('id', batch)
        if (error) {
          logger.error(`[GDPR] Failed to delete ${table} rows`, {
            error: error instanceof Error ? error : new Error(String(error?.message ?? error)),
          })
          unscrubbedRows += batch.length
        } else {
          deleted += batch.length
        }
      }
      counts[key] = deleted
    }

    try {
      // from_number and to_number are the customer's own number, and
      // error_message quotes it back when Twilio rejects a send. Clearing
      // error_message also stops the update_customer_sms_status trigger copying
      // that text into customers.last_sms_failure_reason.
      await scrub('messages', 'messages', {
        body: anonymizedText,
        attachments: null,
        has_attachments: false,
        from_number: null,
        to_number: null,
        error_message: null,
        updated_at: anonymizedAt,
      }, 'id', rowIds(messageRows))

      // to_address is NOT NULL and holds the customer's address on every
      // outbound email, so it takes the placeholder rather than a clear.
      await scrub('emailMessages', 'email_messages', {
        body_text: null,
        body_html: null,
        attachments: null,
        has_attachments: false,
        to_address: ERASED_EMAIL_ADDRESS,
        from_address: null,
        subject: null,
        error: null,
        updated_at: anonymizedAt,
      }, 'id', rowIds(emailRows))

      await scrub('customerConsents', 'customer_consents', {
        source_url: null,
        ip_hash: null,
        user_agent: null,
        captured_by_user_id: null,
        metadata: erasureMarker,
        updated_at: anonymizedAt,
      }, 'customer_id', customerIds)

      await scrub('smsPromoContext', 'sms_promo_context', {
        phone_number: ERASED_CUSTOMER_MOBILE,
      }, 'id', rowIds(promoContextRows))

      // Deleted rather than scrubbed. Writing the shared placeholder into
      // target_phone collides with idx_booking_reminders_phone_unique, which is
      // UNIQUE on (event_id, target_phone, reminder_type) WHERE status is
      // pending or sent, so the second erased customer holding a reminder for
      // the same event and type would abort the whole erasure. These are
      // scheduling records for a guest who no longer exists, so there is nothing
      // to preserve: removing them is both correct and collision-free.
      await deleteRows('bookingReminders', 'booking_reminders', rowIds(reminderRows))

      await scrub('eventBookings', 'bookings', {
        attendee_names: null,
        // 1147 rows carry free-text notes, which is where staff record what a
        // guest told them. Scrubbing attendee_names while leaving this behind
        // defeated the point of the erasure.
        notes: null,
      }, 'id', eventBookingIds)

      await scrub('tableBookings', 'table_bookings', {
        // internal_notes is the only column that was being cleared, and it is
        // empty on every row in production. The guest's own words live in these
        // four, which hold 498 rows between them. allergies and dietary
        // requirements are health data, so leaving them was the worst of it.
        internal_notes: null,
        special_requirements: null,
        cancellation_reason: null,
        allergies: null,
        dietary_requirements: null,
      }, 'id', tableBookingIds)

      await scrub('tableBookingItems', 'table_booking_items', {
        guest_name: null,
      }, 'id', rowIds(tableItemRows))

      await scrub('preorderCovers', 'booking_preorder_covers', {
        guest_name: null,
      }, 'id', rowIds(preorderCoverRows))

      // customer_full_name is GENERATED ALWAYS and must not be written.
      await scrub('privateBookings', 'private_bookings', {
        customer_name: ERASED_FULL_NAME,
        customer_first_name: ERASED_FIRST_NAME,
        customer_last_name: ERASED_LAST_NAME,
        contact_phone: null,
        contact_email: null,
        internal_notes: null,
      }, 'id', privateBookingIds)

      // metadata carries first_name on more than a third of these rows.
      await scrub('privateBookingSms', 'private_booking_sms_queue', {
        message_body: anonymizedText,
        customer_phone: ERASED_CUSTOMER_MOBILE,
        customer_name: ERASED_FULL_NAME,
        recipient_phone: null,
        error_message: null,
        metadata: erasureMarker,
      }, 'id', rowIds(privateSmsRows))

      await scrub('parkingBookings', 'parking_bookings', {
        customer_first_name: ERASED_FIRST_NAME,
        customer_last_name: ERASED_LAST_NAME,
        customer_mobile: ERASED_CUSTOMER_MOBILE,
        customer_email: null,
        vehicle_registration: ERASED_VEHICLE_REGISTRATION,
        vehicle_make: null,
        vehicle_model: null,
        vehicle_colour: null,
      }, 'id', rowIds(parkingRows))

      // metadata holds the initial SMS, which greets the customer by name.
      await scrub('pendingBookings', 'pending_bookings', {
        mobile_number: ERASED_CUSTOMER_MOBILE,
        metadata: erasureMarker,
      }, 'id', rowIds(pendingRows))

      // review_feedback_consent_contact_check allows all three to be NULL
      // whatever contact_consent says.
      await scrub('reviewFeedback', 'review_feedback', {
        customer_name: null,
        customer_email: null,
        customer_phone: null,
      }, 'id', rowIds(reviewRows))

      await scrub('unmatchedCommunications', 'unmatched_communications', {
        from_address: null,
        to_address: null,
        subject: null,
        body_text: anonymizedText,
        body_html: null,
        raw_payload: erasureMarker,
        attachments: null,
        candidate_customer_ids: [],
        resolution_note: null,
        status: 'ignored',
        updated_at: anonymizedAt,
      }, 'id', rowIds(unmatchedRows))

      await scrub('webhookLogs', 'webhook_logs', {
        body: null,
        message_body: null,
        headers: null,
        params: null,
        from_number: null,
        to_number: null,
        customer_id: null,
        error_details: erasureMarker,
      }, 'id', rowIds(webhookRows))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `${reason}. The customer records ${customerIds.join(', ') || '(none)'} are already anonymised, so retry the erasure with one of those ids to finish the remaining tables.`
      )
    }

    await removeCommunicationStorageObjects(storagePaths)

    const scrubbed = [
      ['customers', counts.customers],
      ['SMS messages', counts.messages],
      ['emails', counts.emailMessages],
      ['consent rows', counts.customerConsents],
      ['promo context rows', counts.smsPromoContext],
      ['booking reminders', counts.bookingReminders],
      ['event bookings', counts.eventBookings],
      ['table bookings', counts.tableBookings],
      ['table booking items', counts.tableBookingItems],
      ['pre-order covers', counts.preorderCovers],
      ['private bookings', counts.privateBookings],
      ['private booking SMS', counts.privateBookingSms],
      ['parking bookings', counts.parkingBookings],
      ['pending bookings', counts.pendingBookings],
      ['review feedback', counts.reviewFeedback],
      ['unmatched communications', counts.unmatchedCommunications],
      ['webhook logs', counts.webhookLogs],
      ['media objects', counts.storageObjects],
    ] as const

    const summary = scrubbed
      .filter(([, value]) => value > 0)
      .map(([label, value]) => `${label}: ${value}`)
      .join(', ')

    const warning = unscrubbedRows > 0
      ? ` ${unscrubbedRows} row(s) were rejected by the database and still hold personal data, see the server logs.`
      : ''

    return {
      counts,
      unscrubbedRows,
      message: summary
        ? `Personal data erased. ${summary}.${warning}`
        : `Nothing to erase: the request resolved to records that hold no personal data.${warning}`,
    }
  }

  static async runCommunicationRetentionCleanup(referenceDate = new Date()) {
    const adminClient = createAdminClient()
    const cutoffIso = addMonths(referenceDate, -COMMUNICATION_RETENTION_MONTHS).toISOString()
    const anonymizedText = '[removed after communications retention period]'

    const [messageRows, emailRows, unmatchedRows, webhookRows, consentRows] = await Promise.all([
      fetchAllRows<any>(() =>
        adminClient
          .from('messages')
          .select('id, attachments')
          .lt('created_at', cutoffIso)
          .neq('body', anonymizedText)
          .order('created_at', { ascending: true })
      ),
      fetchAllRows<any>(() =>
        (adminClient.from('email_messages') as any)
          .select('id, attachments')
          .lt('created_at', cutoffIso)
          .or('body_text.not.is.null,body_html.not.is.null,attachments.not.is.null')
          .order('created_at', { ascending: true })
      ),
      fetchAllRows<any>(() =>
        (adminClient.from('unmatched_communications') as any)
          .select('id, attachments')
          .lt('received_at', cutoffIso)
          .order('received_at', { ascending: true })
      ),
      fetchAllRows<any>(() =>
        (adminClient.from('webhook_logs') as any)
          .select('id')
          .lt('processed_at', cutoffIso)
          .or('body.not.is.null,message_body.not.is.null,headers.not.is.null,params.not.is.null,from_number.not.is.null,to_number.not.is.null,customer_id.not.is.null')
          .order('processed_at', { ascending: true })
      ),
      fetchAllRows<any>(() =>
        (adminClient.from('customer_consents') as any)
          .select('id')
          .lt('captured_at', cutoffIso)
          .or('source_url.not.is.null,ip_hash.not.is.null,user_agent.not.is.null')
          .order('captured_at', { ascending: true })
      ),
    ])

    const storagePaths = collectAttachmentPaths([
      ...messageRows,
      ...emailRows,
      ...unmatchedRows,
    ])

    const cleanedAt = new Date().toISOString()

    if (messageRows.length) {
      await updateRows('messages', {
        body: anonymizedText,
        attachments: null,
        has_attachments: false,
        updated_at: cleanedAt,
      }, 'id', messageRows.map((row: any) => row.id))
    }

    if (emailRows.length) {
      await updateRows('email_messages', {
        body_text: null,
        body_html: null,
        attachments: null,
        has_attachments: false,
        updated_at: cleanedAt,
      }, 'id', emailRows.map((row: any) => row.id))
    }

    if (unmatchedRows.length) {
      await updateRows('unmatched_communications', {
        body_text: null,
        body_html: null,
        raw_payload: {},
        attachments: null,
        status: 'ignored',
        updated_at: cleanedAt,
      }, 'id', unmatchedRows.map((row: any) => row.id))
    }

    if (webhookRows.length) {
      await updateRows('webhook_logs', {
        body: null,
        message_body: null,
        headers: null,
        params: null,
        from_number: null,
        to_number: null,
        customer_id: null,
        error_details: { retained: false, reason: 'communications_retention', cleaned_at: cleanedAt },
      }, 'id', webhookRows.map((row: any) => row.id))
    }

    if (consentRows.length) {
      await updateRows('customer_consents', {
        source_url: null,
        ip_hash: null,
        user_agent: null,
        metadata: { retained: true, reason: 'communications_retention', cleaned_at: cleanedAt },
        updated_at: cleanedAt,
      }, 'id', consentRows.map((row: any) => row.id))
    }

    await removeCommunicationStorageObjects(storagePaths)

    return {
      cutoffIso,
      messages: messageRows.length,
      emailMessages: emailRows.length,
      unmatchedCommunications: unmatchedRows.length,
      webhookLogs: webhookRows.length,
      customerConsents: consentRows.length,
      storageObjects: storagePaths.length,
    }
  }
}
