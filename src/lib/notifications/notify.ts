import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail, type EmailOptions } from '@/lib/email/emailService'
import { isEmailSuppressed } from '@/lib/email/logging'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCustomerSmsSendAllowed, isCustomerWhatsAppSendAllowed, sendSMS, sendWhatsApp, type SendSMSOptions, type SendWhatsAppOptions } from '@/lib/twilio'
import { logger } from '@/lib/logger'
import {
  isValidEmailAddress,
  selectChannel,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPolicy,
  type NotificationUrgency,
} from '@/lib/notifications/channel'
import { resolveNotificationRoute } from '@/lib/notifications/routing-matrix'

type CustomerChannelState = {
  id?: string | null
  email?: string | null
  mobile_number?: string | null
  mobile_e164?: string | null
  sms_status?: string | null
  sms_opt_in?: boolean | null
  marketing_sms_opt_in?: boolean | null
  whatsapp_status?: string | null
  whatsapp_opt_in?: boolean | null
  marketing_whatsapp_opt_in?: boolean | null
  last_whatsapp_inbound_at?: string | null
  email_status?: string | null
  email_deactivated_at?: string | null
  marketing_email_opt_in?: boolean | null
}

type NotifyCustomerInput = {
  supabase?: SupabaseClient<any, 'public', any>
  customerId?: string | null
  customer?: CustomerChannelState | null
  policy: NotificationPolicy
  urgency: NotificationUrgency
  category?: NotificationCategory
  email?: Omit<EmailOptions, 'to'> & { to?: string | null }
  whatsapp?: {
    to?: string | null
    body: string
    options?: SendWhatsAppOptions
  }
  sms?: {
    to?: string | null
    body: string
    options?: SendSMSOptions
  }
  delayedFallbackAllowed?: boolean
}

type ChannelAttempt = {
  channel: NotificationChannel
  success: boolean
  error?: string | null
      code?: string | null
      messageId?: string | null
      scheduledFor?: string
      logFailure?: boolean
}

export type NotifyCustomerResult = {
  selectedChannels: NotificationChannel[]
  attempts: ChannelAttempt[]
  noChannelReason?: string
}

async function loadCustomer(
  supabase: SupabaseClient<any, 'public', any> | undefined,
  customerId: string | null | undefined
): Promise<CustomerChannelState | null> {
  if (!supabase || !customerId) {
    return null
  }

  const { data, error } = await supabase
    .from('customers')
    .select('id, email, mobile_number, mobile_e164, sms_status, sms_opt_in, marketing_sms_opt_in, whatsapp_status, whatsapp_opt_in, marketing_whatsapp_opt_in, last_whatsapp_inbound_at, email_status, email_deactivated_at, marketing_email_opt_in')
    .eq('id', customerId)
    .maybeSingle()

  if (error) {
    logger.warn('Failed to load customer channel state', {
      metadata: { customerId, error: error.message },
    })
    return null
  }

  return data as CustomerChannelState | null
}

function resolveTemplateKey(input: NotifyCustomerInput): string {
  const smsTemplate = input.sms?.options?.metadata?.template_key
  const whatsappTemplate = input.whatsapp?.options?.templateKey ?? input.whatsapp?.options?.metadata?.template_key
  return String(input.email?.commType || whatsappTemplate || smsTemplate || 'unknown')
}

async function createDeliveryRecord(input: NotifyCustomerInput, customer: CustomerChannelState | null) {
  try {
    const client = input.supabase ?? createAdminClient()
    const { data, error } = await (client.from('notification_deliveries') as any)
      .insert({
        customer_id: customer?.id ?? input.customerId ?? null,
        template_key: resolveTemplateKey(input),
        policy: input.policy,
        category: input.category ?? 'transactional',
        urgency: input.urgency,
        delayed_fallback_allowed: input.delayedFallbackAllowed === true,
        metadata: {
          has_email: Boolean(input.email),
          has_whatsapp: Boolean(input.whatsapp),
          has_sms: Boolean(input.sms)
        }
      })
      .select('id')
      .maybeSingle()

    if (error) {
      logger.warn('Notification delivery audit unavailable', {
        metadata: { error: error.message }
      })
      return null
    }

    return data?.id ?? null
  } catch (error) {
    logger.warn('Notification delivery audit failed', {
      error: error instanceof Error ? error : new Error(String(error))
    })
    return null
  }
}

