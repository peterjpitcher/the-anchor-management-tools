/**
 * The short link behind an event's printed A4 poster QR code.
 *
 * A printed QR is permanent. Once a poster is on a wall the code cannot be
 * changed, so the destination behind that code has to be correct BEFORE the
 * poster is approved for print. This module is the gate that guarantees it.
 *
 * Two facts make the approach safe:
 *
 * 1. The short code is derived from the event's UUID, not its slug. See
 *    `buildShortCode` in `src/lib/event-marketing-links.ts`: it is the channel
 *    prefix plus the first six hex characters of the event id with the dashes
 *    stripped. A renamed event therefore keeps the same code, which is exactly
 *    why a wrong destination can be repaired IN PLACE without invalidating a
 *    single already-printed poster. Repair, not reissue, is the safe move.
 *
 * 2. The channel is `poster` (short code prefix `po`). It is NOT
 *    `toilet_poster` (`tp`) and NOT `partner_poster` (`pp`). Those are separate
 *    print surfaces with their own links and their own click attribution, and
 *    minting a code against one of them would put the wrong QR on the artwork.
 *    The table talker is a print surface of its own in exactly this sense: it
 *    goes through `resolvePrintLink` with `table_talker` (`tt`), never `poster`.
 *
 * Why validation is needed at all: `EventMarketingService.generateSingleLink`
 * is get-or-create, and when it finds an existing row it returns that row
 * WITHOUT the staleness check the bulk `generateLinks` path applies. An event
 * renamed after its link was minted therefore keeps a `destination_url`
 * pointing at the old slug, which is a 404 on the website. When this was
 * measured, production held 64 stale links out of 819 canonical event links,
 * two of them poster links. So we take the get-or-create result and then check
 * it ourselves, and correct it before anything is allowed to reach a printer.
 *
 * Scope: this repairs the poster link for the event being resolved and nothing
 * else. Repairing the rest of the stale estate is a separate, separately
 * authorised job.
 *
 * All writes use the admin client because `short_links` is service-role-write
 * only in production; the `authenticated` role holds SELECT alone.
 */

import { logAuditEvent } from '@/app/actions/audit'
import {
  EVENT_MARKETING_CHANNEL_MAP,
  buildEventMarketingLinkPayload,
  type EventMarketingChannelConfig,
  type EventMarketingLinkPayload,
} from '@/lib/event-marketing-links'
import type { PrintQrChannel } from '@/lib/events/imageVariants'
import { createAdminClient } from '@/lib/supabase/admin'
import { EventMarketingService, type EventMarketingLink } from '@/services/event-marketing'

/** The one channel a printed A4 poster QR may ever use. */
export const POSTER_LINK_CHANNEL: PrintQrChannel = 'poster'

/**
 * How each print surface is named in the sentences a manager reads. Typed
 * against the closed channel set, so a new surface cannot be added without its
 * wording. The poster's entry keeps every poster message word for word what it
 * was before table talkers existed.
 */
const SURFACE_NAMES: Record<PrintQrChannel, string> = {
  poster: 'poster',
  table_talker: 'table talker',
}

export type PosterLinkBlockReason =
  | 'no_slug'
  | 'event_cancelled'
  | 'event_unpublished'
  | 'link_unavailable'
  | 'repair_failed'

export interface PosterLinkResult {
  ok: true
  shortLinkId: string
  shortCode: string
  /** The URL the QR encodes. */
  shortUrl: string
  destinationUrl: string
  /** True when a stale destination was corrected on the way through. */
  wasRepaired: boolean
}

export interface PosterLinkBlocked {
  ok: false
  reason: PosterLinkBlockReason
  detail: string
}

interface PosterEventRow {
  id: string
  slug: string | null
  name: string
  date: string
  event_status: string | null
}

/**
 * Statuses that stop a poster dead. `postponed` and `rescheduled` are
 * deliberately absent: those events still have a live page worth pointing at.
 */
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled'])
const UNPUBLISHED_STATUSES = new Set(['draft'])

function printChannelConfig(channelKey: PrintQrChannel): EventMarketingChannelConfig {
  const config = EVENT_MARKETING_CHANNEL_MAP.get(channelKey)
  if (!config) {
    // A genuine programming error: every print channel is a fixed member of the
    // channel table, so a miss means that table has been edited wrongly.
    throw new Error(`Print marketing channel ${channelKey} is missing from EVENT_MARKETING_CHANNELS`)
  }
  return config
}

