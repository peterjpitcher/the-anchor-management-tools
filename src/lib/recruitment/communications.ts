import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail, type EmailAttachment } from '@/lib/email/emailService'
import { sendSMS } from '@/lib/twilio'
import { draftRecruitmentEmail } from '@/lib/recruitment/ai'
import { formatRecruitmentAppointment } from '@/services/recruitment'
import type { RecruitmentTemplateType } from '@/types/recruitment'

type GenericClient = SupabaseClient<any, 'public', any>

type MergeData = Record<string, string | number | null | undefined>

const RECRUITMENT_APPLICATION_RECEIVED_FROM = 'peter@orangejelly.co.uk'

const REQUIRED_TEMPLATE_PLACEHOLDERS: Partial<Record<RecruitmentTemplateType, string[]>> = {
  interview_invite: ['booking_link'],
  trial_invite: ['booking_link'],
  offer: ['offer_terms'],
  interview_confirmation: ['appointment_time'],
  trial_confirmation: ['appointment_time'],
  reminder: ['appointment_time', 'appointment_type'],
}

const DECLINE_EMAIL_TYPES = new Set<RecruitmentTemplateType>(['rejection', 'already_considered'])

function normalizeBodyText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim()
}

function mergeTemplate(template: string, data: MergeData): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = data[key]
    return value == null ? `{{${key}}}` : String(value)
  })
}

function unresolvedPlaceholders(value: string): string[] {
  const matches = value.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)
  return Array.from(new Set(Array.from(matches).map(match => match[1]).filter(Boolean)))
}

function assertNoUnresolvedPlaceholders(subject: string, body: string) {
  const unresolved = [...unresolvedPlaceholders(subject), ...unresolvedPlaceholders(body)]
  if (unresolved.length > 0) {
    throw new Error(`Email has unresolved placeholders: ${Array.from(new Set(unresolved)).join(', ')}`)
  }
}

function assertRequiredPlaceholders(type: RecruitmentTemplateType, data: MergeData) {
  const required = REQUIRED_TEMPLATE_PLACEHOLDERS[type] ?? []
  const missing = required.filter(key => !data[key])
  if (missing.length > 0) {
    throw new Error(`Missing required recruitment merge fields: ${missing.join(', ')}`)
  }
}

function candidateFirstName(candidate: any): string {
  return candidate?.first_name || candidate?.email?.split('@')[0] || 'there'
}

function roleTitle(application: any): string {
  return application?.job_posting?.title || 'your application'
}

function applicationRolePhrase(application: any): string {
  const title = application?.job_posting?.title
  return title ? `for ${title}` : 'to The Anchor'
}

function formatApplicationClosingDate(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'long',
    timeZone: 'Europe/London',
  }).format(date)
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)
}

function buildMergeData(input: {
  application: any
  appointment?: any
  bookingLink?: string | null
  offerTerms?: string | null
  extra?: MergeData
}): MergeData {
  const candidate = input.application?.candidate ?? {}
  const appointment = input.appointment
  return {
    first_name: candidateFirstName(candidate),
    last_name: candidate?.last_name ?? '',
    candidate_name: [candidate?.first_name, candidate?.last_name].filter(Boolean).join(' ') || candidate?.email,
    role_title: roleTitle(input.application),
    booking_link: input.bookingLink ?? null,
    appointment_type: appointment?.type === 'trial_shift' ? 'trial shift' : 'interview',
    appointment_time: appointment ? formatRecruitmentAppointment(appointment) : null,
    venue: appointment?.location || 'The Anchor, Horton Road, Stanwell Moor, Surrey TW19 6AQ',
    offer_terms: input.offerTerms ?? null,
    pay_hours: input.offerTerms ?? null,
    right_to_work_wording: 'Please bring proof of your right to work in the UK.',
    signature: 'The Anchor',
    ...input.extra,
  }
}

