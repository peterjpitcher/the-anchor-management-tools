import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/emailService'
import type { HiringApplication, HiringApplicationStage, HiringCandidate, HiringJob } from '@/types/database'
import type { HiringStageReminderConfig } from '@/types/hiring'

const DEFAULT_CONFIG: HiringStageReminderConfig = {
  enabled: true,
  recipients: ['manager@the-anchor.pub'],
  cooldownDays: 7,
  thresholds: {
    new: 2,
    screening: 2,
    screened: 5,
    in_conversation: 3,
    interview_scheduled: 2,
    interviewed: 5,
    offer: 5,
  },
}

const SETTINGS_KEY = 'hiring_stage_reminders'

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value)
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

function normalizeConfig(value: unknown): HiringStageReminderConfig {
  if (!value || typeof value !== 'object') {
    return DEFAULT_CONFIG
  }

  const record = value as Record<string, unknown>
  const enabled = typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_CONFIG.enabled
  const cooldownDays = parsePositiveInt(record.cooldown_days ?? record.cooldownDays, DEFAULT_CONFIG.cooldownDays)

  const recipientsRaw = record.recipients
  const recipients = Array.isArray(recipientsRaw)
    ? recipientsRaw.map((entry) => String(entry).trim()).filter(Boolean)
    : typeof recipientsRaw === 'string'
      ? recipientsRaw.split(',').map((entry) => entry.trim()).filter(Boolean)
      : DEFAULT_CONFIG.recipients

  const thresholdsRaw = record.thresholds
  const thresholds: Partial<Record<HiringApplicationStage, number>> = { ...DEFAULT_CONFIG.thresholds }

  if (thresholdsRaw && typeof thresholdsRaw === 'object') {
    Object.entries(thresholdsRaw as Record<string, unknown>).forEach(([stage, value]) => {
      if (!(stage in thresholds)) return
      thresholds[stage as HiringApplicationStage] = parsePositiveInt(value, thresholds[stage as HiringApplicationStage] || 1)
    })
  }

  return {
    enabled,
    recipients: recipients.length ? recipients : DEFAULT_CONFIG.recipients,
    cooldownDays,
    thresholds,
  }
}

export async function getHiringStageReminderConfig(): Promise<HiringStageReminderConfig> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('system_settings')
    .select('value')
    .eq('key', SETTINGS_KEY)
    .maybeSingle()

  if (error) {
    console.error('Failed to load hiring stage reminders config:', error)
    return DEFAULT_CONFIG
  }

  return normalizeConfig(data?.value)
}

function resolveLastActivity(application: HiringApplication) {
  if (application.stage === 'interview_scheduled' && application.interview_date) {
    return application.interview_date
  }
  return application.updated_at || application.created_at
}

