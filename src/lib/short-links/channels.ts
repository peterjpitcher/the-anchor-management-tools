export type ChannelType = 'digital' | 'print'

export interface ShortLinkChannel {
  key: string
  label: string
  type: ChannelType
  utmSource: string
  utmMedium: string
  utmContent: string
}

export const DIGITAL_CHANNELS: ShortLinkChannel[] = [
  { key: 'facebook', label: 'Facebook', type: 'digital', utmSource: 'facebook', utmMedium: 'social', utmContent: 'facebook_main' },
  { key: 'lnk_bio', label: 'Lnk.bio', type: 'digital', utmSource: 'instagram', utmMedium: 'lnk.bio', utmContent: 'instagram_bio' },
  { key: 'google_business', label: 'Google Business', type: 'digital', utmSource: 'google', utmMedium: 'business_profile', utmContent: 'google_post' },
  { key: 'meta_ads', label: 'Meta Ads', type: 'digital', utmSource: 'facebook', utmMedium: 'paid_social', utmContent: 'meta_ads_main' },
  { key: 'newsletter', label: 'Newsletter', type: 'digital', utmSource: 'newsletter', utmMedium: 'email', utmContent: 'newsletter_primary' },
  { key: 'sms', label: 'SMS', type: 'digital', utmSource: 'sms', utmMedium: 'messaging', utmContent: 'sms_blast' },
  { key: 'whatsapp', label: 'WhatsApp', type: 'digital', utmSource: 'whatsapp', utmMedium: 'messaging', utmContent: 'whatsapp_group' },
]

export const PRINT_CHANNELS: ShortLinkChannel[] = [
  { key: 'poster', label: 'Poster', type: 'print', utmSource: 'poster', utmMedium: 'print', utmContent: 'poster_qr' },
  { key: 'table_talker', label: 'Table Talker', type: 'print', utmSource: 'table_talker', utmMedium: 'print', utmContent: 'table_talker_qr' },
  { key: 'bar_strut', label: 'Bar Strut', type: 'print', utmSource: 'bar_strut', utmMedium: 'print', utmContent: 'bar_strut_qr' },
  { key: 'flyer', label: 'Flyer', type: 'print', utmSource: 'flyer', utmMedium: 'print', utmContent: 'flyer_qr' },
  { key: 'menu_insert', label: 'Menu Insert', type: 'print', utmSource: 'menu_insert', utmMedium: 'print', utmContent: 'menu_insert_qr' },
]

export const ALL_CHANNELS: ShortLinkChannel[] = [...DIGITAL_CHANNELS, ...PRINT_CHANNELS]

export const CHANNEL_MAP = new Map(ALL_CHANNELS.map((c) => [c.key, c]))
