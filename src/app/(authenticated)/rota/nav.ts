type RotaNavItem = {
  label: string;
  href: string;
  badge?: string | number;
};

/**
 * The permission each page actually enforces. `rota:view` gets you into the
 * section, but Leave, Timeclock and Payroll each redirect to `/` without their
 * own permission, so showing those tabs to somebody who cannot open them is a
 * dead end rather than navigation.
 */
type RotaNavRequirement = 'leave' | 'timeclock' | 'payroll' | 'settings';

type RotaNavEntry = RotaNavItem & { requires?: RotaNavRequirement };

/**
 * Permission flags the caller has already resolved. Absent is not the same as
 * false:
 *
 * - `canViewLeave`, `canViewTimeclock` and `canViewPayroll` left out mean "not
 *   checked", and the tab stays visible. That is the behaviour before filtering
 *   existed, so a page that has not been given the flags yet does not silently
 *   lose half its navigation.
 * - `canManageSettings` left out means hidden. Rota Settings sits outside the
 *   section and is only worth advertising to somebody who can actually open it.
 */
export type RotaNavPermissions = {
  canViewLeave?: boolean;
  canViewTimeclock?: boolean;
  canViewPayroll?: boolean;
  canManageSettings?: boolean;
};

export type RotaNavOptions = RotaNavPermissions & {
  /**
   * Weeks inside the publishing horizon with shifts staff cannot see yet. Badges
   * the Rota tab so an unpublished week is visible from anywhere in the section,
   * not only from the week that happens to be on screen.
   */
  weeksNeedingPublishing?: number;
};

const ROTA_NAV_ENTRIES: RotaNavEntry[] = [
  { label: 'Rota', href: '/rota' },
  { label: 'Reassign', href: '/rota/reassign' },
  { label: 'Hours by employee', href: '/rota/hours' },
  { label: 'Leave', href: '/rota/leave', requires: 'leave' },
  { label: 'Timeclock', href: '/rota/timeclock', requires: 'timeclock' },
  { label: 'Labour Costs', href: '/rota/dashboard' },
  { label: 'Payroll', href: '/rota/payroll', requires: 'payroll' },
  { label: 'Shift templates', href: '/rota/templates' },
  { label: 'Rota settings', href: '/settings/rota', requires: 'settings' },
];

function isVisible(entry: RotaNavEntry, permissions: RotaNavPermissions): boolean {
  switch (entry.requires) {
    case 'leave':
      return permissions.canViewLeave !== false;
    case 'timeclock':
      return permissions.canViewTimeclock !== false;
    case 'payroll':
      return permissions.canViewPayroll !== false;
    case 'settings':
      return permissions.canManageSettings === true;
    default:
      return true;
  }
}

/**
 * Section navigation, filtered to the pages this user can open and badged with
 * the work waiting on them. A zero count leaves the badge off entirely, so a
 * pill only ever means "there is something here to clear".
 *
 * `reassignCount` stays the first argument so existing callers keep working; the
 * permissions and the publishing count are optional extras.
 */
export function buildRotaNavItems(reassignCount: number, options: RotaNavOptions = {}): RotaNavItem[] {
  const weeksNeedingPublishing = options.weeksNeedingPublishing ?? 0;

  return ROTA_NAV_ENTRIES
    .filter(entry => isVisible(entry, options))
    .map(({ requires: _requires, ...item }) => {
      if (item.href === '/rota/reassign' && reassignCount > 0) return { ...item, badge: reassignCount };
      if (item.href === '/rota' && weeksNeedingPublishing > 0) return { ...item, badge: weeksNeedingPublishing };
      return item;
    });
}

/**
 * The unbadged, unfiltered list, for pages that have not resolved the caller's
 * permissions. Prefer `buildRotaNavItems` with the flags the page already has.
 */
export const rotaNavItems: RotaNavItem[] = buildRotaNavItems(0);