function buildReminderBody(input: {
  candidateName: string
  jobTitle: string
  stage: string
  ageDays: number
  lastActivity: string
  applicationUrl: string
}) {
  return [
    `Hiring reminder: ${input.candidateName}`,
    `Role: ${input.jobTitle}`,
    `Stage: ${input.stage}`,
    `Days in stage: ${input.ageDays}`,
    `Last activity: ${new Date(input.lastActivity).toLocaleDateString('en-GB')}`,
    `Application link: ${input.applicationUrl}`,
  ].join('\n')
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function sendHiringStageReminders() {
  const config = await getHiringStageReminderConfig()
  if (!config.enabled) {
    return { success: true, skipped: true, reason: 'disabled' }
  }

  if (!config.recipients.length) {
    return { success: false, error: 'No recipients configured' }
  }

  const admin = createAdminClient()
  const thresholdStages = Object.keys(config.thresholds) as HiringApplicationStage[]

  if (!thresholdStages.length) {
    return { success: true, skipped: true, reason: 'no_thresholds' }
  }

  const { data: applications, error } = await admin
    .from('hiring_applications')
    .select(`
      *,
      candidate:hiring_candidates(id, first_name, last_name),
      job:hiring_jobs(id, title)
    `)
    .in('stage', thresholdStages)

  if (error) {
    console.error('Failed to load hiring applications for reminders:', error)
    return { success: false, error: error.message || 'Failed to load applications' }
  }

  const now = Date.now()
  const reminders: Array<{
    application: HiringApplication
    candidate: HiringCandidate
    job: HiringJob
    lastActivity: string
    thresholdDays: number
  }> = []

  for (const app of applications || []) {
    const thresholdDays = config.thresholds[app.stage as HiringApplicationStage]
    if (!thresholdDays) continue

    const lastActivity = resolveLastActivity(app as HiringApplication)
    if (!lastActivity) continue

    const diffMs = now - new Date(lastActivity).getTime()
    if (diffMs < thresholdDays * 24 * 60 * 60 * 1000) {
      continue
    }

    const candidate = (app as any).candidate as HiringCandidate | undefined
    const job = (app as any).job as HiringJob | undefined
    if (!candidate || !job) continue

    reminders.push({
      application: app as HiringApplication,
      candidate,
      job,
      lastActivity,
      thresholdDays,
    })
  }

  if (!reminders.length) {
    return { success: true, sent: 0, skipped: true, reason: 'none_due' }
  }

  const applicationIds = reminders.map((entry) => entry.application.id)
  const cooldownCutoff = new Date(Date.now() - config.cooldownDays * 24 * 60 * 60 * 1000).toISOString()

  const { data: recentEvents } = await admin
    .from('hiring_candidate_events')
    .select('application_id, metadata, created_at')
    .eq('event_type', 'stage_reminder_sent')
    .in('application_id', applicationIds)
    .gte('created_at', cooldownCutoff)

  const reminded = new Map<string, Set<string>>()
  for (const event of recentEvents || []) {
    const stage = (event as any)?.metadata?.stage
    if (!event.application_id || !stage) continue
    if (!reminded.has(event.application_id)) {
      reminded.set(event.application_id, new Set())
    }
    reminded.get(event.application_id)?.add(String(stage))
  }

  const appUrlBase = process.env.NEXT_PUBLIC_APP_URL || ''
  const [toRecipient, ...ccRecipients] = config.recipients

  let sent = 0
  const errors: string[] = []

  for (const reminder of reminders) {
    const alreadyReminded = reminded.get(reminder.application.id)?.has(reminder.application.stage)
    if (alreadyReminded) {
      continue
    }

    const candidateName = `${reminder.candidate.first_name} ${reminder.candidate.last_name}`.trim()
    const stageLabel = reminder.application.stage.replace('_', ' ')
    const ageDays = Math.floor((now - new Date(reminder.lastActivity).getTime()) / (24 * 60 * 60 * 1000))
    const applicationUrl = appUrlBase
      ? `${appUrlBase}/hiring/applications/${reminder.application.id}`
      : `/hiring/applications/${reminder.application.id}`

    const subject = `Hiring reminder: ${candidateName} (${reminder.job.title})`
    const body = buildReminderBody({
      candidateName,
      jobTitle: reminder.job.title,
      stage: stageLabel,
      ageDays,
      lastActivity: reminder.lastActivity,
      applicationUrl,
    })

    const html = escapeHtml(body).replace(/\n/g, '<br />')

    const result = await sendEmail({
      to: toRecipient,
      cc: ccRecipients.length ? ccRecipients : undefined,
      subject,
      html,
    })

    if (!result.success) {
      errors.push(`${reminder.application.id}: ${result.error || 'Failed to send email'}`)
      continue
    }

    sent += 1

    await admin.from('hiring_candidate_events').insert({
      candidate_id: reminder.candidate.id,
      application_id: reminder.application.id,
      job_id: reminder.job.id,
      event_type: 'stage_reminder_sent',
      source: 'system',
      metadata: {
        stage: reminder.application.stage,
        last_activity_at: reminder.lastActivity,
        threshold_days: reminder.thresholdDays,
        reminder_age_days: ageDays,
      },
    })
  }

  return { success: true, sent, errors }
}
