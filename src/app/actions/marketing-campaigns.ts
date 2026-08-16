'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { logAuditEvent } from '@/app/actions/audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { sendEmail } from '@/lib/email/emailService'
import {
  getMarketingConfig,
  MARKETING_UTM_MEDIUM,
  MARKETING_UTM_SOURCE,
} from '@/lib/email/marketing/config'
import { lintMarketingContent } from '@/lib/email/marketing/registry'
import { renderMarketingEmail } from '@/lib/email/marketing/render'
import { createClient } from '@/lib/supabase/server'
import type { ActionType } from '@/types/rbac'
import type {
  MarketingCampaign,
  MarketingCampaignLinkPerformance,
  MarketingCampaignStats,
  MarketingSettings,
} from '@/types/marketing'
import {
  cancelCampaign,
  createCampaign,
  getCampaign,
  getCampaignAudienceDrift,
  getCampaignLinkPerformance,
  getCampaignStats,
  getSettings,
  listCampaigns,
  listRecipients,
  parseCampaignContent,
  pauseCampaign,
  resumeCampaign,
  scheduleCampaign,
  updateCampaign,
  updateSettings,
  type CampaignAudienceDrift,
  type ListCampaignsResult,
  type ListRecipientsResult,
} from '@/services/marketing-campaigns'

/**
 * Server actions for marketing campaigns.
 *
 * Note the permission split: everything that can put mail in front of a customer needs
 * `send`, which is deliberately a separate action from `edit`. Someone trusted to draft a
 * campaign is not automatically trusted to fire it.
 */

type ActionResult<T = undefined> = { success?: boolean; error?: string; data?: T }

interface AuthorisedUser {
  id: string
  email: string | undefined
}

async function authorise(action: ActionType): Promise<{ user: AuthorisedUser } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: 'Unauthorized' }

  if (!(await checkUserPermission('marketing', action, user.id))) {
    return { error: 'Insufficient permissions' }
  }

  return { user: { id: user.id, email: user.email ?? undefined } }
}

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function revalidateCampaigns(id?: string): void {
  revalidatePath('/marketing')
  revalidatePath('/marketing/campaigns')
  if (id) revalidatePath(`/marketing/campaigns/${id}`)
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const campaignStatusSchema = z.enum([
  'draft',
  'scheduled',
  'sending',
  'paused',
  'completed',
  'cancelled',
])

const recipientStatusSchema = z.enum([
  'pending',
  'sending',
  'sent',
  'failed',
  'skipped',
  'needs_review',
])

const tagsSchema = z.array(z.string().trim().min(1).max(80)).max(40)

const audienceSchema = z.object({
  includeTags: tagsSchema.default([]),
  excludeTags: tagsSchema.default([]),
})

const listSchema = z.object({
  status: campaignStatusSchema.optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
})

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  subject: z.string().trim().min(1).max(300),
  preheader: z.string().trim().min(1).max(300),
  content: z.unknown(),
  audience: audienceSchema.optional(),
  utmCampaign: z.string().trim().max(100).nullable().optional(),
})

const updateSchema = createSchema.partial()

const scheduleSchema = z.object({
  scheduledFor: z.string().datetime({ offset: true }),
})

const recipientsSchema = z.object({
  status: recipientStatusSchema.optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
})

const settingsSchema = z.object({
  sendsEnabled: z.boolean().optional(),
  sendWindowStartHour: z.number().int().min(0).max(23).optional(),
  sendWindowEndHour: z.number().int().min(1).max(24).optional(),
  sendDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  frequencyCapDays: z.number().int().min(0).max(365).optional(),
  batchSize: z.number().int().min(1).max(200).optional(),
})

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listMarketingCampaigns(
  input: unknown,
): Promise<ActionResult<ListCampaignsResult>> {
  try {
    const context = await authorise('view')
    if ('error' in context) return { error: context.error }

    const parsed = listSchema.safeParse(input ?? {})
    if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid filters' }

    return { success: true, data: await listCampaigns(parsed.data) }
  } catch (error) {
    console.error('Failed to list marketing campaigns:', error)
    return { error: failureMessage(error, 'Failed to load campaigns') }
  }
}

