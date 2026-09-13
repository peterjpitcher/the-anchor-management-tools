const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on'])

export type SmsSuspensionReason = 'all_comms' | 'all_sms' | 'event_sms' | null

/** The environment variable behind each reason, for log lines staff can act on. */
export const SMS_SUSPENSION_SWITCHES: Record<Exclude<SmsSuspensionReason, null>, string> = {
  all_comms: 'SUSPEND_ALL_COMMS',
  all_sms: 'SUSPEND_ALL_SMS',
  event_sms: 'SUSPEND_EVENT_SMS',
}

export function isTruthyFlag(value: string | null | undefined): boolean {
  if (!value) return false
  return TRUTHY_ENV_VALUES.has(value.trim().toLowerCase())
}

export function isEventScopedSmsMetadata(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  if (!metadata) {
    return false
  }

  if (
    typeof metadata.event_id === 'string' ||
    typeof metadata.event_booking_id === 'string' ||
    typeof metadata.table_booking_id === 'string'
  ) {
    return true
  }

  const templateKey = typeof metadata.template_key === 'string' ? metadata.template_key : ''
  return templateKey.startsWith('event_') || templateKey === 'table_review_followup'
}

/**
 * The strongest active switch wins. SUSPEND_ALL_COMMS stops every channel (SMS here, email in
 * src/lib/email/suspension.ts, WhatsApp in sendWhatsApp), so it outranks the SMS-only switches.
 */
export function resolveSmsSuspensionReason(params: {
  suspendAllComms?: string | null
  suspendAllSms?: string | null
  suspendEventSms?: string | null
  metadata?: Record<string, unknown> | null
}): SmsSuspensionReason {
  if (isTruthyFlag(params.suspendAllComms)) {
    return 'all_comms'
  }

  if (isTruthyFlag(params.suspendAllSms)) {
    return 'all_sms'
  }

  if (!isTruthyFlag(params.suspendEventSms)) {
    return null
  }

  return isEventScopedSmsMetadata(params.metadata) ? 'event_sms' : null
}
