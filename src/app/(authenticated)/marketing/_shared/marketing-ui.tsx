import { Badge } from '@/ds'
import { formatDateInLondon, formatDateTime12Hour } from '@/lib/dateUtils'
import type {
  EligibilityStatus,
  MarketingBasis,
  MarketingCampaignStatus,
  MarketingRecipientStatus,
  MarketingSkipReason,
  MarketingStatus,
  SubscriberType,
} from '@/types/marketing'

// Shared presentation helpers for the B2B marketing section.
// Pure module: safe to import from both server and client components.

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

export interface MarketingNavItem {
  label: string
  href: string
}

export const MARKETING_SECTION_NAV: MarketingNavItem[] = [
  { label: 'Campaigns', href: '/marketing' },
  { label: 'Contacts', href: '/marketing/contacts' },
  { label: 'Settings', href: '/marketing/settings' },
]

// ---------------------------------------------------------------------------
// Campaign status
// ---------------------------------------------------------------------------

export const CAMPAIGN_STATUS_LABELS: Record<MarketingCampaignStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sending: 'Sending',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const CAMPAIGN_STATUS_TONES: Record<MarketingCampaignStatus, BadgeTone> = {
  draft: 'neutral',
  scheduled: 'info',
  sending: 'primary',
  paused: 'warning',
  completed: 'success',
  cancelled: 'danger',
}

export function CampaignStatusBadge({ status }: { status: MarketingCampaignStatus }) {
  return <Badge tone={CAMPAIGN_STATUS_TONES[status]}>{CAMPAIGN_STATUS_LABELS[status]}</Badge>
}

// ---------------------------------------------------------------------------
// Recipient status and skip reasons
// ---------------------------------------------------------------------------

export const RECIPIENT_STATUS_LABELS: Record<MarketingRecipientStatus, string> = {
  pending: 'Waiting',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
  skipped: 'Skipped',
  needs_review: 'Needs review',
}

const RECIPIENT_STATUS_TONES: Record<MarketingRecipientStatus, BadgeTone> = {
  pending: 'neutral',
  sending: 'info',
  sent: 'success',
  failed: 'danger',
  skipped: 'neutral',
  needs_review: 'warning',
}

export function RecipientStatusBadge({ status }: { status: MarketingRecipientStatus }) {
  return <Badge tone={RECIPIENT_STATUS_TONES[status]}>{RECIPIENT_STATUS_LABELS[status]}</Badge>
}

export const SKIP_REASON_LABELS: Record<MarketingSkipReason, string> = {
  unsubscribed: 'Unsubscribed',
  suppressed: 'Suppressed',
  do_not_contact: 'On the do-not-contact list',
  frequency_cap: 'Emailed too recently',
  not_eligible: 'Not marked eligible',
  campaign_cancelled: 'Campaign cancelled',
}

export function skipReasonLabel(reason: MarketingSkipReason | null): string {
  if (!reason) return ''
  return SKIP_REASON_LABELS[reason] ?? reason
}

// ---------------------------------------------------------------------------
// Contact eligibility and marketing status
// ---------------------------------------------------------------------------

export const ELIGIBILITY_LABELS: Record<EligibilityStatus, string> = {
  pending_review: 'Waiting for review',
  eligible: 'Eligible',
  excluded: 'Excluded',
}

const ELIGIBILITY_TONES: Record<EligibilityStatus, BadgeTone> = {
  pending_review: 'warning',
  eligible: 'success',
  excluded: 'neutral',
}

export function EligibilityBadge({ status }: { status: EligibilityStatus }) {
  return <Badge tone={ELIGIBILITY_TONES[status]}>{ELIGIBILITY_LABELS[status]}</Badge>
}

export const MARKETING_STATUS_LABELS: Record<MarketingStatus, string> = {
  subscribed: 'Subscribed',
  unsubscribed: 'Unsubscribed',
  bounced: 'Bounced',
  complained: 'Complained',
}

const MARKETING_STATUS_TONES: Record<MarketingStatus, BadgeTone> = {
  subscribed: 'success',
  unsubscribed: 'neutral',
  bounced: 'warning',
  complained: 'danger',
}

export function MarketingStatusBadge({ status }: { status: MarketingStatus }) {
  return <Badge tone={MARKETING_STATUS_TONES[status]}>{MARKETING_STATUS_LABELS[status]}</Badge>
}

export const SUBSCRIBER_TYPE_LABELS: Record<SubscriberType, string> = {
  corporate: 'Limited company or other business',
  individual: 'Sole trader, partnership or a person',
  unknown: 'Not known yet',
}

export const MARKETING_BASIS_LABELS: Record<MarketingBasis, string> = {
  legitimate_interest: 'Legitimate interest',
  consent: 'Consent',
  soft_opt_in: 'Soft opt-in',
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Rates arrive as a fraction (0.42), so this renders one decimal place at most. */
export function formatPercent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '0%'
  const percent = rate * 100
  return percent % 1 === 0 ? `${percent}%` : `${percent.toFixed(1)}%`
}

/** A count alongside its share of a total, for table cells like "412 (86.4%)". */
export function formatCountWithRate(count: number, rate: number | null | undefined): string {
  return `${count} (${formatPercent(rate)})`
}

/**
 * Uses the shared helper rather than a local Intl call: en-GB with hour12 renders noon as
 * "0pm" on Node 20, and `formatDateTime12Hour` already works around that.
 */
export function formatDateTimeInLondon(value: string | null | undefined): string {
  if (!value) return ''
  return formatDateTime12Hour(value)
}

export function formatDateOnlyInLondon(value: string | null | undefined): string {
  if (!value) return ''
  return formatDateInLondon(value, { day: 'numeric', month: 'short', year: 'numeric' })
}

const ISO_DAY_LABELS: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
}

export const ISO_DAY_OPTIONS: Array<{ value: number; label: string; short: string }> = [
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
  { value: 7, label: 'Sunday', short: 'Sun' },
]

export function formatSendDays(days: number[]): string {
  if (!days.length) return 'No days selected'
  const labels = [...days]
    .sort((a, b) => a - b)
    .map((day) => ISO_DAY_LABELS[day])
    .filter((label): label is string => Boolean(label))
  return labels.length ? labels.join(', ') : 'No days selected'
}

/** 9 becomes "9am", 17 becomes "5pm". Hours are whole numbers in London time. */
export function formatHour(hour: number): string {
  if (!Number.isFinite(hour)) return ''
  const normalised = ((Math.trunc(hour) % 24) + 24) % 24
  if (normalised === 0) return '12am'
  if (normalised === 12) return '12pm'
  return normalised < 12 ? `${normalised}am` : `${normalised - 12}pm`
}

export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: formatHour(hour),
}))
