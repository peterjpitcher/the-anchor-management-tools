export type ChannelType = 'digital' | 'print' | 'screen'

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
  { key: 'facebook_stories', label: 'Facebook Stories', type: 'digital', utmSource: 'facebook', utmMedium: 'social_stories', utmContent: 'facebook_stories' },
  { key: 'instagram_stories', label: 'Instagram Stories', type: 'digital', utmSource: 'instagram', utmMedium: 'social_stories', utmContent: 'instagram_stories' },
  { key: 'lnk_bio', label: 'Link in Bio', type: 'digital', utmSource: 'instagram', utmMedium: 'link_bio', utmContent: 'instagram_bio' },
  { key: 'google_business', label: 'Google Business Profile', type: 'digital', utmSource: 'google_business', utmMedium: 'organic', utmContent: 'google_business_profile' },
  { key: 'meta_ads', label: 'Meta Ads', type: 'digital', utmSource: 'facebook', utmMedium: 'paid_social', utmContent: 'meta_ads_main' },
  { key: 'newsletter', label: 'Email Newsletter', type: 'digital', utmSource: 'email', utmMedium: 'email', utmContent: 'newsletter_primary' },
  { key: 'sms', label: 'SMS', type: 'digital', utmSource: 'sms', utmMedium: 'sms', utmContent: 'sms_blast' },
  { key: 'whatsapp', label: 'WhatsApp', type: 'digital', utmSource: 'whatsapp', utmMedium: 'messaging', utmContent: 'whatsapp_group' },
  { key: 'twitter', label: 'Twitter / X', type: 'digital', utmSource: 'twitter', utmMedium: 'social', utmContent: 'twitter_main' },
  { key: 'tiktok', label: 'TikTok', type: 'digital', utmSource: 'tiktok', utmMedium: 'social', utmContent: 'tiktok_main' },
  { key: 'linkedin', label: 'LinkedIn', type: 'digital', utmSource: 'linkedin', utmMedium: 'social', utmContent: 'linkedin_main' },
]

export const PRINT_CHANNELS: ShortLinkChannel[] = [
  { key: 'poster', label: 'Poster', type: 'print', utmSource: 'poster', utmMedium: 'print', utmContent: 'poster_qr' },
  { key: 'bar_strut', label: 'Bar Strut', type: 'print', utmSource: 'bar_strut', utmMedium: 'print', utmContent: 'bar_strut_qr' },
  { key: 'table_talker', label: 'Table Talker', type: 'print', utmSource: 'table_talker', utmMedium: 'print', utmContent: 'table_talker_qr' },
  { key: 'business_card', label: 'Business Card', type: 'print', utmSource: 'business_card', utmMedium: 'print', utmContent: 'business_card_qr' },
  { key: 'review_card', label: 'Review Card', type: 'print', utmSource: 'review_card', utmMedium: 'print', utmContent: 'review_card_qr' },
  { key: 'window_sticker', label: 'Window Sticker', type: 'print', utmSource: 'window_sticker', utmMedium: 'print', utmContent: 'window_sticker_qr' },
  { key: 'menu_insert', label: 'Menu Insert', type: 'print', utmSource: 'menu_insert', utmMedium: 'print', utmContent: 'menu_insert_qr' },
  { key: 'printed_menu', label: 'Printed Menu', type: 'print', utmSource: 'printed_menu', utmMedium: 'print', utmContent: 'printed_menu_qr' },
  { key: 'flyer', label: 'Flyer', type: 'print', utmSource: 'flyer', utmMedium: 'print', utmContent: 'flyer_qr' },
  { key: 'receipt', label: 'Receipt', type: 'print', utmSource: 'receipt', utmMedium: 'print', utmContent: 'receipt_qr' },
  { key: 'chalkboard', label: 'Chalkboard', type: 'print', utmSource: 'chalkboard', utmMedium: 'print', utmContent: 'chalkboard_qr' },
  { key: 'game_sheet', label: 'Game Sheet', type: 'print', utmSource: 'game_sheet', utmMedium: 'print', utmContent: 'game_sheet_qr' },
  { key: 'beer_mat', label: 'Beer Mat / Coaster', type: 'print', utmSource: 'beer_mat', utmMedium: 'print', utmContent: 'beer_mat_qr' },
  { key: 'staff_badge', label: 'Staff Badge / Lanyard', type: 'print', utmSource: 'staff_badge', utmMedium: 'print', utmContent: 'staff_badge_qr' },
  { key: 'toilet_poster', label: 'Toilet Poster', type: 'print', utmSource: 'toilet_poster', utmMedium: 'print', utmContent: 'toilet_poster_qr' },
  { key: 'a_board', label: 'Outdoor A-board', type: 'print', utmSource: 'a_board', utmMedium: 'print', utmContent: 'a_board_qr' },
  { key: 'bar_top_display', label: 'Bar Top Display', type: 'print', utmSource: 'bar_top_display', utmMedium: 'print', utmContent: 'bar_top_display_qr' },
  { key: 'bill_presenter', label: 'Bill Presenter', type: 'print', utmSource: 'bill_presenter', utmMedium: 'print', utmContent: 'bill_presenter_qr' },
  { key: 'kids_activity_sheet', label: 'Kids Activity Sheet', type: 'print', utmSource: 'kids_activity_sheet', utmMedium: 'print', utmContent: 'kids_activity_sheet_qr' },
  { key: 'loyalty_card', label: 'Loyalty Card', type: 'print', utmSource: 'loyalty_card', utmMedium: 'print', utmContent: 'loyalty_card_qr' },
  { key: 'wifi_card', label: 'WiFi Card / Sign', type: 'print', utmSource: 'wifi_card', utmMedium: 'print', utmContent: 'wifi_card_qr' },
  { key: 'private_hire_pack', label: 'Private Hire Pack', type: 'print', utmSource: 'private_hire_pack', utmMedium: 'print', utmContent: 'private_hire_pack_qr' },
  { key: 'partner_poster', label: 'Local Partner Poster', type: 'print', utmSource: 'partner_poster', utmMedium: 'print', utmContent: 'partner_poster_qr' },
]

