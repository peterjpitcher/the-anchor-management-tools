'use server';

import { redirect } from 'next/navigation';
import { checkUserPermission } from '@/app/actions/rbac';
import { getMenuTargetGp } from '@/app/actions/menu-settings';
import { PageLayout } from '@/ds';
import { Section } from '@/ds';
import { Card } from '@/ds';
import { MenuTargetForm } from './MenuTargetForm';

export default async function MenuTargetSettingsPage() {
  const canManage = await checkUserPermission('menu_management', 'manage');
  if (!canManage) {
    redirect('/unauthorized');
  }

  const currentTarget = await getMenuTargetGp();

  return (
    <PageLayout
      title="Menu GP Target"
      subtitle="Set the standard GP% target applied across every dish."
      backButton={{ label: 'Back to Settings', href: '/settings' }}
    >
      <Section
        title="Standard target"
        subtitle="Adjusting this value updates all dishes and future GP calculations."
      >
        <Card className="p-6">
          <MenuTargetForm initialTarget={currentTarget} />
        </Card>
      </Section>
    </PageLayout>
  );
}
