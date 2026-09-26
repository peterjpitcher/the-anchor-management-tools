import type { IconName } from '@/ds/icons'
import type { MenuPurchaseDepartment } from '@/lib/menu/purchase-departments'

/**
 * How menu states look on staff screens: the DS Badge tone, the words and, where a table tints a
 * whole row, the row class. Pure module, safe to import from server and client components.
 *
 * Each state has one entry here and every Menu page reads it, so an inactive dish, a special
 * placement or a dish below its GP target looks the same on the Overview, Dishes, Recipes and
 * Ingredients tabs and in the drawers. Whole class strings only, so Tailwind can see every class.
 */

export type MenuBadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

/* ------------------------------------------------------------------ */
/*  Active or inactive: dishes, recipes, ingredients                  */
/* ------------------------------------------------------------------ */

export function menuActiveTone(isActive: boolean): MenuBadgeTone {
  return isActive ? 'success' : 'neutral'
}

export function menuActiveLabel(isActive: boolean): string {
  return isActive ? 'Active' : 'Inactive'
}

/* ------------------------------------------------------------------ */
/*  A dish's placement on a menu                                      */
/* ------------------------------------------------------------------ */

/** A special placement stands out; an ordinary one is quiet. */
export function menuAssignmentTone(isSpecial: boolean): MenuBadgeTone {
  return isSpecial ? 'warning' : 'neutral'
}

/* ------------------------------------------------------------------ */
/*  Purchase department                                               */
/* ------------------------------------------------------------------ */

const PURCHASE_DEPARTMENT_TONES = new Map<string, MenuBadgeTone>([
  ['kitchen', 'neutral'],
  // Bar purchases are the ones staff look for among mostly kitchen stock.
  ['bar', 'primary'],
  ['other', 'neutral'],
])

export function purchaseDepartmentTone(department: MenuPurchaseDepartment | string): MenuBadgeTone {
  return PURCHASE_DEPARTMENT_TONES.get(department) ?? 'neutral'
}

/* ------------------------------------------------------------------ */
/*  GP% against the target                                            */
/* ------------------------------------------------------------------ */

/**
 * An average GP badge: at or above target is green, within five points of it amber, further
 * below red, and no figure at all is neutral.
 */
export function menuGpTone(gp: number | null, target: number): MenuBadgeTone {
  if (gp === null) return 'neutral'
  if (gp >= target) return 'success'
  if (gp >= target - 0.05) return 'warning'
  return 'danger'
}

export type GpTargetState = 'below' | 'ok'

interface GpTargetUi {
  label: string
  /** The figure itself, as text. */
  text: string
  /** A table row for a line below target is tinted; an ok row is not. */
  row: string
  icon: IconName
  /** The icon beside the figure (a base status colour: icons, never text). */
  iconClass: string
}

export const GP_TARGET_UI: Record<GpTargetState, GpTargetUi> = {
  below: {
    label: 'Below target',
    text: 'text-danger-fg',
    // The hover keeps the tint: the DS table row otherwise greys every row on hover.
    row: 'bg-danger-soft hover:bg-danger-soft',
    icon: 'alertTriangle',
    iconClass: 'text-danger',
  },
  ok: {
    label: 'OK',
    text: 'text-success-fg',
    row: '',
    icon: 'checkCircle',
    iconClass: 'text-success',
  },
}

export function gpTargetState(belowTarget: boolean): GpTargetState {
  return belowTarget ? 'below' : 'ok'
}

/* ------------------------------------------------------------------ */
/*  Costing status (Menu Health)                                      */
/* ------------------------------------------------------------------ */

export type DishCostingStatus = 'alert' | 'missing' | 'ok'

export const DISH_COSTING_STATUS_UI: Record<DishCostingStatus, { tone: MenuBadgeTone; label: string }> = {
  alert: { tone: 'danger', label: 'Alert' },
  missing: { tone: 'warning', label: 'No cost' },
  ok: { tone: 'success', label: 'OK' },
}

export type MenuStatTone = 'success' | 'warning' | 'danger'

const DISH_COSTING_COUNT_TONE: Record<Exclude<DishCostingStatus, 'ok'>, MenuStatTone> = {
  alert: 'danger',
  missing: 'warning',
}

/**
 * The colour of a "Below GP Target" or "Missing Costing" figure (a DS Stat `tone`) on the
 * Overview and Dishes tabs: any dish in that state is bad news in its badge colour (red below
 * target, amber missing costing), and none at all is green.
 */
