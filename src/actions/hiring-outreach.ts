'use server'

import { z } from 'zod'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/emailService'
import { generateHiringOutreachDraft } from '@/lib/hiring/messaging'

const DraftSchema = z.object({
  jobId: z.string().uuid(),
  candidateId: z.string().uuid(),
})

const UpdateSchema = z.object({
  messageId: z.string().uuid(),
  subject: z.string().min(1),
  body: z.string().min(1),
})

const SendSchema = z.object({
  messageId: z.string().uuid(),
  subject: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
})

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isPlaceholderEmail(email?: string | null) {
  if (!email) return true
  return email.startsWith('pending-') || email.endsWith('@hiring.temp')
}

export async function generateOutreachMessageDraftAction(input: { jobId: string; candidateId: string }) {
  const allowed = await checkUserPermission('hiring', 'send')
  if (!allowed) return { success: false, error: 'Unauthorized' }

  const parse = DraftSchema.safeParse(input)
  if (!parse.success) {
    return { success: false, error: parse.error.issues[0].message }
  }

  try {
    const admin = createAdminClient()
    const [candidateResult, jobResult, lastApplicationResult] = await Promise.all([
      admin.from('hiring_candidates').select('*').eq('id', parse.data.candidateId).single(),
      admin.from('hiring_jobs').select('*').eq('id', parse.data.jobId).single(),
      admin
        .from('hiring_applications')
        .select('*, job:hiring_jobs(title)')
        .eq('candidate_id', parse.data.candidateId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (candidateResult.error || !candidateResult.data) {
      return { success: false, error: 'Candidate not found' }
    }

    if (jobResult.error || !jobResult.data) {
      return { success: false, error: 'Job not found' }
    }

    const draft = await generateHiringOutreachDraft({
      job: jobResult.data,
      candidate: candidateResult.data,
      lastApplication: lastApplicationResult.data ?? null,
    })

    if (draft.usage) {
      await (admin.from('ai_usage_events') as any).insert([
        {
          context: `hiring_outreach:${parse.data.jobId}:${parse.data.candidateId}`,
          model: draft.usage.model,
          prompt_tokens: draft.usage.promptTokens,
          completion_tokens: draft.usage.completionTokens,
          total_tokens: draft.usage.totalTokens,
          cost: draft.usage.cost,
        },
      ])
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data: message, error: messageError } = await admin
      .from('hiring_outreach_messages')
      .insert({
        job_id: parse.data.jobId,
        candidate_id: parse.data.candidateId,
        channel: 'email',
        direction: 'outbound',
        status: 'draft',
        subject: draft.subject,
        body: draft.body,
        template_key: 'reengage',
        metadata: {
          compliance_lines: draft.complianceLines,
          generator: draft.generator,
          model: draft.model || null,
          usage: draft.usage || null,
          created_by: user?.id || null,
          last_application_id: lastApplicationResult.data?.id || null,
        },
      })
      .select('*')
      .single()

    if (messageError || !message) {
      return { success: false, error: messageError?.message || 'Failed to create outreach draft' }
    }

    return { success: true, data: message }
  } catch (error: any) {
    console.error('Generate outreach draft failed:', error)
    return { success: false, error: error.message || 'Failed to generate outreach draft' }
  }
}

export async function updateOutreachMessageDraftAction(input: { messageId: string; subject: string; body: string }) {
  const allowed = await checkUserPermission('hiring', 'send')
  if (!allowed) return { success: false, error: 'Unauthorized' }

  const parse = UpdateSchema.safeParse(input)
  if (!parse.success) {
    return { success: false, error: parse.error.issues[0].message }
  }

  try {
    const admin = createAdminClient()
    const { data: existing, error } = await admin
      .from('hiring_outreach_messages')
      .select('id, status')
      .eq('id', parse.data.messageId)
      .single()

    if (error || !existing) {
      return { success: false, error: 'Outreach message not found' }
    }

    if (existing.status !== 'draft') {
      return { success: false, error: 'Only drafts can be edited' }
    }

    const { data, error: updateError } = await admin
      .from('hiring_outreach_messages')
      .update({
        subject: parse.data.subject,
        body: parse.data.body,
      })
      .eq('id', parse.data.messageId)
      .select('*')
      .single()

    if (updateError || !data) {
      return { success: false, error: updateError?.message || 'Failed to update draft' }
    }

    return { success: true, data }
  } catch (error: any) {
    console.error('Update outreach draft failed:', error)
    return { success: false, error: error.message || 'Failed to update draft' }
  }
}

export async function sendOutreachMessageAction(input: { messageId: string; subject?: string; body?: string }) {
  const allowed = await checkUserPermission('hiring', 'send')
  if (!allowed) return { success: false, error: 'Unauthorized' }

  const parse = SendSchema.safeParse(input)
  if (!parse.success) {
    return { success: false, error: parse.error.issues[0].message }
  }

  try {
    const admin = createAdminClient()
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data: message, error } = await admin
      .from('hiring_outreach_messages')
      .select(`*, candidate:hiring_candidates(id, first_name, last_name, email)`)
      .eq('id', parse.data.messageId)
      .single()

    if (error || !message) {
      return { success: false, error: 'Outreach message not found' }
    }

    if (message.status !== 'draft') {
      return { success: false, error: 'Only drafts can be sent' }
    }

    const subject = parse.data.subject || message.subject || ''
    const body = parse.data.body || message.body || ''

    if (!subject.trim() || !body.trim()) {
      return { success: false, error: 'Subject and body are required to send' }
    }

    const candidate = (message as any).candidate
    const recipientEmail = candidate?.email

    if (!recipientEmail || isPlaceholderEmail(recipientEmail)) {
      return { success: false, error: 'Candidate email is missing or invalid' }
    }

    const html = escapeHtml(body).replace(/\n/g, '<br />')
    const result = await sendEmail({
      to: recipientEmail,
      subject,
      html,
    })

    const userId = user?.id || null
    const userEmail = user?.email ?? undefined

    if (!result.success) {
      await admin
        .from('hiring_outreach_messages')
        .update({
          subject,
          body,
          status: 'failed',
          error_message: result.error || 'Failed to send email',
          sent_at: null,
          sent_by: userId,
        })
        .eq('id', parse.data.messageId)

      if (userId) {
        await logAuditEvent({
          user_id: userId,
          user_email: userEmail,
          operation_type: 'email_sent',
          resource_type: 'hiring_outreach_message',
          resource_id: parse.data.messageId,
          operation_status: 'failure',
          error_message: result.error || 'Failed to send email',
          additional_info: {
            candidate_id: message.candidate_id,
            job_id: message.job_id,
            sent_via: 'office365',
          },
        })
      }

      return { success: false, error: result.error || 'Failed to send email' }
    }

    const { data: updated, error: updateError } = await admin
      .from('hiring_outreach_messages')
      .update({
        subject,
        body,
        status: 'sent',
        sent_via: 'office365',
        sent_at: new Date().toISOString(),
        sent_by: userId,
        error_message: null,
      })
      .eq('id', parse.data.messageId)
      .select('*')
      .single()

    if (updateError || !updated) {
      return { success: false, error: updateError?.message || 'Failed to update message status' }
    }

    if (userId) {
      await logAuditEvent({
        user_id: userId,
        user_email: userEmail,
        operation_type: 'email_sent',
        resource_type: 'hiring_outreach_message',
        resource_id: parse.data.messageId,
        operation_status: 'success',
        additional_info: {
          candidate_id: message.candidate_id,
          job_id: message.job_id,
          sent_via: 'office365',
        },
      })
    }

    return { success: true, data: updated }
  } catch (error: any) {
    console.error('Send outreach message failed:', error)
    return { success: false, error: error.message || 'Failed to send outreach message' }
  }
}

export async function markOutreachMessageSentExternallyAction(input: { messageId: string; subject?: string; body?: string }) {
  const allowed = await checkUserPermission('hiring', 'send')
  if (!allowed) return { success: false, error: 'Unauthorized' }

  const parse = SendSchema.safeParse(input)
  if (!parse.success) {
    return { success: false, error: parse.error.issues[0].message }
  }

  try {
    const admin = createAdminClient()
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { data: existing, error } = await admin
      .from('hiring_outreach_messages')
      .select('id, status, candidate_id, job_id, subject, body, metadata')
      .eq('id', parse.data.messageId)
      .single()

    if (error || !existing) {
      return { success: false, error: 'Outreach message not found' }
    }

    if (existing.status !== 'draft') {
      return { success: false, error: 'Only drafts can be marked as sent' }
    }

    const subject = parse.data.subject || existing.subject || ''
    const body = parse.data.body || existing.body || ''

    if (!subject.trim() || !body.trim()) {
      return { success: false, error: 'Subject and body are required to log a message' }
    }

    const metadata = {
      ...(existing.metadata || {}),
      external: true,
    }

    const { data: updated, error: updateError } = await admin
      .from('hiring_outreach_messages')
      .update({
        subject,
        body,
        status: 'sent',
        sent_via: 'external',
        sent_at: new Date().toISOString(),
        sent_by: user?.id || null,
        metadata,
      })
      .eq('id', parse.data.messageId)
      .select('*')
      .single()

    if (updateError || !updated) {
      return { success: false, error: updateError?.message || 'Failed to update message status' }
    }

    if (user?.id) {
      await logAuditEvent({
        user_id: user.id,
        user_email: user.email ?? undefined,
        operation_type: 'message_logged',
        resource_type: 'hiring_outreach_message',
        resource_id: parse.data.messageId,
        operation_status: 'success',
        additional_info: {
          candidate_id: existing.candidate_id,
          job_id: existing.job_id,
          sent_via: 'external',
        },
      })
    }

    return { success: true, data: updated }
  } catch (error: any) {
    console.error('Mark outreach message sent externally failed:', error)
    return { success: false, error: error.message || 'Failed to update outreach message' }
  }
}
