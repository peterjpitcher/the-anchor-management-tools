import type { Event } from '@/types/database'

export type EventMarketingChannelKey =
  | 'facebook'
  | 'lnk_bio'
  | 'google_business_profile'
  | 'opentable'
  | 'newsletter'
  | 'sms'
  | 'whatsapp'
  | 'poster'
  | 'table_talker'
  | 'bar_strut'

export type EventMarketingChannelType = 'digital' | 'print'

export interface EventMarketingChannelConfig {
  key: EventMarketingChannelKey
  label: string
  type: EventMarketingChannelType
  description?: string
  utmSource: string
  utmMedium: string
  utmContent?: string
  shortCodePrefix: string
}

export interface EventMarketingContext {
  id: string
  slug: string
  name: string
  date: string
}

export interface EventMarketingLinkPayload {
  channel: EventMarketingChannelKey
  label: string
  type: EventMarketingChannelType
  destinationUrl: string
  utm: Record<string, string>
  shortCode: string
  shortCodePrefix: string
}

export const EVENT_MARKETING_CHANNELS: EventMarketingChannelConfig[] = [
  {
    key: 'facebook',
    label: 'Facebook',
    type: 'digital',
    description: 'Use for Facebook page posts and ads',
    utmSource: 'facebook',
    utmMedium: 'social',
    utmContent: 'facebook_main',
    shortCodePrefix: 'fb',
  },
  {
    key: 'lnk_bio',
    label: 'Lnk.bio',
    type: 'digital',
    description: 'Use in the Instagram Lnk.bio top link',
    utmSource: 'instagram',
    utmMedium: 'lnk.bio',
    utmContent: 'instagram_bio',
    shortCodePrefix: 'ig',
  },
  {
    key: 'google_business_profile',
    label: 'Google Business Profile',
    type: 'digital',
    description: 'For Google Business Profile event posts',
    utmSource: 'google',
    utmMedium: 'business_profile',
    utmContent: 'google_post',
    shortCodePrefix: 'gp',
  },
  {
    key: 'opentable',
    label: 'OpenTable',
    type: 'digital',
    description: 'Use for OpenTable experience listings',
    utmSource: 'opentable',
    utmMedium: 'reservation_platform',
    utmContent: 'opentable_experience',
    shortCodePrefix: 'ot',
  },
  {
    key: 'newsletter',
    label: 'Newsletter',
    type: 'digital',
    description: 'Use in email newsletters and campaigns',
    utmSource: 'newsletter',
    utmMedium: 'email',
    utmContent: 'newsletter_primary',
    shortCodePrefix: 'nl',
  },
  {
    key: 'sms',
    label: 'SMS',
    type: 'digital',
    description: 'Use in SMS or text message campaigns',
    utmSource: 'sms',
    utmMedium: 'messaging',
    utmContent: 'sms_blast',
    shortCodePrefix: 'sm',
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    type: 'digital',
    description: 'Use when sharing in WhatsApp groups',
    utmSource: 'whatsapp',
    utmMedium: 'messaging',
    utmContent: 'whatsapp_group',
    shortCodePrefix: 'wa',
  },
  {
    key: 'poster',
    label: 'Poster QR',
    type: 'print',
    description: 'Poster artwork and printed flyers',
    utmSource: 'poster',
    utmMedium: 'print',
    utmContent: 'poster_qr',
    shortCodePrefix: 'po',
  },
  {
    key: 'table_talker',
    label: 'Table Talker QR',
    type: 'print',
    description: 'Table talkers placed inside the venue',
    utmSource: 'table_talker',
    utmMedium: 'print',
    utmContent: 'table_talker_qr',
    shortCodePrefix: 'tt',
  },
  {
    key: 'bar_strut',
    label: 'Bar Strut QR',
    type: 'print',
    description: 'Bar strut menu inserts',
    utmSource: 'bar_strut',
    utmMedium: 'print',
    utmContent: 'bar_strut_qr',
    shortCodePrefix: 'bs',
  },
]

export const EVENT_MARKETING_CHANNEL_MAP = new Map(
  EVENT_MARKETING_CHANNELS.map((channel) => [channel.key, channel])
)

export function buildMarketingCampaignSlug(event: Pick<Event, 'slug' | 'date'>): string {
  if (!event.slug) {
    return `event-${event.date}`
  }
  return `event-${event.slug}`
}

export function buildEventBaseUrl(slug: string): string {
  const base = 'https://www.the-anchor.pub'
  const trimmedSlug = slug.startsWith('/') ? slug.slice(1) : slug
  return `${base}/events/${trimmedSlug}`
}

export function buildEventMarketingLinkPayload(
  event: EventMarketingContext,
  channel: EventMarketingChannelConfig
): EventMarketingLinkPayload {
  const campaign = buildMarketingCampaignSlug({ slug: event.slug, date: event.date })
  const baseUrl = buildEventBaseUrl(event.slug)

  const url = new URL(baseUrl)
  url.searchParams.set('utm_source', channel.utmSource)
  url.searchParams.set('utm_medium', channel.utmMedium)
  url.searchParams.set('utm_campaign', campaign)
  if (channel.utmContent) {
    url.searchParams.set('utm_content', channel.utmContent)
  }
  url.searchParams.set('utm_term', channel.key)

  const shortCode = buildShortCode(channel.shortCodePrefix, event.id)

  return {
    channel: channel.key,
    label: channel.label,
    type: channel.type,
    destinationUrl: url.toString(),
    utm: {
      utm_source: channel.utmSource,
      utm_medium: channel.utmMedium,
      utm_campaign: campaign,
      utm_content: channel.utmContent ?? channel.key,
      utm_term: channel.key,
    },
    shortCodePrefix: channel.shortCodePrefix,
    shortCode,
  }
}

export function buildShortCode(prefix: string, eventId: string, attempt = 0): string {
  const sanitized = eventId.replace(/-/g, '')
  const base = sanitized.slice(0, 6)
  if (attempt === 0) {
    return `${prefix}${base}`.slice(0, 20)
  }
  const random = Math.random().toString(36).slice(2, 4 + attempt)
  return `${prefix}${base}${random}`.slice(0, 20)
}