export function dishCostingCountTone(status: Exclude<DishCostingStatus, 'ok'>, count: number): MenuStatTone {
  return count > 0 ? DISH_COSTING_COUNT_TONE[status] : 'success'
}

/* ------------------------------------------------------------------ */
/*  Allergen removability (GP analysis)                               */
/* ------------------------------------------------------------------ */

/** An allergen that cannot be removed from the dish tints its row amber, on hover too. */
export function allergenRemovableRowClass(removable: boolean): string {
  return removable ? '' : 'bg-warning-soft hover:bg-warning-soft'
}

/* ------------------------------------------------------------------ */
/*  Allergen and dietary tags, allergen verification                  */
/* ------------------------------------------------------------------ */

/** An allergen tag on a dish is amber: something to check before serving. */
export const MENU_ALLERGEN_TONE: MenuBadgeTone = 'warning'

/** A dietary tag (vegetarian, vegan, gluten free, halal) is green: something the dish suits. */
export const MENU_DIETARY_TONE: MenuBadgeTone = 'success'

/**
 * A dish whose allergens a manager has checked shows a green badge. One not yet checked shows a
 * "Verify Allergens" button carrying an amber icon (a base colour: icons, never text).
 */
export const ALLERGEN_VERIFICATION_UI: {
  verified: { tone: MenuBadgeTone }
  unverified: { iconClass: string }
} = {
  verified: { tone: 'success' },
  unverified: { iconClass: 'text-warning' },
}

/* ------------------------------------------------------------------ */
/*  Inclusion types and option groups (dish composition)              */
/* ------------------------------------------------------------------ */

/**
 * The left edge of a composition row. Removable is a dashed grey edge, an upgrade is amber, and a
 * choice takes its option group's category colour (optionGroupStyle below). Included has none.
 */
const INCLUSION_TYPE_BORDERS = new Map<string, string>([
  ['removable', 'border-l-4 border-dashed border-l-border-strong'],
  ['upgrade', 'border-l-4 border-l-warning'],
])

export function inclusionTypeBorder(inclusionType: string): string {
  return INCLUSION_TYPE_BORDERS.get(inclusionType) ?? ''
}

/** The badge on a composition row: removable is quiet, an upgrade is amber like its edge. */
const INCLUSION_TYPE_TONES = new Map<string, MenuBadgeTone>([
  ['removable', 'neutral'],
  ['upgrade', 'warning'],
])

export function inclusionTypeTone(inclusionType: string): MenuBadgeTone {
  return INCLUSION_TYPE_TONES.get(inclusionType) ?? 'neutral'
}

/** Upgrade lines in the cost breakdown, as text: the same amber as an upgrade row's edge. */
export const UPGRADE_TEXT = 'text-warning-fg'

/**
 * Option groups are categories with no status meaning, so they take the cat-* tokens. Two are
 * left out on purpose: cat-6 is the same amber as the warning tokens the upgrade state uses (an
 * amber group used to look exactly like an upgrade row), and cat-8 is the stone grey that reads
 * as the neutral "removable" state. The pill classes go on a DS Badge (which has no category
 * tones), in the same soft, -fg and /20 border shades as the booking status map's categories.
 */
const OPTION_GROUP_STYLES = [
  { border: 'border-l-4 border-l-cat-1', pill: 'border-cat-1/20 bg-cat-1-soft text-cat-1-fg' },
  { border: 'border-l-4 border-l-cat-2', pill: 'border-cat-2/20 bg-cat-2-soft text-cat-2-fg' },
  { border: 'border-l-4 border-l-cat-3', pill: 'border-cat-3/20 bg-cat-3-soft text-cat-3-fg' },
  { border: 'border-l-4 border-l-cat-4', pill: 'border-cat-4/20 bg-cat-4-soft text-cat-4-fg' },
  { border: 'border-l-4 border-l-cat-5', pill: 'border-cat-5/20 bg-cat-5-soft text-cat-5-fg' },
  { border: 'border-l-4 border-l-cat-7', pill: 'border-cat-7/20 bg-cat-7-soft text-cat-7-fg' },
] as const

export type OptionGroupStyle = (typeof OPTION_GROUP_STYLES)[number]

/** The same group name always gets the same colour. */
export function optionGroupStyle(group: string): OptionGroupStyle {
  let hash = 0
  for (let i = 0; i < group.length; i++) hash = group.charCodeAt(i) + ((hash << 5) - hash)
  return OPTION_GROUP_STYLES[Math.abs(hash) % OPTION_GROUP_STYLES.length]
}