export async function getMarketingCampaign(id: string): Promise<ActionResult<MarketingCampaign>> {
  try {
    const context = await authorise('view')
    if ('error' in context) return { error: context.error }

    const campaign = await getCampaign(id)
    if (!campaign) return { error: 'Campaign not found' }

    return { success: true, data: campaign }
  } catch (error) {
    console.error('Failed to load marketing campaign:', error)
    return { error: failureMessage(error, 'Failed to load the campaign') }
  }
}

export async function getMarketingCampaignStats(
  id: string,
): Promise<ActionResult<MarketingCampaignStats>> {
  try {
    const context = await authorise('view')
    if ('error' in context) return { error: context.error }

    return { success: true, data: await getCampaignStats(id) }
  } catch (error) {
    console.error('Failed to load marketing campaign stats:', error)
    return { error: failureMessage(error, 'Failed to load campaign results') }
  }
}

/**
 * Clicks per destination, so it is visible which call to action carried the campaign.
 *
 * Returns an empty list rather than an error when a campaign has no short links: a draft has
 * none yet, and that is a normal state rather than a failure.
 */
/**
 * The gap between the approved audience and the live one.
 *
 * Only meaningful while a campaign is scheduled: a draft has nothing approved yet, and once
 * sending has begun the recipient rows are fixed and the stats tell the real story.
 */
export async function getMarketingCampaignAudienceDrift(
  id: string,
): Promise<ActionResult<CampaignAudienceDrift>> {
  try {
    const context = await authorise('view')
    if ('error' in context) return { error: context.error }

    return { success: true, data: await getCampaignAudienceDrift(id) }
  } catch (error) {
    console.error('Failed to load marketing campaign audience drift:', error)
    return { error: failureMessage(error, 'Failed to check the audience') }
  }
}

export async function getMarketingCampaignLinkPerformance(
  id: string,
): Promise<ActionResult<MarketingCampaignLinkPerformance[]>> {
  try {
    const context = await authorise('view')
    if ('error' in context) return { error: context.error }

    const campaignId = z.string().uuid().safeParse(id)
    if (!campaignId.success) return { error: 'Invalid campaign id' }

    return { success: true, data: await getCampaignLinkPerformance(campaignId.data) }
  } catch (error) {
    console.error('Failed to load marketing campaign link performance:', error)
    return { error: failureMessage(error, 'Failed to load link performance') }
  }
}

export async function listMarketingCampaignRecipients(
  campaignId: string,
  input: unknown,
): Promise<ActionResult<ListRecipientsResult>> {
  try {
    const context = await authorise('view')
    if ('error' in context) return { error: context.error }

    const parsed = recipientsSchema.safeParse(input ?? {})
    if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid filters' }

    return { success: true, data: await listRecipients(campaignId, parsed.data) }
  } catch (error) {
    console.error('Failed to list marketing campaign recipients:', error)
    return { error: failureMessage(error, 'Failed to load recipients') }
  }
}

/**
 * Non-fatal advice about a draft's content: missing masthead, missing footer, too many
 * primary buttons. Separate from validation because none of it should stop a send.
 */
