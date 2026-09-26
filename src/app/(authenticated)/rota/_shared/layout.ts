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
