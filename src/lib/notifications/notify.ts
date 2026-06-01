import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail, type EmailOptions } from '@/lib/email/emailService'
import { isEmailSuppressed } from '@/lib/email/logging'
import { isCustomerSmsSendAllowed, sendSMS, type SendSMSOptions } from '@/lib/twilio'
import { logger } from '@/lib/logger'
import {
  isValidEmailAddress,
  selectChannel,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPolicy,
  type NotificationUrgency,
} from '@/lib/notifications/channel'

type CustomerChannelState = {
  id?: string | null
  email?: string | null
  mobile_number?: string | null
  mobile_e164?: string | null
  sms_status?: string | null
  sms_opt_in?: boolean | null
  marketing_sms_opt_in?: boolean | null
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
  sms?: {
    to?: string | null
    body: string
    options?: SendSMSOptions
  }
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
    .select('id, email, mobile_number, mobile_e164, sms_status, sms_opt_in, marketing_sms_opt_in, email_status, email_deactivated_at, marketing_email_opt_in')
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

export async function notifyCustomer(input: NotifyCustomerInput): Promise<NotifyCustomerResult> {
  const category = input.category ?? 'transactional'
  const customer = input.customer ?? (await loadCustomer(input.supabase, input.customerId))
  const smsTo = input.sms?.to || customer?.mobile_e164 || customer?.mobile_number || null
  const emailTo = input.email?.to || customer?.email || null

  const eligibility = {
    email: Boolean(input.email) && await isEmailEligible(
      customer ? { ...customer, email: emailTo } : { email: emailTo },
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
      })

      attempts.push({
        channel,
        success: result.success,
        error: result.error ?? null,
        messageId: result.messageId ?? null,
      })

      if (input.policy === 'email_first' && result.success) {
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

      attempts.push({
        channel,
        success: result.success,
        error: result.error ?? null,
        code: typeof result.code === 'string' ? result.code : null,
        scheduledFor: result.scheduledFor,
        logFailure: result.logFailure === true,
        messageId: result.sid ?? null,
      })
    }
  }

  return {
    selectedChannels: selected.channels,
    attempts,
  }
}
