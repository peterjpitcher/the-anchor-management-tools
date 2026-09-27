import type { HeaderNavItem } from '@/ds';

/**
 * The PageLayout header a rota page builds once and hands to its client component, so the
 * page shows the same title, subtitle and tab row while loading, on error and when loaded.
 */
export interface RotaLayoutProps {
  title: string;
  subtitle?: string;
  navItems: HeaderNavItem[];
}

/**
 * The Leave tab's subtitle. Like every rota tab, it starts with the tab's own label ("Leave: ..."),
 * then says what is waiting.
 */
export function leaveSubtitle(pendingCount: number): string {
  if (pendingCount <= 0) return 'Leave: holiday requests';
  return `Leave: ${pendingCount} ${pendingCount === 1 ? 'request' : 'requests'} pending approval`;
}
