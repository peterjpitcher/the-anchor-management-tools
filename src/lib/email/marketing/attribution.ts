import { createAdminClient } from '@/lib/supabase/admin'

/**
 * First-party engagement and conversion reads for marketing email.
 *
 * Nothing in here asks the email provider anything, and that is the point rather than a
 * limitation. Resend reports THAT a recipient opened or clicked; these two signals report
 * WHICH call to action they clicked and whether it turned into a booking:
 *
 *   1. Clicks, from `short_link_clicks` on links we minted for the campaign. The renderer
 *      appends `utm_content=<marketing_campaign_recipients.id>` to each short URL, so a click
 *      row names one individual recipient and one specific destination.
 *   2. Conversions, from `analytics_events`, which the brand website populates with the UTM
 *      parameters that were still on the URL when the booking was made. The same
 *      `utm_content` value survives the redirect, so a booking traces back to the same person.
 *
 * The two sources will not agree exactly and should not be reconciled. The provider counts a
 * click on any link including the unsubscribe footer; we count clicks that reached a shortened
 * destination. Presented side by side and labelled, that difference is informative.
 *
 * These helpers take the admin client as an argument rather than creating their own, so the
 * services stay the only place a client is minted and this module stays easy to reason about.
 */

export type MarketingAdminClient = ReturnType<typeof createAdminClient>

/** Supabase caps a single response, so anything unbounded is read in pages. */
const FETCH_PAGE_SIZE = 1000

/** A runaway query is a bug, not a big list. Stop rather than exhaust memory. */
const FETCH_ROW_CAP = 100_000

/** PostgREST `in` filters go into the URL, so long lists are chunked. */
const IN_CHUNK_SIZE = 200

interface PagedResult<T> {
  data: T[] | null
  error: { message: string; code?: string } | null
}

async function fetchAllPages<T>(
  run: (from: number, to: number) => PromiseLike<PagedResult<T>>,
): Promise<T[]> {
  const out: T[] = []

  for (let from = 0; from < FETCH_ROW_CAP; from += FETCH_PAGE_SIZE) {
    const { data, error } = await run(from, from + FETCH_PAGE_SIZE - 1)
    // The Postgres error code is carried through rather than dropped, because one caller
    // needs to tell a missing table apart from a genuine query failure.
    if (error) throw Object.assign(new Error(error.message), { code: error.code })

    const batch = data ?? []
    out.push(...batch)
    if (batch.length < FETCH_PAGE_SIZE) return out
  }

  return out
}

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

// ---------------------------------------------------------------------------
// Clicks
// ---------------------------------------------------------------------------

export interface MarketingClickRow {
  short_link_id: string | null
  utm_content: string | null
  clicked_at: string | null
  device_type: string | null
}

/**
 * Only 'bot' is excluded, and an unclassified click still counts.
 *
 * The user-agent parser labels what it recognises. A null device type is a real visit we
 * failed to classify, and dropping it would understate a campaign for no better reason than a
 * gap in a lookup table. This matches `isHumanClick` in the short-links service, so the two
 * places clicks are counted agree.
 */
export function isHumanClick(deviceType: string | null | undefined): boolean {
  return deviceType !== 'bot'
}

/**
 * Every short link this campaign points at.
 *
 * Matched on `metadata` rather than on `link_type`, because the metadata carries the campaign
 * id and is what makes a link this campaign's rather than another campaign's. `contains` maps
 * to the jsonb `@>` operator, which a GIN index can serve.
 */
export async function fetchCampaignLinks(
  supabase: MarketingAdminClient,
  campaignId: string,
): Promise<MarketingCampaignLinkRow[]> {
  const { data, error } = await supabase
    .from('short_links')
    .select('id, short_code, destination_url, metadata')
    .contains('metadata', { channel: 'marketing_email', campaign_id: campaignId })

  if (error) throw new Error(error.message)
  return (data ?? []) as MarketingCampaignLinkRow[]
}

export interface MarketingCampaignLinkRow {
  id: string
  short_code: string
  destination_url: string | null
  metadata: Record<string, unknown> | null
}

