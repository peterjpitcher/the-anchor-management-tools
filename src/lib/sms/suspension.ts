const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on'])

export type SmsSuspensionReason = 'all_sms' | 'event_sms' | null

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

export function resolveSmsSuspensionReason(params: {
  suspendAllSms?: string | null
  suspendEventSms?: string | null
  metadata?: Record<string, unknown> | null
}): SmsSuspensionReason {
  if (isTruthyFlag(params.suspendAllSms)) {
    return 'all_sms'
  }

  if (!isTruthyFlag(params.suspendEventSms)) {
    return null
  }

  return isEventScopedSmsMetadata(params.metadata) ? 'event_sms' : null
}
