// src/lib/checklists/jobs/outbox.ts
// The checklist_email_outbox_process job (spec 3.7 / 10). Claims up to 20 pending outbox rows
// whose next_attempt_at has passed. Manager notifications are queued and held for the Friday
// report; technical alerts are delivered immediately. Failure uses backoff, and on the 5th failure the row
// is marked failed and one system_alert to Peter is created (guarded by a distinct key so it
// is written once). Service-role admin client (checklist_* is deny-all under RLS).

import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/emailService'
import { queueManagerReportEmail } from '@/lib/manager-report/queue'

const MAX_ATTEMPTS = 5
const BATCH_SIZE = 20
const CLAIM_LEASE_MS = 10 * 60 * 1000

type OutboxDependencies = {
  db?: ReturnType<typeof createAdminClient>
  send?: typeof sendEmail
  queue?: typeof queueManagerReportEmail
}

function systemEmail(): string {
  return process.env.CHECKLIST_SYSTEM_EMAIL || 'peter@orangejelly.co.uk'
}

export async function runOutboxProcess(dependencies: OutboxDependencies = {}): Promise<Record<string, unknown>> {
  const db = dependencies.db ?? createAdminClient()
  const send = dependencies.send ?? sendEmail
  const queue = dependencies.queue ?? queueManagerReportEmail
  const nowIso = new Date().toISOString()

  const { data: rows, error } = await db
    .from('checklist_email_outbox')
    .select('*')
    .eq('status', 'pending')
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)
  if (error) throw error

  let sent = 0
  let queued = 0
  let retried = 0
  let failed = 0
  let claimed = 0

  for (const row of rows ?? []) {
    // Compare-and-swap next_attempt_at before sending. Concurrent processors can all read the
    // same pending row, but only one can replace the exact value it read with this lease.
    const previousNextAttemptAt = (row.next_attempt_at as string | null) ?? null
    const claimUntil = new Date(Date.now() + CLAIM_LEASE_MS).toISOString()
    let claimQuery = db
      .from('checklist_email_outbox')
      .update({ next_attempt_at: claimUntil })
      .eq('id', row.id as string)
      .eq('status', 'pending')
    claimQuery = previousNextAttemptAt
      ? claimQuery.eq('next_attempt_at', previousNextAttemptAt)
      : claimQuery.is('next_attempt_at', null)
    const { data: claimedRow, error: claimError } = await claimQuery.select('*').maybeSingle()
    if (claimError) throw claimError
    if (!claimedRow) continue
    claimed += 1

    const toAddresses = (claimedRow.to_addresses as string[] | null) ?? []
    const deferToReport = claimedRow.email_type === 'value_breach'
      || claimedRow.email_type === 'weekly_summary'
      || ['closing_night', 'season'].includes(claimedRow.source_type as string)
    let result: { success: boolean; error?: string; messageId?: string; emailMessageId?: string | null }
    try {
      const bodyHtml =
        (claimedRow.body_html as string | null) ??
        `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">${claimedRow.subject}</div>`
      result = deferToReport ? await queue({
        section: claimedRow.email_type === 'weekly_summary' ? 'checklist_summary' : 'checklist_alerts',
        key: claimedRow.id as string,
        to: toAddresses.join(', '),
        subject: claimedRow.subject as string,
        html: bodyHtml,
        metadata: {
          checklist_outbox_id: claimedRow.id as string,
          checklist_idempotency_key: claimedRow.idempotency_key as string,
          summary: claimedRow.subject as string,
        },
      }) : await send({
        to: toAddresses.join(', '),
        subject: claimedRow.subject as string,
        html: bodyHtml,
        commType: 'checklist_alert',
        idempotencyKey: `checklist:${claimedRow.id as string}`,
        metadata: {
          checklist_outbox_id: claimedRow.id as string,
          checklist_idempotency_key: claimedRow.idempotency_key as string,
        },
      })
    } catch (e) {
      // sendEmail is expected to return a result rather than throw, but guard defensively so a
      // single bad row does not fail the whole batch (the handler only throws on infra errors).
      result = { success: false, error: e instanceof Error ? e.message : 'send threw' }
    }

    if (result.success) {
      const { data: sentRow, error: updErr } = await db
        .from('checklist_email_outbox')
        .update(deferToReport
          ? { status: 'held', sent_at: null, message_id: null, next_attempt_at: null }
          : { status: 'sent', sent_at: new Date().toISOString(), message_id: result.messageId ?? null })
        .eq('id', claimedRow.id as string)
        .eq('status', 'pending')
        .eq('next_attempt_at', claimUntil)
        .select('id')
        .maybeSingle()
      if (updErr) throw updErr
      if (!sentRow) throw new Error(`Checklist outbox claim lost after processing ${claimedRow.id as string}`)
      if (deferToReport) queued += 1
      else sent += 1
      continue
    }

    const attempts = ((claimedRow.attempts as number | null) ?? 0) + 1
    const errorMessage = result.error ?? 'unknown error'

    if (attempts >= MAX_ATTEMPTS) {
      const { data: failedRow, error: updErr } = await db
        .from('checklist_email_outbox')
        .update({ status: 'failed', attempts, error_message: errorMessage })
        .eq('id', claimedRow.id as string)
        .eq('status', 'pending')
        .eq('next_attempt_at', claimUntil)
        .select('id')
        .maybeSingle()
      if (updErr) throw updErr
      if (!failedRow) throw new Error(`Checklist outbox claim lost while failing ${claimedRow.id as string}`)
      failed += 1

      // Terminal-failure alert to Peter, once (distinct key). Skip when the dead row is itself
      // a dead-letter alert, so a mail outage cannot spawn an unbounded chain of alerts.
      if (claimedRow.source_type !== 'outbox') {
        const { error: alertErr } = await db.from('checklist_email_outbox').upsert(
          {
            email_type: 'system_alert',
            source_type: 'outbox',
            source_id: claimedRow.id as string,
            idempotency_key: `checklist_outbox_dead:${claimedRow.id as string}`,
            to_addresses: [systemEmail()],
            subject: `Checklist email permanently failed: ${claimedRow.subject as string}`,
            status: 'pending',
            next_attempt_at: new Date().toISOString(),
          },
          { onConflict: 'idempotency_key', ignoreDuplicates: true },
        )
        if (alertErr) throw alertErr
      }
      continue
    }

    // Exponential backoff: 2^attempts minutes until the next attempt.
    const backoffMinutes = 2 ** attempts
    const nextAttemptAt = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString()
    const { data: retriedRow, error: updErr } = await db
      .from('checklist_email_outbox')
      .update({ attempts, next_attempt_at: nextAttemptAt, error_message: errorMessage })
      .eq('id', claimedRow.id as string)
      .eq('status', 'pending')
      .eq('next_attempt_at', claimUntil)
      .select('id')
      .maybeSingle()
    if (updErr) throw updErr
    if (!retriedRow) throw new Error(`Checklist outbox claim lost while retrying ${claimedRow.id as string}`)
    retried += 1
  }

  return { candidates: (rows ?? []).length, processed: claimed, sent, queued, retried, failed }
}
