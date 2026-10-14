import { reportCronFailure } from '@/lib/cron/alerting'
import { sendEmail } from '@/lib/email/emailService'
import { getAppUrl } from '@/lib/env'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { buildSigningStaffNoticeEmail } from './emails'
import { finaliseSigningDocument, resendSigningLink } from './service'
import { findSubjectClosure } from './subject-state'
import { describeSigningSubject } from './subjects'
import {
  SIGNING_OPEN_STATUSES,
  SIGNING_REMINDER_DAYS,
  type SigningDocumentRow,
  type SigningPartyRow,
} from './types'

/**
 * The daily signing housekeeping: chase people who have not signed, close requests that have
 * run out of time, and finish any signed document whose finishing step did not complete.
 *
 * Each item is handled on its own, so one failure is reported and the rest still run.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export interface SigningReminderRun {
  remindersSent: number
  /** Requests withdrawn because the record they belong to no longer needs signing. */
  withdrawn: number
  /** Lines added to the trail for a request that was closed without one. */
  trailRepaired: number
  expired: number
  finalised: number
  errors: string[]
}

/** How far back the daily job looks for a closed request whose trail is missing its last line. */
const TRAIL_REPAIR_DAYS = 14
const TRAIL_REPAIR_BATCH = 100

/** How many reminders someone should have had by now: one for each threshold passed. */
export function remindersDue(sentAt: string, now: Date): number {
  const days = Math.floor((now.getTime() - new Date(sentAt).getTime()) / DAY_MS)
  return SIGNING_REMINDER_DAYS.filter((threshold) => days >= threshold).length
}

