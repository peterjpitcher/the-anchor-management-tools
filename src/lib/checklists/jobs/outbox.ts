// src/lib/checklists/jobs/outbox.ts
// The checklist_email_outbox_process job (spec 3.7 / 10). Claims up to 20 pending outbox rows
// whose next_attempt_at has passed and delivers them via sendEmail. Success marks the row
// sent; failure increments attempts with exponential backoff, and on the 5th failure the row
// is marked failed and one system_alert to Peter is created (guarded by a distinct key so it
// is written once). Service-role admin client (checklist_* is deny-all under RLS).

import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/emailService'

const MAX_ATTEMPTS = 5
const BATCH_SIZE = 20

function systemEmail(): string {
  return process.env.CHECKLIST_SYSTEM_EMAIL || 'peter@orangejelly.co.uk'
}

export async function runOutboxProcess(): Promise<Record<string, unknown>> {
  const db = createAdminClient()
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
  let retried = 0
  let failed = 0

  for (const row of rows ?? []) {
    const toAddresses = (row.to_addresses as string[] | null) ?? []
    let result: { success: boolean; error?: string; messageId?: string }
    try {
      result = await sendEmail({
        to: toAddresses.join(', '),
        subject: row.subject as string,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">${row.subject}</div>`,
      })
    } catch (e) {
      // sendEmail is expected to return a result rather than throw, but guard defensively so a
      // single bad row does not fail the whole batch (the handler only throws on infra errors).
      result = { success: false, error: e instanceof Error ? e.message : 'send threw' }
    }

    if (result.success) {
      const { error: updErr } = await db
        .from('checklist_email_outbox')
        .update({ status: 'sent', sent_at: new Date().toISOString(), message_id: result.messageId ?? null })
        .eq('id', row.id as string)
      if (updErr) throw updErr
      sent += 1
      continue
    }

    const attempts = ((row.attempts as number | null) ?? 0) + 1
    const errorMessage = result.error ?? 'unknown error'

    if (attempts >= MAX_ATTEMPTS) {
      const { error: updErr } = await db
        .from('checklist_email_outbox')
        .update({ status: 'failed', attempts, error_message: errorMessage })
        .eq('id', row.id as string)
      if (updErr) throw updErr
      failed += 1

      // Terminal-failure alert to Peter, once (distinct key). Skip when the dead row is itself
      // a dead-letter alert, so a mail outage cannot spawn an unbounded chain of alerts.
      if (row.source_type !== 'outbox') {
        const { error: alertErr } = await db.from('checklist_email_outbox').upsert(
          {
            email_type: 'system_alert',
            source_type: 'outbox',
            source_id: row.id as string,
            idempotency_key: `checklist_outbox_dead:${row.id as string}`,
            to_addresses: [systemEmail()],
            subject: `Checklist email permanently failed: ${row.subject as string}`,
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
    const { error: updErr } = await db
      .from('checklist_email_outbox')
      .update({ attempts, next_attempt_at: nextAttemptAt, error_message: errorMessage })
      .eq('id', row.id as string)
    if (updErr) throw updErr
    retried += 1
  }

  return { processed: (rows ?? []).length, sent, retried, failed }
}