async function recordAttempt(input: {
  deliveryId: string | null
  attemptOrder: number
  attempt: ChannelAttempt
}) {
  if (!input.deliveryId) return
  try {
    const client = createAdminClient()
    await (client.from('notification_attempts') as any).insert({
      delivery_id: input.deliveryId,
      channel: input.attempt.channel,
      attempt_order: input.attemptOrder,
      status: input.attempt.success ? 'sent' : 'failed',
      provider_message_id: input.attempt.messageId ?? null,
      twilio_message_sid: input.attempt.channel === 'sms' || input.attempt.channel === 'whatsapp' ? input.attempt.messageId ?? null : null,
      resend_message_id: input.attempt.channel === 'email' ? input.attempt.messageId ?? null : null,
      error: input.attempt.error ?? null,
      raw_payload: {
        code: input.attempt.code ?? null,
        scheduled_for: input.attempt.scheduledFor ?? null,
        log_failure: input.attempt.logFailure === true
      }
    })
  } catch (error) {
    logger.warn('Notification attempt audit failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { deliveryId: input.deliveryId, channel: input.attempt.channel }
    })
  }
}

async function isEmailEligible(customer: CustomerChannelState | null, category: NotificationCategory): Promise<boolean> {
  const email = customer?.email?.trim()
  if (!isValidEmailAddress(email)) {
    return false
  }

  const status = customer?.email_status ?? 'unknown'
  if (['invalid', 'bounced', 'complained'].includes(status)) {
    return false
  }

  if (customer?.email_deactivated_at) {
    return false
  }

  if (category === 'marketing' && customer?.marketing_email_opt_in !== true) {
    return false
  }

  return !(await isEmailSuppressed(email))
}

async function isSmsEligible(
  customer: CustomerChannelState | null,
  smsTo: string | null | undefined,
  category: NotificationCategory,
  allowTransactionalOverride?: boolean
): Promise<boolean> {
  const to = smsTo || customer?.mobile_e164 || customer?.mobile_number || null
  if (!to) {
    return false
  }

  if (category === 'marketing' && customer?.marketing_sms_opt_in !== true) {
    return false
  }

  if (customer?.id) {
    const result = await isCustomerSmsSendAllowed(customer.id, to, { allowTransactionalOverride })
    return result.allowed
  }

  return true
}

async function isWhatsAppEligible(
  customer: CustomerChannelState | null,
  whatsappTo: string | null | undefined,
  category: NotificationCategory
): Promise<boolean> {
  const to = whatsappTo || customer?.mobile_e164 || customer?.mobile_number || null
  if (!to || !customer?.id) {
    return false
  }

  const result = await isCustomerWhatsAppSendAllowed(customer.id, to, {
    marketing: category === 'marketing'
  })

  return result.allowed
}

