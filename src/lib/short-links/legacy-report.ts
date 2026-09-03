import { z } from 'zod'
import { isProtectedShortLinkSlug } from './routing'

const LEGACY_SHORT_LINK_HOSTS = new Set(['vip-club.uk', 'www.vip-club.uk'])

export function isLegacyShortLinkHost(host: string | null): boolean {
  if (!host) return false
  const normalized = host.split(':')[0]?.trim().toLowerCase()
  if (!normalized) return false
  return LEGACY_SHORT_LINK_HOSTS.has(normalized) || normalized.endsWith('.vip-club.uk')
}

/**
 * Whether a legacy-domain request should see the retirement interstitial instead of
 * redirecting straight through.
 *
 * The interstitial exists to find out where an old vip-club.uk link is still published,
 * which click analytics cannot answer: every legacy click arrives with no referrer, so
 * the publication surface has to be asked for directly.
 *
 * Three cases skip it and redirect exactly as before:
 *
 * - bots, which cannot answer and should not be given an extra hop
 * - a table payment link, which is mid-transaction and may carry a reissued token
 * - a protected slug such as `feedback`, which backs the review-request funnel
 */
export function shouldShowLegacyInterstitial(options: {
  requestHost: string | null
  deviceType: string
  isTablePaymentLink: boolean
  shortCode: string
}): boolean {
  if (!isLegacyShortLinkHost(options.requestHost)) return false
  if (options.deviceType === 'bot') return false
  if (options.isTablePaymentLink) return false
  if (isProtectedShortLinkSlug(options.shortCode)) return false
  return true
}

/**
 * Where a legacy vip-club.uk link was found.
 *
 * The list is deliberately granular. A customer only ever taps one of these, but the
 * same form is used by staff sweeping the pub, and "on a sign" is not specific enough
 * to send someone to reprint the right thing.
 */
export const LEGACY_REPORT_LOCATION_KEYS = [
  'table',
  'menu',
  'bar',
  'sign_inside',
  'sign_outside',
  'garden',
  'toilets',
  'flyer',
  'google',
  'social',
  'message',
  'saved',
  'other',
] as const

export type LegacyReportLocationKey = (typeof LEGACY_REPORT_LOCATION_KEYS)[number]

export interface LegacyReportLocation {
  key: LegacyReportLocationKey
  label: string
  /** Optional second line, used where the label alone is ambiguous in a busy pub. */
  hint?: string
}

export const LEGACY_REPORT_LOCATIONS: readonly LegacyReportLocation[] = [
  { key: 'table', label: 'On the table', hint: 'Card, talker or tent on a table' },
  { key: 'menu', label: 'On a printed menu', hint: 'Food, drinks or specials menu' },
  { key: 'bar', label: 'At the bar', hint: 'Bar top, pumps or back bar' },
  { key: 'sign_inside', label: 'A sign or poster inside' },
  { key: 'sign_outside', label: 'A sign outside', hint: 'A-board, window or car park' },
  { key: 'garden', label: 'In the beer garden' },
  { key: 'toilets', label: 'In the toilets' },
  { key: 'flyer', label: 'A flyer, leaflet or card', hint: 'Something you took away' },
  { key: 'google', label: 'Google Maps or Google search' },
  { key: 'social', label: 'Facebook or Instagram' },
  { key: 'message', label: 'A text or email from us' },
  { key: 'saved', label: 'Saved on my phone', hint: 'Bookmark, or you typed it in' },
  { key: 'other', label: 'Somewhere else' },
]

const LOCATION_KEYS = LEGACY_REPORT_LOCATION_KEYS as unknown as [string, ...string[]]

export const LEGACY_REPORT_LOCATION_LABELS: Record<string, string> = Object.fromEntries(
  LEGACY_REPORT_LOCATIONS.map((option) => [option.key, option.label])
)

export function legacyReportLocationLabel(key: string | null): string {
  if (!key) return 'Unknown'
  return LEGACY_REPORT_LOCATION_LABELS[key] || key
}

export const legacyReportSubmissionSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'A short code is required')
    .max(20, 'That short code is not valid')
    .regex(/^[a-zA-Z0-9-]+$/, 'That short code is not valid'),
  locationKey: z.enum(LOCATION_KEYS, { errorMap: () => ({ message: 'Choose where you found the link' }) }),
  locationDetail: z
    .string()
    .trim()
    .max(280, 'Please keep the description under 280 characters')
    .optional()
    .transform((value) => (value ? value : undefined)),
  isStaff: z.boolean().optional().default(false),
})

export type LegacyReportSubmission = z.infer<typeof legacyReportSubmissionSchema>
