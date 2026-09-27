import { redirect } from 'next/navigation';
import { PageLayout } from '@/ds';
import { checkUserPermission } from '@/app/actions/rbac';
import { getRotaSettings } from '@/app/actions/rota-settings';
import { getRotaNavItems } from '@/app/(authenticated)/rota/_shared/nav';
import RotaSettingsManager from './RotaSettingsManager';

export const dynamic = 'force-dynamic';

export default async function RotaSettingsPage() {
  const canManage = await checkUserPermission('settings', 'manage');
  if (!canManage) redirect('/settings');

  // This page belongs to the rota section even though it lives under /settings, so it carries
  // the rota tab row: the same tabs, filtered and badged the same way, as every other rota page.
  const [rotaNavItems, settings] = await Promise.all([getRotaNavItems(), getRotaSettings()]);

  // A tab row needs somewhere else to go. Somebody who can manage settings but may open none of
  // the rota pages would get a row holding only this page, so they get no row at all: for them
  // it is simply the page behind the Settings tile, titled with its label and with a way back.
  const navItems = rotaNavItems.some(item => item.href !== '/settings/rota') ? rotaNavItems : undefined;

  // In the tab row it is titled "Rota" like every other page in that row, with no back button, and
  // its subtitle names the tab the way the other rota pages do ("Payroll: ...", "Timeclock: ...").
  return (
    <PageLayout
      title={navItems ? 'Rota' : 'Rota Settings'}
      subtitle={
        navItems
          ? 'Rota settings: holiday year, allowances, wage target and notification emails'
          : 'Holiday year, allowances, wage target and notification emails'
      }
      navItems={navItems}
      backButton={navItems ? undefined : { label: 'Back to Settings', href: '/settings' }}
      containerSize="md"
    >
      <RotaSettingsManager initialSettings={settings} canManage={canManage} />
    </PageLayout>
  );
}