export async function notifyCustomer(input: NotifyCustomerInput): Promise<NotifyCustomerResult> {
  const category = input.category ?? 'transactional'
  const templateKey = resolveTemplateKey(input)
  const route = resolveNotificationRoute({
    templateKey,
    policy: input.policy,
    delayedFallbackAllowed: input.delayedFallbackAllowed,
  })
  const customer = input.customer ?? (await loadCustomer(input.supabase, input.customerId))
  const smsTo = input.sms?.to || customer?.mobile_e164 || customer?.mobile_number || null
  const whatsappTo = input.whatsapp?.to || customer?.mobile_e164 || customer?.mobile_number || null
  const emailTo = input.email?.to || customer?.email || null
  const deliveryId = await createDeliveryRecord(
    { ...input, delayedFallbackAllowed: route.delayedFallbackAllowed },
    customer
  )

  const eligibility = {
    email: Boolean(input.email) && await isEmailEligible(
      customer ? { ...customer, email: emailTo } : { email: emailTo },
      category
    ),
    whatsapp: Boolean(input.whatsapp) && await isWhatsAppEligible(
      customer,
      whatsappTo,
      category
    ),
    sms: Boolean(input.sms) && await isSmsEligible(
      customer,
      smsTo,
      category,
      input.sms?.options?.allowTransactionalOverride
    ),
  }

  const selected = selectChannel({
    policy: input.policy,
    urgency: input.urgency,
    category,
    eligibility,
    orderedChannels: route.channels,
  })

  if (selected.channels.length === 0) {
    logger.info('No notification channel available', {
      metadata: {
        customerId: customer?.id ?? input.customerId ?? null,
        policy: input.policy,
        urgency: input.urgency,
        reason: selected.reason,
      },
    })
    if (deliveryId) {
      const client = input.supabase ?? createAdminClient()
      await (client.from('notification_deliveries') as any)
        .update({ final_status: 'no_channel', updated_at: new Date().toISOString() })
        .eq('id', deliveryId)
    }
    return {
      selectedChannels: [],
      attempts: [],
      noChannelReason: selected.reason,
    }
  }

  const attempts: ChannelAttempt[] = []

  for (const channel of selected.channels) {
    if (channel === 'email' && input.email && emailTo) {
      const result = await sendEmail({
        ...input.email,
        to: emailTo,
        customerId: input.email.customerId ?? customer?.id ?? input.customerId ?? null,
        requireLog: true,
      })

      const attempt = {
        channel,
        success: result.success,
        error: result.error ?? null,
        messageId: result.messageId ?? null,
      }
      attempts.push(attempt)
      await recordAttempt({ deliveryId, attemptOrder: attempts.length, attempt })

      if (input.policy === 'email_first' && result.success) {
        break
      }

      continue
    }

    if (channel === 'whatsapp' && input.whatsapp && whatsappTo) {
      const result = await sendWhatsApp(
        whatsappTo,
        input.whatsapp.body,
        {
          ...input.whatsapp.options,
          customerId: input.whatsapp.options?.customerId ?? customer?.id ?? input.customerId ?? undefined,
        }
      )

      const attempt = {
        channel,
        success: result.success,
        error: result.error ?? null,
        code: typeof result.code === 'string' ? result.code : null,
        logFailure: result.logFailure === true,
        messageId: result.sid ?? null,
      }
      attempts.push(attempt)
      await recordAttempt({ deliveryId, attemptOrder: attempts.length, attempt })

      if (result.success) {
        break
      }

      continue
    }

    if (channel === 'sms' && input.sms && smsTo) {
      const result = await sendSMS(
        smsTo,
        input.sms.body,
        {
          ...input.sms.options,
          customerId: input.sms.options?.customerId ?? customer?.id ?? input.customerId ?? undefined,
        }
      )

      const attempt = {
        channel,
        success: result.success,
        error: result.error ?? null,
        code: typeof result.code === 'string' ? result.code : null,
        scheduledFor: result.scheduledFor,
        logFailure: result.logFailure === true,
        messageId: result.sid ?? null,
      }
      attempts.push(attempt)
      await recordAttempt({ deliveryId, attemptOrder: attempts.length, attempt })

      if (result.success) {
        break
      }
    }
  }

  if (deliveryId) {
    try {
      const successful = attempts.find(attempt => attempt.success)
      const client = input.supabase ?? createAdminClient()
      await (client.from('notification_deliveries') as any)
        .update({
          selected_channel: successful?.channel ?? null,
          final_status: successful ? 'sent' : 'failed',
          updated_at: new Date().toISOString()
        })
        .eq('id', deliveryId)
    } catch (error) {
      logger.warn('Failed to finalise notification delivery audit', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { deliveryId }
      })
    }
  }

  return {
    selectedChannels: selected.channels,
    attempts,
  }
}
