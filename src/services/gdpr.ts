import { createAdminClient } from '@/lib/supabase/admin'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { logger } from '@/lib/logger'

const COMMUNICATION_ATTACHMENT_BUCKET = 'communication-attachments'
const COMMUNICATION_RETENTION_MONTHS = 24

interface ExportData {
  profile: any
  customers: any[]
  bookings: any[]
  tableBookings: any[]
  privateBookings: any[]
  parkingBookings: any[]
  messages: any[]
  emailMessages: any[]
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
  const { error, count } = await (adminClient.from(table) as any)
    .update(values, { count: 'exact' })
    .in(column, ids)

  if (error) {
    throw new Error(`Failed to update ${table}: ${error.message}`)
  }

  return count ?? 0
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
    const customerIds = exportData.customers.map((customer) => customer.id).filter(Boolean)

    if (customerIds.length > 0) {
      const [
        bookings,
        tableBookings,
        privateBookings,
        parkingBookings,
        messages,
        emailMessages,
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
        (adminClient.from('unmatched_communications') as any)
          .select('*')
          .or(`linked_customer_id.in.(${customerIds.join(',')}),candidate_customer_id.in.(${customerIds.join(',')})`),
      ])

      exportData.bookings = bookings.data || []
      exportData.tableBookings = tableBookings.data || []
      exportData.privateBookings = privateBookings.data || []
      exportData.parkingBookings = parkingBookings.data || []
      exportData.messages = messages.data || []
      exportData.emailMessages = emailMessages.data || []
      exportData.unmatchedCommunications = unmatchedCommunications.data || []
    }

    if (email) {
      const [employeeRows, webhookRowsByEmail, unmatchedRowsByEmail] = await Promise.all([
        adminClient
          .from('employees')
          .select('*')
          .eq('email_address', email),
        (adminClient.from('webhook_logs') as any)
          .select('*')
          .or(`body.ilike.%${email}%,message_body.ilike.%${email}%`)
          .limit(1000),
        (adminClient.from('unmatched_communications') as any)
          .select('*')
          .or(`from_email.eq.${email},to_email.eq.${email}`)
          .limit(1000),
      ])

      exportData.employees = employeeRows.data || []
      exportData.webhookLogs = webhookRowsByEmail.data || []
      exportData.unmatchedCommunications = [
        ...exportData.unmatchedCommunications,
        ...(unmatchedRowsByEmail.data || []),
      ]
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
          .select('id')
          .eq('email', email)
      : { data: [] as any[] }

    const customerIds = (customers || []).map((customer) => customer.id).filter(Boolean)

    const [messageRows, emailRows, unmatchedRows] = await Promise.all([
      customerIds.length
        ? adminClient.from('messages').select('id, attachments').in('customer_id', customerIds)
        : Promise.resolve({ data: [] as any[] }),
      customerIds.length
        ? (adminClient.from('email_messages') as any).select('id, attachments').in('customer_id', customerIds)
        : Promise.resolve({ data: [] as any[] }),
      customerIds.length
        ? (adminClient.from('unmatched_communications') as any)
            .select('id, attachments')
            .or(`linked_customer_id.in.(${customerIds.join(',')}),candidate_customer_id.in.(${customerIds.join(',')})`)
        : Promise.resolve({ data: [] as any[] }),
    ])

    const storagePaths = collectAttachmentPaths([
      ...(messageRows.data || []),
      ...(emailRows.data || []),
      ...(unmatchedRows.data || []),
    ])

    const anonymizedAt = new Date().toISOString()
    const anonymizedText = '[erased under GDPR request]'
    const counts = {
      customers: 0,
      messages: 0,
      emailMessages: 0,
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

    if (unmatchedRows.data?.length) {
      counts.unmatchedCommunications = await updateRows('unmatched_communications', {
        from_phone: null,
        to_phone: null,
        from_email: null,
        to_email: null,
        subject: null,
        body_text: anonymizedText,
        body_html: null,
        attachments: null,
        has_attachments: false,
        status: 'ignored',
        updated_at: anonymizedAt,
      }, 'id', unmatchedRows.data.map((row: any) => row.id))
    }

    if (email) {
      const { count, error } = await (adminClient.from('webhook_logs') as any)
        .update({
          body: null,
          message_body: null,
          headers: {},
          error_details: { erased: true, reason: 'gdpr_erasure', erased_at: anonymizedAt },
        }, { count: 'exact' })
        .or(`body.ilike.%${email}%,message_body.ilike.%${email}%`)

      if (error) {
        logger.warn('Failed to anonymize matching webhook logs', {
          metadata: { userId, error: error.message },
        })
      } else {
        counts.webhookLogs = count ?? 0
      }
    }

    await removeCommunicationStorageObjects(storagePaths)

    return {
      message: `User communication data anonymized. Customers: ${counts.customers}, messages: ${counts.messages}, emails: ${counts.emailMessages}, unmatched: ${counts.unmatchedCommunications}, webhook logs: ${counts.webhookLogs}, media objects requested for removal: ${counts.storageObjects}.`,
    }
  }

  static async runCommunicationRetentionCleanup(referenceDate = new Date()) {
    const adminClient = createAdminClient()
    const cutoffIso = addMonths(referenceDate, -COMMUNICATION_RETENTION_MONTHS).toISOString()

    const [messageRows, emailRows, unmatchedRows] = await Promise.all([
      adminClient
        .from('messages')
        .select('id, attachments')
        .lt('created_at', cutoffIso)
        .limit(1000),
      (adminClient.from('email_messages') as any)
        .select('id, attachments')
        .lt('created_at', cutoffIso)
        .limit(1000),
      (adminClient.from('unmatched_communications') as any)
        .select('id, attachments')
        .lt('received_at', cutoffIso)
        .limit(1000),
    ])

    const storagePaths = collectAttachmentPaths([
      ...(messageRows.data || []),
      ...(emailRows.data || []),
      ...(unmatchedRows.data || []),
    ])

    const anonymizedText = '[removed after communications retention period]'
    const cleanedAt = new Date().toISOString()

    if (messageRows.data?.length) {
      await updateRows('messages', {
        body: anonymizedText,
        attachments: null,
        has_attachments: false,
        updated_at: cleanedAt,
      }, 'id', messageRows.data.map((row: any) => row.id))
    }

    if (emailRows.data?.length) {
      await updateRows('email_messages', {
        body_text: null,
        body_html: null,
        attachments: null,
        has_attachments: false,
        updated_at: cleanedAt,
      }, 'id', emailRows.data.map((row: any) => row.id))
    }

    if (unmatchedRows.data?.length) {
      await updateRows('unmatched_communications', {
        body_text: anonymizedText,
        body_html: null,
        attachments: null,
        has_attachments: false,
        status: 'ignored',
        updated_at: cleanedAt,
      }, 'id', unmatchedRows.data.map((row: any) => row.id))
    }

    await removeCommunicationStorageObjects(storagePaths)

    return {
      cutoffIso,
      messages: messageRows.data?.length || 0,
      emailMessages: emailRows.data?.length || 0,
      unmatchedCommunications: unmatchedRows.data?.length || 0,
      storageObjects: storagePaths.length,
    }
  }
}