export const SCREEN_CHANNELS: ShortLinkChannel[] = [
  { key: 'in_game_screen', label: 'In-game Screen', type: 'screen', utmSource: 'in_game_screen', utmMedium: 'screen', utmContent: 'in_game_screen_qr' },
  { key: 'venue_screen', label: 'Venue Screen', type: 'screen', utmSource: 'venue_screen', utmMedium: 'screen', utmContent: 'venue_screen_qr' },
  { key: 'event_host_slide', label: 'Event Host Slide', type: 'screen', utmSource: 'event_host_slide', utmMedium: 'screen', utmContent: 'event_host_slide_qr' },
  { key: 'pre_event_screen', label: 'Pre-event Waiting Screen', type: 'screen', utmSource: 'pre_event_screen', utmMedium: 'screen', utmContent: 'pre_event_screen_qr' },
  { key: 'post_event_screen', label: 'Post-event Book Next Screen', type: 'screen', utmSource: 'post_event_screen', utmMedium: 'screen', utmContent: 'post_event_screen_qr' },
]

export const QR_CHANNELS: ShortLinkChannel[] = [...PRINT_CHANNELS, ...SCREEN_CHANNELS]

export const ALL_CHANNELS: ShortLinkChannel[] = [...DIGITAL_CHANNELS, ...QR_CHANNELS]

export const CHANNEL_MAP = new Map(ALL_CHANNELS.map((c) => [c.key, c]))

/** Shared colour mapping for channel charts — digital=blue tones, print=amber tones */
export const CHANNEL_COLOURS: Record<string, string> = {
  facebook: '#3b82f6',
  facebook_stories: '#2563eb',
  instagram_stories: '#e879f9',
  lnk_bio: '#6366f1',
  google_business: '#2563eb',
  meta_ads: '#818cf8',
  newsletter: '#60a5fa',
  sms: '#38bdf8',
  whatsapp: '#34d399',
  twitter: '#0ea5e9',
  tiktok: '#111827',
  linkedin: '#0a66c2',
  poster: '#f59e0b',
  table_talker: '#fbbf24',
  bar_strut: '#d97706',
  business_card: '#a16207',
  review_card: '#ca8a04',
  window_sticker: '#eab308',
  flyer: '#fb923c',
  menu_insert: '#f97316',
  printed_menu: '#f97316',
  receipt: '#ea580c',
  chalkboard: '#854d0e',
  game_sheet: '#c2410c',
  beer_mat: '#b45309',
  staff_badge: '#92400e',
  toilet_poster: '#78350f',
  a_board: '#f97316',
  bar_top_display: '#ea580c',
  bill_presenter: '#c2410c',
  kids_activity_sheet: '#fb923c',
  loyalty_card: '#a16207',
  wifi_card: '#eab308',
  private_hire_pack: '#854d0e',
  partner_poster: '#f59e0b',
  in_game_screen: '#14b8a6',
  venue_screen: '#0d9488',
  event_host_slide: '#0f766e',
  pre_event_screen: '#2dd4bf',
  post_event_screen: '#5eead4',
}

/** Fallback colour for unknown channels */
export const CHANNEL_COLOUR_DEFAULT = '#9ca3af'
