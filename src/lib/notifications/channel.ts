export type NotificationChannel = 'email' | 'sms'
export type NotificationPolicy = 'email_first' | 'email_only' | 'sms_only' | 'both'
export type NotificationUrgency = 'standard' | 'time_critical'
export type NotificationCategory = 'transactional' | 'marketing'

export type ChannelEligibility = {
  email: boolean
  sms: boolean
}

export type SelectChannelInput = {
  policy: NotificationPolicy
  urgency: NotificationUrgency
  category?: NotificationCategory
  eligibility: ChannelEligibility
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

  let candidates: NotificationChannel[]
  switch (policy) {
    case 'email_first':
      candidates = ['email', 'sms']
      break
    case 'email_only':
      candidates = ['email']
      break
    case 'sms_only':
      candidates = ['sms']
      break
    case 'both':
      candidates = ['email', 'sms']
      break
    default:
      candidates = ['sms']
  }

  const channels = candidates.filter(channel => eligibility[channel])

  if (channels.length === 0) {
    return { channels: [], reason: 'no_channel_available' }
  }

  return { channels }
}

export function isValidEmailAddress(value: string | null | undefined): value is string {
  if (!value) {
    return false
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}
