import type { Event } from '@/types/database'
import { CHANNEL_MAP, type ChannelType, type ShortLinkChannel } from '@/lib/short-links/channels'

export type EventMarketingChannelKey =
  | 'facebook'
  | 'facebook_stories'
  | 'instagram_stories'
  | 'lnk_bio'
  | 'google_business_profile'
  | 'meta_ads'
  | 'newsletter'
  | 'sms'
  | 'whatsapp'
  | 'twitter'
  | 'tiktok'
  | 'linkedin'
  | 'poster'
  | 'flyer'
  | 'table_talker'
  | 'bar_strut'
  | 'business_card'
  | 'review_card'
  | 'window_sticker'
  | 'menu_insert'
  | 'printed_menu'
  | 'receipt'
  | 'chalkboard'
  | 'game_sheet'
  | 'beer_mat'
  | 'staff_badge'
  | 'toilet_poster'
  | 'a_board'
  | 'bar_top_display'
  | 'bill_presenter'
  | 'kids_activity_sheet'
  | 'loyalty_card'
  | 'wifi_card'
  | 'private_hire_pack'
  | 'partner_poster'
  | 'in_game_screen'
  | 'venue_screen'
  | 'event_host_slide'
  | 'pre_event_screen'
  | 'post_event_screen'
  | 'sms_promo'

export type EventMarketingChannelType = ChannelType