function blocked(reason: PosterLinkBlockReason, detail: string): PosterLinkBlocked {
  return { ok: false, reason, detail }
}

/**
 * Mirrors `needsUpdate` in `src/services/event-marketing.ts`, which is private
 * to that module, for the two dimensions a resolved link exposes.
 *
 * The other two dimensions `needsUpdate` covers, `metadata.event_id` and
 * `metadata.channel`, cannot be wrong here: `generateSingleLink` finds the row
 * by `metadata @> { event_id, channel }`, so any row it returns already matches
 * on both.
 */
function isLinkStale(link: EventMarketingLink, expected: EventMarketingLinkPayload): boolean {
  if (link.destinationUrl !== expected.destinationUrl) return true
  const existingUtm = link.utm || {}
  for (const [key, value] of Object.entries(expected.utm)) {
    if (existingUtm[key] !== value) return true
  }
  return false
}

/**
 * Mirrors `buildMetadata` in `src/services/event-marketing.ts`, also private to
 * that module. The bulk repair path replaces metadata wholesale, so this one
 * does too: writing a different shape here would leave the two repair paths
 * disagreeing about what a marketing link looks like.
 */
function buildPosterMetadata(
  event: PosterEventRow,
  payload: EventMarketingLinkPayload
): Record<string, unknown> {
  return {
    event_id: event.id,
    channel: payload.channel,
    label: payload.label,
    marketing_type: payload.type,
    utm: payload.utm,
    event_slug: event.slug,
    event_name: event.name,
    generated_at: new Date().toISOString(),
  }
}

async function recordRepair(
  event: PosterEventRow,
  link: EventMarketingLink,
  expected: EventMarketingLinkPayload,
  channelKey: PrintQrChannel
): Promise<void> {
  try {
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'short_link',
      resource_id: link.id,
      operation_status: 'success',
      old_values: { destination_url: link.destinationUrl, utm: link.utm },
      new_values: { destination_url: expected.destinationUrl, utm: expected.utm },
      additional_info: {
        // `poster_artwork_link_repair` for the poster, as it always was.
        reason: `${channelKey}_artwork_link_repair`,
        event_id: event.id,
        event_name: event.name,
        channel: channelKey,
        short_code: link.shortCode,
      },
    })
  } catch (error) {
    // The repair itself already succeeded and the link is now correct. Losing
    // the audit row must not block a poster, so log and carry on.
    console.error('Failed to audit print short link repair', channelKey, link.id, error)
  }
}

/**
 * Resolves the poster short link for an event. The poster case of
 * `resolvePrintLink`, kept under its own name because it is what the poster has
 * always called.
 */
export async function resolvePosterLink(eventId: string): Promise<PosterLinkResult | PosterLinkBlocked> {
  return resolvePrintLink(eventId, POSTER_LINK_CHANNEL)
}

/**
 * Resolves the short link behind a printed QR for one print surface, validates
 * where it points, and repairs it in place if the destination has gone stale.
 *
 * Everything the module header says about the poster holds for every surface:
 * the code derives from the event id and the surface's own channel prefix
 * (`po` for the poster, `tt` for the table talker), so a repair keeps every
 * already-printed code working.
 *
 * Returns a blocked result rather than throwing for every expected condition,
 * so the artwork editor can show a manager exactly why the artwork cannot be
 * approved yet.
 */