export async function loadRecruitmentApplicationForComms(
  applicationId: string,
  supabase: GenericClient = createAdminClient()
) {
  const { data, error } = await supabase
    .from('recruitment_applications')
    .select('*, candidate:recruitment_candidates(*), job_posting:recruitment_job_postings(*)')
    .eq('id', applicationId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Application not found.')
  return data
}

export async function sendRecruitmentManagerAlert(
  input: {
    alertType: string
    alertBody: string
    applicationId?: string | null
    candidateId?: string | null
    currentUserId?: string | null
    subject?: string | null
  },
  supabase: GenericClient = createAdminClient()
) {
  const to = process.env.RECRUITMENT_NOTIFICATION_EMAIL || 'manager@the-anchor.pub'
  let application: any = null
  let candidateId = input.candidateId ?? null

  if (input.applicationId) {
    application = await loadRecruitmentApplicationForComms(input.applicationId, supabase)
    candidateId = application.candidate_id
  }

  if (!candidateId) {
    throw new Error('Manager alert requires an application or candidate.')
  }

  const mergeData: MergeData = {
    alert_type: input.alertType,
    alert_body: input.alertBody,
  }

  const { data: template } = await supabase
    .from('recruitment_email_templates')
    .select('subject, body')
    .eq('type', 'manager_alert')
    .eq('is_active', true)
    .maybeSingle()

  const subject = mergeTemplate(input.subject ?? template?.subject ?? 'Recruitment alert - {{alert_type}}', mergeData)
  const body = normalizeBodyText(mergeTemplate(template?.body ?? '{{alert_body}}', mergeData))
  assertNoUnresolvedPlaceholders(subject, body)

  const { data: communication, error: commError } = await supabase
    .from('recruitment_communications')
    .insert({
      application_id: input.applicationId ?? null,
      candidate_id: candidateId,
      type: 'manager_alert',
      channel: 'email',
      subject,
      final_body: body,
      edited_by: input.currentUserId ?? null,
      sent_by: input.currentUserId ?? null,
      delivery_status: 'queued',
      provider: 'email_service',
      metadata: {
        alert_type: input.alertType,
        role_title: application ? roleTitle(application) : null,
      },
    })
    .select('id')
    .single()

  if (commError) throw commError

  const result = await sendEmail({
    to,
    subject,
    text: body,
    from: process.env.RECRUITMENT_FROM_EMAIL,
    replyTo: process.env.RECRUITMENT_FROM_EMAIL || process.env.EMAIL_REPLY_TO,
    commType: 'recruitment_manager_alert',
    metadata: {
      application_id: input.applicationId ?? null,
      candidate_id: candidateId,
      communication_id: communication.id,
    },
  })

  await supabase
    .from('recruitment_communications')
    .update({
      delivery_status: result.success ? 'sent' : 'failed',
      provider_message_id: result.messageId ?? null,
      sent_at: result.success ? new Date().toISOString() : null,
      metadata: {
        alert_type: input.alertType,
        role_title: application ? roleTitle(application) : null,
        error: result.error ?? null,
      },
    })
    .eq('id', communication.id)

  if (!result.success) {
    throw new Error(result.error || 'Recruitment manager alert failed.')
  }

  return { success: true, communicationId: communication.id, messageId: result.messageId ?? null }
}

export async function draftRecruitmentEmailForApplication(
  applicationId: string,
  type: RecruitmentTemplateType,
  options: {
    bookingLink?: string | null
    appointmentId?: string | null
    offerTerms?: string | null
  } = {},
  supabase: GenericClient = createAdminClient()
) {
  const application = await loadRecruitmentApplicationForComms(applicationId, supabase)
  let appointment: any = null

  if (options.appointmentId) {
    const { data, error } = await supabase
      .from('recruitment_candidate_appointments')
      .select('*')
      .eq('id', options.appointmentId)
      .maybeSingle()
    if (error) throw error
    appointment = data
  }

  const deterministicContext = buildMergeData({
    application,
    appointment,
    bookingLink: options.bookingLink ?? null,
    offerTerms: options.offerTerms ?? null,
  })

  const { data: template, error: templateError } = await supabase
    .from('recruitment_email_templates')
    .select('subject, body')
    .eq('type', type)
    .eq('is_active', true)
    .maybeSingle()

  if (templateError) throw templateError
  if (!template) {
    throw new Error(`No active ${type} recruitment email template found.`)
  }

  const isDeclineEmail = DECLINE_EMAIL_TYPES.has(type)
  const publicPositiveSignals = [
    application.candidate?.cv_summary,
    application.candidate?.provided_details,
    application.cover_note,
    ...stringList(application.ai_strengths),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

  const aiContext: Record<string, unknown> = {
    candidate: {
      first_name: application.candidate?.first_name,
      last_name: application.candidate?.last_name,
      cv_summary: application.candidate?.cv_summary,
      provided_details: application.candidate?.provided_details,
    },
    application: {
      cover_note: application.cover_note,
      source: application.source,
    },
    role_title: roleTitle(application),
    ai_strengths: application.ai_strengths,
    public_positive_signals: publicPositiveSignals.slice(0, 6),
    deterministic_fields: deterministicContext,
  }

  if (!isDeclineEmail) {
    aiContext.ai_score = application.ai_score
    aiContext.ai_recommendation = application.ai_recommendation
    aiContext.ai_rationale = application.ai_rationale
    aiContext.ai_concerns = application.ai_concerns
  }

  const draft = await draftRecruitmentEmail(supabase, {
    applicationId,
    candidateId: application.candidate_id,
    type,
    templateSubject: template.subject,
    templateBody: template.body,
    context: aiContext,
  })

  if (!draft.result) {
    return {
      success: false as const,
      error: draft.error ?? 'AI draft failed',
      runId: draft.runId,
    }
  }

  return {
    success: true as const,
    runId: draft.runId,
    subject: mergeTemplate(draft.result.subject, deterministicContext),
    body: mergeTemplate(draft.result.body, deterministicContext),
  }
}

export async function sendRecruitmentApplicationReceivedEmail(
  applicationId: string,
  supabase: GenericClient = createAdminClient()
) {
  const application = await loadRecruitmentApplicationForComms(applicationId, supabase)
  const candidate = application.candidate
  if (!candidate?.email) {
    return { success: false as const, skipped: true as const, reason: 'missing_email' }
  }

  const subject = 'Thank you for applying to The Anchor'
  const closingDate = formatApplicationClosingDate(application.job_posting?.application_closing_date)
  const body = normalizeBodyText([
    `Hi ${candidateFirstName(candidate)},`,
    '',
    `Thank you for applying ${applicationRolePhrase(application)}. I really appreciate you taking the time to send over your application and tell us about your experience.`,
    '',
    closingDate ? `Applications for this role close on ${closingDate}.` : null,
    closingDate ? '' : null,
    "We've received it safely, and I'll review it properly. If it looks like a good fit, I'll be in touch about the next step.",
    '',
    'Wishing you the best of luck.',
    '',
    'Best,',
    'Peter',
  ].join('\n'))
  const idempotencyKey = `recruitment_application_received:${applicationId}`

  const { data: communication, error: commError } = await supabase
    .from('recruitment_communications')
    .insert({
      application_id: applicationId,
      candidate_id: application.candidate_id,
      type: 'application_received',
      channel: 'email',
      subject,
      final_body: body,
      delivery_status: 'queued',
      provider: 'email_service',
      idempotency_key: idempotencyKey,
      metadata: {
        role_title: roleTitle(application),
        application_closing_date: application.job_posting?.application_closing_date ?? null,
      },
    })
    .select('id')
    .single()

  if (commError) {
    if ((commError as any).code === '23505') {
      return { success: true as const, skipped: true as const, reason: 'already_sent' }
    }
    throw commError
  }

  const result = await sendEmail({
    to: candidate.email,
    subject,
    text: body,
    from: RECRUITMENT_APPLICATION_RECEIVED_FROM,
    replyTo: RECRUITMENT_APPLICATION_RECEIVED_FROM,
    commType: 'recruitment_application_received',
    metadata: {
      application_id: applicationId,
      candidate_id: application.candidate_id,
      communication_id: communication.id,
    },
  })

  await supabase
    .from('recruitment_communications')
    .update({
      delivery_status: result.success ? 'sent' : 'failed',
      provider_message_id: result.messageId ?? null,
      sent_at: result.success ? new Date().toISOString() : null,
      metadata: {
        role_title: roleTitle(application),
        application_closing_date: application.job_posting?.application_closing_date ?? null,
        error: result.error ?? null,
      },
    })
    .eq('id', communication.id)

  if (!result.success) {
    throw new Error(result.error || 'Recruitment application received email failed.')
  }

  return { success: true as const, skipped: false as const, communicationId: communication.id, messageId: result.messageId ?? null }
}

export async function sendRecruitmentTemplateEmail(
  applicationId: string,
  type: RecruitmentTemplateType,
  options: {
    currentUserId?: string | null
    subjectOverride?: string | null
    bodyOverride?: string | null
    bookingLink?: string | null
    appointmentId?: string | null
    offerTerms?: string | null
    aiRunId?: string | null
    wasAiAssisted?: boolean
    attachments?: EmailAttachment[]
    extraMergeData?: MergeData
  } = {},
  supabase: GenericClient = createAdminClient()
) {
  const application = await loadRecruitmentApplicationForComms(applicationId, supabase)
  const candidate = application.candidate
  if (!candidate?.email) {
    throw new Error('Candidate does not have an email address.')
  }

  let appointment: any = null
  if (options.appointmentId) {
    const { data, error } = await supabase
      .from('recruitment_candidate_appointments')
      .select('*')
      .eq('id', options.appointmentId)
      .maybeSingle()
    if (error) throw error
    appointment = data
  }

  const mergeData = buildMergeData({
    application,
    appointment,
    bookingLink: options.bookingLink ?? null,
    offerTerms: options.offerTerms ?? null,
    extra: options.extraMergeData,
  })

  assertRequiredPlaceholders(type, mergeData)

  const { data: template, error: templateError } = await supabase
    .from('recruitment_email_templates')
    .select('*')
    .eq('type', type)
    .eq('is_active', true)
    .maybeSingle()

  if (templateError) throw templateError
  if (!template && (!options.subjectOverride || !options.bodyOverride)) {
    throw new Error(`No active ${type} recruitment email template found.`)
  }

  const subject = mergeTemplate(options.subjectOverride ?? template.subject, mergeData)
  const body = normalizeBodyText(mergeTemplate(options.bodyOverride ?? template.body, mergeData))
  assertNoUnresolvedPlaceholders(subject, body)

  const { data: communication, error: commError } = await supabase
    .from('recruitment_communications')
    .insert({
      application_id: applicationId,
      candidate_id: application.candidate_id,
      type,
      channel: 'email',
      subject,
      final_body: body,
      was_ai_assisted: options.wasAiAssisted === true,
      ai_run_id: options.aiRunId ?? null,
      edited_by: options.currentUserId ?? null,
      sent_by: options.currentUserId ?? null,
      delivery_status: 'queued',
      provider: 'email_service',
      metadata: {
        appointment_id: options.appointmentId ?? null,
        booking_link_injected: Boolean(options.bookingLink),
      },
    })
    .select('id')
    .single()

  if (commError) throw commError

  const result = await sendEmail({
    to: candidate.email,
    subject,
    text: body,
    from: process.env.RECRUITMENT_FROM_EMAIL,
    replyTo: process.env.RECRUITMENT_FROM_EMAIL || process.env.EMAIL_REPLY_TO,
    commType: `recruitment_${type}`,
    metadata: {
      application_id: applicationId,
      candidate_id: application.candidate_id,
      communication_id: communication.id,
    },
    attachments: options.attachments,
  })

  await supabase
    .from('recruitment_communications')
    .update({
      delivery_status: result.success ? 'sent' : 'failed',
      provider_message_id: result.messageId ?? null,
      sent_at: result.success ? new Date().toISOString() : null,
      metadata: {
        appointment_id: options.appointmentId ?? null,
        booking_link_injected: Boolean(options.bookingLink),
        error: result.error ?? null,
      },
    })
    .eq('id', communication.id)

  if (!result.success) {
    throw new Error(result.error || 'Recruitment email send failed.')
  }

  return { success: true, communicationId: communication.id, messageId: result.messageId ?? null }
}

export async function sendRecruitmentSms(
  candidateId: string,
  type: string,
  body: string,
  options: {
    applicationId?: string | null
    currentUserId?: string | null
  } = {},
  supabase: GenericClient = createAdminClient()
) {
  const { data: candidate, error } = await supabase
    .from('recruitment_candidates')
    .select('id, phone, phone_e164, sms_consent')
    .eq('id', candidateId)
    .maybeSingle()

  if (error) throw error
  if (!candidate) throw new Error('Candidate not found.')
  if (!candidate.sms_consent) {
    throw new Error('Candidate has not consented to recruitment SMS.')
  }

  const to = candidate.phone_e164 || candidate.phone
  if (!to) {
    throw new Error('Candidate does not have a phone number.')
  }

  const { data: communication, error: commError } = await supabase
    .from('recruitment_communications')
    .insert({
      application_id: options.applicationId ?? null,
      candidate_id: candidateId,
      type,
      channel: 'sms',
      final_body: body,
      sent_by: options.currentUserId ?? null,
      delivery_status: 'queued',
      provider: 'twilio',
    })
    .select('id')
    .single()

  if (commError) throw commError

  const result = await sendSMS(to, body, {
    createCustomerIfMissing: false,
    allowTransactionalOverride: true,
    metadata: {
      recruitment_candidate_id: candidateId,
      recruitment_application_id: options.applicationId ?? null,
      recruitment_communication_id: communication.id,
    },
  })

  await supabase
    .from('recruitment_communications')
    .update({
      delivery_status: result.success ? 'sent' : 'failed',
      provider_message_id: (result as any).messageSid ?? (result as any).sid ?? null,
      sent_at: result.success ? new Date().toISOString() : null,
      metadata: {
        error: result.error ?? null,
        code: (result as any).code ?? null,
      },
    })
    .eq('id', communication.id)

  if (!result.success) {
    throw new Error(result.error || 'Recruitment SMS send failed.')
  }

  return { success: true, communicationId: communication.id, messageSid: (result as any).messageSid ?? (result as any).sid ?? null }
}

export async function retryRecruitmentCommunication(
  communicationId: string,
  currentUserId?: string | null,
  supabase: GenericClient = createAdminClient()
) {
  const { data: original, error } = await supabase
    .from('recruitment_communications')
    .select('*, candidate:recruitment_candidates(*)')
    .eq('id', communicationId)
    .maybeSingle()

  if (error) throw error
  if (!original) throw new Error('Communication not found.')

  const candidate = original.candidate as any
  const metadata = {
    ...(typeof original.metadata === 'object' && original.metadata ? original.metadata : {}),
    retry_of_communication_id: communicationId,
  }

  const { data: retryRow, error: insertError } = await supabase
    .from('recruitment_communications')
    .insert({
      application_id: original.application_id,
      candidate_id: original.candidate_id,
      type: original.type,
      channel: original.channel,
      subject: original.subject,
      final_body: original.final_body,
      was_ai_assisted: original.was_ai_assisted,
      ai_run_id: original.ai_run_id,
      edited_by: currentUserId ?? null,
      sent_by: currentUserId ?? null,
      delivery_status: 'queued',
      provider: original.provider,
      metadata,
    })
    .select('id')
    .single()

  if (insertError) throw insertError

  let success = false
  let providerMessageId: string | null = null
  let failure: string | null = null

  if (original.channel === 'email') {
    const to = original.type === 'manager_alert'
      ? process.env.RECRUITMENT_NOTIFICATION_EMAIL || 'manager@the-anchor.pub'
      : candidate?.email
    if (!to) throw new Error('No email address is available for retry.')

    const result = await sendEmail({
      to,
      subject: original.subject || 'Message from The Anchor',
      text: original.final_body,
      from: process.env.RECRUITMENT_FROM_EMAIL,
      replyTo: process.env.RECRUITMENT_FROM_EMAIL || process.env.EMAIL_REPLY_TO,
      commType: `recruitment_retry_${original.type}`,
      metadata: {
        application_id: original.application_id,
        candidate_id: original.candidate_id,
        communication_id: retryRow.id,
        retry_of_communication_id: communicationId,
      },
    })

    success = result.success
    providerMessageId = result.messageId ?? null
    failure = result.error ?? null
  } else if (original.channel === 'sms') {
    if (!candidate?.sms_consent) throw new Error('Candidate has not consented to recruitment SMS.')
    const to = candidate?.phone_e164 || candidate?.phone
    if (!to) throw new Error('No phone number is available for retry.')

    const result = await sendSMS(to, original.final_body, {
      createCustomerIfMissing: false,
      allowTransactionalOverride: true,
      metadata: {
        recruitment_candidate_id: original.candidate_id,
        recruitment_application_id: original.application_id,
        recruitment_communication_id: retryRow.id,
        retry_of_communication_id: communicationId,
      },
    })

    success = result.success
    providerMessageId = (result as any).messageSid ?? (result as any).sid ?? null
    failure = result.error ?? null
  } else {
    throw new Error('Unsupported communication channel.')
  }

  await supabase
    .from('recruitment_communications')
    .update({
      delivery_status: success ? 'sent' : 'failed',
      provider_message_id: providerMessageId,
      sent_at: success ? new Date().toISOString() : null,
      metadata: { ...metadata, error: failure },
    })
    .eq('id', retryRow.id)

  if (!success) {
    throw new Error(failure || 'Communication retry failed.')
  }

  return { success: true as const, communicationId: retryRow.id, retryOfCommunicationId: communicationId }
}

export async function sendDueRecruitmentAppointmentReminders(
  supabase: GenericClient = createAdminClient()
) {
  const now = Date.now()
  const lower = new Date(now + 23 * 60 * 60 * 1000).toISOString()
  const upper = new Date(now + 25 * 60 * 60 * 1000).toISOString()

  const { data: appointments, error } = await supabase
    .from('recruitment_candidate_appointments')
    .select('*, candidate:recruitment_candidates(*), application:recruitment_applications(*)')
    .eq('status', 'scheduled')
    .gte('scheduled_start', lower)
    .lte('scheduled_start', upper)
    .order('scheduled_start', { ascending: true })
    .limit(50)

  if (error) throw error

  let emailSent = 0
  let smsSent = 0
  let failed = 0

  for (const appointment of appointments ?? []) {
    if (!appointment.reminder_email_sent_at) {
      try {
        await sendRecruitmentTemplateEmail(appointment.application_id, 'reminder', {
          appointmentId: appointment.id,
        }, supabase)

        await supabase
          .from('recruitment_candidate_appointments')
          .update({ reminder_email_sent_at: new Date().toISOString() })
          .eq('id', appointment.id)
        emailSent += 1
      } catch (reminderError) {
        failed += 1
        console.error('Recruitment reminder email failed', reminderError)
      }
    }

    if (!appointment.reminder_sms_sent_at && appointment.candidate?.sms_consent) {
      try {
        const body = `Reminder: your ${appointment.type === 'trial_shift' ? 'trial shift' : 'interview'} at The Anchor is ${formatRecruitmentAppointment(appointment)}.`
        await sendRecruitmentSms(appointment.candidate_id, 'reminder', body, {
          applicationId: appointment.application_id,
        }, supabase)

        await supabase
          .from('recruitment_candidate_appointments')
          .update({ reminder_sms_sent_at: new Date().toISOString() })
          .eq('id', appointment.id)
        smsSent += 1
      } catch (smsError) {
        failed += 1
        console.error('Recruitment reminder SMS failed', smsError)
      }
    }
  }

  return { processed: appointments?.length ?? 0, emailSent, smsSent, failed }
}
