import type { HeaderNavItem } from '@/ds'

/**
 * The Marketing tab row. Pure module, safe to import from server and client components.
 *
 * Every Marketing page passes this as `navItems`. The active tab comes from the path (longest
 * matching prefix), so a campaign's own pages (/marketing/campaigns/new and /<id>) light up
 * Campaigns, their parent tab, without a flag.
 */
export const MARKETING_NAV: HeaderNavItem[] = [
  { label: 'Campaigns', href: '/marketing' },
  { label: 'Contacts', href: '/marketing/contacts' },
  { label: 'Settings', href: '/marketing/settings' },
]

/** The back button on a campaign's own pages (new and detail). */
export const MARKETING_BACK_TO_CAMPAIGNS = { label: 'Back to Campaigns', href: '/marketing' }

/** What each tab is for, shown as the subtitle under the section title. */
const MARKETING_SUBTITLES = {
  campaigns: 'Email campaigns to guests and business contacts',
  contacts: 'Business contacts for email campaigns',
  settings: 'Settings for campaign email',
} as const

/**
 * The page chrome a Marketing tab shares in every state (loading, error, loaded): the section
 * title, the tab's subtitle and the tab row. Server pages and their client components both
 * spread it, so the header does not change when an error replaces the page.
 */
export function marketingLayout(tab: keyof typeof MARKETING_SUBTITLES): {
  title: string
  subtitle: string
  navItems: HeaderNavItem[]
} {
  return { title: 'Marketing', subtitle: MARKETING_SUBTITLES[tab], navItems: MARKETING_NAV }
}
