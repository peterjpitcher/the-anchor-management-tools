import type { HeaderNavItem } from '@/ds'

/**
 * The Marketing tab row. Pure module, safe to import from server and client components.
 *
 * The three tab pages pass this as `navItems`; the active tab comes from the path (longest
 * matching prefix). A campaign's own pages (/marketing/campaigns/new and /<id>) are child
 * pages: they show the back button, not the tab row.
 */
export const MARKETING_NAV: HeaderNavItem[] = [
  { label: 'Campaigns', href: '/marketing' },
  { label: 'Contacts', href: '/marketing/contacts' },
  { label: 'Settings', href: '/marketing/settings' },
]

/** The back button on a campaign's own pages (new and detail): back to the Marketing list. */
export const MARKETING_BACK = { label: 'Back to Marketing', href: '/marketing' }

/** What each tab is for, shown as the subtitle under the section title. */
const MARKETING_SUBTITLES = {
  campaigns: 'Campaigns: email campaigns to guests and business contacts',
  contacts: 'Contacts: business contacts for email campaigns',
  settings: 'Settings: when and how campaign email goes out',
} as const

/**
 * The permissions the tab row depends on. Campaigns and Contacts need marketing:view, which
 * every Marketing page already checks; Settings needs marketing:manage, the permission its page
 * checks, so the tab only shows to someone it will open for.
 */
export interface MarketingNavPermissions {
  canManageSettings: boolean
}

/** The Marketing tab row for one user: the same tabs on every Marketing page. */
export function marketingNavItems({ canManageSettings }: MarketingNavPermissions): HeaderNavItem[] {
  return canManageSettings
    ? MARKETING_NAV
    : MARKETING_NAV.filter((item) => item.href !== '/marketing/settings')
}

/**
 * The page chrome a Marketing tab shares in every state (loading, error, loaded): the section
 * title, the tab's subtitle and the tab row. Server pages and their client components both
 * spread it, so the header does not change when an error replaces the page.
 */
export function marketingLayout(
  tab: keyof typeof MARKETING_SUBTITLES,
  permissions: MarketingNavPermissions,
): {
  title: string
  subtitle: string
  navItems: HeaderNavItem[]
} {
  return { title: 'Marketing', subtitle: MARKETING_SUBTITLES[tab], navItems: marketingNavItems(permissions) }
}
