import {
  legacyPolicyChannels,
  type NotificationChannel,
  type NotificationPolicy,
} from '@/lib/notifications/channel'

export type NotificationRoute = {
  channels: NotificationChannel[]
  delayedFallbackAllowed: boolean
}

type TemplateRouteRule = {
  match: string
  type: 'exact' | 'prefix'
  channels: NotificationChannel[]
  delayedFallbackAllowed?: boolean
}

const EMAIL_THEN_MESSAGING: NotificationChannel[] = ['email', 'whatsapp', 'sms']
const SMS_ONLY: NotificationChannel[] = ['sms']

const TEMPLATE_ROUTE_RULES: TemplateRouteRule[] = [
  { type: 'prefix', match: 'table_booking_', channels: EMAIL_THEN_MESSAGING },
  { type: 'exact', match: 'sunday_preorder_request', channels: SMS_ONLY },
  { type: 'prefix', match: 'event_payment_', channels: EMAIL_THEN_MESSAGING },
  { type: 'prefix', match: 'event_booking_', channels: EMAIL_THEN_MESSAGING },
  { type: 'prefix', match: 'event_ticket_', channels: EMAIL_THEN_MESSAGING },
  { type: 'exact', match: 'event_rescheduled', channels: EMAIL_THEN_MESSAGING },
  { type: 'exact', match: 'event_postponed', channels: EMAIL_THEN_MESSAGING },
  { type: 'exact', match: 'event_cancelled', channels: EMAIL_THEN_MESSAGING },
  { type: 'exact', match: 'event_waitlist_offer', channels: SMS_ONLY },
  { type: 'prefix', match: 'event_cross_promo_', channels: SMS_ONLY },
  { type: 'prefix', match: 'event_general_promo_', channels: SMS_ONLY },
  { type: 'prefix', match: 'event_reminder_promo_', channels: SMS_ONLY },
  { type: 'prefix', match: 'private_booking_', channels: EMAIL_THEN_MESSAGING },
  { type: 'prefix', match: 'parking_payment_', channels: EMAIL_THEN_MESSAGING },
  { type: 'prefix', match: 'refund_confirmation', channels: EMAIL_THEN_MESSAGING },
  { type: 'exact', match: 'bulk_sms_campaign', channels: SMS_ONLY },
  { type: 'exact', match: 'message_thread_reply', channels: SMS_ONLY },
  { type: 'exact', match: 'job_queue_sms', channels: SMS_ONLY },
  { type: 'exact', match: 'background_job_sms', channels: SMS_ONLY },
  { type: 'exact', match: 'foh_food_order_alert', channels: SMS_ONLY },
]

function normalizeTemplateKey(value: string | null | undefined): string {
  return value?.trim() || 'unknown'
}

function findRouteRule(templateKey: string): TemplateRouteRule | null {
  return TEMPLATE_ROUTE_RULES.find((rule) => {
    if (rule.type === 'exact') return templateKey === rule.match
    return templateKey.startsWith(rule.match)
  }) ?? null
}

export function resolveNotificationRoute(input: {
  templateKey: string | null | undefined
  policy: NotificationPolicy
  delayedFallbackAllowed?: boolean
}): NotificationRoute {
  const templateKey = normalizeTemplateKey(input.templateKey)
  const rule = findRouteRule(templateKey)

  return {
    channels: rule?.channels ?? legacyPolicyChannels(input.policy),
    delayedFallbackAllowed: input.delayedFallbackAllowed === true || rule?.delayedFallbackAllowed === true,
  }
}

function getNotificationRoutingMatrix() {
  return TEMPLATE_ROUTE_RULES.map((rule) => ({
    template: rule.match,
    match: rule.type,
    channels: rule.channels,
    delayedFallbackAllowed: rule.delayedFallbackAllowed === true,
  }))
}
