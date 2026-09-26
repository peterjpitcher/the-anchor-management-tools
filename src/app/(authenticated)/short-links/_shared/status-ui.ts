/**
 * The Short Links status maps. Pure module, safe to import from server and client components.
 * Each status has one map, used everywhere it shows (docs/standards/UI_UX.md, "Status").
 */

export type ShortLinkBadgeTone = 'neutral' | 'info' | 'success'

/** A link row's type badge: a UTM variant is quiet, a link in its own right stands out. */
export const SHORT_LINK_KIND_TONE: Record<'link' | 'variant', ShortLinkBadgeTone> = {
  link: 'info',
  variant: 'neutral',
}

/** Who answered the legacy-link retirement page: a staff check, or a customer. */
export const LEGACY_REPORTER_TONE: Record<'staff' | 'customer', ShortLinkBadgeTone> = {
  staff: 'info',
  customer: 'success',
}
