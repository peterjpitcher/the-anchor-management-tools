type RotaNavItem = {
  label: string;
  href: string;
  badge?: string | number;
};

export const rotaNavItems: RotaNavItem[] = [
  { label: 'Rota', href: '/rota' },
  { label: 'Reassign', href: '/rota/reassign' },
  { label: 'Hours by employee', href: '/rota/hours' },
  { label: 'Leave', href: '/rota/leave' },
  { label: 'Timeclock', href: '/rota/timeclock' },
  { label: 'Labour Costs', href: '/rota/dashboard' },
  { label: 'Payroll', href: '/rota/payroll' },
];

/**
 * Same nav with a count against Reassign, so an unfilled shift is visible from
 * anywhere in the section. Zero leaves the badge off entirely, so the pill only
 * ever means "there is something here to clear".
 */
export function buildRotaNavItems(reassignCount: number): RotaNavItem[] {
  return rotaNavItems.map(item =>
    item.href === '/rota/reassign' && reassignCount > 0
      ? { ...item, badge: reassignCount }
      : item,
  );
}
