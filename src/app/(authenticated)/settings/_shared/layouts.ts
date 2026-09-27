/**
 * Page headers shared by a server page (its error state) and the client page it renders (its
 * loaded state), so the title never changes between states. Plain data, no 'use client', so a
 * server page can import it.
 */

export const BACK_TO_SETTINGS = { label: 'Back to Settings', href: '/settings' } as const

export const CUSTOMER_LABELS_LAYOUT = {
  title: 'Customer Labels',
  subtitle: 'Organise customers with labels for better targeting and management',
  backButton: BACK_TO_SETTINGS,
} as const