export async function resolvePrintLink(
  eventId: string,
  channelKey: PrintQrChannel
): Promise<PosterLinkResult | PosterLinkBlocked> {
  const channel = printChannelConfig(channelKey)
  const surface = SURFACE_NAMES[channelKey]
  const supabase = createAdminClient()

  const { data, error: eventError } = await supabase
    .from('events')
    .select('id, slug, name, date, event_status')
    .eq('id', eventId)
    .maybeSingle()

  if (eventError) {
    console.error('Failed to load event for print link', channelKey, eventId, eventError)
    return blocked(
      'link_unavailable',
      `Could not load this event, so the ${surface} QR destination cannot be checked. Try again in a moment.`
    )
  }

  if (!data) {
    return blocked(
      'link_unavailable',
      `Event ${eventId} was not found, so there is no ${surface} QR destination to check.`
    )
  }

  const event = data as PosterEventRow
  const status = (event.event_status || '').toLowerCase()

  if (CANCELLED_STATUSES.has(status)) {
    return blocked(
      'event_cancelled',
      `"${event.name}" is cancelled, so a ${surface} must not be printed for it.`
    )
  }

  if (UNPUBLISHED_STATUSES.has(status)) {
    return blocked(
      'event_unpublished',
      `"${event.name}" is still a draft, so its web page does not exist yet. Publish the event, then generate the ${surface} again.`
    )
  }

  if (!event.slug || event.slug.trim().length === 0) {
    return blocked(
      'no_slug',
      `"${event.name}" has no web address (slug), so the ${surface} QR would have nowhere to point. Add a slug to the event, then generate the ${surface} again.`
    )
  }

  // Get-or-create. Never hand-build a short link: the code has to come from the
  // same derivation the rest of the app uses, or an already-printed poster and
  // a freshly minted code would disagree.
  let link: EventMarketingLink
  try {
    link = await EventMarketingService.generateSingleLink(event.id, channelKey)
  } catch (error) {
    console.error('Failed to get or create the print short link', channelKey, event.id, error)
    return blocked(
      'link_unavailable',
      `Could not get the ${surface} short link for "${event.name}". Try again; if it keeps failing, regenerate this event's marketing links.`
    )
  }

  // Belt and braces on the channel. A poster carrying a `pp` (partner poster)
  // or `tp` (toilet poster) code, or a table talker carrying the poster's `po`,
  // would silently attribute its scans to another surface and could point at
  // another campaign, so refuse it rather than print it.
  if (link.channel !== channelKey || !link.shortCode.startsWith(channel.shortCodePrefix)) {
    console.error('Print short link resolved to the wrong channel', channelKey, event.id, link.channel, link.shortCode)
    return blocked(
      'link_unavailable',
      `The short link returned for "${event.name}" is not a ${surface} link, so it must not go on printed artwork.`
    )
  }

  const expected = buildEventMarketingLinkPayload(
    { id: event.id, slug: event.slug, name: event.name, date: event.date },
    channel
  )

  if (!isLinkStale(link, expected)) {
    return {
      ok: true,
      shortLinkId: link.id,
      shortCode: link.shortCode,
      shortUrl: link.shortUrl,
      destinationUrl: link.destinationUrl,
      wasRepaired: false,
    }
  }

  // Repair in place. `short_code` is deliberately not in the update: the code
  // is what the printed artwork carries, and it must survive the correction.
  const { data: updated, error: updateError } = await supabase
    .from('short_links')
    .update({
      destination_url: expected.destinationUrl,
      metadata: buildPosterMetadata(event, expected),
      name: `Event: ${event.name} – ${channel.label}`,
      updated_at: new Date().toISOString(),
    })
    .eq('id', link.id)
    .select('id, short_code, destination_url')
    .maybeSingle()

  if (updateError || !updated) {
    // Returning the stale link as ok is the exact production failure this
    // module exists to prevent, so block instead.
    console.error('Failed to repair the print short link destination', channelKey, link.id, updateError)
    return blocked(
      'repair_failed',
      `The ${surface} QR for "${event.name}" points at the wrong page and the correction could not be saved, so the ${surface} cannot be approved. Try again.`
    )
  }

  if (updated.short_code !== link.shortCode) {
    // Impossible unless something else rewrote the row mid-repair. A changed
    // code means every printed poster carrying the old one is now orphaned, so
    // treat it as a failure rather than quietly returning a different QR.
    console.error('Print short code changed during repair', channelKey, link.id, link.shortCode, updated.short_code)
    return blocked(
      'repair_failed',
      `The ${surface} short link for "${event.name}" changed while it was being corrected, so the ${surface} cannot be approved. Try again.`
    )
  }

  await recordRepair(event, link, expected, channelKey)

  return {
    ok: true,
    shortLinkId: updated.id,
    shortCode: updated.short_code,
    shortUrl: link.shortUrl,
    destinationUrl: updated.destination_url,
    wasRepaired: true,
  }
}
