import { cache } from 'react';
import type { HeaderNavItem } from '@/ds';
import { checkUserPermission } from '@/app/actions/rbac';
import { getUnfilledShiftCount } from '@/app/actions/rota-reassign';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getIsoWeekday, getTodayIsoDate, shiftIsoDate } from '@/lib/dateUtils';
import type { PublishedShiftSnapshot, RotaPublishShift } from '@/lib/rota/publish-status';
import { readinessWeekFromRow, summariseRotaReadiness } from '@/lib/rota/week-readiness';

/**
 * The permission each tab's page actually enforces, so a tab only shows when it opens. Hours by
 * Employee needs both rota and timeclock access; Rota Settings lives under /settings and needs
 * settings:manage.
 */
type RotaNavRequirement = 'rota' | 'hours' | 'leave' | 'timeclock' | 'payroll' | 'settings';

type RotaNavEntry = { label: string; href: string; requires: RotaNavRequirement };

/**
 * Permission flags the caller has already resolved. `canManageSettings` left out means hidden
 * (Rota Settings is only worth advertising to somebody who can open it); every other flag left
 * out means "not checked" and keeps its tab. `getRotaNavItems` always passes every flag.
 */
export type RotaNavPermissions = {
  canViewRota?: boolean;
  canViewLeave?: boolean;
  canViewTimeclock?: boolean;
  canViewPayroll?: boolean;
  canManageSettings?: boolean;
};

export type RotaNavOptions = RotaNavPermissions & {
  /**
   * Weeks inside the publishing horizon with shifts staff cannot see yet. Badges the Rota tab so
   * an unpublished week is visible from anywhere in the section, not only from the week on screen.
   */
  weeksNeedingPublishing?: number;
};

const ROTA_NAV_ENTRIES: RotaNavEntry[] = [
  { label: 'Rota', href: '/rota', requires: 'rota' },
  { label: 'Reassign', href: '/rota/reassign', requires: 'rota' },
  { label: 'Hours by Employee', href: '/rota/hours', requires: 'hours' },
  { label: 'Leave', href: '/rota/leave', requires: 'leave' },
  { label: 'Timeclock', href: '/rota/timeclock', requires: 'timeclock' },
  { label: 'Labour Costs', href: '/rota/dashboard', requires: 'rota' },
  { label: 'Payroll', href: '/rota/payroll', requires: 'payroll' },
  { label: 'Shift Templates', href: '/rota/templates', requires: 'rota' },
  { label: 'Rota Settings', href: '/settings/rota', requires: 'settings' },
];

function isVisible(requires: RotaNavRequirement, permissions: RotaNavPermissions): boolean {
  switch (requires) {
    case 'rota':
      return permissions.canViewRota !== false;
    case 'hours':
      return permissions.canViewRota !== false && permissions.canViewTimeclock !== false;
    case 'leave':
      return permissions.canViewLeave !== false;
    case 'timeclock':
      return permissions.canViewTimeclock !== false;
    case 'payroll':
      return permissions.canViewPayroll !== false;
    case 'settings':
      return permissions.canManageSettings === true;
  }
}

/**
 * The rota tab row from flags and counts already in hand: filtered to the pages this user can
 * open and badged with the work waiting on them. A zero count leaves the badge off, so a pill
 * only ever means "there is something here to clear". Pure; pages call `getRotaNavItems`.
 */
export function buildRotaNavItems(reassignCount: number, options: RotaNavOptions = {}): HeaderNavItem[] {
  const weeksNeedingPublishing = options.weeksNeedingPublishing ?? 0;

  return ROTA_NAV_ENTRIES
    .filter(entry => isVisible(entry.requires, options))
    .map(({ label, href }): HeaderNavItem => {
      if (href === '/rota/reassign' && reassignCount > 0) return { label, href, badge: reassignCount };
      if (href === '/rota' && weeksNeedingPublishing > 0) return { label, href, badge: weeksNeedingPublishing };
      return { label, href };
    });
}

/* ------------------------------------------------------------------ */
/*  Publishing badge                                                  */
/* ------------------------------------------------------------------ */

/**
 * How far ahead publishing is judged for the Rota badge. Four weeks is the pub's planning
 * horizon: far enough to catch a week left in draft behind a week that has already gone out,
 * near enough that a rota nobody has started yet does not sit there as permanent noise.
 */
const READINESS_HORIZON_WEEKS = 4;

const READINESS_LIVE_SHIFT_COLUMNS =
  'id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name, reassignment_reason';

const READINESS_PUBLISHED_SHIFT_COLUMNS =
  'id, week_id, employee_id, shift_date, start_time, end_time, unpaid_break_minutes, department, status, notes, is_overnight, is_open_shift, name';

type ReadinessPublishedRow = PublishedShiftSnapshot & { week_id: string };

/** Monday of the week holding a YYYY-MM-DD date, in plain date arithmetic (never the host zone). */
function mondayOfWeek(isoDate: string): string {
  const weekday = getIsoWeekday(isoDate); // 1 = Monday, 7 = Sunday
  if (weekday === null) return isoDate;
  return shiftIsoDate(isoDate, 1 - weekday) ?? isoDate;
}

/**
 * Weeks inside the horizon carrying shifts staff cannot see yet. It diffs live shifts against the
 * published snapshot through the shared readiness model rather than trusting
 * `has_unpublished_changes`, which is written in a second unchecked call and is blind to a draft
 * or missing week.
 *
 * Only weeks with unseen or ghost shifts count, not every week that is not yet published: an
 * empty future week is not work anybody can clear, and the badge has to mean the same thing as
 * the Reassign one.
 */
