import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidEmailAddress } from '@/lib/notifications/channel'
import { sendEmail, type EmailOptions } from '@/lib/email/emailService'
import { managerReportId } from './queue'
import { managerReportPeriod } from './schedule'
import { renderManagerReport } from './render'
import { MANAGER_REPORT_SECTIONS, type ManagerReportEntry, type ManagerReportSection } from './types'

type Db = ReturnType<typeof createAdminClient>
interface SourceReference {
  id: string; checklistOutboxId?: string; communicationId?: string
  leaveRequestId?: string; leaveReminderKind?: string
}
interface ReportMetadata {
  periodKey: string
  sources: SourceReference[]
  payload: EmailOptions
  firstAttemptAt?: string
  acceptedAt?: string
  providerMessageId?: string
}
interface EmailRow {
  id: string; to_address: string; subject: string | null; body_html: string | null
  body_text: string | null; created_at: string; metadata: Record<string, unknown>
}
export interface ManagerReportDeliveryResult {
  success: boolean; sent: number; skipped?: string; error?: string
}
export interface ManagerReportDeliveryDependencies {
  db: Db
  send: typeof sendEmail
  now: () => Date
}
const PAGE_SIZE = 500
const LEASE_MS = 10 * 60 * 1000
// Leave an hour of headroom before Resend forgets an idempotency key.
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000

async function listQueued(db: Db, commType: string, before?: string): Promise<EmailRow[]> {
  const rows: EmailRow[] = []
  let cursor: string | undefined
  for (;;) {
    let query = db.from('email_messages')
      .select('id,to_address,subject,body_html,body_text,created_at,metadata')
      .eq('comm_type', commType).eq('status', 'queued').order('id').limit(PAGE_SIZE)
    if (before) query = query.lte('created_at', before)
    if (cursor) query = query.gt('id', cursor)
    const { data, error } = await query
    if (error) throw new Error(error.message)
    const page = (data ?? []) as EmailRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
    cursor = page[page.length - 1].id
  }
}

function toEntry(row: EmailRow): ManagerReportEntry {
  const section = row.metadata.section as ManagerReportSection
  if (!MANAGER_REPORT_SECTIONS.includes(section) || typeof row.metadata.key !== 'string') {
    throw new Error(`Invalid manager report item ${row.id}`)
  }
  return {
    id: row.id, section, key: row.metadata.key, to: row.to_address,
    subject: row.subject ?? '', html: row.body_html ?? undefined, text: row.body_text ?? undefined,
    createdAt: row.created_at, metadata: row.metadata,
  }
}

async function saveReport(db: Db, id: string, metadata: ReportMetadata, status = 'queued'): Promise<void> {
  const { data, error } = await db.from('email_messages').update({
    metadata, status, ...(metadata.acceptedAt ? { sent_at: metadata.acceptedAt } : {}),
  }).eq('id', id).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'Report state was not saved')
}

async function finaliseSources(db: Db, metadata: ReportMetadata): Promise<void> {
  for (const source of metadata.sources) {
    if (source.leaveRequestId && source.leaveReminderKind) {
      const { error } = await db.from('leave_reminder_log').upsert({
        request_id: source.leaveRequestId, reminder_kind: source.leaveReminderKind,
        sent_at: metadata.acceptedAt, sent_to: [metadata.payload.to],
      }, { onConflict: 'request_id,reminder_kind' })
      if (error) throw new Error(error.message)
    }
  }
  // Finalise shared report outcomes in batches so a busy week fits the cron budget.
  const communicationIds = [...new Set(metadata.sources.flatMap(source => source.communicationId ? [source.communicationId] : []))]
  const checklistIds = [...new Set(metadata.sources.flatMap(source => source.checklistOutboxId ? [source.checklistOutboxId] : []))]
  for (const [table, ids, values] of [
    ['recruitment_communications', communicationIds, {
      delivery_status: 'sent', sent_at: metadata.acceptedAt, provider: 'resend', provider_message_id: metadata.providerMessageId,
    }],
    ['checklist_email_outbox', checklistIds, {
      status: 'sent', sent_at: metadata.acceptedAt, message_id: metadata.providerMessageId, error_message: null,
    }],
  ] as const) {
    for (let offset = 0; offset < ids.length; offset += PAGE_SIZE) {
      const batch = ids.slice(offset, offset + PAGE_SIZE)
      const { data, error } = await db.from(table).update(values).in('id', batch).select('id')
      if (error || data?.length !== batch.length) throw new Error(error?.message ?? `${table} rows were not finalised`)
    }
  }
  for (let offset = 0; offset < metadata.sources.length; offset += PAGE_SIZE) {
    const ids = metadata.sources.slice(offset, offset + PAGE_SIZE).map(source => source.id)
    const { data, error } = await db.from('email_messages')
      .update({ status: 'sent', sent_at: metadata.acceptedAt }).in('id', ids).select('id')
    if (error || data?.length !== ids.length) throw new Error(error?.message ?? 'Report items were not finalised')
  }
}

