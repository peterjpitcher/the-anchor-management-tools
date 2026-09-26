import type { HeaderNavItem } from '@/ds'

/**
 * The private bookings tab rows. Pure module, safe to import from server and client components.
 *
 * - PB_NAV: the section's top-level pages (list, calendar, SMS queue, reports, settings).
 * - PB_SETTINGS_NAV: the settings sub-area, which also carries "Back to Private Bookings"
 *   (privateBookingSettingsNav drops the tabs a person cannot open).
 * - PB_DETAIL_NAV(bookingId): the tabs of one booking. The contract is a PDF that leaves the
 *   app, so it is a header action on the booking ("Open Contract"), not a tab.
 */

const SMS_QUEUE_HREF = '/private-bookings/sms-queue'
const REPORTS_HREF = '/private-bookings/reports'

export const PB_NAV: HeaderNavItem[] = [
  { label: 'Bookings', href: '/private-bookings' },
  { label: 'Calendar', href: '/private-bookings/calendar' },
  { label: 'SMS Queue', href: SMS_QUEUE_HREF },
  { label: 'Reports', href: REPORTS_HREF },
  { label: 'Settings', href: '/private-bookings/settings' },
]

/**
 * Permission flags the caller has already resolved. Left out means "not checked" and the tab
 * stays visible; false hides it. The SMS queue needs private_bookings view_sms_queue (or manage)
 * and the growth report needs reports view: without them those pages send you to
 * /unauthorized, so a tab would be a dead end rather than navigation.
 */
export type PrivateBookingsNavAccess = {
  canViewSmsQueue?: boolean
  canViewReports?: boolean
}

/** PB_NAV without the tabs this person cannot open. */
export function privateBookingsNav(access: PrivateBookingsNavAccess = {}): HeaderNavItem[] {
  return PB_NAV.filter((item) => {
    if (item.href === SMS_QUEUE_HREF) return access.canViewSmsQueue !== false
    if (item.href === REPORTS_HREF) return access.canViewReports !== false
    return true
  })
}

const SETTINGS_GENERAL_HREF = '/private-bookings/settings'
const SETTINGS_CATERING_HREF = '/private-bookings/settings/catering'
const SETTINGS_VENDORS_HREF = '/private-bookings/settings/vendors'
const SETTINGS_SPACES_HREF = '/private-bookings/settings/spaces'

export const PB_SETTINGS_NAV: HeaderNavItem[] = [
  { label: 'General', href: SETTINGS_GENERAL_HREF },
  { label: 'Catering', href: SETTINGS_CATERING_HREF },
  { label: 'Vendors', href: SETTINGS_VENDORS_HREF },
  { label: 'Spaces', href: SETTINGS_SPACES_HREF },
]

/** Every settings tab is titled with the sub-area's name; the subtitle names the tab. */
export const PB_SETTINGS_TITLE = 'Private Booking Settings'

/**
 * Which settings tabs this person can open, read from their private_bookings actions. General
 * needs view (or manage); Catering, Vendors and Spaces each need their manage action (or manage).
 * Each page sends you to /unauthorized without its action, so a tab would be a dead end. Every
 * settings page builds its tab row from this one function, so they all show the same tabs.
 */
export function privateBookingSettingsNav(actions: ReadonlySet<string>): HeaderNavItem[] {
  const canManage = actions.has('manage')
  return PB_SETTINGS_NAV.filter((item) => {
    if (item.href === SETTINGS_GENERAL_HREF) return canManage || actions.has('view')
    if (item.href === SETTINGS_CATERING_HREF) return canManage || actions.has('manage_catering')
    if (item.href === SETTINGS_VENDORS_HREF) return canManage || actions.has('manage_vendors')
    if (item.href === SETTINGS_SPACES_HREF) return canManage || actions.has('manage_spaces')
    return true
  })
}

/** The back button on every page below the list: a booking and its tabs, new, and settings. */
export const PB_BACK_TO_LIST = { label: 'Back to Private Bookings', href: '/private-bookings' }

export function PB_DETAIL_NAV(bookingId: string): HeaderNavItem[] {
  const base = `/private-bookings/${bookingId}`
  return [
    { label: 'Overview', href: base },
    { label: 'Items', href: `${base}/items` },
    { label: 'Messages', href: `${base}/messages` },
    { label: 'Communications', href: `${base}/communications` },
  ]
}

/**
 * The booking's contract, opened in a new tab from the booking's header. It is the URL the old
 * Contract tab used; that page redirects to the contract API, so old links keep working too.
 */
export function privateBookingContractHref(bookingId: string): string {
  return `/private-bookings/${bookingId}/contract`
}