/** Clicks on the given short links, bots included. Callers filter, so counts stay explicit. */
export async function fetchClicksForLinks(
  supabase: MarketingAdminClient,
  linkIds: string[],
): Promise<MarketingClickRow[]> {
  if (linkIds.length === 0) return []

  const out: MarketingClickRow[] = []
  for (const part of chunk(linkIds, IN_CHUNK_SIZE)) {
    const rows = await fetchAllPages<MarketingClickRow>((from, to) =>
      supabase
        .from('short_link_clicks')
        .select('short_link_id, utm_content, clicked_at, device_type')
        .in('short_link_id', part)
        // Paging without an order is undefined, and a repeated or skipped row would silently
        // change a count. Ordering by the primary key is stable and free.
        .order('id', { ascending: true })
        .range(from, to),
    )
    out.push(...rows)
  }

  return out
}

/**
 * Clicks belonging to specific recipients, wherever they landed.
 *
 * Keyed on `utm_content` alone rather than also on the campaign's links, because a recipient
 * id is unique across the whole system. That also means a forwarded email still credits the
 * person we sent it to, which is the honest answer: they are the reason the click happened.
 */
export async function fetchClicksByRecipientIds(
  supabase: MarketingAdminClient,
  recipientIds: string[],
): Promise<MarketingClickRow[]> {
  if (recipientIds.length === 0) return []

  const out: MarketingClickRow[] = []
  for (const part of chunk(recipientIds, IN_CHUNK_SIZE)) {
    const rows = await fetchAllPages<MarketingClickRow>((from, to) =>
      supabase
        .from('short_link_clicks')
        .select('short_link_id, utm_content, clicked_at, device_type')
        .in('utm_content', part)
        .order('id', { ascending: true })
        .range(from, to),
    )
    out.push(...rows)
  }

  return out
}

export interface RecipientClickSummary {
  clickCount: number
  lastClickedAt: string | null
}