/** No report payload is rebuilt after freezing, including attachments, sender and reply-to. */
export async function deliverManagerReport(
  dependencies?: ManagerReportDeliveryDependencies,
): Promise<ManagerReportDeliveryResult> {
  const now = dependencies?.now ?? (() => new Date())
  const period = managerReportPeriod(now())
  if (!period) return { success: true, sent: 0, skipped: 'outside_friday_window' }
  const db = dependencies?.db ?? createAdminClient()
  const send = dependencies?.send ?? sendEmail
  const owner = randomUUID()
  let lockId: string | undefined
  let sent = 0
  let completed = false
  let failureMessage: string | null = null
  try {
    // A single global lease also serialises recovery of previous weeks against a new batch.
    const stamp = now().toISOString()
    const { data: inserted, error: insertError } = await db.from('cron_job_runs').insert({
      job_name: 'manager-weekly-report', run_key: 'delivery', status: 'running', started_at: stamp, error_message: owner,
    }).select('id').single()
    if (insertError && insertError.code !== '23505') throw new Error(insertError.message)
    if (inserted) lockId = inserted.id
    else {
      const { data: lock, error } = await db.from('cron_job_runs').select('id,status,started_at')
        .eq('job_name', 'manager-weekly-report').eq('run_key', 'delivery').single()
      if (error || !lock) throw new Error(error?.message ?? 'Report lease missing')
      if (lock.status === 'running' && now().getTime() - Date.parse(lock.started_at) < LEASE_MS) {
        return { success: true, sent, skipped: 'already_running' }
      }
      const { data: claimed, error: claimError } = await db.from('cron_job_runs')
        .update({ status: 'running', started_at: stamp, error_message: owner, finished_at: null })
        .eq('id', lock.id).eq('status', lock.status).eq('started_at', lock.started_at).select('id').maybeSingle()
      if (claimError) throw new Error(claimError.message)
      if (!claimed) return { success: true, sent, skipped: 'already_running' }
      lockId = claimed.id
    }
    const renew = async (): Promise<void> => {
      const { data, error } = await db.from('cron_job_runs').update({ started_at: now().toISOString() })
        .eq('id', lockId!).eq('error_message', owner).eq('status', 'running').select('id').single()
      if (error || !data) throw new Error(error?.message ?? 'Report lease lost')
    }
    const deliver = async (row: EmailRow): Promise<void> => {
      const metadata = row.metadata as unknown as ReportMetadata
      if (!metadata.payload || !Array.isArray(metadata.sources)) throw new Error(`Invalid frozen report ${row.id}`)
      if (!metadata.acceptedAt) {
        if (metadata.firstAttemptAt && now().getTime() - Date.parse(metadata.firstAttemptAt) >= RETRY_WINDOW_MS) {
          throw new Error(`Report ${row.id} needs provider reconciliation before retry: the idempotency window has expired`)
        }
        await renew()
        metadata.firstAttemptAt ??= now().toISOString()
        await saveReport(db, row.id, metadata)
        const result = await send(metadata.payload)
        // A provider id is acceptance even when emailService could not write its own log.
        if (!result.messageId) throw new Error(result.error ?? 'Email provider did not confirm report acceptance')
        metadata.acceptedAt = now().toISOString()
        metadata.providerMessageId = result.messageId
        await saveReport(db, row.id, metadata)
        sent += 1
      }
      await renew()
      await finaliseSources(db, metadata)
      await saveReport(db, row.id, metadata, 'sent')
    }
    // Finish frozen reports first. An ambiguous earlier send blocks a new week's report.
    for (const pending of await listQueued(db, 'manager_weekly_report')) await deliver(pending)
    const entries = (await listQueued(db, 'manager_report_item', period.periodEnd)).map(toEntry)
    const manager = (process.env.MANAGER_EMAIL || 'manager@the-anchor.pub').trim().toLowerCase()
    if (!isValidEmailAddress(manager) || /[,;<>]/.test(manager)) throw new Error('Manager report recipient is invalid')
    const recipients = new Map<string, ManagerReportEntry[]>([[manager, []]])
    for (const entry of entries) recipients.set(entry.to, [...(recipients.get(entry.to) ?? []), entry])
    for (const [to, items] of recipients) {
      await renew()
      const id = managerReportId(['manager_weekly_report', period.key, to])
      const { data: existing, error: existingError } = await db.from('email_messages').select('id').eq('id', id).maybeSingle()
      if (existingError) throw new Error(existingError.message)
      // Late arrivals after the immutable report was frozen stay queued for next Friday.
      if (existing) continue
      const appUrl = process.env.NEXT_PUBLIC_APP_URL
      const from = process.env.EMAIL_FROM_ADDRESS
      if (!appUrl || !from) throw new Error('Manager report app URL and email sender must be configured')
      const rendered = renderManagerReport({ entries: items, ...period, appUrl })
      const metadata: ReportMetadata = {
        periodKey: period.key,
        sources: items.map(item => ({
          id: item.id,
          checklistOutboxId: typeof item.metadata?.checklist_outbox_id === 'string' ? item.metadata.checklist_outbox_id : undefined,
          communicationId: typeof item.metadata?.communication_id === 'string' ? item.metadata.communication_id : undefined,
          leaveRequestId: typeof item.metadata?.leave_request_id === 'string' ? item.metadata.leave_request_id : undefined,
          leaveReminderKind: typeof item.metadata?.leave_reminder_kind === 'string' ? item.metadata.leave_reminder_kind : undefined,
        })),
        payload: {
          to, from, replyTo: process.env.EMAIL_REPLY_TO ?? '',
          subject: rendered.subject, html: rendered.html, text: rendered.text,
          provider: 'resend', commType: 'manager_weekly_report_delivery',
          idempotencyKey: `manager-weekly-report/${id}`, suppressionMode: 'fail_closed',
          metadata: { manager_report_id: id },
          ...(rendered.attachment ? { attachments: [{ name: rendered.attachment.filename,
            contentType: rendered.attachment.contentType,
            content: Buffer.from(rendered.attachment.content, 'utf8').toString('base64'),
          }] } : {}),
        },
      }
      const { data, error } = await db.from('email_messages').insert({
        id, to_address: to, from_address: from, comm_type: 'manager_weekly_report', status: 'queued',
        subject: rendered.subject, body_html: rendered.html, body_text: rendered.text, metadata,
      }).select('id,to_address,subject,body_html,body_text,created_at,metadata').single()
      if (error || !data) throw new Error(error?.message ?? 'Report payload was not frozen')
      await deliver(data as EmailRow)
    }
    completed = true
    return { success: true, sent }
  } catch (error) {
    failureMessage = error instanceof Error ? error.message : 'Manager report delivery failed'
    return { success: false, sent, error: failureMessage }
  } finally {
    if (lockId) {
      try {
        const { error } = await db.from('cron_job_runs').update({
          status: completed ? 'completed' : 'failed', finished_at: now().toISOString(), error_message: failureMessage,
        }).eq('id', lockId).eq('error_message', owner)
        if (error) console.error('Manager report lease release failed', { message: error.message, code: error.code })
      } catch (error) {
        console.error('Manager report lease release failed', { message: error instanceof Error ? error.message : String(error) })
      }
    }
  }
}
