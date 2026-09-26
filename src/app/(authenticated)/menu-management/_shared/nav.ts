import type { HeaderNavItem } from '@/ds'

/**
 * The Menu tab row. Pure module, safe to import from server and client components.
 *
 * Every Menu page passes this as `navItems` and is titled with the sidebar label, "Menu
 * Management", with the tab named in the subtitle. The active tab comes from the path (longest
 * matching prefix), so /menu-management/dishes lights up Dishes rather than Overview. All four
 * tabs need only menu_management:view, the same as the section, so every tab shows to everyone
 * who can open it.
 */
export const MENU_NAV: HeaderNavItem[] = [
  { label: 'Overview', href: '/menu-management' },
  { label: 'Dishes', href: '/menu-management/dishes' },
  { label: 'Recipes', href: '/menu-management/recipes' },
  { label: 'Ingredients', href: '/menu-management/ingredients' },
]

/** The one title on every Menu tab: the sidebar label that owns the tab row. */
export const MENU_TITLE = 'Menu Management'