export async function lintMarketingCampaignContent(
  content: unknown,
): Promise<ActionResult<string[]>> {
  try {
    const context = await authorise('view')
    if ('error' in context) return { error: context.error }

    return { success: true, data: lintMarketingContent(parseCampaignContent(content)) }
  } catch (error) {
    return { error: failureMessage(error, 'Failed to check the content') }
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createMarketingCampaign(
  input: unknown,
): Promise<ActionResult<MarketingCampaign>> {
  try {
    const context = await authorise('create')
    if ('error' in context) return { error: context.error }

    const parsed = createSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid campaign' }

    // `content` is optional in the parsed shape only because zod treats an unknown-typed
    // field that way; the service needs the key present, so it is named explicitly.
    const campaign = await createCampaign(
      { ...parsed.data, content: parsed.data.content },
      context.user.id,
    )

    await logAuditEvent({
      user_id: context.user.id,
      user_email: context.user.email,
      operation_type: 'create',
      resource_type: 'marketing_campaign',
      resource_id: campaign.id,
      operation_status: 'success',
      additional_info: { name: campaign.name, subject: campaign.subject },
    })

    revalidateCampaigns(campaign.id)
    return { success: true, data: campaign }
  } catch (error) {
    console.error('Failed to create marketing campaign:', error)
    return { error: failureMessage(error, 'Failed to create the campaign') }
  }
}

export async function updateMarketingCampaign(
  id: string,
  input: unknown,
): Promise<ActionResult<MarketingCampaign>> {
  try {
    const context = await authorise('edit')
    if ('error' in context) return { error: context.error }

    const parsed = updateSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid campaign' }

    const campaign = await updateCampaign(id, parsed.data, context.user.id)

    await logAuditEvent({
      user_id: context.user.id,
      user_email: context.user.email,
      operation_type: 'update',
      resource_type: 'marketing_campaign',
      resource_id: id,
      operation_status: 'success',
      additional_info: { fields: Object.keys(parsed.data) },
    })

    revalidateCampaigns(id)
    return { success: true, data: campaign }
  } catch (error) {
    console.error('Failed to update marketing campaign:', error)
    return { error: failureMessage(error, 'Failed to update the campaign') }
  }
}

/**
 * Books a campaign in.
 *
 * The audit entry records the approved recipient count and the content hash, because those
 * two numbers are what a later question about a send comes down to: how many people, and was
 * it the email that was approved.
 */
export async function scheduleMarketingCampaign(
  id: string,
  input: unknown,
): Promise<ActionResult<MarketingCampaign>> {
  try {
    const context = await authorise('send')
    if ('error' in context) return { error: context.error }

    const parsed = scheduleSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid schedule' }

    const { campaign, approvedRecipientCount } = await scheduleCampaign(
      id,
      parsed.data.scheduledFor,
      context.user.id,
    )

    await logAuditEvent({
      user_id: context.user.id,
      user_email: context.user.email,
      operation_type: 'update',
      resource_type: 'marketing_campaign',
      resource_id: id,
      operation_status: 'success',
      additional_info: {
        change: 'schedule',
        scheduled_for: campaign.scheduledFor,
        approved_recipient_count: approvedRecipientCount,
        content_hash: campaign.contentHash,
      },
    })

    revalidateCampaigns(id)
    return { success: true, data: campaign }
  } catch (error) {
    console.error('Failed to schedule marketing campaign:', error)
    return { error: failureMessage(error, 'Failed to schedule the campaign') }
  }
}

export async function pauseMarketingCampaign(id: string): Promise<ActionResult<MarketingCampaign>> {
  try {
    const context = await authorise('send')
    if ('error' in context) return { error: context.error }

    const campaign = await pauseCampaign(id, context.user.id)

    await logAuditEvent({
      user_id: context.user.id,
      user_email: context.user.email,
      operation_type: 'update',
      resource_type: 'marketing_campaign',
      resource_id: id,
      operation_status: 'success',
      additional_info: { change: 'pause' },
    })

    revalidateCampaigns(id)
    return { success: true, data: campaign }
  } catch (error) {
    console.error('Failed to pause marketing campaign:', error)
    return { error: failureMessage(error, 'Failed to pause the campaign') }
  }
}

export async function resumeMarketingCampaign(id: string): Promise<ActionResult<MarketingCampaign>> {
  try {
    const context = await authorise('send')
    if ('error' in context) return { error: context.error }

    const campaign = await resumeCampaign(id, context.user.id)

    await logAuditEvent({
      user_id: context.user.id,
      user_email: context.user.email,
      operation_type: 'update',
      resource_type: 'marketing_campaign',
      resource_id: id,
      operation_status: 'success',
      additional_info: { change: 'resume' },
    })

    revalidateCampaigns(id)
    return { success: true, data: campaign }
  } catch (error) {
    console.error('Failed to resume marketing campaign:', error)
    return { error: failureMessage(error, 'Failed to resume the campaign') }
  }
}

export async function cancelMarketingCampaign(id: string): Promise<ActionResult<MarketingCampaign>> {
  try {
    const context = await authorise('send')
    if ('error' in context) return { error: context.error }

    const { campaign, cancelledRecipients } = await cancelCampaign(id, context.user.id)

    await logAuditEvent({
      user_id: context.user.id,
      user_email: context.user.email,
      operation_type: 'update',
      resource_type: 'marketing_campaign',
      resource_id: id,
      operation_status: 'success',
      additional_info: { change: 'cancel', cancelled_recipients: cancelledRecipients },
    })

    revalidateCampaigns(id)
    return { success: true, data: campaign }
  } catch (error) {
    console.error('Failed to cancel marketing campaign:', error)
    return { error: failureMessage(error, 'Failed to cancel the campaign') }
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getMarketingSettings(): Promise<ActionResult<MarketingSettings>> {
  try {
    const context = await authorise('view')
    if ('error' in context) return { error: context.error }

    return { success: true, data: await getSettings() }
  } catch (error) {
    console.error('Failed to load marketing settings:', error)
    return { error: failureMessage(error, 'Failed to load settings') }
  }
}

/**
 * Changes the send settings, including the global kill switch.
 *
 * The old and new values are both logged. Turning sending on is the single most consequential
 * change in this section and needs to be answerable months later.
 */
export async function updateMarketingSettings(input: unknown): Promise<ActionResult<MarketingSettings>> {
  try {
    const context = await authorise('manage')
    if ('error' in context) return { error: context.error }

    const parsed = settingsSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid settings' }

    const before = await getSettings()
    const settings = await updateSettings(parsed.data, context.user.id)

    await logAuditEvent({
      user_id: context.user.id,
      user_email: context.user.email,
      operation_type: 'update',
      resource_type: 'marketing_settings',
      operation_status: 'success',
      old_values: { ...before },
      new_values: { ...settings },
    })

    revalidatePath('/marketing')
    revalidatePath('/marketing/settings')
    return { success: true, data: settings }
  } catch (error) {
    console.error('Failed to update marketing settings:', error)
    return { error: failureMessage(error, 'Failed to update settings') }
  }
}

/**
 * Sends this campaign to the signed-in user's own address.
 *
 * The only way to see a campaign as a recipient will before it reaches real businesses, so it
 * is gated on the send permission rather than edit: someone who may not authorise a campaign
 * should not be able to put it in an inbox either.
 *
 * Nothing is recorded against any contact and no recipient row is touched, so a test send
 * cannot affect the frequency cap, the audience or the campaign statistics. The unsubscribe
 * link points at the real route but carries a placeholder token, which resolves to the same
 * neutral page an expired link would.
 */
export async function sendMarketingTestEmail(id: unknown): Promise<ActionResult<{ sentTo: string }>> {
  try {
    const context = await authorise('send')
    if ('error' in context) return { error: context.error }

    const campaignId = z.string().uuid().safeParse(id)
    if (!campaignId.success) return { error: 'Invalid campaign id' }

    const recipient = context.user.email
    if (!recipient) return { error: 'Your account has no email address to send a test to' }

    const config = getMarketingConfig()
    if (!config.ok) {
      return { error: `Marketing email is not configured yet. Missing: ${config.missing.join(', ')}` }
    }

    const campaign = await getCampaign(campaignId.data)
    if (!campaign) return { error: 'Campaign not found' }

    const content = parseCampaignContent(campaign.content)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://management.orangejelly.co.uk'
    const rendered = renderMarketingEmail(content, {
      unsubscribeUrl: `${appUrl}/api/unsubscribe?t=test-send-placeholder-token`,
      linkMap: campaign.linkMap ?? {},
      utm: {
        source: MARKETING_UTM_SOURCE,
        medium: MARKETING_UTM_MEDIUM,
        campaign: campaign.utmCampaign ?? campaign.id,
      },
    })

    const result = await sendEmail({
      to: recipient,
      subject: `[TEST] ${campaign.subject}`,
      html: rendered.html,
      text: rendered.text,
      provider: 'resend',
      from: config.from,
      replyTo: config.replyTo,
      commType: 'marketing_campaign_test',
      customerId: null,
    })

    if (!result.success) {
      return { error: result.error ?? 'The test send failed' }
    }

    await logAuditEvent({
      user_id: context.user.id,
      operation_type: 'send',
      resource_type: 'marketing_campaign',
      resource_id: campaign.id,
      operation_status: 'success',
      additional_info: { test_send: true, sent_to: recipient, size_bytes: rendered.sizeBytes },
    })

    return { success: true, data: { sentTo: recipient } }
  } catch (error) {
    console.error('Failed to send a marketing test email:', error)
    return { error: failureMessage(error, 'Failed to send the test email') }
  }
}