export async function runSigningReminders(now: Date = new Date()): Promise<SigningReminderRun> {
  const admin = createAdminClient()
  const run: SigningReminderRun = { remindersSent: 0, withdrawn: 0, trailRepaired: 0, expired: 0, finalised: 0, errors: [] }
  const note = (what: string, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error)
    run.errors.push(`${what}: ${message}`)
    logger.error(`Signing reminders: ${what}`, { error: error instanceof Error ? error : new Error(message) })
  }

  const open = await fetchAllRows<SigningDocumentRow>(
    (from, to) =>
      admin
        .from('signing_documents')
        .select('*')
        .in('status', [...SIGNING_OPEN_STATUSES])
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'open signing documents' }
  )

  for (const document of open) {
    // 0. The record has moved on (booking cancelled, quote settled, worker left): withdraw the
    //    request. Nobody should be chased to sign something that no longer applies.
    try {
      const reason = await findSubjectClosure(document)
      if (reason) {
        const { data: closed, error } = await admin
          .from('signing_documents')
          .update({ status: 'voided', voided_at: now.toISOString(), void_reason: reason, updated_at: now.toISOString() })
          .eq('id', document.id)
          .in('status', [...SIGNING_OPEN_STATUSES])
          .select('id')
        if (error) throw new Error(error.message)
        if (closed && closed.length > 0) {
          const { error: eventError } = await admin
            .from('signing_events')
            .insert({ document_id: document.id, event: 'voided', occurred_at: now.toISOString(), meta: { reason, automatic: true } })
          if (eventError) throw new Error(eventError.message)
          run.withdrawn += 1
        }
        continue
      }
    } catch (error) {
      // Not knowing is not a reason to chase: skip this one today and report it.
      note(`checking the record behind ${document.id}`, error)
      continue
    }

    // 1. Out of time: close it and tell whoever sent it.
    if (new Date(document.expires_at).getTime() <= now.getTime()) {
      try {
        const { data: closed, error } = await admin
          .from('signing_documents')
          .update({ status: 'expired', updated_at: now.toISOString() })
          .eq('id', document.id)
          .in('status', [...SIGNING_OPEN_STATUSES])
          .select('id')
        if (error) throw new Error(error.message)
        if (!closed || closed.length === 0) continue
        const { error: eventError } = await admin
          .from('signing_events')
          .insert({ document_id: document.id, event: 'expired', occurred_at: now.toISOString() })
        if (eventError) throw new Error(eventError.message)
        run.expired += 1
        await notifySenderOfExpiry(admin, document)
      } catch (error) {
        note(`expiring ${document.id}`, error)
      }
      continue
    }

    // 2. Still open: chase anyone who is behind on reminders. One per run at most, so someone
    //    who was never reminded does not get two emails on the same morning.
    const due = remindersDue(document.sent_at, now)
    if (due === 0) continue
    try {
      const { data: parties, error } = await admin
        .from('signing_parties')
        .select('id, email, status, reminder_count, role')
        .eq('document_id', document.id)
        .eq('status', 'pending')
      if (error) throw new Error(error.message)
      for (const party of (parties ?? []) as Array<Pick<SigningPartyRow, 'id' | 'email' | 'status' | 'reminder_count' | 'role'>>) {
        if (!party.email || party.role === 'company' || party.reminder_count >= due) continue
        try {
          await resendSigningLink({ partyId: party.id, userId: null, isReminder: true })
          run.remindersSent += 1
        } catch (error) {
          note(`reminding ${party.id}`, error)
        }
      }
    } catch (error) {
      note(`reading signers of ${document.id}`, error)
    }
  }

  // 3. Signed, but the finishing step did not complete (the signed PDF, or the record update).
  try {
    const unfinished = await fetchAllRows<Pick<SigningDocumentRow, 'id'>>(
      (from, to) =>
        admin
          .from('signing_documents')
          .select('id')
          .in('status', ['completed', 'superseded'])
          .or('final_pdf_path.is.null,completion_applied_at.is.null,copies_sent_at.is.null')
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'unfinished signing documents' }
    )
    for (const document of unfinished) {
      try {
        await finaliseSigningDocument(document.id)
        run.finalised += 1
      } catch (error) {
        note(`finishing ${document.id}`, error)
      }
    }
  } catch (error) {
    note('reading unfinished documents', error)
  }

  // 4. Closing a request is two writes: the status, then the line on the trail. If the second
  //    failed the request is closed but its trail does not say so. Add the missing line.
  try {
    const since = new Date(now.getTime() - TRAIL_REPAIR_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const closed = await fetchAllRows<Pick<SigningDocumentRow, 'id' | 'status' | 'void_reason' | 'voided_at' | 'updated_at'>>(
      (from, to) =>
        admin
          .from('signing_documents')
          .select('id, status, void_reason, voided_at, updated_at')
          .in('status', ['voided', 'expired'])
          .gte('updated_at', since)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'recently closed signing documents' }
    )
    for (let index = 0; index < closed.length; index += TRAIL_REPAIR_BATCH) {
      const batch = closed.slice(index, index + TRAIL_REPAIR_BATCH)
      const { data: events, error } = await admin
        .from('signing_events')
        .select('document_id, event')
        .in('document_id', batch.map((document) => document.id))
        .in('event', ['voided', 'expired'])
      if (error) throw new Error(error.message)
      const recorded = new Set(((events ?? []) as Array<{ document_id: string; event: string }>).map((row) => `${row.document_id}:${row.event}`))
      for (const document of batch) {
        if (recorded.has(`${document.id}:${document.status}`)) continue
        try {
          const { error: insertError } = await admin.from('signing_events').insert({
            document_id: document.id,
            event: document.status,
            occurred_at: document.voided_at ?? document.updated_at,
            meta: { ...(document.void_reason ? { reason: document.void_reason } : {}), repaired: true },
          })
          if (insertError) throw new Error(insertError.message)
          run.trailRepaired += 1
        } catch (error) {
          note(`repairing the trail of ${document.id}`, error)
        }
      }
    }
  } catch (error) {
    note('reading recently closed documents', error)
  }

  if (run.errors.length > 0) {
    try {
      await reportCronFailure('signing-reminders', new Error(`${run.errors.length} item(s) failed`), {
        errors: run.errors.slice(0, 20),
        remindersSent: run.remindersSent,
        withdrawn: run.withdrawn,
        trailRepaired: run.trailRepaired,
        expired: run.expired,
        finalised: run.finalised,
      })
    } catch {
      // The log lines above are the record.
    }
  }
  return run
}

async function notifySenderOfExpiry(admin: ReturnType<typeof createAdminClient>, document: SigningDocumentRow): Promise<void> {
  if (!document.created_by) return
  const { data } = await admin.auth.admin.getUserById(document.created_by)
  const to = data?.user?.email
  if (!to) return
  const subject = await describeSigningSubject(document)
  const email = buildSigningStaffNoticeEmail({
    outcome: 'expired',
    title: document.title,
    subjectLabel: subject.label,
    recordUrl: `${getAppUrl()}${subject.path}`,
  })
  const result = await sendEmail({
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    commType: 'signing_staff_notice',
    metadata: { signing_document_id: document.id },
  })
  if (!result.success) throw new Error(`expiry notice not sent: ${result.error ?? 'unknown error'}`)
}
