import { formatDateInLondon } from '@/lib/dateUtils'
import { isPlaceholderName } from '@/lib/sms/name-utils'
import type { MarketingContent } from './registry'

/**
 * Per-recipient merge for lifecycle campaigns (spec tasks/spec-2026-11-02-table-booking-return-visits.md,
 * section 9.2).
 *
 * A one-off campaign is identical for every recipient. A return-visit email is not: it carries
 * the guest's first name and the voucher issued to them. Those values live on the recipient
 * row (`marketing_campaign_recipients.merge_fields`) and are substituted into the campaign
 * content before it is rendered, so the blocks escape them like any other text and the
 * designer's markup is untouched.
 *
 * Tokens are `{{name}}`, or `{{name|fallback}}` for a value that may be empty ("Hi
 * {{first_name|there}},"). A token with no value and no fallback is an error, never a blank:
 * "Hi ," and a voucher card without a number have both been the kind of thing that reaches a
 * customer. Anything left looking like a token after the merge is an error too.
 */

export interface RecipientMergeFields {
  first_name?: string | null
  party_size?: number | null
  voucher_number?: string | null
  voucher_percent?: number | string | null
  voucher_expires_on?: string | null
}

export class MergeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MergeError'
  }
}

const TOKEN = /\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/g
const VOUCHER_NUMBER = /^AN-\d{4}-\d{4}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const BROKEN_VALUE = /undefined|Invalid Date|NaN/

/** Party size for the booking link, clamped to the website's 1 to 20. */
export function bookingPartySize(fields: RecipientMergeFields): number | null {
  const size = Number(fields.party_size)
  if (!Number.isFinite(size) || size < 1) return null
  return Math.min(20, Math.max(1, Math.round(size)))
}

/** The values each token resolves to. Empty string means "no value": the fallback applies. */
export function resolveMergeValues(fields: RecipientMergeFields): Record<string, string> {
  const rawName = fields.first_name?.trim() ?? ''
  const firstName = isPlaceholderName(rawName) ? '' : rawName

  const values: Record<string, string> = { first_name: firstName }

  if (fields.voucher_number != null) {
    const number = String(fields.voucher_number).trim()
    if (!VOUCHER_NUMBER.test(number)) {
      throw new MergeError(`Voucher number "${number}" is not a ledger number`)
    }
    values.voucher_number = number
  }

  if (fields.voucher_percent != null) {
    const percent = Number(fields.voucher_percent)
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
      throw new MergeError(`Voucher percentage "${fields.voucher_percent}" is not a whole percentage`)
    }
    values.voucher_percent = String(percent)
  }

  if (fields.voucher_expires_on != null) {
    const iso = String(fields.voucher_expires_on)
    if (!ISO_DATE.test(iso) || Number.isNaN(Date.parse(`${iso}T12:00:00Z`))) {
      throw new MergeError(`Voucher expiry "${iso}" is not a date`)
    }
    // "Friday 11 December 2026", as the voucher card design writes it (no comma after the day).
    // The day name comes from the date, never from copy, so it cannot drift from it.
    values.voucher_expires_on = `${formatDateInLondon(iso, { weekday: 'long' })} ${formatDateInLondon(iso, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })}`
  }

  for (const [key, value] of Object.entries(values)) {
    if (BROKEN_VALUE.test(value)) {
      throw new MergeError(`Merge value for ${key} reads "${value}"`)
    }
  }

  return values
}

function mergeString(input: string, values: Record<string, string>): string {
  const merged = input.replace(TOKEN, (_match, name: string, fallback: string | undefined) => {
    const value = values[name]
    if (value) return value
    if (fallback !== undefined) return fallback
    throw new MergeError(`No value for {{${name}}}`)
  })
  if (merged.includes('{{') || merged.includes('}}')) {
    throw new MergeError(`Unmerged token left in "${merged.slice(0, 80)}"`)
  }
  return merged
}

function mergeValue(value: unknown, values: Record<string, string>): unknown {
  if (typeof value === 'string') return mergeString(value, values)
  if (Array.isArray(value)) return value.map((entry) => mergeValue(entry, values))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, mergeValue(entry, values)]),
    )
  }
  return value
}

/** Whether the content asks for any per-recipient value at all. */
export function contentHasMergeTokens(content: MarketingContent): boolean {
  return /\{\{\s*[a-z_]+/.test(JSON.stringify(content))
}

/** The token names a piece of content uses, for the schedule-time check. */
export function mergeTokensIn(content: MarketingContent): string[] {
  const names = new Set<string>()
  for (const match of JSON.stringify(content).matchAll(TOKEN)) names.add(match[1])
  return [...names].sort()
}

/**
 * The content with this recipient's values in place. Throws MergeError rather than sending a
 * half-merged email.
 */
export function mergeCampaignContent(content: MarketingContent, fields: RecipientMergeFields): MarketingContent {
  return mergeValue(content, resolveMergeValues(fields)) as MarketingContent
}

/**
 * Sample values for a test send and the preview, so staff see a filled-in voucher rather than
 * raw tokens. The number is the designer's sample, which is not a real ledger voucher.
 */
export const SAMPLE_MERGE_FIELDS: RecipientMergeFields = {
  first_name: 'Sarah',
  party_size: 4,
  voucher_number: 'AN-2611-0042',
  voucher_percent: 10,
  voucher_expires_on: '2026-12-11',
}
