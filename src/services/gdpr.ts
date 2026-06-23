import { createAdminClient } from '@/lib/supabase/admin'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { logger } from '@/lib/logger'
import { generatePhoneVariants } from '@/lib/utils'

const COMMUNICATION_ATTACHMENT_BUCKET = 'communication-attachments'
const COMMUNICATION_RETENTION_MONTHS = 24
const GDPR_BATCH_SIZE = 1000
const GDPR_UPDATE_BATCH_SIZE = 500

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

function buildCommunicationIdentity(profile: any, customers: any[]) {
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
  identity: ReturnType<typeof buildCommunicationIdentity>,
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
  identity: ReturnType<typeof buildCommunicationIdentity>,
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

  static async deleteUserData(userId: string) {
    const adminClient = createAdminClient()

    const { data: profileData } = await adminClient
      .from('profiles')
      .select('id, email')
      .eq('id', userId)
      .maybeSingle()

    if (!profileData) {
      return { message: 'No profile found for deletion request.' }
    }

    const email = normalizeEmail(profileData.email)
    const { data: customers } = email
      ? await adminClient
          .from('customers')
          .select('id, email, mobile_number, mobile_e164, mobile_number_raw')
          .eq('email', email)
      : { data: [] as any[] }

    const identity = buildCommunicationIdentity(profileData, customers || [])
    const customerIds = identity.customerIds

    const [messageRows, emailRows, unmatchedRows, webhookRows] = await Promise.all([
      customerIds.length
        ? adminClient.from('messages').select('id, attachments').in('customer_id', customerIds)
        : Promise.resolve({ data: [] as any[] }),
      customerIds.length
        ? (adminClient.from('email_messages') as any).select('id, attachments').in('customer_id', customerIds)
        : Promise.resolve({ data: [] as any[] }),
      fetchUnmatchedCommunicationRows(adminClient, identity, 'id, attachments'),
      fetchWebhookLogRows(adminClient, identity, 'id'),
    ])

    const storagePaths = collectAttachmentPaths([
      ...(messageRows.data || []),
      ...(emailRows.data || []),
      ...(unmatchedRows || []),
    ])

    const anonymizedAt = new Date().toISOString()
    const anonymizedText = '[erased under GDPR request]'
    const counts = {
      customers: 0,
      messages: 0,
      emailMessages: 0,
      customerConsents: 0,
      unmatchedCommunications: 0,
      webhookLogs: 0,
      storageObjects: storagePaths.length,
    }

    if (customerIds.length > 0) {
      counts.messages = await updateRows('messages', {
        body: anonymizedText,
        attachments: null,
        has_attachments: false,
        updated_at: anonymizedAt,
      }, 'customer_id', customerIds)

      counts.emailMessages = await updateRows('email_messages', {
        body_text: null,
        body_html: null,
        attachments: null,
        has_attachments: false,
        updated_at: anonymizedAt,
      }, 'customer_id', customerIds)

      counts.customerConsents = await updateRows('customer_consents', {
        source_url: null,
        ip_hash: null,
        user_agent: null,
        captured_by_user_id: null,
        metadata: { erased: true, reason: 'gdpr_erasure', erased_at: anonymizedAt },
        updated_at: anonymizedAt,
      }, 'customer_id', customerIds)

      for (const customerId of customerIds) {
        const { error } = await (adminClient.from('customers') as any)
          .update({
            first_name: 'Erased',
            last_name: 'Customer',
            email: null,
            mobile_number: `erased-${customerId}`,
            mobile_e164: null,
            mobile_number_raw: null,
            internal_notes: null,
            sms_opt_in: false,
            marketing_sms_opt_in: false,
            sms_status: 'opted_out',
            whatsapp_opt_in: false,
            marketing_whatsapp_opt_in: false,
            whatsapp_status: 'opted_out',
            whatsapp_opted_out_at: anonymizedAt,
          })
          .eq('id', customerId)

        if (error) {
          throw new Error(`Failed to anonymize customer ${customerId}: ${error.message}`)
        }
        counts.customers += 1
      }
    }

    if (unmatchedRows.length) {
      counts.unmatchedCommunications = await updateRows('unmatched_communications', {
        from_address: null,
        to_address: null,
        subject: null,
        body_text: anonymizedText,
        body_html: null,
        raw_payload: { erased: true, reason: 'gdpr_erasure', erased_at: anonymizedAt },
        attachments: null,
        candidate_customer_ids: [],
        status: 'ignored',
        updated_at: anonymizedAt,
      }, 'id', unmatchedRows.map((row: any) => row.id))
    }

    if (webhookRows.length) {
      counts.webhookLogs = await updateRows('webhook_logs', {
        body: null,
        message_body: null,
        headers: null,
        params: null,
        from_number: null,
        to_number: null,
        customer_id: null,
        error_details: { erased: true, reason: 'gdpr_erasure', erased_at: anonymizedAt },
      }, 'id', webhookRows.map((row: any) => row.id))
    }

    await removeCommunicationStorageObjects(storagePaths)

    return {
      message: `User communication data anonymized. Customers: ${counts.customers}, messages: ${counts.messages}, emails: ${counts.emailMessages}, consent rows: ${counts.customerConsents}, unmatched: ${counts.unmatchedCommunications}, webhook logs: ${counts.webhookLogs}, media objects requested for removal: ${counts.storageObjects}.`,
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