/** Human clicks per recipient id, with the most recent one. */
export function summariseClicksByRecipient(
  rows: MarketingClickRow[],
): Map<string, RecipientClickSummary> {
  const byRecipient = new Map<string, RecipientClickSummary>()

  for (const row of rows) {
    if (!row.utm_content || !isHumanClick(row.device_type)) continue

    const current = byRecipient.get(row.utm_content) ?? { clickCount: 0, lastClickedAt: null }
    current.clickCount += 1
    if (row.clicked_at && (!current.lastClickedAt || row.clicked_at > current.lastClickedAt)) {
      current.lastClickedAt = row.clicked_at
    }
    byRecipient.set(row.utm_content, current)
  }

  return byRecipient
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

/**
 * Keys an analytics event might carry money under, in the order we trust them.
 *
 * Today's booking events carry none of these, so `conversionValue` is null in practice. The
 * lookup is here so that the day one of them does start carrying an amount, the figure appears
 * without a schema hunt, and until then we report "not recorded" rather than a fabricated zero.
 */
const CONVERSION_VALUE_KEYS = ['value', 'amount', 'total_amount', 'deposit_amount'] as const

function readConversionValue(metadata: Record<string, unknown> | null): number | null {
  if (!metadata) return null

  for (const key of CONVERSION_VALUE_KEYS) {
    const raw = metadata[key]
    const parsed =
      typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN
    if (Number.isFinite(parsed)) return parsed
  }

  return null
}

/** Postgres `undefined_table`. */
const UNDEFINED_TABLE = '42P01'

/**
 * Enquiry reporting must never take a campaign page down with it.
 *
 * `marketing_conversions` is newer than the code that reads it, so on any environment where
 * that migration has not been applied yet the table is simply absent. A missing table means
 * one missing metric, not a broken campaign, so it degrades to zero enquiries and the rest of
 * the page still renders. Every other error is real and is still thrown.
 */
function zeroWhenTableMissing(error: unknown): ConversionSummary {
  if ((error as { code?: string } | null)?.code === UNDEFINED_TABLE) {
    return { count: 0, value: null, lastAt: null }
  }
  throw error
}

export interface ConversionSummary {
  count: number
  /** Null when not one matching event carried an amount. Null means unknown, not zero. */
  value: number | null
  lastAt: string | null
}

interface ConversionRow {
  created_at: string | null
  metadata: Record<string, unknown> | null
}

function summariseConversions(rows: ConversionRow[]): ConversionSummary {
  let count = 0
  let value = 0
  let sawValue = false
  let lastAt: string | null = null

  for (const row of rows) {
    count += 1

    const amount = readConversionValue(row.metadata)
    if (amount !== null) {
      value += amount
      sawValue = true
    }

    if (row.created_at && (!lastAt || row.created_at > lastAt)) lastAt = row.created_at
  }

  return {
    count,
    // Rounded to pennies because summing floats produces the classic 0.30000000000000004.
    value: sawValue ? Math.round(value * 100) / 100 : null,
    lastAt,
  }
}

/**
 * Bookings attributed to a campaign.
 *
 * Matched on the UTM campaign value the renderer actually stamped on every link, which is the
 * campaign's `utm_campaign` when someone typed one and the campaign id otherwise. Reporting has
 * to use the same fallback the renderer uses, or a campaign nobody named would report zero
 * conversions while cheerfully producing them.
 */
export async function fetchConversionsByUtmCampaign(
  supabase: MarketingAdminClient,
  utmCampaign: string,
): Promise<ConversionSummary> {
  const rows = await fetchAllPages<ConversionRow>((from, to) =>
    supabase
      .from('analytics_events')
      .select('created_at, metadata')
      .eq('metadata->>utm_campaign', utmCampaign)
      .order('id', { ascending: true })
      .range(from, to),
  )

  return summariseConversions(rows)
}

/**
 * Enquiries attributed to a campaign.
 *
 * Bookings and enquiries are counted separately and never summed into one figure by this
 * module. They are different things: a booking is money on the diary, an enquiry is a
 * business asking a question. A campaign whose call to action is the Christmas enquiry form
 * would otherwise report zero, because an enquiry never produces an `analytics_events` row
 * (that table requires a customer, and an enquirer is not one yet).
 *
 * `marketing_conversions` carries no amount, so the value here is always null. Deliberate:
 * inventing a value for an enquiry would put an unearned number next to real booking money.
 */
export async function fetchEnquiryConversionsByUtmCampaign(
  supabase: MarketingAdminClient,
  utmCampaign: string,
): Promise<ConversionSummary> {
  let rows: Array<{ occurred_at: string | null }>
  try {
    rows = await fetchAllPages<{ occurred_at: string | null }>((from, to) =>
      supabase
        .from('marketing_conversions')
        .select('occurred_at')
        .eq('utm_campaign', utmCampaign)
        .order('id', { ascending: true })
        .range(from, to),
    )
  } catch (error) {
    return zeroWhenTableMissing(error)
  }

  let lastAt: string | null = null
  for (const row of rows) {
    if (row.occurred_at && (!lastAt || row.occurred_at > lastAt)) lastAt = row.occurred_at
  }

  return { count: rows.length, value: null, lastAt }
}

/** Bookings attributed to specific recipients, through the `utm_content` they carried. */
export async function fetchConversionsByRecipientIds(
  supabase: MarketingAdminClient,
  recipientIds: string[],
): Promise<ConversionSummary> {
  if (recipientIds.length === 0) return { count: 0, value: null, lastAt: null }

  const rows: ConversionRow[] = []
  for (const part of chunk(recipientIds, IN_CHUNK_SIZE)) {
    const batch = await fetchAllPages<ConversionRow>((from, to) =>
      supabase
        .from('analytics_events')
        .select('created_at, metadata')
        .in('metadata->>utm_content', part)
        .order('id', { ascending: true })
        .range(from, to),
    )
    rows.push(...batch)
  }

  return summariseConversions(rows)
}

/**
 * Enquiries attributed to specific recipients.
 *
 * Matched on `recipient_id`, which the write path resolves from `utm_content` at the moment
 * the enquiry lands. Counted separately from bookings for the same reason as above: an enquiry
 * is a business asking a question, not money on the diary, and adding the two together would
 * flatter a campaign that has produced no revenue at all.
 */
export async function fetchEnquiryConversionsByRecipientIds(
  supabase: MarketingAdminClient,
  recipientIds: string[],
): Promise<ConversionSummary> {
  if (recipientIds.length === 0) return { count: 0, value: null, lastAt: null }

  const rows: Array<{ occurred_at: string | null }> = []
  try {
    for (const part of chunk(recipientIds, IN_CHUNK_SIZE)) {
      const batch = await fetchAllPages<{ occurred_at: string | null }>((from, to) =>
        supabase
          .from('marketing_conversions')
          .select('occurred_at')
          .in('recipient_id', part)
          .order('id', { ascending: true })
          .range(from, to),
      )
      rows.push(...batch)
    }
  } catch (error) {
    return zeroWhenTableMissing(error)
  }

  let lastAt: string | null = null
  for (const row of rows) {
    if (row.occurred_at && (!lastAt || row.occurred_at > lastAt)) lastAt = row.occurred_at
  }

  return { count: rows.length, value: null, lastAt }
}
