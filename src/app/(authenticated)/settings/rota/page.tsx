import { redirect } from 'next/navigation';
import { PageLayout } from '@/ds';
import { Section } from '@/ds';
import { Card } from '@/ds';
import { checkUserPermission } from '@/app/actions/rbac';
import { getRotaSettings } from '@/app/actions/rota-settings';
import { buildRotaNavItems } from '@/app/(authenticated)/rota/nav';
import RotaSettingsManager from './RotaSettingsManager';

export const dynamic = 'force-dynamic';

export default async function RotaSettingsPage() {
  const canManage = await checkUserPermission('settings', 'manage');
  if (!canManage) redirect('/settings');

  // This page belongs to the rota section even though it lives under /settings, so
  // it carries the same navigation. The badges are deliberately left off: they are
  // a "what needs doing now" signal for the working pages, and every other rota
  // page renders the nav unbadged too.
  const [canViewRota, canViewLeave, canViewTimeclock, canViewPayroll, settings] = await Promise.all([
    checkUserPermission('rota', 'view'),
    checkUserPermission('leave', 'view'),
    checkUserPermission('timeclock', 'view'),
    checkUserPermission('payroll', 'view'),
    getRotaSettings(),
  ]);

  const navItems = canViewRota
    ? buildRotaNavItems(0, {
        canViewLeave,
        canViewTimeclock,
        canViewPayroll,
        canManageSettings: canManage,
      })
    : undefined;

  return (
    <PageLayout
      title="Rota Settings"
      subtitle="Configure holiday year, allowances, and notification emails"
      navItems={navItems}
      backButton={{ label: 'Back to Settings', href: '/settings' }}
    >
      <Section
        title="Configuration"
        description="These settings apply across the rota, leave, and payroll modules."
      >
        <Card>
          <RotaSettingsManager initialSettings={settings} canManage={canManage} />
        </Card>
      </Section>
    </PageLayout>
  );
}
