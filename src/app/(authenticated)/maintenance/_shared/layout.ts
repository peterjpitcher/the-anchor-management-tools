/**
 * Header props every maintenance item page shares, in each of its states: the back button to
 * the list. Plain data, so the server page and the client item can both import it.
 */
export const MAINTENANCE_ITEM_LAYOUT = {
  backButton: { label: 'Back to Maintenance', href: '/maintenance' },
} as const
