import { redirect } from 'next/navigation';
import { PageLayout } from '@/components/ui-v2/layout/PageLayout';
import { Section } from '@/components/ui-v2/layout/Section';
import { Card } from '@/components/ui-v2/layout/Card';
import { checkUserPermission } from '@/app/actions/rbac';
import { getRotaSettings } from '@/app/actions/rota-settings';
import RotaSettingsManager from './RotaSettingsManager';

export const dynamic = 'force-dynamic';

export default async function RotaSettingsPage() {
  const canManage = await checkUserPermission('settings', 'manage');
  if (!canManage) redirect('/settings');

  const settings = await getRotaSettings();

  return (
    <PageLayout
      title="Rota Settings"
      subtitle="Configure holiday year, allowances, and notification emails"
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
