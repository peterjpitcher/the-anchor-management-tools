import type { IconName } from '@/ds/icons'

/**
 * The guest pages' status colours, in one place (UI_UX rule 7 and the "each status
 * has one map" rule). Pages never pick a tone class inline: they pick a tone, and
 * these maps turn it into whole class strings (rule 10: no class built at runtime).
 */

/** The three tones every guest banner, panel and icon disc speaks in. */
export type GuestTone = 'success' | 'notice' | 'problem'

/** The badge's four tones. `outstanding` is money or an answer still owed. */
export type GuestBadgeTone = 'success' | 'outstanding' | 'danger' | 'outline'

/**
 * The traffic-light banner colours the older guest pages speak in (`green`, `amber`,
 * `red` in their status messages), in the guest vocabulary.
 */
export const GUEST_BANNER_TONE: Record<'green' | 'amber' | 'red', GuestTone> = {
  green: 'success',
  amber: 'notice',
  red: 'problem',
}

/** The badge that sits beside a status disc or banner of the same tone. */
export const GUEST_BADGE_TONE_FOR: Record<GuestTone, GuestBadgeTone> = {
  success: 'success',
  notice: 'outstanding',
  problem: 'danger',
}

/** Alert panel: fill, edge and the tone colour its icon and title take. */
export const GUEST_ALERT_TONE_CLASS: Record<GuestTone, string> = {
  success: 'border-guest-success-border bg-guest-success-soft text-anchor-success',
  notice: 'border-guest-notice-border bg-guest-notice-soft text-guest-accent-text',
  problem: 'border-guest-danger-border bg-guest-danger-soft text-anchor-danger',
}

/**
 * Alert body text. Success keeps its green; the other two drop the body back to
 * charcoal for readability, with the icon and title carrying the tone.
 */
export const GUEST_ALERT_BODY_CLASS: Record<GuestTone, string> = {
  success: 'text-anchor-success',
  notice: 'text-guest-text',
  problem: 'text-guest-text',
}

export const GUEST_TONE_ICON: Record<GuestTone, IconName> = {
  success: 'checkCircle',
  notice: 'alertTriangle',
  problem: 'alertCircle',
}

/** Badge fill and text. */
export const GUEST_BADGE_TONE_CLASS: Record<GuestBadgeTone, string> = {
  success: 'bg-guest-success-tint text-anchor-success',
  outstanding: 'bg-guest-notice-tint text-guest-accent-text',
  danger: 'bg-guest-danger-tint text-anchor-danger',
  outline: 'border-[1.5px] border-guest-border-strong bg-transparent text-guest-text',
}

/** The round icon disc that heads a result card. `brand` is the green of the assurance rows. */
export type GuestMarkTone = GuestTone | 'brand'

export const GUEST_MARK_TONE_CLASS: Record<GuestMarkTone, string> = {
  success: 'bg-guest-success-tint text-anchor-success',
  notice: 'bg-guest-notice-tint text-guest-accent-text',
  problem: 'bg-guest-danger-tint text-anchor-danger',
  brand: 'bg-guest-brand-tint text-anchor-green',
}

export const GUEST_MARK_ICON: Record<GuestTone, IconName> = {
  success: 'check',
  notice: 'clock',
  problem: 'alertCircle',
}

const SUCCESS_STATUSES = ['confirmed', 'completed', 'seated', 'paid']
const OUTSTANDING_STATUSES = ['awaiting deposit', 'pending', 'pending confirmation', 'outstanding']
const DANGER_STATUSES = ['cancelled', 'no show', 'failed']

/**
 * Map an existing status string to a badge tone.
 *
 * Anything unrecognised falls back to `outline` and keeps whatever humanised
 * text it came with, so a new status added to the database shows up readable
 * rather than mis-coloured or blank. Feed it the output of `humanizeStatus()`
 * or a `statusLabels` lookup: it normalises case, spacing and underscores.
 */
export function guestBadgeToneForStatus(status: string): GuestBadgeTone {
  const normalised = status.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')

  if (SUCCESS_STATUSES.includes(normalised)) return 'success'
  if (OUTSTANDING_STATUSES.includes(normalised)) return 'outstanding'
  if (DANGER_STATUSES.includes(normalised)) return 'danger'
  return 'outline'
}