export interface EventMarketingChannelConfig {
  key: EventMarketingChannelKey
  label: string
  type: EventMarketingChannelType
  tier: 'always_on' | 'on_demand'
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

const EVENT_CHANNEL_SOURCE_KEYS: Array<{ key: EventMarketingChannelKey; sharedKey: string }> = [
  { key: 'facebook', sharedKey: 'facebook' },
  { key: 'lnk_bio', sharedKey: 'lnk_bio' },
  { key: 'google_business_profile', sharedKey: 'google_business' },
  { key: 'meta_ads', sharedKey: 'meta_ads' },
  { key: 'facebook_stories', sharedKey: 'facebook_stories' },
  { key: 'instagram_stories', sharedKey: 'instagram_stories' },
  { key: 'newsletter', sharedKey: 'newsletter' },
  { key: 'sms', sharedKey: 'sms' },
  { key: 'whatsapp', sharedKey: 'whatsapp' },
  { key: 'twitter', sharedKey: 'twitter' },
  { key: 'tiktok', sharedKey: 'tiktok' },
  { key: 'linkedin', sharedKey: 'linkedin' },
  { key: 'poster', sharedKey: 'poster' },
  { key: 'flyer', sharedKey: 'flyer' },
  { key: 'table_talker', sharedKey: 'table_talker' },
  { key: 'bar_strut', sharedKey: 'bar_strut' },
  { key: 'business_card', sharedKey: 'business_card' },
  { key: 'review_card', sharedKey: 'review_card' },
  { key: 'window_sticker', sharedKey: 'window_sticker' },
  { key: 'menu_insert', sharedKey: 'menu_insert' },
  { key: 'printed_menu', sharedKey: 'printed_menu' },
  { key: 'receipt', sharedKey: 'receipt' },
  { key: 'chalkboard', sharedKey: 'chalkboard' },
  { key: 'game_sheet', sharedKey: 'game_sheet' },
  { key: 'beer_mat', sharedKey: 'beer_mat' },
  { key: 'staff_badge', sharedKey: 'staff_badge' },
  { key: 'toilet_poster', sharedKey: 'toilet_poster' },
  { key: 'a_board', sharedKey: 'a_board' },
  { key: 'bar_top_display', sharedKey: 'bar_top_display' },
  { key: 'bill_presenter', sharedKey: 'bill_presenter' },
  { key: 'kids_activity_sheet', sharedKey: 'kids_activity_sheet' },
  { key: 'loyalty_card', sharedKey: 'loyalty_card' },
  { key: 'wifi_card', sharedKey: 'wifi_card' },
  { key: 'private_hire_pack', sharedKey: 'private_hire_pack' },
  { key: 'partner_poster', sharedKey: 'partner_poster' },
  { key: 'in_game_screen', sharedKey: 'in_game_screen' },
  { key: 'venue_screen', sharedKey: 'venue_screen' },
  { key: 'event_host_slide', sharedKey: 'event_host_slide' },
  { key: 'pre_event_screen', sharedKey: 'pre_event_screen' },
  { key: 'post_event_screen', sharedKey: 'post_event_screen' },
]

const ALWAYS_ON_CHANNELS = new Set<EventMarketingChannelKey>([
  'facebook',
  'lnk_bio',
  'google_business_profile',
  'meta_ads',
])

const SHORT_CODE_PREFIXES: Record<EventMarketingChannelKey, string> = {
  facebook: 'fb',
  facebook_stories: 'fs',
  instagram_stories: 'is',
  lnk_bio: 'ig',
  google_business_profile: 'gp',
  meta_ads: 'ma',
  newsletter: 'nl',
  sms: 'sm',
  whatsapp: 'wa',
  twitter: 'tw',
  tiktok: 'tk',
  linkedin: 'li',
  poster: 'po',
  flyer: 'fl',
  table_talker: 'tt',
  bar_strut: 'bs',
  business_card: 'bc',
  review_card: 'rc',
  window_sticker: 'ws',
  menu_insert: 'mi',
  printed_menu: 'mn',
  receipt: 're',
  chalkboard: 'cb',
  game_sheet: 'gc',
  beer_mat: 'bm',
  staff_badge: 'sb',
  toilet_poster: 'tp',
  a_board: 'ab',
  bar_top_display: 'bd',
  bill_presenter: 'bp',
  kids_activity_sheet: 'ks',
  loyalty_card: 'lc',
  wifi_card: 'wf',
  private_hire_pack: 'ph',
  partner_poster: 'pp',
  in_game_screen: 'sc',
  venue_screen: 'vs',
  event_host_slide: 'hs',
  pre_event_screen: 'ps',
  post_event_screen: 'ns',
  sms_promo: 'sp',
}

const EVENT_DESCRIPTIONS: Partial<Record<EventMarketingChannelKey, string>> = {
  facebook: 'Use for Facebook page posts and ads',
  facebook_stories: 'Use for Facebook story posts',
  instagram_stories: 'Use for Instagram story posts',
  lnk_bio: 'Use in the Instagram Lnk.bio top link',
  google_business_profile: 'For Google Business Profile event posts',
  meta_ads: 'Paid social - paste as the destination URL in Meta Ads Manager',
  newsletter: 'Use in email newsletters and campaigns',
  sms: 'Use in SMS or text message campaigns',
  whatsapp: 'Use when sharing in WhatsApp groups',
  twitter: 'Use for Twitter/X posts',
  tiktok: 'Use for TikTok posts',
  linkedin: 'Use for LinkedIn posts',
  poster: 'Poster artwork',
  flyer: 'Loose flyers and handouts',
  table_talker: 'Table talkers placed inside the venue',
  bar_strut: 'Bar strut menu inserts',
  business_card: 'Business cards and small handouts',
  review_card: 'Review cards used to promote this event',
  window_sticker: 'Window stickers and door signage',
  menu_insert: 'Loose inserts placed inside menus',
  printed_menu: 'Food menus and printed menu inserts in the venue',
  receipt: 'Till receipts and bill folders',
  chalkboard: 'Chalkboards and handwritten signs',
  game_sheet: 'Back of quiz answer sheets and music bingo game cards',
  beer_mat: 'Beer mats and coasters on tables',
  staff_badge: 'Staff badges, lanyards and handheld prompts',
  toilet_poster: 'Posters inside toilets',
  a_board: 'Outdoor A-boards and pavement signs',
  bar_top_display: 'Bar top displays and counter signs',
  bill_presenter: 'Bill presenters and table payment folders',
  kids_activity_sheet: 'Kids activity sheets and family packs',
  loyalty_card: 'Loyalty cards and stamped cards',
  wifi_card: 'WiFi cards and WiFi signs',
  private_hire_pack: 'Private hire packs and function room paperwork',
  partner_poster: 'Posters or flyers displayed by local partners',
  in_game_screen: 'QR shown on screen during quiz nights or music bingo',
  venue_screen: 'QR shown on venue TVs before or between events',
  event_host_slide: 'Slides controlled by the host during the event',
  pre_event_screen: 'Waiting screen shown before the event starts',
  post_event_screen: 'End screen for booking the next event',
  sms_promo: 'Automated cross-promotion SMS to past event attendees',
}

function eventChannelFromShared(
  key: EventMarketingChannelKey,
  channel: ShortLinkChannel
): EventMarketingChannelConfig {
  return {
    key,
    label: key === 'google_business_profile' ? 'Google Business Profile' : channel.label,
    type: channel.type,
    tier: ALWAYS_ON_CHANNELS.has(key) ? 'always_on' : 'on_demand',
    description: EVENT_DESCRIPTIONS[key],
    utmSource: channel.utmSource,
    utmMedium: channel.utmMedium,
    utmContent: channel.utmContent,
    shortCodePrefix: SHORT_CODE_PREFIXES[key],
  }
}

export const EVENT_MARKETING_CHANNELS: EventMarketingChannelConfig[] = [
  ...EVENT_CHANNEL_SOURCE_KEYS.map(({ key, sharedKey }) => {
    const channel = CHANNEL_MAP.get(sharedKey)
    if (!channel) {
      throw new Error(`Missing shared marketing channel: ${sharedKey}`)
    }
    return eventChannelFromShared(key, channel)
  }),
  {
    key: 'sms_promo',
    label: 'SMS Promo',
    type: 'digital',
    tier: 'on_demand',
    description: EVENT_DESCRIPTIONS.sms_promo,
    utmSource: 'sms',
    utmMedium: 'messaging',
    utmContent: 'sms_promo',
    shortCodePrefix: SHORT_CODE_PREFIXES.sms_promo,
  },
]

export const EVENT_MARKETING_CHANNEL_MAP = new Map(
  EVENT_MARKETING_CHANNELS.map((channel) => [channel.key, channel])
)

export function isEventMarketingQrChannel(channel: EventMarketingChannelConfig): boolean {
  return channel.type === 'print' || channel.type === 'screen'
}

export function shouldAutoGenerateEventMarketingChannel(channel: EventMarketingChannelConfig): boolean {
  return channel.tier === 'always_on' || isEventMarketingQrChannel(channel)
}

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