async function countWeeksNeedingPublishing(firstWeekStart: string): Promise<number> {
  const admin = createAdminClient();
  const weekStarts = Array.from({ length: READINESS_HORIZON_WEEKS }, (_, index) =>
    shiftIsoDate(firstWeekStart, index * 7),
  ).filter((value): value is string => Boolean(value));
  if (weekStarts.length === 0) return 0;

  const lastWeekStart = weekStarts[weekStarts.length - 1];
  const horizonEnd = shiftIsoDate(lastWeekStart, 6) ?? lastWeekStart;

  const [weeksQuery, liveShiftsQuery] = await Promise.all([
    admin
      .from('rota_weeks')
      .select('id, week_start, status, published_at')
      .gte('week_start', weekStarts[0])
      .lte('week_start', lastWeekStart),
    admin
      .from('rota_shifts')
      .select(READINESS_LIVE_SHIFT_COLUMNS)
      .gte('shift_date', weekStarts[0])
      .lte('shift_date', horizonEnd),
  ]);

  // A badge is not a place to fail visibly, so a broken read shows nothing and says so in the
  // logs. The Sunday manager alert is what has to shout.
  if (weeksQuery.error || liveShiftsQuery.error) {
    console.error(
      '[rota] Could not work out which weeks still need publishing:',
      weeksQuery.error?.message ?? liveShiftsQuery.error?.message,
    );
    return 0;
  }

  const weekRows = (weeksQuery.data ?? []) as { id: string; week_start: string; status: string | null; published_at: string | null }[];
  const weekIds = weekRows.map(row => row.id);

  let publishedRows: ReadinessPublishedRow[] = [];
  if (weekIds.length > 0) {
    const publishedQuery = await admin
      .from('rota_published_shifts')
      .select(READINESS_PUBLISHED_SHIFT_COLUMNS)
      .in('week_id', weekIds);
    if (publishedQuery.error) {
      console.error('[rota] Could not read the published rota snapshot:', publishedQuery.error.message);
      return 0;
    }
    publishedRows = (publishedQuery.data ?? []) as ReadinessPublishedRow[];
  }

  const weekRowByStart = new Map(weekRows.map(row => [row.week_start, row]));
  const weekStartById = new Map(weekRows.map(row => [row.id, row.week_start]));

  const liveByWeek = new Map<string, RotaPublishShift[]>();
  ((liveShiftsQuery.data ?? []) as RotaPublishShift[]).forEach(shift => {
    const key = mondayOfWeek(shift.shift_date);
    const bucket = liveByWeek.get(key);
    if (bucket) bucket.push(shift);
    else liveByWeek.set(key, [shift]);
  });

  const publishedByWeek = new Map<string, PublishedShiftSnapshot[]>();
  publishedRows.forEach(({ week_id: weekId, ...snapshot }) => {
    const key = weekStartById.get(weekId);
    if (!key) return;
    const bucket = publishedByWeek.get(key);
    if (bucket) bucket.push(snapshot);
    else publishedByWeek.set(key, [snapshot]);
  });

  const summary = summariseRotaReadiness(
    weekStarts.map(startDate => ({
      week: readinessWeekFromRow(startDate, weekRowByStart.get(startDate) ?? null),
      liveShifts: liveByWeek.get(startDate) ?? [],
      publishedShifts: publishedByWeek.get(startDate) ?? [],
    })),
    READINESS_HORIZON_WEEKS,
  );

  return summary.byWeek.filter(readiness => readiness.unpublishedCount > 0 || readiness.removedCount > 0).length;
}

/** A badge count that never takes the page down: a failed count is no badge, logged. */
async function badgeCount(label: string, load: () => Promise<number>): Promise<number> {
  try {
    return await load();
  } catch (error) {
    console.error(`[rota] Could not load the ${label} badge:`, error instanceof Error ? error.message : error);
    return 0;
  }
}

/**
 * The rota tab row for the signed-in user, the same on every page in it (the eight rota pages and
 * /settings/rota): each tab filtered by the permission its page enforces, and both badges
 * (shifts still needing somebody on Reassign, weeks with unpublished shifts on Rota) on every
 * page. Both counts are section-wide, from today forwards, never from the week on screen.
 *
 * Call it once per page, alongside the page's own loads, and pass the result as `navItems`:
 *
 *   const [canView, navItems] = await Promise.all([checkUserPermission('rota', 'view'), getRotaNavItems()]);
 *   <PageLayout title="Rota" subtitle="..." navItems={navItems}>
 *
 * Wrapped in React `cache`, so calling it twice in one request costs one set of queries.
 */
export const getRotaNavItems = cache(async (): Promise<HeaderNavItem[]> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const [canViewRota, canViewLeave, canViewTimeclock, canViewPayroll, canManageSettings] = await Promise.all([
    checkUserPermission('rota', 'view', user.id),
    checkUserPermission('leave', 'view', user.id),
    checkUserPermission('timeclock', 'view', user.id),
    checkUserPermission('payroll', 'view', user.id),
    checkUserPermission('settings', 'manage', user.id),
  ]);

  // The badges sit on rota tabs, so somebody without rota access neither sees nor pays for them.
  const [reassignCount, weeksNeedingPublishing] = canViewRota
    ? await Promise.all([
        badgeCount('Reassign', getUnfilledShiftCount),
        badgeCount('publishing', () => countWeeksNeedingPublishing(mondayOfWeek(getTodayIsoDate()))),
      ])
    : [0, 0];

  return buildRotaNavItems(reassignCount, {
    canViewRota,
    canViewLeave,
    canViewTimeclock,
    canViewPayroll,
    canManageSettings,
    weeksNeedingPublishing,
  });
});
