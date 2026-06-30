export type NotificationChannel = 'email' | 'whatsapp' | 'sms'
export type NotificationPolicy = 'email_first' | 'email_only' | 'sms_only' | 'both'
export type NotificationUrgency = 'standard' | 'time_critical'
export type NotificationCategory = 'transactional' | 'marketing'

type ChannelEligibility = {
  email: boolean
  whatsapp: boolean
  sms: boolean
}

export type SelectChannelInput = {
  policy: NotificationPolicy
  urgency: NotificationUrgency
  category?: NotificationCategory
  eligibility: ChannelEligibility
  orderedChannels?: NotificationChannel[]
}

export type SelectChannelResult =
  | { channels: NotificationChannel[]; reason?: never }
  | { channels: []; reason: 'no_channel_available' | 'invalid_time_critical_email_only' | 'invalid_time_critical_email_first' }

export function selectChannel(input: SelectChannelInput): SelectChannelResult {
  const { policy, urgency, eligibility } = input

  if (urgency === 'time_critical' && policy === 'email_only') {
    return { channels: [], reason: 'invalid_time_critical_email_only' }
  }

  if (urgency === 'time_critical' && policy === 'email_first') {
    return { channels: [], reason: 'invalid_time_critical_email_first' }
  }

  const candidates = input.orderedChannels ?? legacyPolicyChannels(policy)

  const channels = candidates.filter(channel => eligibility[channel])

  if (channels.length === 0) {
    return { channels: [], reason: 'no_channel_available' }
  }

  return { channels }
}

export function legacyPolicyChannels(policy: NotificationPolicy): NotificationChannel[] {
  switch (policy) {
    case 'email_first':
      return ['email', 'whatsapp', 'sms']
    case 'email_only':
      return ['email']
    case 'sms_only':
      return ['sms']
    case 'both':
      return ['email', 'whatsapp', 'sms']
    default:
      return ['sms']
  }
}

export function isValidEmailAddress(value: string | null | undefined): value is string {
  if (!value) {
    return false
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}
