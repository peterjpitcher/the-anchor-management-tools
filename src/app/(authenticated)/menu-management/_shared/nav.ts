import type { HeaderNavItem } from '@/ds'

/**
 * The Menu tab row. Pure module, safe to import from server and client components.
 *
 * Every Menu page passes this as `navItems` and keeps the one section title, "Menu", with the
 * tab named in the subtitle. The active tab comes from the path (longest matching prefix), so
 * /menu-management/dishes lights up Dishes rather than Overview. All four tabs need only
 * menu_management:view, the same as the section, so every tab shows to everyone who can open it.
 */
export const MENU_NAV: HeaderNavItem[] = [
  { label: 'Overview', href: '/menu-management' },
  { label: 'Dishes', href: '/menu-management/dishes' },
  { label: 'Recipes', href: '/menu-management/recipes' },
  { label: 'Ingredients', href: '/menu-management/ingredients' },
]

/** The one section title on every Menu tab. */
export const MENU_TITLE = 'Menu'
