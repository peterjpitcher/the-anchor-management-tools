/**
 * Short-link variants: copies of a link that differ only by `utm_content`, one per paid ad
 * (`meta_ads`) or one per organic Facebook post (`facebook_post`, CheersAI's per-post links).
 * A variant carries `utm_variant: true` in its metadata, and anything that looks up an event's
 * own link for a channel must skip it, or a per-ad or per-post link could stand in for the event's
 * link and be repointed or handed out in its place.
 */

/** What a utm_content variant is for: a paid ad, or one organic Facebook post. */
export type ShortLinkVariantChannel = 'meta_ads' | 'facebook_post'

/** Whether a short link is a utm_content variant of another, rather than an event's own link. */
export function isShortLinkVariant(link: { metadata?: Record<string, unknown> | null } | null | undefined): boolean {
  return link?.metadata?.utm_variant === true
}
